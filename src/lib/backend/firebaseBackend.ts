// Firestore backend: every phone listens to the same project documents, so a
// plot marked "Sold" on one phone shows up on all the others within a second.
//
// Data layout (see firestore.rules for who may read/write what):
//   joinCodes/{code}                     → { projectId, role }  (lookup by code only)
//   projects/{pid}                       → project settings
//   projects/{pid}/members/{uid}         → { role, name, code, joinedAt }
//   projects/{pid}/private/codes         → { adminCode, salesCode }  (admins only)
//   projects/{pid}/plots/{plotId}        → plot details + shape
//   projects/{pid}/layout/{chunk}        → background drawing (roads etc.)
//   projects/{pid}/activity/{id}         → history of status / shape changes

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, onAuthStateChanged, signInAnonymously, type Auth } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import { getRandomBytes } from 'expo-crypto';

import { generateCode, normalizeCode } from '../codes';
import { saleFields } from '../status';
import type { Activity, Broker, LayoutData, Member, NewProjectInput, Plot, PlotAccount, PlotPatch, PlotStatus, Project, ProjectCodes, Role } from '../types';
import { emulatorHost, firebaseConfig } from './config';
import { makeAuth } from './makeAuth';
import { docToPlot, plotToDoc } from './serialize';
import { UserError, type Backend, type BulkItem, type ErrCb, type LayoutReplace, type ProjectPatch, type ShapeEdit, type Unsub, type Who } from './types';

const BATCH_LIMIT = 400;
const CHUNK_PREFIX = 'p';

/** Runs many writes as several batches (Firestore allows 500 writes per batch). */
class BatchQueue {
  private batches: WriteBatch[] = [];
  private count = BATCH_LIMIT;
  constructor(private db: Firestore) {}
  private cur(): WriteBatch {
    if (this.count >= BATCH_LIMIT) {
      this.batches.push(writeBatch(this.db));
      this.count = 0;
    }
    this.count++;
    return this.batches[this.batches.length - 1];
  }
  set(ref: DocumentReference, data: Record<string, unknown>) {
    this.cur().set(ref, data);
  }
  update(ref: DocumentReference, data: Record<string, unknown>) {
    this.cur().update(ref, data);
  }
  delete(ref: DocumentReference) {
    this.cur().delete(ref);
  }
  /** Commits all batches. Firestore sends them in order, also after being offline. */
  commit(): Promise<void> {
    const all = Promise.all(this.batches.map((b) => b.commit())).then(() => undefined);
    this.batches = [];
    this.count = BATCH_LIMIT;
    return all;
  }
}

/** Called when a write that we stopped waiting for fails later (e.g. rejected after coming online). */
export const backgroundErrors: { handler: (e: Error) => void } = { handler: () => undefined };

/**
 * Waits for a write to reach the server, but no longer than `ms`. Firestore
 * already applied the write on this phone (listeners update at once); when the
 * phone is offline the write is queued and sent automatically later.
 */
async function soft(p: Promise<unknown>, ms = 4000): Promise<void> {
  const r = await Promise.race([
    p.then(
      () => 'ok' as const,
      (e) => ({ e }),
    ),
    new Promise<'pending'>((res) => setTimeout(() => res('pending'), ms)),
  ]);
  if (r === 'pending') p.catch((e) => backgroundErrors.handler(friendly(e)));
  else if (r !== 'ok') throw friendly(r.e);
}

function friendly(e: unknown): Error {
  const code = (e as { code?: string })?.code || '';
  if (code.includes('permission-denied')) return new UserError('You do not have permission for this. Ask the project admin.');
  if (code.includes('unavailable')) return new UserError('No internet connection. Changes will sync when you are back online.');
  if (code.includes('admin-restricted-operation') || code.includes('operation-not-allowed'))
    return new UserError('Anonymous sign-in is not enabled in Firebase. See SETUP.md, step 3.');
  return e instanceof Error ? e : new Error(String(e));
}

export class FirebaseBackend implements Backend {
  readonly kind = 'firebase' as const;
  private app: FirebaseApp;
  private auth: Auth;
  private db: Firestore;
  private uidPromise: Promise<string> | null = null;
  private uid: string | null = null;

  constructor() {
    this.app = getApps()[0] ?? initializeApp(firebaseConfig);
    this.auth = makeAuth(this.app);
    this.db = initializeFirestore(this.app, { ignoreUndefinedProperties: true });
    if (emulatorHost) {
      connectAuthEmulator(this.auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(this.db, emulatorHost, 8080);
    }
  }

  ready(): Promise<string> {
    if (!this.uidPromise) {
      this.uidPromise = new Promise<string>((resolve, reject) => {
        const unsub = onAuthStateChanged(
          this.auth,
          async (user) => {
            unsub();
            try {
              const u = user ?? (await signInAnonymously(this.auth)).user;
              this.uid = u.uid;
              resolve(u.uid);
            } catch (e) {
              this.uidPromise = null;
              reject(friendly(e));
            }
          },
          (e) => {
            this.uidPromise = null;
            reject(friendly(e));
          },
        );
      });
    }
    return this.uidPromise;
  }

  newId(): string {
    return doc(collection(this.db, 'ids')).id;
  }

  private me(): string {
    if (!this.uid) throw new Error('Not signed in yet.');
    return this.uid;
  }

  private projectRef(pid: string) {
    return doc(this.db, 'projects', pid);
  }
  private sub(pid: string, name: string, id?: string) {
    return id ? doc(this.db, 'projects', pid, name, id) : doc(collection(this.db, 'projects', pid, name));
  }

  private writeLayout(q: BatchQueue, pid: string, layout: LayoutData, oldIds: string[]) {
    const ids = new Set<string>();
    layout.paths.forEach((d, i) => {
      const id = CHUNK_PREFIX + i;
      ids.add(id);
      q.set(this.sub(pid, 'layout', id), { kind: 'paths', i, d });
    });
    ids.add('texts');
    q.set(this.sub(pid, 'layout', 'texts'), { kind: 'texts', json: JSON.stringify(layout.texts) });
    for (const id of oldIds) if (!ids.has(id)) q.delete(this.sub(pid, 'layout', id));
  }

  async createProject(input: NewProjectInput, layout: LayoutData, plots: Plot[], who: Who) {
    const uid = await this.ready();
    const pid = doc(collection(this.db, 'projects')).id;
    const now = Date.now();
    const codes: ProjectCodes = { adminCode: generateCode(getRandomBytes), salesCode: generateCode(getRandomBytes) };
    // Step 1: project, its two join codes and me as admin (one batch, required by the security rules)
    const b = writeBatch(this.db);
    const project: Omit<Project, 'id'> = { ...input, ownerUid: uid, createdAt: now, updatedAt: now, layoutVersion: 1 };
    b.set(this.projectRef(pid), project);
    b.set(doc(this.db, 'joinCodes', codes.adminCode), { projectId: pid, role: 'admin', createdAt: now });
    b.set(doc(this.db, 'joinCodes', codes.salesCode), { projectId: pid, role: 'sales', createdAt: now });
    b.set(this.sub(pid, 'members', uid), { role: 'admin', name: who.name, code: codes.adminCode, joinedAt: now });
    const step1 = b.commit();
    await soft(step1, 8000);
    // Step 2: everything else (sent after step 1, also when offline)
    const q = new BatchQueue(this.db);
    q.set(this.sub(pid, 'private', 'codes'), { ...codes });
    this.writeLayout(q, pid, layout, []);
    for (const p of plots) q.set(this.sub(pid, 'plots', p.id), plotToDoc({ ...p, updatedAt: now, updatedBy: uid, updatedByName: who.name }));
    await soft(q.commit(), 8000);
    return { projectId: pid, codes };
  }

  async joinProject(rawCode: string, who: Who) {
    const uid = await this.ready();
    const code = normalizeCode(rawCode);
    let snap;
    try {
      snap = await getDoc(doc(this.db, 'joinCodes', code));
    } catch (e) {
      throw friendly(e);
    }
    if (!snap.exists()) throw new UserError('This project code was not found. Check the code with your admin.');
    const { projectId, role } = snap.data() as { projectId: string; role: Role };
    const memberRef = this.sub(projectId, 'members', uid);
    let existingRole: Role | null = null;
    try {
      const m = await getDoc(memberRef);
      if (m.exists()) existingRole = (m.data() as Member).role;
    } catch {
      // not a member yet → reading is not allowed, that's fine
    }
    try {
      if (!(existingRole === 'admin' && role === 'sales')) {
        await writeBatch(this.db)
          .set(memberRef, { role, name: who.name, code, joinedAt: Date.now() })
          .commit();
      }
      const p = await getDoc(this.projectRef(projectId));
      return { projectId, role: existingRole === 'admin' ? 'admin' : role, name: (p.data()?.name as string) ?? 'Project' };
    } catch (e) {
      throw friendly(e);
    }
  }

  watchProject(pid: string, cb: (p: Project | null) => void, err?: ErrCb): Unsub {
    return onSnapshot(
      this.projectRef(pid),
      (s) => cb(s.exists() ? ({ id: s.id, ...(s.data() as Omit<Project, 'id'>) } as Project) : null),
      (e) => err?.(friendly(e)),
    );
  }

  watchPlots(pid: string, cb: (plots: Plot[]) => void, err?: ErrCb): Unsub {
    return onSnapshot(
      collection(this.db, 'projects', pid, 'plots'),
      (s) => cb(s.docs.map((d) => docToPlot(d.id, d.data()))),
      (e) => err?.(friendly(e)),
    );
  }

  watchLayout(pid: string, cb: (l: LayoutData) => void, err?: ErrCb): Unsub {
    return onSnapshot(
      collection(this.db, 'projects', pid, 'layout'),
      (s) => {
        const chunks: { i: number; d: string }[] = [];
        let texts: LayoutData['texts'] = [];
        for (const d of s.docs) {
          const v = d.data();
          if (v.kind === 'paths') chunks.push({ i: v.i, d: v.d });
          else if (v.kind === 'texts') {
            try {
              texts = JSON.parse(v.json || '[]');
            } catch {
              texts = [];
            }
          }
        }
        chunks.sort((a, b) => a.i - b.i);
        cb({ paths: chunks.map((c) => c.d), texts });
      },
      (e) => err?.(friendly(e)),
    );
  }

  watchMembership(pid: string, cb: (m: Member | null) => void, err?: ErrCb): Unsub {
    const uid = this.me();
    return onSnapshot(
      this.sub(pid, 'members', uid),
      (s) => cb(s.exists() ? ({ uid, ...(s.data() as Omit<Member, 'uid'>) } as Member) : null),
      (e) => {
        // once removed from a project the rules stop us reading it
        if (String((e as { code?: string }).code).includes('permission-denied')) cb(null);
        else err?.(friendly(e));
      },
    );
  }

  watchMembers(pid: string, cb: (ms: Member[]) => void, err?: ErrCb): Unsub {
    return onSnapshot(
      collection(this.db, 'projects', pid, 'members'),
      (s) => cb(s.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) }))),
      (e) => err?.(friendly(e)),
    );
  }

  watchActivity(pid: string, plotId: string | null, cb: (a: Activity[]) => void, err?: ErrCb): Unsub {
    const col = collection(this.db, 'projects', pid, 'activity');
    const q = plotId ? query(col, where('plotId', '==', plotId), limit(50)) : query(col, orderBy('at', 'desc'), limit(100));
    return onSnapshot(
      q,
      (s) => cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Activity, 'id'>) })).sort((a, b) => b.at - a.at)),
      (e) => err?.(friendly(e)),
    );
  }

  async getCodes(pid: string): Promise<ProjectCodes> {
    try {
      const s = await getDoc(this.sub(pid, 'private', 'codes'));
      if (!s.exists()) throw new UserError('Codes not found.');
      return s.data() as ProjectCodes;
    } catch (e) {
      throw friendly(e);
    }
  }

  async updateProject(pid: string, patch: ProjectPatch) {
    await soft(
      writeBatch(this.db)
        .update(this.projectRef(pid), { ...patch, updatedAt: Date.now() })
        .commit(),
    );
  }

  private activity(pid: string, a: Omit<Activity, 'id' | 'by' | 'at'>): [DocumentReference, Record<string, unknown>] {
    return [this.sub(pid, 'activity'), { ...a, by: this.me(), at: Date.now() }];
  }

  async updatePlot(pid: string, before: Plot, patch: PlotPatch, who: Who) {
    const uid = await this.ready();
    const b = writeBatch(this.db);
    b.update(this.sub(pid, 'plots', before.id), plotToDoc({ ...patch, ...saleFields(before, patch.status, who.name, patch.bookingDate), updatedAt: Date.now(), updatedBy: uid, updatedByName: who.name }));
    if (patch.status && patch.status !== before.status) {
      b.set(...this.activity(pid, { plotId: before.id, plotNumber: before.number, action: 'status', from: before.status, to: patch.status, byName: who.name }));
    } else if (patch.number && patch.number !== before.number) {
      b.set(...this.activity(pid, { plotId: before.id, plotNumber: patch.number, action: 'renamed', from: before.number, to: patch.number, byName: who.name }));
    }
    await soft(b.commit());
  }

  async bulkUpdatePlots(pid: string, items: BulkItem[], who: Who) {
    const uid = await this.ready();
    const now = Date.now();
    const q = new BatchQueue(this.db);
    for (const { before, patch } of items) {
      q.update(this.sub(pid, 'plots', before.id), plotToDoc({ ...patch, ...saleFields(before, patch.status, who.name, patch.bookingDate), updatedAt: now, updatedBy: uid, updatedByName: who.name }));
      if (patch.status && patch.status !== before.status) {
        q.set(...this.activity(pid, { plotId: before.id, plotNumber: before.number, action: 'status', from: before.status, to: patch.status, byName: who.name }));
      }
    }
    await soft(q.commit());
  }

  async applyShapeEdit(pid: string, edit: ShapeEdit, who: Who) {
    const uid = await this.ready();
    const now = Date.now();
    const q = new BatchQueue(this.db);
    for (const p of edit.upserts) q.set(this.sub(pid, 'plots', p.id), plotToDoc({ ...p, updatedAt: now, updatedBy: uid, updatedByName: who.name }));
    for (const id of edit.deletes) q.delete(this.sub(pid, 'plots', id));
    const first = edit.upserts[0];
    q.set(...this.activity(pid, { plotId: first?.id ?? '', plotNumber: first?.number ?? '', action: 'shape', to: edit.note, byName: who.name }));
    await soft(q.commit());
  }

  async replaceLayout(pid: string, data: LayoutReplace, who: Who) {
    const uid = await this.ready();
    const now = Date.now();
    try {
      const old = await getDocs(collection(this.db, 'projects', pid, 'layout'));
      const proj = await getDoc(this.projectRef(pid));
      const q = new BatchQueue(this.db);
      this.writeLayout(
        q,
        pid,
        data.layout,
        old.docs.map((d) => d.id),
      );
      for (const p of data.upserts) q.set(this.sub(pid, 'plots', p.id), plotToDoc({ ...p, updatedAt: now, updatedBy: uid, updatedByName: who.name }));
      for (const id of data.deletes) q.delete(this.sub(pid, 'plots', id));
      q.update(this.projectRef(pid), {
        bounds: data.bounds,
        origin: data.origin,
        drawingUnit: data.drawingUnit,
        layoutVersion: ((proj.data()?.layoutVersion as number) || 1) + 1,
        updatedAt: now,
      });
      q.set(...this.activity(pid, { plotId: '', plotNumber: '', action: 'layout', to: `New drawing imported (${data.upserts.length} plots)`, byName: who.name }));
      await q.commit();
    } catch (e) {
      throw friendly(e);
    }
  }

  async requestStatus(pid: string, plot: Plot, status: PlotStatus, who: Who) {
    const uid = await this.ready();
    const now = Date.now();
    const b = writeBatch(this.db);
    b.update(this.sub(pid, 'plots', plot.id), { pending: { status, by: uid, byName: who.name, at: now }, updatedAt: now, updatedBy: uid, updatedByName: who.name });
    b.set(...this.activity(pid, { plotId: plot.id, plotNumber: plot.number, action: 'request', from: plot.status, to: status, byName: who.name }));
    await soft(b.commit());
  }

  async cancelRequest(pid: string, plot: Plot, who: Who) {
    const uid = await this.ready();
    await soft(
      writeBatch(this.db)
        .update(this.sub(pid, 'plots', plot.id), { pending: null, updatedAt: Date.now(), updatedBy: uid, updatedByName: who.name })
        .commit(),
    );
  }

  async decideRequest(pid: string, plot: Plot, approve: boolean, who: Who) {
    const uid = await this.ready();
    const req = plot.pending;
    if (!req) return;
    const now = Date.now();
    const b = writeBatch(this.db);
    const patch: Record<string, unknown> = { pending: null, updatedAt: now, updatedBy: uid, updatedByName: who.name };
    if (approve) Object.assign(patch, { status: req.status, ...saleFields(plot, req.status, req.byName) });
    b.update(this.sub(pid, 'plots', plot.id), patch);
    b.set(
      ...this.activity(pid, {
        plotId: plot.id,
        plotNumber: plot.number,
        action: approve ? 'status' : 'rejected',
        from: plot.status,
        to: req.status,
        note: `${approve ? 'Approved' : 'Rejected'} request from ${req.byName}`,
        byName: who.name,
      }),
    );
    await soft(b.commit());
  }

  watchAccounts(pid: string, cb: (a: Record<string, PlotAccount>) => void, err?: ErrCb): Unsub {
    return onSnapshot(
      collection(this.db, 'projects', pid, 'accounts'),
      (s) => cb(Object.fromEntries(s.docs.map((d) => [d.id, { plotId: d.id, schedule: [], payments: [], commissionPayments: [], ...(d.data() as Partial<PlotAccount>) } as PlotAccount]))),
      (e) => err?.(friendly(e)),
    );
  }

  async saveAccount(pid: string, acc: PlotAccount, who: Who) {
    await soft(setDoc(this.sub(pid, 'accounts', acc.plotId), { ...acc, updatedAt: Date.now(), updatedByName: who.name }));
  }

  watchBrokers(pid: string, cb: (b: Broker[]) => void, err?: ErrCb): Unsub {
    return onSnapshot(
      collection(this.db, 'projects', pid, 'brokers'),
      (s) => cb(s.docs.map((d) => ({ ...(d.data() as Broker), id: d.id })).sort((a, b) => a.name.localeCompare(b.name))),
      (e) => err?.(friendly(e)),
    );
  }

  async saveBroker(pid: string, b: Broker) {
    const { id, ...rest } = b;
    await soft(setDoc(this.sub(pid, 'brokers', id), rest));
  }

  async deleteBroker(pid: string, id: string) {
    await soft(writeBatch(this.db).delete(this.sub(pid, 'brokers', id)).commit());
  }

  async nextReceiptNo(pid: string): Promise<number> {
    const ref = this.sub(pid, 'private', 'counters');
    try {
      return await runTransaction(this.db, async (t) => {
        const cur = await t.get(ref);
        const next = ((cur.data()?.receipt as number) || 0) + 1;
        t.set(ref, { receipt: next }, { merge: true });
        return next;
      });
    } catch (e) {
      const code = String((e as { code?: string })?.code);
      if (code.includes('unavailable') || code.includes('failed-precondition')) throw new UserError('A receipt number needs internet. Try again when online.');
      throw friendly(e);
    }
  }

  async regenerateCode(pid: string, role: Role): Promise<ProjectCodes> {
    const current = await this.getCodes(pid);
    for (let attempt = 0; ; attempt++) {
      const code = generateCode(getRandomBytes);
      const next: ProjectCodes = role === 'admin' ? { ...current, adminCode: code } : { ...current, salesCode: code };
      const old = role === 'admin' ? current.adminCode : current.salesCode;
      try {
        await writeBatch(this.db)
          .set(doc(this.db, 'joinCodes', code), { projectId: pid, role, createdAt: Date.now() })
          .delete(doc(this.db, 'joinCodes', old))
          .set(this.sub(pid, 'private', 'codes'), next)
          .commit();
        return next;
      } catch (e) {
        if (attempt < 2) continue;
        throw friendly(e);
      }
    }
  }

  async removeMember(pid: string, uid: string) {
    try {
      await writeBatch(this.db).delete(this.sub(pid, 'members', uid)).commit();
    } catch (e) {
      throw friendly(e);
    }
  }

  async leaveProject(pid: string) {
    const uid = await this.ready();
    try {
      await writeBatch(this.db).delete(this.sub(pid, 'members', uid)).commit();
    } catch {
      // already removed — nothing to do
    }
  }

  async deleteProject(pid: string) {
    const uid = await this.ready();
    try {
      const q = new BatchQueue(this.db);
      for (const name of ['plots', 'layout', 'activity', 'private', 'accounts', 'brokers']) {
        const s = await getDocs(collection(this.db, 'projects', pid, name));
        s.docs.forEach((d) => q.delete(d.ref));
      }
      const codes = await this.getCodes(pid).catch(() => null);
      if (codes) {
        q.delete(doc(this.db, 'joinCodes', codes.adminCode));
        q.delete(doc(this.db, 'joinCodes', codes.salesCode));
      }
      const members = await getDocs(collection(this.db, 'projects', pid, 'members'));
      members.docs.filter((d) => d.id !== uid).forEach((d) => q.delete(d.ref));
      await q.commit();
      // the project itself, then my own membership last (the rules check it)
      await writeBatch(this.db).delete(this.projectRef(pid)).commit();
      await writeBatch(this.db).delete(this.sub(pid, 'members', uid)).commit();
    } catch (e) {
      throw friendly(e);
    }
  }
}

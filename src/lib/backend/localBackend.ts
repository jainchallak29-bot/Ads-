// Device-only backend, used when Firebase isn't configured yet. Same features,
// but data stays on this phone (no sharing between phones).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRandomBytes } from 'expo-crypto';

import { generateCode, normalizeCode } from '../codes';
import type { Activity, LayoutData, Member, NewProjectInput, Plot, PlotPatch, Project, ProjectCodes, Role } from '../types';
import { UserError, type Backend, type ErrCb, type LayoutReplace, type ProjectPatch, type ShapeEdit, type Unsub, type Who } from './types';

const KEY = (pid: string) => `local-project:${pid}`;
const CODES_KEY = 'local-codes';
const LOCAL_UID = 'this-device';

interface Stored {
  project: Project;
  plots: Record<string, Plot>;
  layout: LayoutData;
  members: Member[];
  codes: ProjectCodes;
  activity: Activity[];
}

type Listener = () => void;

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private cache = new Map<string, Stored | null>();
  private listeners = new Map<string, Set<Listener>>();

  async ready() {
    return LOCAL_UID;
  }

  newId() {
    const b = getRandomBytes(10);
    return Array.from(b, (x) => (x % 36).toString(36)).join('') + Date.now().toString(36);
  }

  private async load(pid: string): Promise<Stored | null> {
    if (this.cache.has(pid)) return this.cache.get(pid)!;
    const raw = await AsyncStorage.getItem(KEY(pid));
    const s = raw ? (JSON.parse(raw) as Stored) : null;
    this.cache.set(pid, s);
    return s;
  }

  private async save(pid: string, s: Stored | null) {
    this.cache.set(pid, s);
    if (s) await AsyncStorage.setItem(KEY(pid), JSON.stringify(s));
    else await AsyncStorage.removeItem(KEY(pid));
    this.listeners.get(pid)?.forEach((l) => l());
  }

  private async mutate(pid: string, fn: (s: Stored) => void) {
    const s = await this.load(pid);
    if (!s) throw new UserError('Project not found on this phone.');
    const copy: Stored = JSON.parse(JSON.stringify(s));
    fn(copy);
    copy.project.updatedAt = Date.now();
    await this.save(pid, copy);
  }

  private watch<T>(pid: string, pick: (s: Stored | null) => T, cb: (v: T) => void): Unsub {
    let alive = true;
    const fire = () => {
      this.load(pid).then((s) => alive && cb(pick(s)));
    };
    let set = this.listeners.get(pid);
    if (!set) this.listeners.set(pid, (set = new Set()));
    set.add(fire);
    fire();
    return () => {
      alive = false;
      set!.delete(fire);
    };
  }

  private async codeMap(): Promise<Record<string, { projectId: string; role: Role }>> {
    const raw = await AsyncStorage.getItem(CODES_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  async createProject(input: NewProjectInput, layout: LayoutData, plots: Plot[], who: Who) {
    const pid = this.newId();
    const now = Date.now();
    const codes = { adminCode: generateCode(getRandomBytes), salesCode: generateCode(getRandomBytes) };
    const s: Stored = {
      project: { ...input, id: pid, ownerUid: LOCAL_UID, createdAt: now, updatedAt: now, layoutVersion: 1 },
      plots: Object.fromEntries(plots.map((p) => [p.id, { ...p, updatedAt: now, updatedBy: LOCAL_UID, updatedByName: who.name }])),
      layout,
      members: [{ uid: LOCAL_UID, role: 'admin', name: who.name, code: codes.adminCode, joinedAt: now }],
      codes,
      activity: [],
    };
    await this.save(pid, s);
    const map = await this.codeMap();
    map[codes.adminCode] = { projectId: pid, role: 'admin' };
    map[codes.salesCode] = { projectId: pid, role: 'sales' };
    await AsyncStorage.setItem(CODES_KEY, JSON.stringify(map));
    return { projectId: pid, codes };
  }

  async joinProject(code: string, who: Who) {
    const hit = (await this.codeMap())[normalizeCode(code)];
    const s = hit ? await this.load(hit.projectId) : null;
    if (!hit || !s) {
      throw new UserError('Code not found. Sharing between phones needs the Firebase setup (see SETUP.md) — right now the app runs in this-phone-only mode.');
    }
    return { projectId: hit.projectId, role: 'admin' as Role, name: s.project.name };
  }

  watchProject(pid: string, cb: (p: Project | null) => void): Unsub {
    return this.watch(pid, (s) => s?.project ?? null, cb);
  }
  watchPlots(pid: string, cb: (plots: Plot[]) => void): Unsub {
    return this.watch(pid, (s) => (s ? Object.values(s.plots) : []), cb);
  }
  watchLayout(pid: string, cb: (l: LayoutData) => void): Unsub {
    return this.watch(pid, (s) => s?.layout ?? { paths: [], texts: [] }, cb);
  }
  watchMembership(pid: string, cb: (m: Member | null) => void): Unsub {
    return this.watch(pid, (s) => s?.members.find((m) => m.uid === LOCAL_UID) ?? null, cb);
  }
  watchMembers(pid: string, cb: (ms: Member[]) => void): Unsub {
    return this.watch(pid, (s) => s?.members ?? [], cb);
  }
  watchActivity(pid: string, plotId: string | null, cb: (a: Activity[]) => void, _err?: ErrCb): Unsub {
    return this.watch(pid, (s) => (s?.activity ?? []).filter((a) => !plotId || a.plotId === plotId).slice(0, 100), cb);
  }

  async getCodes(pid: string) {
    const s = await this.load(pid);
    if (!s) throw new UserError('Project not found.');
    return s.codes;
  }

  async updateProject(pid: string, patch: ProjectPatch) {
    await this.mutate(pid, (s) => Object.assign(s.project, patch));
  }

  private log(s: Stored, a: Omit<Activity, 'id' | 'by' | 'at'>) {
    s.activity.unshift({ ...a, id: this.newId(), by: LOCAL_UID, at: Date.now() });
    s.activity = s.activity.slice(0, 500);
  }

  async updatePlot(pid: string, before: Plot, patch: PlotPatch, who: Who) {
    await this.mutate(pid, (s) => {
      const cur = s.plots[before.id];
      if (!cur) throw new UserError('This plot no longer exists.');
      s.plots[before.id] = { ...cur, ...patch, updatedAt: Date.now(), updatedBy: LOCAL_UID, updatedByName: who.name };
      if (patch.status && patch.status !== before.status) {
        this.log(s, { plotId: before.id, plotNumber: before.number, action: 'status', from: before.status, to: patch.status, byName: who.name });
      } else if (patch.number && patch.number !== before.number) {
        this.log(s, { plotId: before.id, plotNumber: patch.number, action: 'renamed', from: before.number, to: patch.number, byName: who.name });
      }
    });
  }

  async applyShapeEdit(pid: string, edit: ShapeEdit, who: Who) {
    await this.mutate(pid, (s) => {
      for (const p of edit.upserts) s.plots[p.id] = { ...p, updatedAt: Date.now(), updatedBy: LOCAL_UID, updatedByName: who.name };
      for (const id of edit.deletes) delete s.plots[id];
      const first = edit.upserts[0];
      this.log(s, { plotId: first?.id ?? '', plotNumber: first?.number ?? '', action: 'shape', to: edit.note, byName: who.name });
    });
  }

  async replaceLayout(pid: string, data: LayoutReplace, who: Who) {
    await this.mutate(pid, (s) => {
      s.layout = data.layout;
      for (const id of data.deletes) delete s.plots[id];
      for (const p of data.upserts) s.plots[p.id] = { ...p, updatedAt: Date.now(), updatedBy: LOCAL_UID, updatedByName: who.name };
      s.project.bounds = data.bounds;
      s.project.origin = data.origin;
      s.project.drawingUnit = data.drawingUnit;
      s.project.layoutVersion++;
      this.log(s, { plotId: '', plotNumber: '', action: 'layout', to: `New drawing imported (${data.upserts.length} plots)`, byName: who.name });
    });
  }

  async regenerateCode(pid: string, role: Role) {
    const map = await this.codeMap();
    let next: ProjectCodes | null = null;
    await this.mutate(pid, (s) => {
      const code = generateCode(getRandomBytes);
      const old = role === 'admin' ? s.codes.adminCode : s.codes.salesCode;
      delete map[old];
      map[code] = { projectId: pid, role };
      s.codes = role === 'admin' ? { ...s.codes, adminCode: code } : { ...s.codes, salesCode: code };
      next = s.codes;
    });
    await AsyncStorage.setItem(CODES_KEY, JSON.stringify(map));
    return next!;
  }

  async removeMember(pid: string, uid: string) {
    await this.mutate(pid, (s) => {
      s.members = s.members.filter((m) => m.uid !== uid);
    });
  }

  async leaveProject(pid: string) {
    await this.deleteProject(pid);
  }

  async deleteProject(pid: string) {
    const s = await this.load(pid);
    if (s) {
      const map = await this.codeMap();
      delete map[s.codes.adminCode];
      delete map[s.codes.salesCode];
      await AsyncStorage.setItem(CODES_KEY, JSON.stringify(map));
    }
    await this.save(pid, null);
  }
}

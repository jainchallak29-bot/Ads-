// Security-rule tests. Run with:  npm run test:rules   (starts the Firestore emulator)
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';

let env: RulesTestEnvironment;
const PID = 'proj1';
const ADMIN_CODE = 'ADMN2345';
const SALES_CODE = 'SALE2345';

const db = (uid: string | null) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore()) as unknown as Firestore;

const project = (owner: string) => ({
  name: 'Green Valley',
  ownerUid: owner,
  drawingUnit: 'ft',
  areaUnit: 'sqyd',
  lengthUnit: 'ft',
  currency: '₹',
  salesCanEdit: true,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  origin: { x: 0, y: 0 },
  createdAt: 1,
  updatedAt: 1,
  layoutVersion: 1,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-plot-inventory',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
});

after(async () => {
  await env?.cleanup();
});

test('owner creates a project with codes in one batch', async () => {
  const d = db('owner');
  const b = writeBatch(d);
  b.set(doc(d, 'projects', PID), project('owner'));
  b.set(doc(d, 'joinCodes', ADMIN_CODE), { projectId: PID, role: 'admin', createdAt: 1 });
  b.set(doc(d, 'joinCodes', SALES_CODE), { projectId: PID, role: 'sales', createdAt: 1 });
  b.set(doc(d, 'projects', PID, 'members', 'owner'), { role: 'admin', name: 'Owner', code: ADMIN_CODE, joinedAt: 1 });
  await assertSucceeds(b.commit());

  const b2 = writeBatch(d);
  b2.set(doc(d, 'projects', PID, 'private', 'codes'), { adminCode: ADMIN_CODE, salesCode: SALES_CODE });
  b2.set(doc(d, 'projects', PID, 'plots', 'p1'), { number: '1', pts: [0, 0, 1, 0, 1, 1], status: 'available', rate: 100 });
  b2.set(doc(d, 'projects', PID, 'layout', 'p0'), { kind: 'paths', i: 0, d: 'M0 0L1 1' });
  await assertSucceeds(b2.commit());
});

test('strangers cannot read or list anything', async () => {
  const d = db('stranger');
  await assertFails(getDoc(doc(d, 'projects', PID)));
  await assertFails(getDocs(collection(d, 'projects', PID, 'plots')));
  await assertFails(getDocs(collection(d, 'joinCodes')));
  await assertFails(getDoc(doc(db(null), 'joinCodes', SALES_CODE)));
  // knowing a code lets you look it up
  await assertSucceeds(getDoc(doc(d, 'joinCodes', SALES_CODE)));
});

test('cannot hijack an existing project with forged codes', async () => {
  const d = db('attacker');
  await assertFails(setDoc(doc(d, 'joinCodes', 'EVIL2345'), { projectId: PID, role: 'admin', createdAt: 1 }));
  const b = writeBatch(d);
  b.set(doc(d, 'joinCodes', 'EVIL2346'), { projectId: PID, role: 'admin', createdAt: 1 });
  b.set(doc(d, 'projects', PID, 'members', 'attacker'), { role: 'admin', name: 'x', code: 'EVIL2346', joinedAt: 1 });
  await assertFails(b.commit());
  await assertFails(setDoc(doc(d, 'projects', PID), project('attacker')));
  // claiming admin with the sales code
  await assertFails(setDoc(doc(d, 'projects', PID, 'members', 'attacker'), { role: 'admin', name: 'x', code: SALES_CODE, joinedAt: 1 }));
  // writing someone else's membership
  await assertFails(setDoc(doc(d, 'projects', PID, 'members', 'other'), { role: 'sales', name: 'x', code: SALES_CODE, joinedAt: 1 }));
});

test('sales member joins and can view but not see codes or edit details', async () => {
  const d = db('sales1');
  await assertSucceeds(setDoc(doc(d, 'projects', PID, 'members', 'sales1'), { role: 'sales', name: 'Sam', code: SALES_CODE, joinedAt: 2 }));
  await assertSucceeds(getDoc(doc(d, 'projects', PID)));
  await assertSucceeds(getDocs(collection(d, 'projects', PID, 'plots')));
  await assertSucceeds(getDocs(collection(d, 'projects', PID, 'layout')));
  await assertFails(getDoc(doc(d, 'projects', PID, 'private', 'codes')));
  await assertFails(updateDoc(doc(d, 'projects', PID, 'plots', 'p1'), { rate: 1 }));
  await assertFails(setDoc(doc(d, 'projects', PID, 'plots', 'p2'), { number: '2', pts: [], status: 'available' }));
  await assertFails(deleteDoc(doc(d, 'projects', PID, 'plots', 'p1')));
  await assertFails(updateDoc(doc(d, 'projects', PID), { salesCanEdit: true }));
  // cannot promote self
  await assertFails(updateDoc(doc(d, 'projects', PID, 'members', 'sales1'), { role: 'admin' }));
});

test('sales can mark sold only while the admin allows it', async () => {
  const d = db('sales1');
  const plot = doc(d, 'projects', PID, 'plots', 'p1');
  await assertSucceeds(updateDoc(plot, { status: 'sold', buyerName: 'Ravi', updatedBy: 'sales1', updatedAt: 3, updatedByName: 'Sam' }));
  await assertFails(updateDoc(plot, { status: 'gone', updatedBy: 'sales1' }));
  await assertSucceeds(updateDoc(plot, { status: 'token', updatedBy: 'sales1' }));
  await assertFails(updateDoc(plot, { status: 'blocked', updatedBy: 'sales1' }));
  await assertFails(updateDoc(plot, { block: 'A', updatedBy: 'sales1' }));
  await assertFails(updateDoc(plot, { premiums: ['x'], updatedBy: 'sales1' }));
  // a plot the admin marked "Not for sale" can't be changed by sales
  await assertSucceeds(updateDoc(doc(db('owner'), 'projects', PID, 'plots', 'p1'), { status: 'blocked' }));
  await assertFails(updateDoc(plot, { status: 'available', updatedBy: 'sales1' }));
  await assertSucceeds(updateDoc(doc(db('owner'), 'projects', PID, 'plots', 'p1'), { status: 'sold' }));
  await assertSucceeds(setDoc(doc(d, 'projects', PID, 'activity', 'a1'), { plotId: 'p1', action: 'status', by: 'sales1', at: 3 }));
  await assertFails(setDoc(doc(d, 'projects', PID, 'activity', 'a2'), { plotId: 'p1', action: 'status', by: 'owner', at: 3 }));

  await assertSucceeds(updateDoc(doc(db('owner'), 'projects', PID), { salesCanEdit: false }));
  await assertFails(updateDoc(plot, { status: 'available', updatedBy: 'sales1' }));
  await assertSucceeds(updateDoc(doc(db('owner'), 'projects', PID), { salesCanEdit: true }));
});

test('admin manages codes and members', async () => {
  const d = db('owner');
  await assertSucceeds(getDoc(doc(d, 'projects', PID, 'private', 'codes')));
  const b = writeBatch(d);
  b.set(doc(d, 'joinCodes', 'NEWS2345'), { projectId: PID, role: 'sales', createdAt: 5 });
  b.delete(doc(d, 'joinCodes', SALES_CODE));
  b.set(doc(d, 'projects', PID, 'private', 'codes'), { adminCode: ADMIN_CODE, salesCode: 'NEWS2345' });
  await assertSucceeds(b.commit());
  // old code no longer works for new people
  await assertFails(setDoc(doc(db('late'), 'projects', PID, 'members', 'late'), { role: 'sales', name: 'L', code: SALES_CODE, joinedAt: 6 }));
  // remove the sales member → they lose access
  await assertSucceeds(deleteDoc(doc(d, 'projects', PID, 'members', 'sales1')));
  await assertFails(getDoc(doc(db('sales1'), 'projects', PID)));
  // a second admin can join with the admin code and edit everything
  await assertSucceeds(setDoc(doc(db('admin2'), 'projects', PID, 'members', 'admin2'), { role: 'admin', name: 'A2', code: ADMIN_CODE, joinedAt: 7 }));
  await assertSucceeds(updateDoc(doc(db('admin2'), 'projects', PID, 'plots', 'p1'), { rate: 200, pts: [0, 0, 2, 0, 2, 2] }));
  await assertFails(updateDoc(doc(db('admin2'), 'projects', PID), { ownerUid: 'admin2' }));
});

test('approval mode: sales can only request; one request at a time; admin decides', async () => {
  const owner = db('owner');
  await assertSucceeds(setDoc(doc(db('s2'), 'projects', PID, 'members', 's2'), { role: 'sales', name: 'S2', code: 'NEWS2345', joinedAt: 9 }));
  await assertSucceeds(setDoc(doc(db('s3'), 'projects', PID, 'members', 's3'), { role: 'sales', name: 'S3', code: 'NEWS2345', joinedAt: 9 }));
  await assertSucceeds(setDoc(doc(owner, 'projects', PID, 'plots', 'p9'), { number: '9', pts: [0, 0, 1, 0, 1, 1], status: 'available', pending: null }));
  await assertSucceeds(updateDoc(doc(owner, 'projects', PID), { features: { approval: true } }));
  const plot2 = doc(db('s2'), 'projects', PID, 'plots', 'p9');
  const plot3 = doc(db('s3'), 'projects', PID, 'plots', 'p9');
  // direct change no longer allowed
  await assertFails(updateDoc(plot2, { status: 'booked', updatedBy: 's2' }));
  // request is allowed
  await assertSucceeds(updateDoc(plot2, { pending: { status: 'booked', by: 's2', byName: 'S2', at: 1 }, buyerName: 'Ravi', updatedBy: 's2' }));
  // another salesperson can't overwrite or impersonate
  await assertFails(updateDoc(plot3, { pending: { status: 'sold', by: 's3', byName: 'S3', at: 2 }, updatedBy: 's3' }));
  await assertFails(updateDoc(plot3, { pending: null, updatedBy: 's3' }));
  // requester can cancel
  await assertSucceeds(updateDoc(plot2, { pending: null, updatedBy: 's2' }));
  await assertFails(updateDoc(plot2, { pending: { status: 'blocked', by: 's2', byName: 'S2', at: 3 }, updatedBy: 's2' }));
  await assertSucceeds(updateDoc(plot2, { pending: { status: 'sold', by: 's2', byName: 'S2', at: 3 }, updatedBy: 's2' }));
  // admin approves
  await assertSucceeds(updateDoc(doc(owner, 'projects', PID, 'plots', 'p9'), { status: 'sold', pending: null }));
  await assertSucceeds(updateDoc(doc(owner, 'projects', PID), { features: { approval: false } }));
});

test('accounts and brokers are admin-only', async () => {
  const owner = db('owner');
  await assertSucceeds(setDoc(doc(owner, 'projects', PID, 'accounts', 'p1'), { plotId: 'p1', schedule: [], payments: [{ amount: 5 }], commissionPayments: [] }));
  await assertSucceeds(setDoc(doc(owner, 'projects', PID, 'brokers', 'b1'), { name: 'Broker', commission: { kind: 'pct', value: 2 } }));
  const s2 = db('s2');
  await assertFails(getDoc(doc(s2, 'projects', PID, 'accounts', 'p1')));
  await assertFails(getDocs(collection(s2, 'projects', PID, 'accounts')));
  await assertFails(getDoc(doc(s2, 'projects', PID, 'brokers', 'b1')));
  await assertFails(setDoc(doc(s2, 'projects', PID, 'accounts', 'p2'), { plotId: 'p2' }));
  await assertFails(getDoc(doc(s2, 'projects', PID, 'private', 'counters')));
});

test('customer share link: public read, admin publish, status sync by members', async () => {
  const owner = db('owner');
  const b = writeBatch(owner);
  b.set(doc(owner, 'publicLayouts', 'tok123'), { projectId: PID, name: 'GV', plots: {}, st: { p1: 'a' }, rev: 'x' });
  b.set(doc(owner, 'publicLayouts', 'tok123', 'chunks', 'p0'), { kind: 'paths', i: 0, d: 'M0 0L1 1' });
  await assertSucceeds(b.commit());
  // anyone (even not signed in) can read it, but not list
  await assertSucceeds(getDoc(doc(db(null), 'publicLayouts', 'tok123')));
  await assertSucceeds(getDocs(collection(db(null), 'publicLayouts', 'tok123', 'chunks')));
  await assertFails(getDocs(collection(db(null), 'publicLayouts')));
  // strangers can't write; can't publish for someone else's project
  await assertFails(updateDoc(doc(db('stranger'), 'publicLayouts', 'tok123'), { st: { p1: 'n' } }));
  await assertFails(setDoc(doc(db('stranger'), 'publicLayouts', 'evil'), { projectId: PID, name: 'Fake' }));
  // a sales member with edit rights may only sync statuses
  await assertSucceeds(updateDoc(doc(db('s2'), 'publicLayouts', 'tok123'), { st: { p1: 'n' }, stAt: 5 }));
  await assertFails(updateDoc(doc(db('s2'), 'publicLayouts', 'tok123'), { name: 'Hacked' }));
  await assertFails(setDoc(doc(db('s2'), 'publicLayouts', 'tok123', 'chunks', 'p1'), { kind: 'paths', i: 1, d: '' }));
  // admin unpublishes (doc + chunks in one batch)
  const d = writeBatch(owner);
  d.delete(doc(owner, 'publicLayouts', 'tok123', 'chunks', 'p0'));
  d.delete(doc(owner, 'publicLayouts', 'tok123'));
  await assertSucceeds(d.commit());
});

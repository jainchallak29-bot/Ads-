// Storage rules for photos & documents. Run with: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';

let env: RulesTestEnvironment;
const PID = 'sproj';
const bytes = new Uint8Array([1, 2, 3, 4]);

const fs = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const st = (uid: string | null) => (uid ? env.authenticatedContext(uid).storage() : env.unauthenticatedContext().storage()) as unknown as FirebaseStorage;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-plot-inventory',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.clearFirestore();
  // a project with an admin and a sales member (written with rules disabled)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'projects', PID), { ownerUid: 'adm', salesCanEdit: true, name: 'S' });
    await setDoc(doc(db, 'projects', PID, 'members', 'adm'), { role: 'admin', name: 'A' });
    await setDoc(doc(db, 'projects', PID, 'members', 'sal'), { role: 'sales', name: 'S' });
  });
});

after(async () => {
  await env?.cleanup();
});

test('sales uploads a shared photo; everyone in the team can view; strangers cannot', async () => {
  await assertSucceeds(setDoc(doc(fs('sal'), 'projects', PID, 'files', 'f1'), { plotId: 'p1', name: 'a.jpg', private: false, uploadedBy: 'sal', kind: 'photo', at: 1 }));
  await assertSucceeds(uploadBytes(ref(st('sal'), `projects/${PID}/files/f1/a.jpg`), bytes));
  await assertSucceeds(getBytes(ref(st('adm'), `projects/${PID}/files/f1/a.jpg`)));
  await assertFails(getBytes(ref(st('stranger'), `projects/${PID}/files/f1/a.jpg`)));
  await assertFails(getBytes(ref(st(null), `projects/${PID}/files/f1/a.jpg`)));
  // no record → no upload
  await assertFails(uploadBytes(ref(st('sal'), `projects/${PID}/files/nope/x.jpg`), bytes));
});

test('private documents are admins only', async () => {
  await assertFails(setDoc(doc(fs('sal'), 'projects', PID, 'files', 'f2'), { plotId: 'p1', name: 'id.pdf', private: true, uploadedBy: 'sal', kind: 'doc', at: 1 }));
  await assertSucceeds(setDoc(doc(fs('adm'), 'projects', PID, 'files', 'f3'), { plotId: 'p1', name: 'id.pdf', private: true, uploadedBy: 'adm', kind: 'doc', at: 1 }));
  await assertSucceeds(uploadBytes(ref(st('adm'), `projects/${PID}/files/f3/id.pdf`), bytes));
  await assertFails(getBytes(ref(st('sal'), `projects/${PID}/files/f3/id.pdf`)));
  await assertSucceeds(getBytes(ref(st('adm'), `projects/${PID}/files/f3/id.pdf`)));
  // sales can't delete someone else's file; admin can
  await assertFails(deleteObject(ref(st('sal'), `projects/${PID}/files/f3/id.pdf`)));
  await assertSucceeds(deleteObject(ref(st('adm'), `projects/${PID}/files/f3/id.pdf`)));
});

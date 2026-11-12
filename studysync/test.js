// API tests using Node's built-in test runner:  npm test
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const dbFile = path.join(os.tmpdir(), `studysync-test-${process.pid}.db`);
process.env.DB_FILE = dbFile;
const app = require('./server');

let server, base;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => { server.close(); fs.rmSync(dbFile, { force: true }); });

const post = (body) => fetch(`${base}/api/sessions`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('rejects a session with no subject', async () => {
  const r = await post({ subject: '  ', duration_min: 30 });
  assert.equal(r.status, 400);
});

test('rejects zero, negative and absurd durations', async () => {
  for (const d of [0, -5, 'abc', 99999]) {
    const r = await post({ subject: 'Maths', duration_min: d });
    assert.equal(r.status, 400, `duration ${d} should be rejected`);
  }
});

test('rejects an unknown category', async () => {
  const r = await post({ subject: 'Maths', category: 'Gaming', duration_min: 20 });
  assert.equal(r.status, 400);
});

test('creates and lists sessions, newest first', async () => {
  const a = await (await post({ subject: 'Maths', category: 'Study', duration_min: 45, started_at: '2026-10-01T10:00:00Z' })).json();
  const b = await (await post({ subject: 'DBMS', category: 'Project', duration_min: 30.5, notes: 'ER diagram' })).json();
  assert.ok(a.id && b.id);
  const rows = await (await fetch(`${base}/api/sessions`)).json();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].subject, 'DBMS'); // newer first
});

test('summary totals by subject and category', async () => {
  await post({ subject: 'DBMS', category: 'Project', duration_min: 10 });
  const s = await (await fetch(`${base}/api/summary?days=7&tz=330`)).json();
  const dbms = s.bySubject.find((r) => r.subject === 'DBMS');
  assert.equal(dbms.minutes, 40.5);
  assert.equal(dbms.sessions, 2);
  assert.equal(s.topSubject, 'DBMS');
  assert.equal(s.perDay.length, 7);
  assert.equal(s.perDay.reduce((a, d) => a + d.minutes, 0), s.totalMinutes);
});

test('summary excludes sessions older than the range', async () => {
  const s = await (await fetch(`${base}/api/summary?days=7`)).json();
  assert.equal(s.bySubject.find((r) => r.subject === 'Maths'), undefined); // logged on 1 Oct
});

test('deletes a session and 404s on a missing one', async () => {
  const rows = await (await fetch(`${base}/api/sessions`)).json();
  const del = await fetch(`${base}/api/sessions/${rows[0].id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const again = await fetch(`${base}/api/sessions/${rows[0].id}`, { method: 'DELETE' });
  assert.equal(again.status, 404);
});

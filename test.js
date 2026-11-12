// API tests using Node's built-in test runner:  npm test
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const dbFile = path.join(os.tmpdir(), `studysync-test-${process.pid}.db`);
process.env.DB_FILE = dbFile;
const app = require('./server');

let server, base, cookie;
test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'secure-pass-123' }),
  });
  assert.equal(response.status, 201);
  cookie = response.headers.get('set-cookie').split(';')[0];
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  app.closeDatabase();
  fs.rmSync(dbFile, { force: true });
});

const requestAs = (sessionCookie, route, options = {}) => fetch(`${base}${route}`, {
  ...options,
  headers: { ...(options.headers || {}), cookie: sessionCookie },
});
const post = (body) => requestAs(cookie, '/api/sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('requires authentication and rejects invalid account credentials', async () => {
  const unauthorized = await fetch(`${base}/api/sessions`);
  assert.equal(unauthorized.status, 401);
  const invalid = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
  });
  assert.equal(invalid.status, 400);
  const duplicate = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'OWNER@example.com', password: 'secure-pass-123' }),
  });
  assert.equal(duplicate.status, 409);
  const wrongPassword = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'incorrect-pass' }),
  });
  assert.equal(wrongPassword.status, 401);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'OWNER@example.com', password: 'secure-pass-123' }),
  });
  assert.equal(login.status, 200);
  const me = await requestAs(login.headers.get('set-cookie').split(';')[0], '/api/auth/me');
  assert.equal((await me.json()).email, 'owner@example.com');
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
  const rows = await (await requestAs(cookie, '/api/sessions')).json();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].subject, 'DBMS'); // newer first
});

test('summary totals by subject and category', async () => {
  await post({ subject: 'DBMS', category: 'Project', duration_min: 10 });
  const s = await (await requestAs(cookie, '/api/summary?days=7&tz=330')).json();
  const dbms = s.bySubject.find((r) => r.subject === 'DBMS');
  assert.equal(dbms.minutes, 40.5);
  assert.equal(dbms.sessions, 2);
  assert.equal(s.topSubject, 'DBMS');
  assert.equal(s.perDay.length, 7);
  assert.equal(s.perDay.reduce((a, d) => a + d.minutes, 0), s.totalMinutes);
});

test('summary excludes sessions older than the range', async () => {
  const s = await (await requestAs(cookie, '/api/summary?days=7')).json();
  assert.equal(s.bySubject.find((r) => r.subject === 'Maths'), undefined); // logged on 1 Oct
});

test('deletes a session and 404s on a missing one', async () => {
  const rows = await (await requestAs(cookie, '/api/sessions')).json();
  const del = await requestAs(cookie, `/api/sessions/${rows[0].id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const again = await requestAs(cookie, `/api/sessions/${rows[0].id}`, { method: 'DELETE' });
  assert.equal(again.status, 404);
});

test('keeps sessions private between accounts and supports logout', async () => {
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'other@example.com', password: 'another-pass-123' }),
  });
  assert.equal(register.status, 201);
  const otherCookie = register.headers.get('set-cookie').split(';')[0];
  const ownerRows = await (await requestAs(cookie, '/api/sessions')).json();
  assert.ok(ownerRows.length > 0);
  const created = await requestAs(otherCookie, '/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: 'Physics', duration_min: 25 }),
  });
  assert.equal(created.status, 201);
  const otherRows = await (await requestAs(otherCookie, '/api/sessions')).json();
  assert.equal(otherRows.length, 1);
  const ownerRowsAfter = await (await requestAs(cookie, '/api/sessions')).json();
  assert.equal(ownerRowsAfter.length, ownerRows.length);
  const attemptDeleteOwnerSession = await requestAs(otherCookie, `/api/sessions/${ownerRows[0].id}`, { method: 'DELETE' });
  assert.equal(attemptDeleteOwnerSession.status, 404);
  const logout = await requestAs(otherCookie, '/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 200);
  const afterLogout = await requestAs(otherCookie, '/api/sessions');
  assert.equal(afterLogout.status, 401);
});

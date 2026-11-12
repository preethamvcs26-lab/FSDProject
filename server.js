// StudySync backend: Express + SQLite (Node's built-in node:sqlite, no native build needed)
const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} = require('node:crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'studysync.db');
const AUTH_SESSION_DAYS = 30;

const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    subject     TEXT    NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'Study',
    notes       TEXT    DEFAULT '',
    started_at  TEXT    NOT NULL,          -- ISO timestamp
    duration_min REAL   NOT NULL CHECK (duration_min > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
`);

const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all();
if (!sessionColumns.some((column) => column.name === 'user_id')) {
  db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_started ON sessions(user_id, started_at)');

const CATEGORIES = ['Study', 'Assignment', 'Project', 'Revision', 'Break', 'Other'];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, storedHash) {
  const [salt, expectedHex] = storedHash.split(':');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createAuthSession(userId, res) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + AUTH_SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, userId, expiresAt);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `studysync_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${AUTH_SESSION_DAYS * 86400}${secure}`
  );
}

function clearAuthSession(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `studysync_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function requireAuth(req, res, next) {
  const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith('studysync_session='));
  const token = cookie ? cookie.slice('studysync_session='.length) : '';
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(401).json({ error: 'Please sign in to continue' });
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const authSession = db.prepare(`
    SELECT users.id, users.email
    FROM auth_sessions
    JOIN users ON users.id = auth_sessions.user_id
    WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
  `).get(tokenHash, new Date().toISOString());
  if (!authSession) {
    return res.status(401).json({ error: 'Please sign in to continue' });
  }
  req.user = authSession;
  next();
}

app.post('/api/auth/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(email, hashPassword(password));
  const userId = Number(info.lastInsertRowid);
  db.prepare('UPDATE sessions SET user_id = ? WHERE user_id IS NULL').run(userId);
  createAuthSession(userId, res);
  res.status(201).json({ id: userId, email });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (password.length > 128) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
  if (!user || !passwordMatches(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  createAuthSession(user.id, res);
  res.json({ id: user.id, email: user.email });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

app.post('/api/auth/logout', (req, res) => {
  const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith('studysync_session='));
  const token = cookie ? cookie.slice('studysync_session='.length) : '';
  if (/^[a-f0-9]{64}$/.test(token)) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
  }
  clearAuthSession(res);
  res.json({ ok: true });
});

// Create a session
app.post('/api/sessions', requireAuth, (req, res) => {
  const { subject, category = 'Study', notes = '', started_at, duration_min } = req.body || {};
  const dur = Number(duration_min);
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required' });
  if (!Number.isFinite(dur) || dur <= 0 || dur > 24 * 60) {
    return res.status(400).json({ error: 'Duration must be between 0 and 1440 minutes' });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  const start = started_at && !isNaN(Date.parse(started_at)) ? new Date(started_at).toISOString() : new Date().toISOString();

  const info = db
    .prepare('INSERT INTO sessions (user_id, subject, category, notes, started_at, duration_min) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, String(subject).trim(), category, String(notes).trim(), start, dur);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// List sessions (newest first), optional ?limit=
app.get('/api/sessions', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?').all(req.user.id, limit);
  res.json(rows);
});

// Delete a session
app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Summary: "where is my time going" -> totals by subject, by category, and per day (last N days)
app.get('/api/summary', requireAuth, (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const tzMin = Math.max(-840, Math.min(840, Math.round(Number(req.query.tz) || 0)));
  // Start of the oldest local day in range, converted back to UTC
  const localNow = Date.now() + tzMin * 60000;
  const localMidnight = localNow - (localNow % 86400000);
  const since = new Date(localMidnight - (days - 1) * 86400000 - tzMin * 60000).toISOString();

  const bySubject = db
    .prepare(`SELECT subject, ROUND(SUM(duration_min), 1) AS minutes, COUNT(*) AS sessions
              FROM sessions WHERE user_id = ? AND started_at >= ? GROUP BY subject ORDER BY minutes DESC`)
    .all(req.user.id, since);
  const byCategory = db
    .prepare(`SELECT category, ROUND(SUM(duration_min), 1) AS minutes
              FROM sessions WHERE user_id = ? AND started_at >= ? GROUP BY category ORDER BY minutes DESC`)
    .all(req.user.id, since);
  // Group days in the viewer's local time: client passes tz = minutes ahead of UTC (e.g. 330 for IST)
  const tz = tzMin;
  const modifier = `${tz >= 0 ? '+' : '-'}${Math.abs(tz)} minutes`;
  const perDayRaw = db
    .prepare(`SELECT substr(datetime(started_at, ?), 1, 10) AS day, ROUND(SUM(duration_min), 1) AS minutes
              FROM sessions WHERE user_id = ? AND started_at >= ? GROUP BY day ORDER BY day`)
    .all(modifier, req.user.id, since);

  // Fill in zero-days so the chart has no gaps
  const map = new Map(perDayRaw.map((r) => [r.day, r.minutes]));
  const perDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() + tz * 60000 - i * 86400000).toISOString().slice(0, 10);
    perDay.push({ day: d, minutes: map.get(d) || 0 });
  }

  const total = bySubject.reduce((s, r) => s + r.minutes, 0);
  const totalSessions = bySubject.reduce((s, r) => s + r.sessions, 0);
  res.json({
    days,
    totalMinutes: Math.round(total * 10) / 10,
    totalSessions,
    avgPerDay: Math.round((total / days) * 10) / 10,
    topSubject: bySubject[0] ? bySubject[0].subject : null,
    bySubject,
    byCategory,
    perDay,
  });
});

app.get('/api/categories', (_req, res) => res.json(CATEGORIES));

if (require.main === module) {
  app.listen(PORT, () => console.log(`StudySync running at http://localhost:${PORT}`));
}
module.exports = app;
module.exports.closeDatabase = () => db.close();

// StudySync backend: Express + SQLite (Node's built-in node:sqlite, no native build needed)
const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'studysync.db');

const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject     TEXT    NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'Study',
    notes       TEXT    DEFAULT '',
    started_at  TEXT    NOT NULL,          -- ISO timestamp
    duration_min REAL   NOT NULL CHECK (duration_min > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
`);

const CATEGORIES = ['Study', 'Assignment', 'Project', 'Revision', 'Break', 'Other'];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create a session
app.post('/api/sessions', (req, res) => {
  const { subject, category = 'Study', notes = '', started_at, duration_min } = req.body || {};
  const dur = Number(duration_min);
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required' });
  if (!Number.isFinite(dur) || dur <= 0 || dur > 24 * 60) {
    return res.status(400).json({ error: 'Duration must be between 0 and 1440 minutes' });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  const start = started_at && !isNaN(Date.parse(started_at)) ? new Date(started_at).toISOString() : new Date().toISOString();

  const info = db
    .prepare('INSERT INTO sessions (subject, category, notes, started_at, duration_min) VALUES (?, ?, ?, ?, ?)')
    .run(String(subject).trim(), category, String(notes).trim(), start, dur);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// List sessions (newest first), optional ?limit=
app.get('/api/sessions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC, id DESC LIMIT ?').all(limit);
  res.json(rows);
});

// Delete a session
app.delete('/api/sessions/:id', (req, res) => {
  const info = db.prepare('DELETE FROM sessions WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Summary: "where is my time going" -> totals by subject, by category, and per day (last N days)
app.get('/api/summary', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const tzMin = Math.max(-840, Math.min(840, Math.round(Number(req.query.tz) || 0)));
  // Start of the oldest local day in range, converted back to UTC
  const localNow = Date.now() + tzMin * 60000;
  const localMidnight = localNow - (localNow % 86400000);
  const since = new Date(localMidnight - (days - 1) * 86400000 - tzMin * 60000).toISOString();

  const bySubject = db
    .prepare(`SELECT subject, ROUND(SUM(duration_min), 1) AS minutes, COUNT(*) AS sessions
              FROM sessions WHERE started_at >= ? GROUP BY subject ORDER BY minutes DESC`)
    .all(since);
  const byCategory = db
    .prepare(`SELECT category, ROUND(SUM(duration_min), 1) AS minutes
              FROM sessions WHERE started_at >= ? GROUP BY category ORDER BY minutes DESC`)
    .all(since);
  // Group days in the viewer's local time: client passes tz = minutes ahead of UTC (e.g. 330 for IST)
  const tz = tzMin;
  const modifier = `${tz >= 0 ? '+' : '-'}${Math.abs(tz)} minutes`;
  const perDayRaw = db
    .prepare(`SELECT substr(datetime(started_at, ?), 1, 10) AS day, ROUND(SUM(duration_min), 1) AS minutes
              FROM sessions WHERE started_at >= ? GROUP BY day ORDER BY day`)
    .all(modifier, since);

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

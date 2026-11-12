# StudySync – Where is my time going?

A full-stack web app that answers one question: **where does my study time actually go?**
Log study sessions with a live timer or by typing minutes, then see a dashboard of time per subject,
time per category, and minutes per day.

## Features (Review 1 build)

- Start/stop **timer** (keeps running even if you refresh the page) or **manual entry**
- Sessions saved to a real **SQLite database** (subject, category, notes, start time, duration)
- **Dashboard**: total time, session count, daily average, top subject
- Charts: time by subject (bars), by category (donut), minutes per day (column chart)
- Email-based registration and login with server-side password hashing and private study sessions
- Range filter: 7 / 14 / 30 days
- Recent sessions table with delete
- Input validation on both client and server, responsive layout, dark mode

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | HTML, CSS, vanilla JavaScript (no build step, charts drawn with CSS/DOM, no external libraries) |
| Backend | Node.js + Express 5 REST API |
| Database | SQLite via Node's built-in `node:sqlite` |
| Tests | Node built-in test runner (9 API tests) |

## Run it

Requires **Node.js 22.5 or newer** (`node -v` to check).

```bash
npm install
npm run seed     # optional: load a week of sample data for the demo (add -- --reset to wipe first)
npm start        # http://localhost:3000
npm test         # run the API tests
```

Data is stored in `studysync.db` in the project folder. Delete that file to start fresh.

## API

| Method | Route | What it does |
|--------|-------|--------------|
| POST | `/api/auth/register` | Create an account with `{email, password}` (password must be at least 8 characters) |
| POST | `/api/auth/login` | Sign in with `{email, password}` |
| GET | `/api/auth/me` | Get the signed-in account |
| POST | `/api/auth/logout` | Sign out and revoke the current session |
| POST | `/api/sessions` | Create a session `{subject, category, notes, started_at, duration_min}` |
| GET | `/api/sessions?limit=` | List sessions, newest first |
| DELETE | `/api/sessions/:id` | Delete a session |
| GET | `/api/summary?days=7&tz=330` | Totals by subject, category and day (`tz` = minutes ahead of UTC) |
| GET | `/api/categories` | Allowed categories |

Study session and summary endpoints require the HTTP-only session cookie issued at registration or login. The first account created after upgrading adopts any existing sessions that did not have an account owner.

## Project structure

```
server.js        Express app + SQLite schema + routes
seed.js          Sample data for demos
test.js          API tests
public/
  index.html     Page layout
  style.css      Styling (light + dark)
  app.js         Timer, forms, API calls, chart rendering
```

## Demo script (about 3 minutes)

1. Open the dashboard with seeded data and explain the question it answers.
2. Point out the stat tiles, then the "Where your time went" bars and category donut.
3. Click **Start**, enter a subject, click **Stop & save**, and watch the dashboard update live.
4. Add a manual entry (e.g. 30 min of DBMS) and show the table and charts change.
5. Switch 7 → 30 days. Delete a session.
6. Show the code: schema in `server.js`, `/api/summary`, and `npm test`.

## Planned next

- Weekly goals per subject with progress tracking
- Pomodoro mode
- Group study sessions shared between teammates (the "Sync" in StudySync)
- Export to CSV, plus weekly summary insights

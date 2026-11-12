// StudySync frontend (vanilla JS, no build step, no external libraries)
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const $ = (id) => document.getElementById(id);
const TZ = -new Date().getTimezoneOffset(); // minutes ahead of UTC
const TIMER_KEY = 'studysync.timerStart';
const AUTH_KEY = 'studysync.auth';
const AUTH_USER = 'student';
const AUTH_PASS = 'studysync';
const USERS_KEY = 'studysync.users';
const THEME_KEY = 'studysync.theme';
const GOAL_KEY = 'studysync.weeklyGoal';
const TASK_KEY = 'studysync.dailyTasks';
const SUMMARY_PAGES = new Set(['dashboard', 'time', 'days']);
let registering = false;
let allRows = [];
let calendarDate = new Date();

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = $('themeToggle');
  const dark = theme === 'dark';
  button.textContent = dark ? '☀️ Light theme' : '🌙 Dark theme';
  button.setAttribute('aria-pressed', String(dark));
}

let days = 7;
let timerHandle = null;

/* ---------- helpers ---------- */
const fmtMin = (m) => {
  m = Number(m) || 0;
  if (m > 0 && m < 1) return `${Math.max(Math.round(m * 60), 1)} sec`;
  if (m < 60) return `${Math.round(m * 10) / 10} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
};
const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const fmtWhen = (iso) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function setMsg(text, kind = '') {
  const el = $('msg');
  el.textContent = text;
  el.className = 'msg ' + kind;
  if (kind === 'ok') setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3000);
}
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  children.forEach((c) => node.append(c));
  return node;
}

/* ---------- rendering ---------- */
function renderStats(s) {
  $('statTotal').textContent = fmtMin(s.totalMinutes);
  $('statSessions').textContent = s.totalSessions;
  $('statAvg').textContent = fmtMin(s.avgPerDay);
  let streak = 0;
  let dayIndex = s.perDay.length - 1;
  if (dayIndex >= 0 && !s.perDay[dayIndex].minutes) dayIndex--;
  for (; dayIndex >= 0 && s.perDay[dayIndex].minutes > 0; dayIndex--) streak++;
  $('statTop').textContent = `${streak} ${streak === 1 ? 'day' : 'days'}`;
}

function renderGoal(totalMinutes) {
  const target = Number(localStorage.getItem(GOAL_KEY)) || 600;
  const completed = Math.round(totalMinutes);
  const percent = Math.min(Math.round((completed / target) * 100), 100);
  $('goalProgress').textContent = fmtMin(completed);
  $('goalProgress').dataset.minutes = String(totalMinutes);
  $('goalTargetLabel').textContent = `of ${fmtMin(target)}`;
  $('goalFill').style.width = `${percent}%`;
  $('progressPercent').textContent = `${percent}%`;
  $('progressDonut').style.background = `conic-gradient(#6658ed ${percent}%, var(--line) ${percent}% 100%)`;
  $('activityHours').textContent = `${(totalMinutes / 60).toFixed(1)}h`;
  const track = document.querySelector('.goal-track');
  track.setAttribute('aria-valuemax', String(target));
  track.setAttribute('aria-valuenow', String(Math.min(completed, target)));
  $('goalEncouragement').textContent = completed >= target ? 'Weekly goal reached — excellent work!' : `${fmtMin(Math.max(target - completed, 0))} left to reach your weekly goal.`;
  $('goalMinutes').value = String(target);
}

function renderDashboardCourses(s) {
  const box = $('dashboardCourses');
  box.replaceChildren();
  $('emptyDashboardCourses').hidden = s.bySubject.length > 0;
  const max = Math.max(...s.bySubject.map((r) => r.minutes), 1);
  s.bySubject.slice(0, 3).forEach((row, i) => {
    const pct = s.totalMinutes ? Math.round(row.minutes / s.totalMinutes * 100) : 0;
    const fill = el('span', { className: 'course-progress-fill' });
    fill.style.width = `${Math.round(row.minutes / max * 100)}%`;
    fill.style.background = COLORS[i % COLORS.length];
    box.append(el('article', { className: `course-card course-card-${i}` },
      el('div', { className: 'course-art' }, el('span', { className: 'course-icon', textContent: ['▧', '⌘', '◈'][i] }), el('span', { className: 'course-percent', textContent: `${pct}%` })),
      el('div', { className: 'course-info' },
        el('span', { className: 'eyebrow', textContent: `${row.sessions} ${row.sessions === 1 ? 'SESSION' : 'SESSIONS'}` }),
        el('h3', { textContent: row.subject }),
        el('div', { className: 'course-meta', textContent: `${fmtMin(row.minutes)} studied` }),
        el('div', { className: 'course-progress' }, fill))));
  });
}

function renderBars(s) {
  const box = $('subjectBars');
  box.replaceChildren();
  $('emptyBars').hidden = s.bySubject.length > 0;
  const max = Math.max(...s.bySubject.map((r) => r.minutes), 1);
  s.bySubject.slice(0, 8).forEach((r, i) => {
    const pct = s.totalMinutes ? Math.round((r.minutes / s.totalMinutes) * 100) : 0;
    const fill = el('div', { className: 'bar-fill' });
    fill.style.background = COLORS[i % COLORS.length];
    fill.style.width = '0%';
    requestAnimationFrame(() => (fill.style.width = `${(r.minutes / max) * 100}%`));
    box.append(
      el('div', { className: 'bar-row' },
        el('div', { className: 'meta' }, el('span', { textContent: r.subject }), el('span', { textContent: `${fmtMin(r.minutes)} · ${pct}%` })),
        el('div', { className: 'bar-track' }, fill))
    );
  });
}

function renderDonut(s) {
  const total = s.byCategory.reduce((a, r) => a + r.minutes, 0);
  const legend = $('legend');
  legend.replaceChildren();
  if (!total) {
    $('donut').style.background = 'var(--line)';
    legend.append(el('li', { textContent: 'No data yet' }));
    return;
  }
  const palette = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
  let acc = 0;
  const stops = s.byCategory.map((r, i) => {
    const start = acc;
    acc += (r.minutes / total) * 100;
    return `${palette[i % palette.length]} ${start}% ${acc}%`;
  });
  $('donut').style.background = `conic-gradient(${stops.join(', ')})`;
  s.byCategory.forEach((r, i) => {
    const sw = el('i');
    sw.style.background = palette[i % palette.length];
    legend.append(el('li', {}, sw, r.category, el('span', { className: 'v', textContent: `${Math.round((r.minutes / total) * 100)}%` })));
  });
}

function renderDays(s) {
  const max = Math.max(...s.perDay.map((d) => d.minutes), 1);
  const showEvery = s.perDay.length > 14 ? 3 : 1;
  document.querySelectorAll('#dayChart, #dayChartDetailed').forEach((box) => {
    box.replaceChildren();
    s.perDay.forEach((d, i) => {
      const bar = el('div', { className: 'daybar' + (d.minutes ? '' : ' zero') });
      bar.style.height = '0px';
      requestAnimationFrame(() => (bar.style.height = d.minutes ? `${Math.max((d.minutes / max) * 140, 4)}px` : '2px'));
      const label = new Date(d.day + 'T00:00:00').toLocaleDateString([], s.perDay.length > 7 ? { day: 'numeric', month: 'short' } : { weekday: 'short' });
      bar.title = `${d.day}: ${fmtMin(d.minutes)}`;
      box.append(el('div', { className: 'daycol' },
        el('div', { className: 'dayval', textContent: d.minutes && s.perDay.length <= 14 ? fmtMin(d.minutes) : '' }),
        bar,
        el('div', { className: 'daylbl', textContent: i % showEvery === 0 ? label : '' })));
    });
  });
}

function renderRows(rows) {
  const tbody = $('rows');
  tbody.replaceChildren();
  $('emptyRows').hidden = rows.length > 0;
  $('emptyRows').textContent = $('sessionSearch').value.trim() ? 'No sessions match your search.' : 'Nothing logged yet.';
  rows.slice(0, 15).forEach((r) => {
    const del = el('button', { className: 'del', title: 'Delete session', textContent: '✕' });
    del.setAttribute('aria-label', `Delete ${r.subject} session`);
    del.onclick = async () => {
      if (!confirm('Delete this session?')) return;
      await api(`/api/sessions/${r.id}`, { method: 'DELETE' });
      refresh();
    };
    tbody.append(
      el('tr', {},
        el('td', { textContent: fmtWhen(r.started_at) }),
        el('td', { textContent: r.subject }),
        el('td', {}, el('span', { className: 'tag', textContent: r.category })),
        el('td', { className: 'num', textContent: fmtMin(r.duration_min) }),
        el('td', { className: 'notes', textContent: r.notes || '' }),
        el('td', {}, del))
    );
  });
}

/* ---------- data ---------- */
async function refresh() {
  try {
    const [summary, weeklySummary, rows] = await Promise.all([
      api(`/api/summary?days=${days}&tz=${TZ}`),
      api(`/api/summary?days=7&tz=${TZ}`),
      api('/api/sessions?limit=50'),
    ]);
    renderStats(summary);
    renderGoal(weeklySummary.totalMinutes);
    renderDashboardCourses(summary);
    renderBars(summary);
    renderDonut(summary);
    renderDays(summary);
    allRows = rows;
    renderRows(filterRows());
    // subject suggestions from history
    const subs = [...new Set(rows.map((r) => r.subject))];
    $('subjectList').replaceChildren(...subs.map((s) => el('option', { value: s })));
  } catch (e) {
    setMsg('Could not load data. Is the server running?', 'err');
  }
}

function filterRows() {
  const query = $('sessionSearch').value.trim().toLowerCase();
  if (!query) return allRows;
  return allRows.filter((row) => [row.subject, row.category, row.notes].some((value) => String(value || '').toLowerCase().includes(query)));
}

async function saveSession(durationMin, startedAt) {
  const subject = $('subject').value.trim();
  if (!subject) {
    setMsg('Please enter a subject first.', 'err');
    $('subject').focus();
    return false;
  }
  try {
    await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        subject,
        category: $('category').value,
        notes: $('notes').value,
        started_at: startedAt,
        duration_min: durationMin,
      }),
    });
    setMsg(`Saved ${fmtMin(durationMin)} of ${subject}.`, 'ok');
    $('minutes').value = '';
    $('notes').value = '';
    await refresh();
    return true;
  } catch (e) {
    setMsg(e.message, 'err');
    return false;
  }
}

/* ---------- timer (survives page refresh) ---------- */
function tick() {
  const start = Number(localStorage.getItem(TIMER_KEY));
  if (!start) return;
  $('clock').textContent = fmtClock(Date.now() - start);
}
function setTimerUI(running) {
  $('startBtn').hidden = running;
  $('stopBtn').hidden = !running;
  $('discardBtn').hidden = !running;
  $('clock').classList.toggle('running', running);
  clearInterval(timerHandle);
  if (running) { tick(); timerHandle = setInterval(tick, 500); } else $('clock').textContent = '00:00:00';
}
$('startBtn').onclick = () => {
  localStorage.setItem(TIMER_KEY, String(Date.now()));
  setMsg('');
  setTimerUI(true);
};
$('stopBtn').onclick = async () => {
  const start = Number(localStorage.getItem(TIMER_KEY));
  if (!start) return;
  const minutes = Math.max(Math.round(((Date.now() - start) / 60000) * 10) / 10, 0.1);
  const ok = await saveSession(minutes, new Date(start).toISOString());
  if (ok) { localStorage.removeItem(TIMER_KEY); setTimerUI(false); } // keep running if save failed (e.g. no subject)
};
$('discardBtn').onclick = () => {
  if (!confirm('Discard this running timer?')) return;
  localStorage.removeItem(TIMER_KEY);
  setTimerUI(false);
};

/* ---------- manual form ---------- */
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mins = Number($('minutes').value);
  if (!mins || mins <= 0) {
    setMsg('Enter the minutes studied, or use the timer above.', 'err');
    $('minutes').focus();
    return;
  }
  // Manual entry is assumed to have just finished
  await saveSession(mins, new Date(Date.now() - mins * 60000).toISOString());
});

/* ---------- range buttons ---------- */
document.querySelectorAll('.range button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.range button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    days = Number(b.dataset.days);
    refresh();
  };
});

/* ---------- pages ---------- */
function isAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === '1';
}
function currentPage() {
  const name = (location.hash || '').replace(/^#\/?/, '');
  return ['dashboard', 'log', 'time', 'days', 'sessions'].includes(name) ? name : 'dashboard';
}
function showPage(name) {
  const authed = name !== 'login';
  document.body.classList.toggle('authed', authed);
  $('loginView').hidden = authed;
  $('appShell').hidden = !authed;
  $('logoutBtn').hidden = !authed;
  document.querySelector('.range').hidden = !SUMMARY_PAGES.has(name);
  document.querySelectorAll('.page').forEach((page) => {
    page.hidden = page.id !== `page-${name}`;
  });
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === name));
}
function route() {
  if (!isAuthed()) {
    showPage('login');
    return;
  }
  const page = currentPage();
  if (location.hash !== `#/${page}`) location.hash = `#/${page}`;
  showPage(page);
  refresh();
}

$('registerBtn').onclick = () => {
  registering = !registering;
  $('authTitle').textContent = registering ? 'Create your account' : 'Personal login';
  $('authHint').textContent = registering ? 'Choose a username and password to get started.' : 'Sign in to open your study dashboard.';
  $('confirmPasswordLabel').hidden = !registering;
  $('confirmPassword').required = registering;
  $('password').autocomplete = registering ? 'new-password' : 'current-password';
  document.querySelector('#loginForm button[type="submit"]').textContent = registering ? 'Register' : 'Sign in';
  $('registerBtn').textContent = registering ? 'Back to sign in' : 'Create an account';
  $('loginMsg').textContent = '';
};

$('themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  setTheme(next);
};

$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const user = $('username').value.trim();
  const pass = $('password').value;
  const msg = $('loginMsg');
  const users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
  if (registering) {
    if (user.length < 3) {
      msg.textContent = 'Username must be at least 3 characters.';
      msg.className = 'msg err';
      return;
    }
    if (pass.length < 6) {
      msg.textContent = 'Password must be at least 6 characters.';
      msg.className = 'msg err';
      return;
    }
    if (pass !== $('confirmPassword').value) {
      msg.textContent = 'Passwords do not match.';
      msg.className = 'msg err';
      return;
    }
    if (user.toLowerCase() === AUTH_USER || Object.keys(users).some((name) => name.toLowerCase() === user.toLowerCase())) {
      msg.textContent = 'That username is already taken.';
      msg.className = 'msg err';
      return;
    }
    users[user] = pass;
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    $('username').value = user;
    $('confirmPassword').value = '';
    $('password').value = '';
    $('registerBtn').click();
    msg.textContent = 'Account created. Sign in with your new details.';
    msg.className = 'msg ok';
    return;
  }
  if ((user === AUTH_USER && pass === AUTH_PASS) || users[user] === pass) {
    sessionStorage.setItem(AUTH_KEY, '1');
    msg.textContent = '';
    msg.className = 'msg';
    location.hash = '#/dashboard';
    route();
    return;
  }
  msg.textContent = 'Wrong username or password.';
  msg.className = 'msg err';
});

$('logoutBtn').onclick = () => {
  sessionStorage.removeItem(AUTH_KEY);
  if (location.hash) location.hash = '';
  route();
};

window.addEventListener('hashchange', route);

/* ---------- dashboard tools ---------- */
function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  $('calendarMonth').textContent = calendarDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const grid = $('calendarGrid');
  grid.replaceChildren(...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label) => el('span', { className: 'calendar-weekday', textContent: label })));
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < offset; i++) grid.append(el('span', { className: 'calendar-day blank' }));
  for (let day = 1; day <= count; day++) {
    const today = year === new Date().getFullYear() && month === new Date().getMonth() && day === new Date().getDate();
    grid.append(el('span', { className: `calendar-day${today ? ' today' : ''}`, textContent: String(day) }));
  }
}
function taskStorageKey() {
  const today = new Date();
  return `${TASK_KEY}.${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}
function getTasks() {
  try { return JSON.parse(localStorage.getItem(taskStorageKey()) || '[]'); } catch { return []; }
}
function saveTasks(tasks) { localStorage.setItem(taskStorageKey(), JSON.stringify(tasks)); }
function renderTasks() {
  const tasks = getTasks();
  const list = $('taskList');
  list.replaceChildren();
  $('planCount').textContent = `${tasks.filter((task) => task.done).length}/${tasks.length}`;
  if (!tasks.length) list.append(el('p', { className: 'task-empty', textContent: 'Add a small goal for today.' }));
  tasks.forEach((task, index) => {
    const checkbox = el('input', { type: 'checkbox', checked: task.done, 'aria-label': `Complete ${task.text}` });
    checkbox.onchange = () => { const updated = getTasks(); updated[index].done = checkbox.checked; saveTasks(updated); renderTasks(); };
    const remove = el('button', { type: 'button', className: 'task-remove', textContent: '×', 'aria-label': `Remove ${task.text}` });
    remove.onclick = () => { const updated = getTasks(); updated.splice(index, 1); saveTasks(updated); renderTasks(); };
    list.append(el('div', { className: `task-row${task.done ? ' done' : ''}` }, checkbox, el('span', { textContent: task.text }), remove));
  });
}
$('taskForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('taskInput').value.trim();
  if (!text) return;
  const tasks = getTasks(); tasks.push({ text, done: false }); saveTasks(tasks);
  $('taskInput').value = ''; renderTasks();
});
$('prevMonth').onclick = () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1); renderCalendar(); };
$('nextMonth').onclick = () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1); renderCalendar(); };
$('editGoalBtn').onclick = () => {
  $('goalForm').hidden = !$('goalForm').hidden;
  if (!$('goalForm').hidden) $('goalMinutes').focus();
};
$('goalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const target = Number($('goalMinutes').value);
  if (!Number.isFinite(target) || target < 30 || target > 10080) return;
  localStorage.setItem(GOAL_KEY, String(target));
  renderGoal(Number($('goalProgress').dataset.minutes || 0));
  $('goalForm').hidden = true;
});
$('sessionSearch').addEventListener('input', () => renderRows(filterRows()));
$('dashboardSearch').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  $('sessionSearch').value = $('dashboardSearch').value;
  location.hash = '#/sessions';
});

/* ---------- init ---------- */
(async function init() {
  setTheme(localStorage.getItem(THEME_KEY) || 'light');
  const today = new Date();
  $('welcomeDate').textContent = `${today.toLocaleDateString([], { weekday: 'long' }).toUpperCase()} · YOUR LEARNING SPACE`;
  $('welcomeTitle').innerHTML = `${today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening'}! <span>Ready to learn?</span>`;
  renderCalendar(); renderTasks();
  const cats = await api('/api/categories').catch(() => ['Study']);
  $('category').replaceChildren(...cats.map((c) => el('option', { value: c, textContent: c })));
  setTimerUI(!!localStorage.getItem(TIMER_KEY));
  route();
})();

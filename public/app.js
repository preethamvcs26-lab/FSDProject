// StudySync frontend (vanilla JS, no build step, no external libraries)
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const $ = (id) => document.getElementById(id);
const TZ = -new Date().getTimezoneOffset(); // minutes ahead of UTC
const TIMER_KEY = 'studysync.timerStart';
const GOAL_KEY = 'studysync.weeklyGoal';
const TASK_KEY = 'studysync.dailyTasks';
const THEME_KEY = 'studysync.theme';
let allRows = [];
let calendarDate = new Date();
let currentUser = null;
let registering = false;

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
  if (!res.ok) {
    const error = new Error(data.error || 'Something went wrong');
    error.status = res.status;
    throw error;
  }
  return data;
}
function userStorageKey(key) {
  return `${key}.${currentUser.id}`;
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
  $('statTotal').dataset.minutes = String(s.totalMinutes);
  $('statSessions').textContent = s.totalSessions;
  $('statAvg').textContent = fmtMin(s.avgPerDay);
  let streak = 0;
  let dayIndex = s.perDay.length - 1;
  if (dayIndex >= 0 && !s.perDay[dayIndex].minutes) dayIndex--;
  for (; dayIndex >= 0 && s.perDay[dayIndex].minutes > 0; dayIndex--) streak++;
  $('statTop').textContent = `${streak} ${streak === 1 ? 'day' : 'days'}`;
}

function renderGoal(totalMinutes) {
  const target = Number(localStorage.getItem(userStorageKey(GOAL_KEY))) || 600;
  const completed = Math.round(totalMinutes);
  const percent = Math.min(Math.round((completed / target) * 100), 100);
  $('goalProgress').textContent = fmtMin(completed);
  $('goalTargetLabel').textContent = `of ${fmtMin(target)}`;
  $('goalFill').style.width = `${percent}%`;
  $('progressPercent').textContent = `${percent}%`;
  $('progressDonut').style.background = `conic-gradient(#6658ed ${percent}%, var(--line) ${percent}% 100%)`;
  $('activityHours').textContent = `${(totalMinutes / 60).toFixed(1)}h`;
  const track = document.querySelector('.goal-track');
  track.setAttribute('aria-valuemax', String(target));
  track.setAttribute('aria-valuenow', String(Math.min(completed, target)));
  $('goalEncouragement').textContent = completed >= target
    ? 'Goal reached — excellent work this week!'
    : `${fmtMin(Math.max(target - completed, 0))} to go. You’ve got this!`;
  $('goalMinutes').value = String(target);
}

function renderBars(s) {
  const box = $('learningCards');
  box.replaceChildren();
  $('emptyBars').hidden = s.bySubject.length > 0;
  const max = Math.max(...s.bySubject.map((r) => r.minutes), 1);
  s.bySubject.slice(0, 3).forEach((r, i) => {
    const pct = s.totalMinutes ? Math.round((r.minutes / s.totalMinutes) * 100) : 0;
    const fill = el('span', { className: 'course-progress-fill' });
    fill.style.width = '0%';
    fill.style.background = COLORS[i % COLORS.length];
    requestAnimationFrame(() => (fill.style.width = `${(r.minutes / max) * 100}%`));
    const icon = el('span', { className: `course-icon course-icon-${i}`, textContent: ['▧', '⌘', '◈'][i] });
    const card = el('article', { className: 'course-card' },
      el('div', { className: 'course-art' }, icon, el('span', { className: 'course-percent', textContent: `${pct}%` })),
      el('div', { className: 'course-info' },
        el('span', { className: 'eyebrow', textContent: `${r.sessions} ${r.sessions === 1 ? 'SESSION' : 'SESSIONS'}` }),
        el('h3', { textContent: r.subject }),
        el('div', { className: 'course-meta', textContent: `${fmtMin(r.minutes)} studied` }),
        el('div', { className: 'course-progress' }, fill)));
    box.append(card);
  });
  const details = $('subjectDetails');
  details.replaceChildren();
  if (s.byCategory.length) {
    details.append(el('span', { className: 'eyebrow', textContent: 'THIS WEEK BY CATEGORY' }));
    s.byCategory.forEach((row, i) => details.append(el('span', { className: 'category-chip' },
      el('i', { style: `background:${['#6b5ce7','#28b88a','#f1a94e','#e77c9b'][i % 4]}` }),
      `${row.category} · ${fmtMin(row.minutes)}`)));
  }
}

function renderDays(s) {
  const box = $('dayChart');
  box.replaceChildren();
  const max = Math.max(...s.perDay.map((d) => d.minutes), 1);
  const showEvery = s.perDay.length > 14 ? 3 : 1;
  s.perDay.forEach((d, i) => {
    const bar = el('div', { className: 'daybar' + (d.minutes ? '' : ' zero') });
    bar.style.height = '0px';
    requestAnimationFrame(() => (bar.style.height = d.minutes ? `${Math.max((d.minutes / max) * 140, 4)}px` : '2px'));
    const label = new Date(d.day + 'T00:00:00').toLocaleDateString([], s.perDay.length > 7 ? { day: 'numeric', month: 'short' } : { weekday: 'short' });
    bar.title = `${d.day}: ${fmtMin(d.minutes)}`;
    box.append(
      el('div', { className: 'daycol' },
        el('div', { className: 'dayval', textContent: d.minutes && s.perDay.length <= 14 ? fmtMin(d.minutes) : '' }),
        bar,
        el('div', { className: 'daylbl', textContent: i % showEvery === 0 ? label : '' }))
    );
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
    renderBars(summary);
    renderDays(summary);
    allRows = rows;
    renderRows(filterRows());
    // subject suggestions from history
    const subs = [...new Set(rows.map((r) => r.subject))];
    $('subjectList').replaceChildren(...subs.map((s) => el('option', { value: s })));
  } catch (e) {
    if (e.status === 401) {
      currentUser = null;
      $('authView').hidden = false;
      document.querySelector('.app-layout').hidden = true;
      $('authMessage').textContent = 'Your session expired. Please sign in again.';
      return;
    }
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
  const start = Number(localStorage.getItem(userStorageKey(TIMER_KEY)));
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
  localStorage.setItem(userStorageKey(TIMER_KEY), String(Date.now()));
  setMsg('');
  setTimerUI(true);
};
$('stopBtn').onclick = async () => {
  const start = Number(localStorage.getItem(userStorageKey(TIMER_KEY)));
  if (!start) return;
  const minutes = Math.max(Math.round(((Date.now() - start) / 60000) * 10) / 10, 0.1);
  const ok = await saveSession(minutes, new Date(start).toISOString());
  if (ok) { localStorage.removeItem(userStorageKey(TIMER_KEY)); setTimerUI(false); } // keep running if save failed (e.g. no subject)
};
$('discardBtn').onclick = () => {
  if (!confirm('Discard this running timer?')) return;
  localStorage.removeItem(userStorageKey(TIMER_KEY));
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

/* ---------- sidebar and study goal ---------- */
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
  });
});
$('sessionSearch').addEventListener('input', () => renderRows(filterRows()));
$('editGoalBtn').onclick = () => {
  $('goalForm').hidden = !$('goalForm').hidden;
  if (!$('goalForm').hidden) $('goalMinutes').focus();
};
$('goalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const target = Number($('goalMinutes').value);
  if (!Number.isFinite(target) || target < 30 || target > 10080) return;
  localStorage.setItem(userStorageKey(GOAL_KEY), String(target));
  renderGoal(Number($('statTotal').dataset.minutes || 0));
  $('goalForm').hidden = true;
});

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  $('calendarMonth').textContent = calendarDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const grid = $('calendarGrid');
  grid.replaceChildren(...['S','M','T','W','T','F','S'].map((day) => el('span', { className: 'calendar-weekday', textContent: day })));
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < offset; i++) grid.append(el('span', { className: 'calendar-day blank' }));
  for (let day = 1; day <= count; day++) {
    const isToday = year === new Date().getFullYear() && month === new Date().getMonth() && day === new Date().getDate();
    grid.append(el('span', { className: `calendar-day${isToday ? ' today' : ''}`, textContent: String(day) }));
  }
}
function getTasks() {
  const key = `${userStorageKey(TASK_KEY)}.${new Date().toLocaleDateString('en-CA')}`;
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function saveTasks(tasks) {
  const key = `${userStorageKey(TASK_KEY)}.${new Date().toLocaleDateString('en-CA')}`;
  localStorage.setItem(key, JSON.stringify(tasks));
}
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
$('prevMonth').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); };
$('nextMonth').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); };
$('dashboardSearch').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  $('sessionSearch').value = $('dashboardSearch').value;
  renderRows(filterRows());
  $('history').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeToggle').textContent = theme === 'dark' ? '☀' : '☾';
  $('themeToggle').setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
$('themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next); setTheme(next);
};

function setAuthMode(isRegistering) {
  registering = isRegistering;
  $('loginTab').classList.toggle('active', !registering);
  $('registerTab').classList.toggle('active', registering);
  $('loginTab').setAttribute('aria-selected', String(!registering));
  $('registerTab').setAttribute('aria-selected', String(registering));
  $('authTitle').textContent = registering ? 'Create your StudySync account' : 'Login to StudySync';
  $('authSubmit').textContent = registering ? 'Create Account' : 'Login';
  $('authSwitchText').textContent = registering ? 'Already have an account?' : "Don't have an account?";
  $('authSwitch').textContent = registering ? 'Login' : 'Register';
  $('confirmPasswordField').hidden = !registering;
  $('confirmPassword').required = registering;
  $('authPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('authMessage').textContent = '';
}

function enterApp(user) {
  currentUser = user;
  $('authView').hidden = true;
  document.querySelector('.app-layout').hidden = false;
  $('profileEmail').textContent = user.email;
  document.querySelector('.avatar-button').textContent = user.email.slice(0, 1).toUpperCase();
  renderCalendar();
  renderTasks();
  setTimerUI(!!localStorage.getItem(userStorageKey(TIMER_KEY)));
  refresh();
}

$('loginTab').onclick = () => setAuthMode(false);
$('registerTab').onclick = () => setAuthMode(true);
$('authSwitch').onclick = () => setAuthMode(!registering);
$('passwordVisibility').onclick = () => {
  const password = $('authPassword');
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  $('passwordVisibility').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
};
$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const message = $('authMessage');
  if (registering && password !== $('confirmPassword').value) {
    message.textContent = 'Passwords do not match.';
    return;
  }
  $('authSubmit').disabled = true;
  message.textContent = registering ? 'Creating your account…' : 'Signing in…';
  try {
    const user = await api(registering ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    $('authForm').reset();
    setAuthMode(false);
    enterApp(user);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    $('authSubmit').disabled = false;
  }
});
$('logoutBtn').onclick = async () => {
  let logoutError = '';
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    logoutError = error.message;
  }
  currentUser = null;
  setTimerUI(false);
  $('authView').hidden = false;
  document.querySelector('.app-layout').hidden = true;
  $('authForm').reset();
  setAuthMode(false);
  $('authMessage').textContent = logoutError;
};

/* ---------- init ---------- */
(async function init() {
  const today = new Date();
  $('welcomeTitle').innerHTML = `${today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening'}! <span>Ready to learn?</span>`;
  document.querySelector('.page-heading .eyebrow').textContent = `${today.toLocaleDateString([], { weekday: 'long' }).toUpperCase()} · YOUR LEARNING SPACE`;
  setTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  setAuthMode(false);
  try {
    const cats = await api('/api/categories');
    $('category').replaceChildren(...cats.map((c) => el('option', { value: c, textContent: c })));
  } catch (error) {
    $('authMessage').textContent = 'Could not connect to StudySync. Please check that the server is running.';
    return;
  }
  try {
    enterApp(await api('/api/auth/me'));
  } catch (error) {
    $('authView').hidden = false;
    document.querySelector('.app-layout').hidden = true;
    if (error.status !== 401) {
      $('authMessage').textContent = 'Could not connect to StudySync. Please check that the server is running.';
    }
  }
})();

// server.js — LexLead v2.0
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const path = require('path');
const db = require('./database');
const { checkAllAccounts, testConnection } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lexlead-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function auth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function apiAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Nicht eingeloggt' });
  next();
}

// ─── HTML TEMPLATES ───────────────────────────────────────────────────────────

const baseStyles = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0c10;
      --bg2: #111318;
      --bg3: #1a1d24;
      --border: #252830;
      --border2: #2e3240;
      --text: #e8eaf0;
      --muted: #7c8298;
      --accent: #4f8ef7;
      --accent2: #6c63ff;
      --green: #22c55e;
      --yellow: #f59e0b;
      --red: #ef4444;
      --orange: #f97316;
      --radius: 12px;
      --radius-sm: 8px;
      --shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    html { font-size: 15px; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { opacity: 0.8; }
    input, textarea, select {
      width: 100%; padding: 10px 14px;
      background: var(--bg3); border: 1px solid var(--border2);
      border-radius: var(--radius-sm); color: var(--text);
      font-family: inherit; font-size: 0.9rem;
      transition: border-color 0.2s;
      outline: none;
    }
    input:focus, textarea:focus, select:focus { border-color: var(--accent); }
    textarea { resize: vertical; min-height: 80px; }
    label { display: block; font-size: 0.82rem; font-weight: 600; color: var(--muted); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.05em; }
    .btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 9px 18px; border-radius: var(--radius-sm);
      font-weight: 600; font-size: 0.88rem; cursor: pointer;
      border: none; transition: all 0.18s; font-family: inherit;
      white-space: nowrap;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: #3d7de8; }
    .btn-secondary { background: var(--bg3); color: var(--text); border: 1px solid var(--border2); }
    .btn-secondary:hover { background: var(--border); }
    .btn-success { background: var(--green); color: #fff; }
    .btn-success:hover { background: #16a34a; }
    .btn-danger { background: var(--red); color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .btn-sm { padding: 6px 12px; font-size: 0.8rem; }
    .btn-icon { padding: 7px 10px; }
    .card {
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 20px;
    }
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 100px;
      font-size: 0.75rem; font-weight: 700; letter-spacing: 0.03em;
    }
    .badge-green { background: rgba(34,197,94,0.12); color: var(--green); }
    .badge-yellow { background: rgba(245,158,11,0.12); color: var(--yellow); }
    .badge-red { background: rgba(239,68,68,0.12); color: var(--red); }
    .badge-blue { background: rgba(79,142,247,0.12); color: var(--accent); }
    .badge-gray { background: var(--bg3); color: var(--muted); }
    .form-group { margin-bottom: 16px; }
    .alert { padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.9rem; }
    .alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
    .alert-success { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.25); color: #86efac; }
    .alert-info { background: rgba(79,142,247,0.1); border: 1px solid rgba(79,142,247,0.25); color: #93c5fd; }
    .nav {
      background: var(--bg2); border-bottom: 1px solid var(--border);
      padding: 0 24px; display: flex; align-items: center;
      height: 60px; gap: 4px; position: sticky; top: 0; z-index: 100;
    }
    .nav-brand { font-weight: 800; font-size: 1.15rem; color: var(--accent); margin-right: 20px; display:flex;align-items:center;gap:8px;}
    .nav-link { padding: 6px 14px; border-radius: var(--radius-sm); color: var(--muted); font-weight: 500; font-size: 0.9rem; transition:all 0.15s; }
    .nav-link:hover, .nav-link.active { background: var(--bg3); color: var(--text); opacity: 1; }
    .nav-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
    .page { max-width: 1200px; margin: 0 auto; padding: 28px 20px; }
    .page-header { margin-bottom: 24px; }
    .page-title { font-size: 1.5rem; font-weight: 800; }
    .page-sub { color: var(--muted); margin-top: 3px; font-size: 0.9rem; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .stat-value { font-size: 2rem; font-weight: 800; line-height: 1; }
    .stat-label { font-size: 0.82rem; color: var(--muted); margin-top: 5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-sub { font-size: 0.8rem; color: var(--muted); margin-top: 6px; }
    .score-bar { height: 6px; background: var(--bg3); border-radius: 3px; overflow: hidden; margin-top: 6px; }
    .score-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 14px; font-size: 0.78rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
    td { padding: 13px 14px; border-bottom: 1px solid var(--border); font-size: 0.88rem; vertical-align: middle; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    tr:last-child td { border-bottom: none; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .text-muted { color: var(--muted); }
    .text-sm { font-size: 0.82rem; }
    .flex { display: flex; align-items: center; }
    .gap-2 { gap: 8px; }
    .gap-3 { gap: 12px; }
    .mt-4 { margin-top: 16px; }
    .mt-6 { margin-top: 24px; }
    .mb-4 { margin-bottom: 16px; }
    .divider { height: 1px; background: var(--border); margin: 20px 0; }
    @media (max-width: 768px) {
      .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
      .nav-link span { display: none; }
    }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
    .empty-state .icon { font-size: 3rem; margin-bottom: 12px; }
    .empty-state p { font-size: 0.9rem; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000; align-items:center; justify-content:center; }
    .modal-overlay.open { display:flex; }
    .modal { background:var(--bg2); border:1px solid var(--border2); border-radius:var(--radius); padding:24px; width:90%; max-width:560px; max-height:90vh; overflow-y:auto; }
    .modal-header { font-size:1.1rem; font-weight:700; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; }
    .score-pill { display:inline-flex;align-items:center;justify-content:center; width:32px;height:32px;border-radius:50%; font-weight:800;font-size:0.9rem; }
    .score-high { background:rgba(34,197,94,0.15);color:var(--green); }
    .score-mid { background:rgba(245,158,11,0.15);color:var(--yellow); }
    .score-low { background:rgba(239,68,68,0.15);color:var(--red); }
    .score-none { background:var(--bg3);color:var(--muted); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg2); }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
  </style>
`;

function navbar(active, user) {
  const links = [
    { href: '/dashboard', icon: '⊞', label: 'Dashboard', key: 'dashboard' },
    { href: '/leads', icon: '✉', label: 'Leads', key: 'leads' },
    { href: '/kalender', icon: '◷', label: 'Kalender', key: 'kalender' },
    { href: '/einstellungen', icon: '⚙', label: 'Einstellungen', key: 'einstellungen' },
  ];
  return `
  <nav class="nav">
    <div class="nav-brand">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="7" fill="#4f8ef7"/>
        <path d="M7 20L14 8L21 20" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10 16H18" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
      LexLead
    </div>
    ${links.map(l => `<a href="${l.href}" class="nav-link ${active === l.key ? 'active' : ''}">${l.icon} <span>${l.label}</span></a>`).join('')}
    <div class="nav-right">
      <span class="text-sm text-muted">${user?.name || ''}</span>
      <a href="/logout" class="btn btn-secondary btn-sm">Logout</a>
    </div>
  </nav>`;
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect(req.session.userId ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LexLead – Login</title>${baseStyles}<style>
    .auth-page { min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px; }
    .auth-box { width:100%;max-width:400px; }
    .auth-logo { text-align:center;margin-bottom:32px; }
    .auth-logo h1 { font-size:2rem;font-weight:900;color:var(--accent); }
    .auth-logo p { color:var(--muted);font-size:0.9rem;margin-top:4px; }
    .auth-card { background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:32px; }
    .auth-tabs { display:flex;gap:8px;margin-bottom:24px; }
    .auth-tab { flex:1;padding:9px;text-align:center;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-size:0.88rem;border:1px solid var(--border2);color:var(--muted);background:transparent;font-family:inherit;transition:all 0.15s; }
    .auth-tab.active { background:var(--accent);color:#fff;border-color:var(--accent); }
    .pane { display:none; }
    .pane.active { display:block; }
  </style></head><body>
  <div class="auth-page">
    <div class="auth-box">
      <div class="auth-logo">
        <h1>⬟ LexLead</h1>
        <p>KI-Filter für Immobilien-Anfragen</p>
      </div>
      <div class="auth-card">
        <div class="auth-tabs">
          <button class="auth-tab active" onclick="showTab('login',this)">Einloggen</button>
          <button class="auth-tab" onclick="showTab('register',this)">Registrieren</button>
        </div>
        ${req.query.error ? `<div class="alert alert-error">${req.query.error}</div>` : ''}
        ${req.query.success ? `<div class="alert alert-success">${req.query.success}</div>` : ''}
        <div id="login" class="pane active">
          <form method="POST" action="/login">
            <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required autofocus></div>
            <div class="form-group"><label>Passwort</label><input type="password" name="password" placeholder="••••••••" required></div>
            <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;">Einloggen</button>
          </form>
        </div>
        <div id="register" class="pane">
          <form method="POST" action="/register">
            <div class="form-group"><label>Name</label><input type="text" name="name" placeholder="Max Mustermann" required></div>
            <div class="form-group"><label>Maklerbüro (optional)</label><input type="text" name="firma" placeholder="Immobilien GmbH"></div>
            <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required></div>
            <div class="form-group"><label>Passwort</label><input type="password" name="password" placeholder="Min. 6 Zeichen" required minlength="6"></div>
            <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;">30 Tage kostenlos testen</button>
          </form>
        </div>
      </div>
      <p style="text-align:center;color:var(--muted);font-size:0.78rem;margin-top:16px;">149€/Monat · Kein Risiko · Jederzeit kündbar</p>
    </div>
  </div>
  <script>
    function showTab(id, el) {
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      el.classList.add('active');
    }
    // Auto-show register tab if ?tab=register
    if (location.search.includes('tab=register')) showTab('register', document.querySelectorAll('.auth-tab')[1]);
  </script>
  </body></html>`);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.getUserByEmail(email?.toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.redirect('/login?error=E-Mail+oder+Passwort+falsch');
  }
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/register', async (req, res) => {
  const { name, email, password, firma } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.redirect('/login?tab=register&error=Bitte+alle+Felder+ausfüllen');
  }
  const existing = db.getUserByEmail(email.toLowerCase().trim());
  if (existing) return res.redirect('/login?error=E-Mail+bereits+registriert');
  const hash = await bcrypt.hash(password, 10);
  const user = db.createUser(name, email.toLowerCase().trim(), hash, firma);
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login?success=Erfolgreich+ausgeloggt');
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

app.get('/dashboard', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const stats = db.getLeadStats(req.session.userId);
  const topLeads = db.getLeads(req.session.userId, { limit: 5 });
  const wiedervorlagen = db.getWiedervorlagen(req.session.userId);
  const accounts = db.getEmailAccounts(req.session.userId);

  const scoreColor = (s) => s >= 7 ? 'var(--green)' : s >= 4 ? 'var(--yellow)' : s > 0 ? 'var(--red)' : 'var(--muted)';
  const scorePill = (s) => `<span class="score-pill ${s >= 7 ? 'score-high' : s >= 4 ? 'score-mid' : s > 0 ? 'score-low' : 'score-none'}">${s || '?'}</span>`;
  const portalBadge = (p) => `<span class="badge badge-blue">${p}</span>`;
  const statusBadge = (s) => {
    const map = { neu: ['badge-blue','Neu'], beantwortet: ['badge-green','Beantwortet'], abgelehnt: ['badge-red','Abgelehnt'], warten: ['badge-yellow','Warten'] };
    const [cls, label] = map[s] || ['badge-gray', s];
    return `<span class="badge ${cls}">${label}</span>`;
  };

  const heute = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard – LexLead</title>${baseStyles}</head><body>
  ${navbar('dashboard', user)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="page-title">Guten Tag, ${user.name.split(' ')[0]} 👋</div>
        <div class="page-sub">${heute} · ${stats.heute} neue Leads heute</div>
      </div>
      <form method="POST" action="/api/check-now" style="display:inline">
        <button type="submit" class="btn btn-secondary">↻ Jetzt abrufen</button>
      </form>
    </div>

    ${accounts.length === 0 ? `
    <div class="alert alert-info" style="margin-bottom:20px;">
      ℹ️ Noch kein E-Mail-Account verbunden. <a href="/einstellungen" style="font-weight:700">Jetzt verbinden →</a>
    </div>` : ''}

    ${wiedervorlagen.length > 0 ? `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius);padding:16px 20px;margin-bottom:20px;">
      <div style="font-weight:700;color:var(--yellow);margin-bottom:10px;">⏰ ${wiedervorlagen.length} Wiedervorlage${wiedervorlagen.length > 1 ? 'n' : ''} heute fällig</div>
      ${wiedervorlagen.slice(0, 3).map(l => `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid rgba(245,158,11,0.1);">
          ${scorePill(l.score)}
          <div style="flex:1">
            <div style="font-weight:600;font-size:0.88rem">${l.from_name || l.from_email}</div>
            <div class="text-sm text-muted">${l.subject}</div>
          </div>
          <a href="/leads/${l.id}" class="btn btn-secondary btn-sm">Öffnen</a>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="grid-4 mb-4">
      <div class="stat-card">
        <div class="stat-value">${stats.gesamt}</div>
        <div class="stat-label">Leads gesamt</div>
        <div class="stat-sub">${stats.heute} heute neu</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--green)">${stats.hoch}</div>
        <div class="stat-label">Score ≥ 7</div>
        <div class="stat-sub">Hohe Priorität</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--yellow)">${stats.mittel}</div>
        <div class="stat-label">Score 4–6</div>
        <div class="stat-sub">Mittlere Priorität</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--accent)">${stats.beantwortet}</div>
        <div class="stat-label">Beantwortet</div>
        <div class="stat-sub">Quote: ${stats.gesamt > 0 ? Math.round((stats.beantwortet / stats.gesamt) * 100) : 0}%</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-weight:700">Top Leads</div>
          <a href="/leads" class="btn btn-secondary btn-sm">Alle anzeigen</a>
        </div>
        ${topLeads.length === 0 ? `<div class="empty-state" style="padding:30px 0"><div class="icon">📭</div><p>Noch keine Leads vorhanden</p></div>` : `
        <table>
          <thead><tr><th>Score</th><th>Kontakt</th><th>Portal</th><th>Status</th></tr></thead>
          <tbody>
            ${topLeads.map(l => `
            <tr style="cursor:pointer" onclick="location.href='/leads/${l.id}'">
              <td>${scorePill(l.score)}</td>
              <td>
                <div style="font-weight:600">${l.from_name || l.from_email}</div>
                <div class="text-sm text-muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</div>
              </td>
              <td>${portalBadge(l.portal)}</td>
              <td>${statusBadge(l.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:16px">Statistik</div>
        ${stats.gesamt > 0 ? `
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="text-sm">Hoch (≥7)</span>
            <span class="text-sm" style="color:var(--green)">${stats.hoch}</span>
          </div>
          <div class="score-bar"><div class="score-fill" style="width:${stats.gesamt > 0 ? (stats.hoch/stats.gesamt*100) : 0}%;background:var(--green)"></div></div>
        </div>
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="text-sm">Mittel (4–6)</span>
            <span class="text-sm" style="color:var(--yellow)">${stats.mittel}</span>
          </div>
          <div class="score-bar"><div class="score-fill" style="width:${stats.gesamt > 0 ? (stats.mittel/stats.gesamt*100) : 0}%;background:var(--yellow)"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="text-sm">Niedrig (1–3)</span>
            <span class="text-sm" style="color:var(--red)">${stats.niedrig}</span>
          </div>
          <div class="score-bar"><div class="score-fill" style="width:${stats.gesamt > 0 ? (stats.niedrig/stats.gesamt*100) : 0}%;background:var(--red)"></div></div>
        </div>
        ` : `<div class="text-muted text-sm">Noch keine Daten vorhanden.</div>`}
        <div class="divider"></div>
        <div style="font-weight:700;margin-bottom:12px">Verbundene Postfächer</div>
        ${accounts.length === 0 ? `<div class="text-muted text-sm">Kein E-Mail-Account verbunden</div>` :
          accounts.map(a => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--green)"></div>
            <div>
              <div style="font-weight:600;font-size:0.88rem">${a.label || a.email}</div>
              <div class="text-sm text-muted">${a.email}</div>
            </div>
          </div>`).join('')}
        }
      </div>
    </div>
  </div>
  <script>
    // Auto-check form
    document.querySelector('form[action="/api/check-now"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = '⏳ Abrufe...';
      try {
        const r = await fetch('/api/check-now', { method: 'POST' });
        const d = await r.json();
        btn.textContent = '✓ ' + (d.neue || 0) + ' neue Leads';
        setTimeout(() => location.reload(), 1500);
      } catch { btn.textContent = '↻ Fehler'; }
    });
  </script>
  </body></html>`);
});

// ─── LEADS LIST ───────────────────────────────────────────────────────────────

app.get('/leads', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const { status, portal, search, min } = req.query;
  const leads = db.getLeads(req.session.userId, {
    status: status || null,
    portal: portal || null,
    search: search || null,
    minScore: min ? parseInt(min) : null
  });

  const scorePill = (s) => `<span class="score-pill ${s >= 7 ? 'score-high' : s >= 4 ? 'score-mid' : s > 0 ? 'score-low' : 'score-none'}">${s || '?'}</span>`;
  const statusBadge = (s) => {
    const map = { neu: ['badge-blue','Neu'], beantwortet: ['badge-green','Beantwortet'], abgelehnt: ['badge-red','Abgelehnt'], warten: ['badge-yellow','Warten'] };
    const [cls, label] = map[s] || ['badge-gray', s];
    return `<span class="badge ${cls}">${label}</span>`;
  };
  const kaufBadge = (k) => {
    const map = { Hoch: 'badge-green', Mittel: 'badge-yellow', Niedrig: 'badge-red' };
    return k ? `<span class="badge ${map[k] || 'badge-gray'}">${k}</span>` : '<span class="text-muted">–</span>';
  };
  const timeAgo = (dt) => {
    if (!dt) return '';
    const diff = Date.now() - new Date(dt);
    const h = Math.floor(diff / 3600000);
    if (h < 1) return 'Gerade eben';
    if (h < 24) return `vor ${h}h`;
    const d = Math.floor(h / 24);
    return `vor ${d}d`;
  };

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leads – LexLead</title>${baseStyles}</head><body>
  ${navbar('leads', user)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="page-title">Leads</div>
        <div class="page-sub">${leads.length} Ergebnis${leads.length !== 1 ? 'se' : ''}</div>
      </div>
    </div>

    <div class="card mb-4" style="padding:14px 16px">
      <form method="GET" action="/leads" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:200px">
          <label>Suche</label>
          <input name="search" placeholder="Name, E-Mail, Betreff…" value="${search || ''}">
        </div>
        <div style="min-width:140px">
          <label>Status</label>
          <select name="status">
            <option value="">Alle Status</option>
            <option value="neu" ${status === 'neu' ? 'selected' : ''}>Neu</option>
            <option value="beantwortet" ${status === 'beantwortet' ? 'selected' : ''}>Beantwortet</option>
            <option value="warten" ${status === 'warten' ? 'selected' : ''}>Warten</option>
            <option value="abgelehnt" ${status === 'abgelehnt' ? 'selected' : ''}>Abgelehnt</option>
          </select>
        </div>
        <div style="min-width:140px">
          <label>Min. Score</label>
          <select name="min">
            <option value="">Alle Scores</option>
            <option value="7" ${min === '7' ? 'selected' : ''}>≥ 7 (Hoch)</option>
            <option value="4" ${min === '4' ? 'selected' : ''}>≥ 4 (Mittel+)</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary">Filtern</button>
        ${search || status || min ? `<a href="/leads" class="btn btn-secondary">Reset</a>` : ''}
      </form>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      ${leads.length === 0 ? `<div class="empty-state"><div class="icon">📭</div><p>Keine Leads gefunden.</p></div>` : `
      <table>
        <thead><tr><th>Score</th><th>Kontakt</th><th>Betreff</th><th>Portal</th><th>Kaufabsicht</th><th>Status</th><th>Eingang</th></tr></thead>
        <tbody>
          ${leads.map(l => `
          <tr style="cursor:pointer" onclick="location.href='/leads/${l.id}'">
            <td>${scorePill(l.score)}</td>
            <td>
              <div style="font-weight:600">${l.from_name || '–'}</div>
              <div class="text-sm text-muted">${l.from_email}</div>
            </td>
            <td style="max-width:220px">
              <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${l.subject}</div>
              ${l.wiedervorlage ? `<div class="text-sm" style="color:var(--yellow)">⏰ ${l.wiedervorlage}</div>` : ''}
            </td>
            <td><span class="badge badge-blue">${l.portal}</span></td>
            <td>${kaufBadge(l.kaufabsicht)}</td>
            <td>${statusBadge(l.status)}</td>
            <td class="text-muted text-sm">${timeAgo(l.received_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`}
    </div>
  </div>
  </body></html>`);
});

// ─── LEAD DETAIL ──────────────────────────────────────────────────────────────

app.get('/leads/:id', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const lead = db.getLeadById(req.params.id, req.session.userId);
  if (!lead) return res.redirect('/leads');

  const scoreClass = lead.score >= 7 ? 'score-high' : lead.score >= 4 ? 'score-mid' : lead.score > 0 ? 'score-low' : 'score-none';
  const kaufColor = { Hoch: 'var(--green)', Mittel: 'var(--yellow)', Niedrig: 'var(--red)' }[lead.kaufabsicht] || 'var(--muted)';

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${lead.from_name || lead.from_email} – LexLead</title>${baseStyles}</head><body>
  ${navbar('leads', user)}
  <div class="page">
    <div style="margin-bottom:16px"><a href="/leads" class="btn btn-secondary btn-sm">← Zurück</a></div>

    <div style="display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start">
      <!-- Main -->
      <div>
        <div class="card mb-4">
          <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:20px">
            <span class="score-pill ${scoreClass}" style="width:44px;height:44px;font-size:1.1rem">${lead.score || '?'}</span>
            <div style="flex:1">
              <div style="font-size:1.15rem;font-weight:700">${lead.from_name || lead.from_email}</div>
              <div class="text-muted text-sm">${lead.from_email}</div>
              <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
                <span class="badge badge-blue">${lead.portal}</span>
                ${lead.objekt_ref ? `<span class="badge badge-gray">Objekt #${lead.objekt_ref}</span>` : ''}
                <span class="badge ${lead.status === 'neu' ? 'badge-blue' : lead.status === 'beantwortet' ? 'badge-green' : lead.status === 'abgelehnt' ? 'badge-red' : 'badge-yellow'}">${lead.status}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px">
              <select id="statusSelect" onchange="updateStatus(this.value)" class="btn btn-secondary btn-sm" style="width:auto;padding:6px 12px">
                <option value="neu" ${lead.status === 'neu' ? 'selected' : ''}>Neu</option>
                <option value="beantwortet" ${lead.status === 'beantwortet' ? 'selected' : ''}>Beantwortet</option>
                <option value="warten" ${lead.status === 'warten' ? 'selected' : ''}>Warten</option>
                <option value="abgelehnt" ${lead.status === 'abgelehnt' ? 'selected' : ''}>Abgelehnt</option>
              </select>
            </div>
          </div>

          <div class="divider"></div>

          <div style="font-weight:700;margin-bottom:8px">Betreff</div>
          <div style="color:var(--muted)">${lead.subject}</div>

          <div class="divider"></div>

          <div style="font-weight:700;margin-bottom:12px">KI-Analyse</div>
          <div class="grid-2" style="margin-bottom:16px;gap:12px">
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Kaufabsicht</div>
              <div style="font-weight:700;color:${kaufColor}">${lead.kaufabsicht || '–'}</div>
            </div>
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Finanzierung</div>
              <div style="font-weight:700">${lead.finanzierung || '–'}</div>
            </div>
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Zeitrahmen</div>
              <div style="font-weight:700">${lead.zeitrahmen || '–'}</div>
            </div>
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Eingang</div>
              <div style="font-weight:700">${lead.received_at ? new Date(lead.received_at).toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '–'}</div>
            </div>
          </div>

          ${lead.zusammenfassung ? `
          <div style="background:rgba(79,142,247,0.06);border:1px solid rgba(79,142,247,0.15);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px">
            <div style="font-size:0.78rem;font-weight:700;color:var(--accent);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">KI-Zusammenfassung</div>
            <div style="font-size:0.9rem;line-height:1.6">${lead.zusammenfassung}</div>
          </div>` : ''}

          <div class="divider"></div>
          <div style="font-weight:700;margin-bottom:10px">Original E-Mail</div>
          <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px;font-size:0.85rem;line-height:1.7;white-space:pre-wrap;max-height:300px;overflow-y:auto;color:var(--muted)">${(lead.body || '').substring(0, 3000)}</div>
        </div>

        <!-- Antwort-Entwurf -->
        ${lead.antwort_entwurf ? `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-weight:700">✨ KI-Antwort-Entwurf</div>
            <button onclick="copyDraft()" class="btn btn-primary btn-sm" id="copyBtn">Kopieren</button>
          </div>
          <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px;font-size:0.88rem;line-height:1.7;white-space:pre-wrap" id="draftText">${lead.antwort_entwurf}</div>
        </div>` : ''}
      </div>

      <!-- Sidebar -->
      <div>
        <!-- Notizen -->
        <div class="card mb-4">
          <div style="font-weight:700;margin-bottom:12px">📝 Notiz</div>
          <textarea id="notizText" rows="4" placeholder="Interne Notiz hinzufügen…">${lead.notiz || ''}</textarea>
          <button onclick="saveNotiz()" class="btn btn-secondary btn-sm mt-4" style="width:100%;justify-content:center">Speichern</button>
        </div>

        <!-- Wiedervorlage -->
        <div class="card mb-4">
          <div style="font-weight:700;margin-bottom:12px">⏰ Wiedervorlage</div>
          <input type="date" id="wiedervorlageDate" value="${lead.wiedervorlage || ''}" min="${new Date().toISOString().split('T')[0]}">
          <button onclick="saveWiedervorlage()" class="btn btn-secondary btn-sm mt-4" style="width:100%;justify-content:center">Setzen</button>
        </div>

        <!-- Termin erstellen -->
        <div class="card mb-4">
          <div style="font-weight:700;margin-bottom:12px">📅 Termin erstellen</div>
          <div class="form-group">
            <label>Typ</label>
            <select id="terminTyp">
              <option value="besichtigung">Besichtigung</option>
              <option value="anruf">Anruf</option>
              <option value="termin">Termin</option>
              <option value="frist">Frist</option>
            </select>
          </div>
          <div class="form-group">
            <label>Datum</label>
            <input type="date" id="terminDatum" min="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label>Uhrzeit</label>
            <input type="time" id="terminUhrzeit">
          </div>
          <button onclick="createTermin()" class="btn btn-success btn-sm" style="width:100%;justify-content:center">Termin speichern</button>
        </div>

        <!-- Lead archivieren -->
        <button onclick="if(confirm('Lead archivieren?')) fetch('/api/leads/${lead.id}/archive',{method:'POST'}).then(()=>location.href='/leads')"
          class="btn btn-secondary" style="width:100%;justify-content:center;color:var(--muted)">
          🗑 Archivieren
        </button>
      </div>
    </div>
  </div>
  <script>
    async function updateStatus(val) {
      await fetch('/api/leads/${lead.id}/status', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status: val}) });
      showToast('Status aktualisiert');
    }
    async function saveNotiz() {
      const notiz = document.getElementById('notizText').value;
      await fetch('/api/leads/${lead.id}/notiz', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({notiz}) });
      showToast('Notiz gespeichert');
    }
    async function saveWiedervorlage() {
      const datum = document.getElementById('wiedervorlageDate').value;
      await fetch('/api/leads/${lead.id}/wiedervorlage', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({datum}) });
      showToast('Wiedervorlage gesetzt: ' + datum);
    }
    async function createTermin() {
      const typ = document.getElementById('terminTyp').value;
      const datum = document.getElementById('terminDatum').value;
      const uhrzeit = document.getElementById('terminUhrzeit').value;
      if (!datum) { showToast('Bitte Datum wählen', 'error'); return; }
      const titel = typ.charAt(0).toUpperCase() + typ.slice(1) + ' – ' + '${(lead.from_name || lead.from_email).replace(/'/g, "\\'")}';
      await fetch('/api/termine', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({leadId: ${lead.id}, titel, typ, datum, uhrzeit}) });
      showToast('Termin erstellt');
    }
    function copyDraft() {
      navigator.clipboard.writeText(document.getElementById('draftText').innerText);
      const btn = document.getElementById('copyBtn');
      btn.textContent = '✓ Kopiert!';
      setTimeout(() => btn.textContent = 'Kopieren', 2000);
    }
    function showToast(msg, type='success') {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-weight:600;z-index:9999;transition:opacity 0.3s;font-size:0.88rem;';
      t.style.background = type === 'error' ? '#ef4444' : '#22c55e';
      t.style.color = '#fff';
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
    }
  </script>
  </body></html>`);
});

// ─── KALENDER ────────────────────────────────────────────────────────────────

app.get('/kalender', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);
  const monatStr = `${year}-${String(month).padStart(2, '0')}`;
  const termine = db.getTermine(req.session.userId, monatStr);

  const monatName = new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const ersterTag = new Date(year, month - 1, 1).getDay();
  const offset = ersterTag === 0 ? 6 : ersterTag - 1;
  const tageImMonat = new Date(year, month, 0).getDate();

  const prevM = month === 1 ? 12 : month - 1;
  const prevY = month === 1 ? year - 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const nextY = month === 12 ? year + 1 : year;

  const terminByDay = {};
  termine.forEach(t => {
    const day = parseInt(t.datum.split('-')[2]);
    if (!terminByDay[day]) terminByDay[day] = [];
    terminByDay[day].push(t);
  });

  const typeColor = { besichtigung: 'var(--accent)', anruf: 'var(--green)', termin: 'var(--yellow)', frist: 'var(--red)' };
  const typeIcon = { besichtigung: '🏠', anruf: '📞', termin: '👔', frist: '⚠️' };

  let calCells = '';
  for (let i = 0; i < offset; i++) calCells += `<div class="cal-cell cal-empty"></div>`;
  for (let d = 1; d <= tageImMonat; d++) {
    const isToday = d === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
    const dayTermine = terminByDay[d] || [];
    calCells += `
      <div class="cal-cell ${isToday ? 'cal-today' : ''}">
        <div class="cal-day">${d}</div>
        ${dayTermine.slice(0, 3).map(t => `
          <div class="cal-event" style="background:${typeColor[t.typ] || 'var(--accent)'}20;border-left:2px solid ${typeColor[t.typ] || 'var(--accent)'};" title="${t.titel}">
            ${typeIcon[t.typ] || '📌'} <span>${t.uhrzeit ? t.uhrzeit + ' ' : ''}${t.titel.substring(0, 20)}</span>
          </div>
        `).join('')}
        ${dayTermine.length > 3 ? `<div class="text-sm text-muted">+${dayTermine.length - 3} mehr</div>` : ''}
      </div>`;
  }

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kalender – LexLead</title>${baseStyles}<style>
    .cal-grid { display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-top:10px; }
    .cal-header-cell { text-align:center;padding:10px;font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em; }
    .cal-cell { background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;min-height:90px;transition:background 0.15s; }
    .cal-cell:hover { background:var(--bg3); }
    .cal-empty { background:transparent;border-color:transparent; }
    .cal-today { border-color:var(--accent);background:rgba(79,142,247,0.04); }
    .cal-day { font-size:0.85rem;font-weight:700;margin-bottom:6px; }
    .cal-today .cal-day { color:var(--accent); }
    .cal-event { font-size:0.72rem;padding:3px 6px;border-radius:4px;margin-bottom:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer; }
  </style></head><body>
  ${navbar('kalender', user)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="page-title">Kalender</div>
        <div class="page-sub">${termine.length} Termine in ${monatName}</div>
      </div>
      <button onclick="document.getElementById('terminModal').classList.add('open')" class="btn btn-primary">+ Termin</button>
    </div>

    <div class="card" style="padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <a href="/kalender?year=${prevY}&month=${prevM}" class="btn btn-secondary btn-sm">← Zurück</a>
        <div style="font-weight:800;font-size:1.1rem">${monatName}</div>
        <a href="/kalender?year=${nextY}&month=${nextM}" class="btn btn-secondary btn-sm">Weiter →</a>
      </div>
      <div class="cal-grid">
        ${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => `<div class="cal-header-cell">${d}</div>`).join('')}
        ${calCells}
      </div>
    </div>

    <!-- Termine Liste -->
    ${termine.length > 0 ? `
    <div class="card mt-6">
      <div style="font-weight:700;margin-bottom:14px">Alle Termine diesen Monat</div>
      ${termine.map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:1.3rem">${typeIcon[t.typ] || '📌'}</div>
          <div style="flex:1">
            <div style="font-weight:600">${t.titel}</div>
            <div class="text-sm text-muted">${t.datum}${t.uhrzeit ? ' · ' + t.uhrzeit : ''}</div>
            ${t.notiz ? `<div class="text-sm text-muted">${t.notiz}</div>` : ''}
          </div>
          <button onclick="deleteTermin(${t.id})" class="btn btn-secondary btn-sm btn-icon">✕</button>
        </div>
      `).join('')}
    </div>` : ''}
  </div>

  <!-- Termin Modal -->
  <div class="modal-overlay" id="terminModal" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal">
      <div class="modal-header">
        Neuer Termin
        <button onclick="document.getElementById('terminModal').classList.remove('open')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div class="form-group"><label>Titel</label><input id="tTitel" placeholder="Besichtigung Musterstraße 5"></div>
      <div class="form-group"><label>Typ</label>
        <select id="tTyp">
          <option value="termin">Termin</option>
          <option value="besichtigung">Besichtigung</option>
          <option value="anruf">Anruf</option>
          <option value="frist">Frist</option>
        </select>
      </div>
      <div class="grid-2">
        <div class="form-group"><label>Datum</label><input type="date" id="tDatum"></div>
        <div class="form-group"><label>Uhrzeit</label><input type="time" id="tUhrzeit"></div>
      </div>
      <div class="form-group"><label>Notiz (optional)</label><textarea id="tNotiz" rows="2" placeholder="Zusätzliche Infos…"></textarea></div>
      <button onclick="createTerminFromModal()" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px">Speichern</button>
    </div>
  </div>
  <script>
    async function createTerminFromModal() {
      const titel = document.getElementById('tTitel').value;
      const typ = document.getElementById('tTyp').value;
      const datum = document.getElementById('tDatum').value;
      const uhrzeit = document.getElementById('tUhrzeit').value;
      const notiz = document.getElementById('tNotiz').value;
      if (!titel || !datum) { alert('Bitte Titel und Datum angeben.'); return; }
      await fetch('/api/termine', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({titel, typ, datum, uhrzeit, notiz}) });
      location.reload();
    }
    async function deleteTermin(id) {
      if (!confirm('Termin löschen?')) return;
      await fetch('/api/termine/' + id, { method: 'DELETE' });
      location.reload();
    }
  </script>
  </body></html>`);
});

// ─── EINSTELLUNGEN ────────────────────────────────────────────────────────────

app.get('/einstellungen', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const accounts = db.getEmailAccounts(req.session.userId);

  const hostHints = [
    { name: 'Gmail', host: 'imap.gmail.com', port: 993 },
    { name: 'Outlook / Hotmail', host: 'outlook.office365.com', port: 993 },
    { name: 'GMX', host: 'imap.gmx.net', port: 993 },
    { name: 'Web.de', host: 'imap.web.de', port: 993 },
    { name: 'T-Online', host: 'secureimap.t-online.de', port: 993 },
    { name: 'iCloud', host: 'imap.mail.me.com', port: 993 },
    { name: 'Strato', host: 'imap.strato.de', port: 993 },
    { name: '1&1 / IONOS', host: 'imap.ionos.de', port: 993 },
  ];

  const apiKeyStatus = process.env.ANTHROPIC_API_KEY
    ? `<span class="badge badge-green">✓ Konfiguriert</span>`
    : `<span class="badge badge-red">✗ Fehlt – KI-Analyse inaktiv</span>`;

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Einstellungen – LexLead</title>${baseStyles}</head><body>
  ${navbar('einstellungen', user)}
  <div class="page" style="max-width:760px">
    <div class="page-header"><div class="page-title">Einstellungen</div></div>

    ${req.query.msg ? `<div class="alert ${req.query.error ? 'alert-error' : 'alert-success'}">${req.query.msg}</div>` : ''}

    <!-- E-Mail Accounts -->
    <div class="card mb-4">
      <div style="font-weight:700;font-size:1.05rem;margin-bottom:16px">📬 E-Mail-Postfächer</div>

      ${accounts.length > 0 ? `
      <div style="margin-bottom:16px">
        ${accounts.map(a => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--green)"></div>
          <div style="flex:1">
            <div style="font-weight:600">${a.label || a.email}</div>
            <div class="text-sm text-muted">${a.email} · ${a.host}:${a.port}</div>
            ${a.last_check ? `<div class="text-sm text-muted">Zuletzt geprüft: ${new Date(a.last_check).toLocaleString('de-DE')}</div>` : ''}
          </div>
          <button onclick="if(confirm('Account entfernen?')) fetch('/api/accounts/${a.id}',{method:'DELETE'}).then(()=>location.reload())" class="btn btn-danger btn-sm">Entfernen</button>
        </div>`).join('')}
      </div>` : `<p class="text-muted text-sm" style="margin-bottom:16px">Noch kein E-Mail-Account verbunden.</p>`}

      <div style="border:1px solid var(--border2);border-radius:var(--radius-sm);padding:16px">
        <div style="font-weight:700;margin-bottom:14px">Neues Postfach hinzufügen</div>
        <div class="form-group">
          <label>Anbieter (für Host-Vorausfüllung)</label>
          <select onchange="fillHost(this.value)">
            <option value="">– Anbieter wählen –</option>
            ${hostHints.map(h => `<option value="${h.host}:${h.port}">${h.name}</option>`).join('')}
            <option value="custom">Eigener Server</option>
          </select>
        </div>
        <div class="grid-2">
          <div class="form-group"><label>Label</label><input id="acc_label" placeholder="Mein Geschäftspostfach"></div>
          <div class="form-group"><label>E-Mail-Adresse</label><input id="acc_email" type="email" placeholder="makler@firma.de"></div>
        </div>
        <div class="form-group"><label>Passwort / App-Passwort</label><input id="acc_pw" type="password" placeholder="••••••••"></div>
        <div class="grid-2">
          <div class="form-group"><label>IMAP-Host</label><input id="acc_host" placeholder="imap.gmail.com"></div>
          <div class="form-group"><label>Port</label><input id="acc_port" type="number" value="993"></div>
        </div>
        <div style="display:flex;gap:10px">
          <button onclick="testAccount()" class="btn btn-secondary" id="testBtn">Verbindung testen</button>
          <button onclick="addAccount()" class="btn btn-primary" id="addBtn">Postfach speichern</button>
        </div>
        <div id="testResult" style="margin-top:10px"></div>
      </div>

      <div class="mt-4" style="background:var(--bg3);border-radius:var(--radius-sm);padding:12px">
        <div style="font-size:0.8rem;font-weight:700;color:var(--muted);margin-bottom:6px">💡 HINWEIS: Gmail & Google Workspace</div>
        <div class="text-sm text-muted">Bei Gmail bitte ein <strong>App-Passwort</strong> verwenden (Google-Konto → Sicherheit → 2FA → App-Passwörter). Normales Google-Passwort funktioniert nicht mit IMAP.</div>
      </div>
    </div>

    <!-- KI-Status -->
    <div class="card mb-4">
      <div style="font-weight:700;font-size:1.05rem;margin-bottom:12px">🤖 KI-Analyse (Claude)</div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div class="text-sm text-muted">Anthropic API Key Status</div>
          <div style="margin-top:4px">${apiKeyStatus}</div>
        </div>
      </div>
      ${!process.env.ANTHROPIC_API_KEY ? `
      <div class="mt-4 text-sm text-muted">
        Tragen Sie den API Key als Environment Variable <code style="background:var(--bg3);padding:2px 6px;border-radius:4px">ANTHROPIC_API_KEY</code> in Render ein.<br>
        API Key erhalten: <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>
      </div>` : ''}
    </div>

    <!-- Profil -->
    <div class="card">
      <div style="font-weight:700;font-size:1.05rem;margin-bottom:16px">👤 Profil</div>
      <div class="grid-2">
        <div><label>Name</label><div style="padding:10px 0;font-weight:600">${user.name}</div></div>
        <div><label>E-Mail</label><div style="padding:10px 0;color:var(--muted)">${user.email}</div></div>
        <div><label>Firma</label><div style="padding:10px 0;color:var(--muted)">${user.firma || '–'}</div></div>
        <div><label>Plan</label><div style="padding:10px 0"><span class="badge badge-blue">${user.plan === 'trial' ? 'Testphase' : user.plan}</span></div></div>
      </div>
    </div>
  </div>

  <script>
    function fillHost(val) {
      if (!val || val === 'custom') return;
      const [host, port] = val.split(':');
      document.getElementById('acc_host').value = host;
      document.getElementById('acc_port').value = port;
    }
    async function testAccount() {
      const btn = document.getElementById('testBtn');
      const res = document.getElementById('testResult');
      btn.disabled = true; btn.textContent = '⏳ Teste…';
      const data = {
        email: document.getElementById('acc_email').value,
        password: document.getElementById('acc_pw').value,
        host: document.getElementById('acc_host').value,
        port: parseInt(document.getElementById('acc_port').value) || 993
      };
      try {
        const r = await fetch('/api/accounts/test', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
        const d = await r.json();
        res.innerHTML = d.ok
          ? '<div class="alert alert-success">✓ Verbindung erfolgreich!</div>'
          : '<div class="alert alert-error">✗ Fehler: ' + (d.error || 'Unbekannt') + '</div>';
      } catch { res.innerHTML = '<div class="alert alert-error">Netzwerkfehler</div>'; }
      btn.disabled = false; btn.textContent = 'Verbindung testen';
    }
    async function addAccount() {
      const btn = document.getElementById('addBtn');
      btn.disabled = true; btn.textContent = '⏳ Speichere…';
      const data = {
        label: document.getElementById('acc_label').value,
        email: document.getElementById('acc_email').value,
        password: document.getElementById('acc_pw').value,
        host: document.getElementById('acc_host').value,
        port: parseInt(document.getElementById('acc_port').value) || 993
      };
      if (!data.email || !data.password || !data.host) {
        alert('Bitte alle Pflichtfelder ausfüllen.');
        btn.disabled = false; btn.textContent = 'Postfach speichern';
        return;
      }
      const r = await fetch('/api/accounts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      const d = await r.json();
      if (d.ok) location.reload();
      else alert('Fehler: ' + (d.error || 'Unbekannt'));
      btn.disabled = false; btn.textContent = 'Postfach speichern';
    }
  </script>
  </body></html>`);
});

// ─── API ROUTES ───────────────────────────────────────────────────────────────

app.post('/api/check-now', apiAuth, async (req, res) => {
  try {
    const { checkAccount } = require('./mailer');
    const accounts = db.getEmailAccounts(req.session.userId);
    let total = 0;
    for (const acc of accounts) total += await checkAccount(acc);
    res.json({ ok: true, neue: total });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/accounts', apiAuth, async (req, res) => {
  const { label, email, password, host, port } = req.body;
  if (!email || !password || !host) return res.json({ ok: false, error: 'Pflichtfelder fehlen' });
  db.addEmailAccount(req.session.userId, label, email, password, host, port || 993, true);
  res.json({ ok: true });
});

app.post('/api/accounts/test', apiAuth, async (req, res) => {
  const result = await testConnection(req.body);
  res.json(result);
});

app.delete('/api/accounts/:id', apiAuth, (req, res) => {
  db.deleteEmailAccount(req.params.id, req.session.userId);
  res.json({ ok: true });
});

app.post('/api/leads/:id/status', apiAuth, (req, res) => {
  db.updateLeadStatus(req.params.id, req.session.userId, req.body.status);
  res.json({ ok: true });
});

app.post('/api/leads/:id/notiz', apiAuth, (req, res) => {
  db.updateLeadNotiz(req.params.id, req.session.userId, req.body.notiz);
  res.json({ ok: true });
});

app.post('/api/leads/:id/wiedervorlage', apiAuth, (req, res) => {
  db.updateLeadWiedervorlage(req.params.id, req.session.userId, req.body.datum);
  res.json({ ok: true });
});

app.post('/api/leads/:id/archive', apiAuth, (req, res) => {
  db.archiveLead(req.params.id, req.session.userId);
  res.json({ ok: true });
});

app.post('/api/termine', apiAuth, (req, res) => {
  const { leadId, titel, typ, datum, uhrzeit, notiz } = req.body;
  db.createTermin(req.session.userId, leadId, titel, typ, datum, uhrzeit, notiz);
  res.json({ ok: true });
});

app.delete('/api/termine/:id', apiAuth, (req, res) => {
  db.deleteTermin(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ─── START ────────────────────────────────────────────────────────────────────

async function start() {
  await db.initDB();

  // E-Mails alle 5 Minuten prüfen
  cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ Cron: E-Mail-Check startet…');
    await checkAllAccounts();
  });

  app.listen(PORT, () => {
    console.log(`🚀 LexLead v2.0 läuft auf Port ${PORT}`);
    console.log(`   API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Konfiguriert' : '⚠️  Fehlt (Demo-Modus)'}`);
  });
}

start().catch(console.error);

// server.js — LexLead v2.0
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const path = require('path');
const db = require('./database');
const { checkAllAccounts, testConnection } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lexlead-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function auth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function apiAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Nicht eingeloggt' });
  next();
}

// ─── HTML TEMPLATES ───────────────────────────────────────────────────────────

const baseStyles = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0c10;
      --bg2: #111318;
      --bg3: #1a1d24;
      --border: #252830;
      --border2: #2e3240;
      --text: #e8eaf0;
      --muted: #7c8298;
      --accent: #4f8ef7;
      --accent2: #6c63ff;
      --green: #22c55e;
      --yellow: #f59e0b;
      --red: #ef4444;
      --orange: #f97316;
      --radius: 12px;
      --radius-sm: 8px;
      --shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    html { font-size: 15px; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { opacity: 0.8; }
    input, textarea, select {
      width: 100%; padding: 10px 14px;
      background: var(--bg3); border: 1px solid var(--border2);
      border-radius: var(--radius-sm); color: var(--text);
      font-family: inherit; font-size: 0.9rem;
      transition: border-color 0.2s;
      outline: none;
    }
    input:focus, textarea:focus, select:focus { border-color: var(--accent); }
    textarea { resize: vertical; min-height: 80px; }
    label { display: block; font-size: 0.82rem; font-weight: 600; color: var(--muted); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.05em; }
    .btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 9px 18px; border-radius: var(--radius-sm);
      font-weight: 600; font-size: 0.88rem; cursor: pointer;
      border: none; transition: all 0.18s; font-family: inherit;
      white-space: nowrap;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: #3d7de8; }
    .btn-secondary { background: var(--bg3); color: var(--text); border: 1px solid var(--border2); }
    .btn-secondary:hover { background: var(--border); }
    .btn-success { background: var(--green); color: #fff; }
    .btn-success:hover { background: #16a34a; }
    .btn-danger { background: var(--red); color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .btn-sm { padding: 6px 12px; font-size: 0.8rem; }
    .btn-icon { padding: 7px 10px; }
    .card {
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 20px;
    }
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 100px;
      font-size: 0.75rem; font-weight: 700; letter-spacing: 0.03em;
    }
    .badge-green { background: rgba(34,197,94,0.12); color: var(--green); }
    .badge-yellow { background: rgba(245,158,11,0.12); color: var(--yellow); }
    .badge-red { background: rgba(239,68,68,0.12); color: var(--red); }
    .badge-blue { background: rgba(79,142,247,0.12); color: var(--accent); }
    .badge-gray { background: var(--bg3); color: var(--muted); }
    .form-group { margin-bottom: 16px; }
    .alert { padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.9rem; }
    .alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
    .alert-success { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.25); color: #86efac; }
    .alert-info { background: rgba(79,142,247,0.1); border: 1px solid rgba(79,142,247,0.25); color: #93c5fd; }
    .nav {
      background: var(--bg2); border-bottom: 1px solid var(--border);
      padding: 0 24px; display: flex; align-items: center;
      height: 60px; gap: 4px; position: sticky; top: 0; z-index: 100;
    }
    .nav-brand { font-weight: 800; font-size: 1.15rem; color: var(--accent); margin-right: 20px; display:flex;align-items:center;gap:8px;}
    .nav-link { padding: 6px 14px; border-radius: var(--radius-sm); color: var(--muted); font-weight: 500; font-size: 0.9rem; transition:all 0.15s; }
    .nav-link:hover, .nav-link.active { background: var(--bg3); color: var(--text); opacity: 1; }
    .nav-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
    .page { max-width: 1200px; margin: 0 auto; padding: 28px 20px; }
    .page-header { margin-bottom: 24px; }
    .page-title { font-size: 1.5rem; font-weight: 800; }
    .page-sub { color: var(--muted); margin-top: 3px; font-size: 0.9rem; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
    .stat-value { font-size: 2rem; font-weight: 800; line-height: 1; }
    .stat-label { font-size: 0.82rem; color: var(--muted); margin-top: 5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-sub { font-size: 0.8rem; color: var(--muted); margin-top: 6px; }
    .score-bar { height: 6px; background: var(--bg3); border-radius: 3px; overflow: hidden; margin-top: 6px; }
    .score-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 14px; font-size: 0.78rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
    td { padding: 13px 14px; border-bottom: 1px solid var(--border); font-size: 0.88rem; vertical-align: middle; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    tr:last-child td { border-bottom: none; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .text-muted { color: var(--muted); }
    .text-sm { font-size: 0.82rem; }
    .flex { display: flex; align-items: center; }
    .gap-2 { gap: 8px; }
    .gap-3 { gap: 12px; }
    .mt-4 { margin-top: 16px; }
    .mt-6 { margin-top: 24px; }
    .mb-4 { margin-bottom: 16px; }
    .divider { height: 1px; background: var(--border); margin: 20px 0; }
    @media (max-width: 768px) {
      .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
      .nav-link span { display: none; }
    }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
    .empty-state .icon { font-size: 3rem; margin-bottom: 12px; }
    .empty-state p { font-size: 0.9rem; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000; align-items:center; justify-content:center; }
    .modal-overlay.open { display:flex; }
    .modal { background:var(--bg2); border:1px solid var(--border2); border-radius:var(--radius); padding:24px; width:90%; max-width:560px; max-height:90vh; overflow-y:auto; }
    .modal-header { font-size:1.1rem; font-weight:700; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; }
    .score-pill { display:inline-flex;align-items:center;justify-content:center; width:32px;height:32px;border-radius:50%; font-weight:800;font-size:0.9rem; }
    .score-high { background:rgba(34,197,94,0.15);color:var(--green); }
    .score-mid { background:rgba(245,158,11,0.15);color:var(--yellow); }
    .score-low { background:rgba(239,68,68,0.15);color:var(--red); }
    .score-none { background:var(--bg3);color:var(--muted); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg2); }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
  </style>
`;

function navbar(active, user) {
  const links = [
    { href: '/dashboard', icon: '⊞', label: 'Dashboard', key: 'dashboard' },
    { href: '/leads', icon: '✉', label: 'Leads', key: 'leads' },
    { href: '/kalender', icon: '◷', label: 'Kalender', key: 'kalender' },
    { href: '/einstellungen', icon: '⚙', label: 'Einstellungen', key: 'einstellungen' },
  ];
  return `
  <nav class="nav">
    <div class="nav-brand">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="7" fill="#4f8ef7"/>
        <path d="M7 20L14 8L21 20" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10 16H18" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
      LexLead
    </div>
    ${links.map(l => `<a href="${l.href}" class="nav-link ${active === l.key ? 'active' : ''}">${l.icon} <span>${l.label}</span></a>`).join('')}
    <div class="nav-right">
      <span class="text-sm text-muted">${user?.name || ''}</span>
      <a href="/logout" class="btn btn-secondary btn-sm">Logout</a>
    </div>
  </nav>`;
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect(req.session.userId ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LexLead – Login</title>${baseStyles}<style>
    .auth-page { min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px; }
    .auth-box { width:100%;max-width:400px; }
    .auth-logo { text-align:center;margin-bottom:32px; }
    .auth-logo h1 { font-size:2rem;font-weight:900;color:var(--accent); }
    .auth-logo p { color:var(--muted);font-size:0.9rem;margin-top:4px; }
    .auth-card { background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:32px; }
    .auth-tabs { display:flex;gap:8px;margin-bottom:24px; }
    .auth-tab { flex:1;padding:9px;text-align:center;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-size:0.88rem;border:1px solid var(--border2);color:var(--muted);background:transparent;font-family:inherit;transition:all 0.15s; }
    .auth-tab.active { background:var(--accent);color:#fff;border-color:var(--accent); }
    .pane { display:none; }
    .pane.active { display:block; }
  </style></head><body>
  <div class="auth-page">
    <div class="auth-box">
      <div class="auth-logo">
        <h1>⬟ LexLead</h1>
        <p>KI-Filter für Immobilien-Anfragen</p>
      </div>
      <div class="auth-card">
        <div class="auth-tabs">
          <button class="auth-tab active" onclick="showTab('login',this)">Einloggen</button>
          <button class="auth-tab" onclick="showTab('register',this)">Registrieren</button>
        </div>
        ${req.query.error ? `<div class="alert alert-error">${req.query.error}</div>` : ''}
        ${req.query.success ? `<div class="alert alert-success">${req.query.success}</div>` : ''}
        <div id="login" class="pane active">
          <form method="POST" action="/login">
            <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required autofocus></div>
            <div class="form-group"><label>Passwort</label><input type="password" name="password" placeholder="••••••••" required></div>
            <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;">Einloggen</button>
          </form>
        </div>
        <div id="register" class="pane">
          <form method="POST" action="/register">
            <div class="form-group"><label>Name</label><input type="text" name="name" placeholder="Max Mustermann" required></div>
            <div class="form-group"><label>Maklerbüro (optional)</label><input type="text" name="firma" placeholder="Immobilien GmbH"></div>
            <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required></div>
            <div class="form-group"><label>Passwort</label><input type="password" name="password" placeholder="Min. 6 Zeichen" required minlength="6"></div>
            <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;">30 Tage kostenlos testen</button>
          </form>
        </div>
      </div>
      <p style="text-align:center;color:var(--muted);font-size:0.78rem;margin-top:16px;">149€/Monat · Kein Risiko · Jederzeit kündbar</p>
    </div>
  </div>
  <script>
    function showTab(id, el) {
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      el.classList.add('active');
    }
    // Auto-show register tab if ?tab=register
    if (location.search.includes('tab=register')) showTab('register', document.querySelectorAll('.auth-tab')[1]);
  </script>
  </body></html>`);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.getUserByEmail(email?.toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.redirect('/login?error=E-Mail+oder+Passwort+falsch');
  }
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/register', async (req, res) => {
  const { name, email, password, firma } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.redirect('/login?tab=register&error=Bitte+alle+Felder+ausfüllen');
  }
  const existing = db.getUserByEmail(email.toLowerCase().trim());
  if (existing) return res.redirect('/login?error=E-Mail+bereits+registriert');
  const hash = await bcrypt.hash(password, 10);
  const user = db.createUser(name, email.toLowerCase().trim(), hash, firma);
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login?success=Erfolgreich+ausgeloggt');
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

app.get('/dashboard', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const stats = db.getLeadStats(req.session.userId);
  const topLeads = db.getLeads(req.session.userId, { limit: 5 });
  const wiedervorlagen = db.getWiedervorlagen(req.session.userId);
  const accounts = db.getEmailAccounts(req.session.userId);

  const scoreColor = (s) => s >= 7 ? 'var(--green)' : s >= 4 ? 'var(--yellow)' : s > 0 ? 'var(--red)' : 'var(--muted)';
  const scorePill = (s) => `<span class="score-pill ${s >= 7 ? 'score-high' : s >= 4 ? 'score-mid' : s > 0 ? 'score-low' : 'score-none'}">${s || '?'}</span>`;
  const portalBadge = (p) => `<span class="badge badge-blue">${p}</span>`;
  const statusBadge = (s) => {
    const map = { neu: ['badge-blue','Neu'], beantwortet: ['badge-green','Beantwortet'], abgelehnt: ['badge-red','Abgelehnt'], warten: ['badge-yellow','Warten'] };
    const [cls, label] = map[s] || ['badge-gray', s];
    return `<span class="badge ${cls}">${label}</span>`;
  };

  const heute = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard – LexLead</title>${baseStyles}</head><body>
  ${navbar('dashboard', user)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="page-title">Guten Tag, ${user.name.split(' ')[0]} 👋</div>
        <div class="page-sub">${heute} · ${stats.heute} neue Leads heute</div>
      </div>
      <form method="POST" action="/api/check-now" style="display:inline">
        <button type="submit" class="btn btn-secondary">↻ Jetzt abrufen</button>
      </form>
    </div>

    ${accounts.length === 0 ? `
    <div class="alert alert-info" style="margin-bottom:20px;">
      ℹ️ Noch kein E-Mail-Account verbunden. <a href="/einstellungen" style="font-weight:700">Jetzt verbinden →</a>
    </div>` : ''}

    ${wiedervorlagen.length > 0 ? `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius);padding:16px 20px;margin-bottom:20px;">
      <div style="font-weight:700;color:var(--yellow);margin-bottom:10px;">⏰ ${wiedervorlagen.length} Wiedervorlage${wiedervorlagen.length > 1 ? 'n' : ''} heute fällig</div>
      ${wiedervorlagen.slice(0, 3).map(l => `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid rgba(245,158,11,0.1);">
          ${scorePill(l.score)}
          <div style="flex:1">
            <div style="font-weight:600;font-size:0.88rem">${l.from_name || l.from_email}</div>
            <div class="text-sm text-muted">${l.subject}</div>
          </div>
          <a href="/leads/${l.id}" class="btn btn-secondary btn-sm">Öffnen</a>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="grid-4 mb-4">
      <div class="stat-card">
        <div class="stat-value">${stats.gesamt}</div>
        <div class="stat-label">Leads gesamt</div>
        <div class="stat-sub">${stats.heute} heute neu</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--green)">${stats.hoch}</div>
        <div class="stat-label">Score ≥ 7</div>
        <div class="stat-sub">Hohe Priorität</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--yellow)">${stats.mittel}</div>
        <div class="stat-label">Score 4–6</div>
        <div class="stat-sub">Mittlere Priorität</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--accent)">${stats.beantwortet}</div>
        <div class="stat-label">Beantwortet</div>
        <div class="stat-sub">Quote: ${stats.gesamt > 0 ? Math.round((stats.beantwortet / stats.gesamt) * 100) : 0}%</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-weight:700">Top Leads</div>
          <a href="/leads" class="btn btn-secondary btn-sm">Alle anzeigen</a>
        </div>
        ${topLeads.length === 0 ? `<div class="empty-state" style="padding:30px 0"><div class="icon">📭</div><p>Noch keine Leads vorhanden</p></div>` : `
        <table>
          <thead><tr><th>Score</th><th>Kontakt</th><th>Portal</th><th>Status</th></tr></thead>
          <tbody>
            ${topLeads.map(l => `
            <tr style="cursor:pointer" onclick="location.href='/leads/${l.id}'">
              <td>${scorePill(l.score)}</td>
              <td>
                <div style="font-weight:600">${l.from_name || l.from_email}</div>
                <div class="text-sm text-muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</div>
              </td>
              <td>${portalBadge(l.portal)}</td>
              <td>${statusBadge(l.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:16px">Statistik</div>
        ${stats.gesamt > 0 ? `
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="text-sm">Hoch (≥7)</span>
            <span class="text-sm" style="color:var(--green)">${stats.hoch}</span>
          </div>
          <div class="score-bar"><div class="score-fill" style="width:${stats.gesamt > 0 ? (stats.hoch/stats.gesamt*100) : 0}%;background:var(--green)"></div></div>
        </div>
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="text-sm">Mittel (4–6)</span>
            <span class="text-sm" style="color:var(--yellow)">${stats.mittel}</span>
          </div>
          <div class="score-bar"><div class="score-fill" style="width:${stats.gesamt > 0 ? (stats.mittel/stats.gesamt*100) : 0}%;background:var(--yellow)"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span class="text-sm">Niedrig (1–3)</span>
            <span class="text-sm" style="color:var(--red)">${stats.niedrig}</span>
          </div>
          <div class="score-bar"><div class="score-fill" style="width:${stats.gesamt > 0 ? (stats.niedrig/stats.gesamt*100) : 0}%;background:var(--red)"></div></div>
        </div>
        ` : `<div class="text-muted text-sm">Noch keine Daten vorhanden.</div>`}
        <div class="divider"></div>
        <div style="font-weight:700;margin-bottom:12px">Verbundene Postfächer</div>
        ${accounts.length === 0 ? `<div class="text-muted text-sm">Kein E-Mail-Account verbunden</div>` :
          accounts.map(a => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--green)"></div>
            <div>
              <div style="font-weight:600;font-size:0.88rem">${a.label || a.email}</div>
              <div class="text-sm text-muted">${a.email}</div>
            </div>
          </div>`).join('')}
        }
      </div>
    </div>
  </div>
  <script>
    // Auto-check form
    document.querySelector('form[action="/api/check-now"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = '⏳ Abrufe...';
      try {
        const r = await fetch('/api/check-now', { method: 'POST' });
        const d = await r.json();
        btn.textContent = '✓ ' + (d.neue || 0) + ' neue Leads';
        setTimeout(() => location.reload(), 1500);
      } catch { btn.textContent = '↻ Fehler'; }
    });
  </script>
  </body></html>`);
});

// ─── LEADS LIST ───────────────────────────────────────────────────────────────

app.get('/leads', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const { status, portal, search, min } = req.query;
  const leads = db.getLeads(req.session.userId, {
    status: status || null,
    portal: portal || null,
    search: search || null,
    minScore: min ? parseInt(min) : null
  });

  const scorePill = (s) => `<span class="score-pill ${s >= 7 ? 'score-high' : s >= 4 ? 'score-mid' : s > 0 ? 'score-low' : 'score-none'}">${s || '?'}</span>`;
  const statusBadge = (s) => {
    const map = { neu: ['badge-blue','Neu'], beantwortet: ['badge-green','Beantwortet'], abgelehnt: ['badge-red','Abgelehnt'], warten: ['badge-yellow','Warten'] };
    const [cls, label] = map[s] || ['badge-gray', s];
    return `<span class="badge ${cls}">${label}</span>`;
  };
  const kaufBadge = (k) => {
    const map = { Hoch: 'badge-green', Mittel: 'badge-yellow', Niedrig: 'badge-red' };
    return k ? `<span class="badge ${map[k] || 'badge-gray'}">${k}</span>` : '<span class="text-muted">–</span>';
  };
  const timeAgo = (dt) => {
    if (!dt) return '';
    const diff = Date.now() - new Date(dt);
    const h = Math.floor(diff / 3600000);
    if (h < 1) return 'Gerade eben';
    if (h < 24) return `vor ${h}h`;
    const d = Math.floor(h / 24);
    return `vor ${d}d`;
  };

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leads – LexLead</title>${baseStyles}</head><body>
  ${navbar('leads', user)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div class="page-title">Leads</div>
        <div class="page-sub">${leads.length} Ergebnis${leads.length !== 1 ? 'se' : ''}</div>
      </div>
    </div>

    <div class="card mb-4" style="padding:14px 16px">
      <form method="GET" action="/leads" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:200px">
          <label>Suche</label>
          <input name="search" placeholder="Name, E-Mail, Betreff…" value="${search || ''}">
        </div>
        <div style="min-width:140px">
          <label>Status</label>
          <select name="status">
            <option value="">Alle Status</option>
            <option value="neu" ${status === 'neu' ? 'selected' : ''}>Neu</option>
            <option value="beantwortet" ${status === 'beantwortet' ? 'selected' : ''}>Beantwortet</option>
            <option value="warten" ${status === 'warten' ? 'selected' : ''}>Warten</option>
            <option value="abgelehnt" ${status === 'abgelehnt' ? 'selected' : ''}>Abgelehnt</option>
          </select>
        </div>
        <div style="min-width:140px">
          <label>Min. Score</label>
          <select name="min">
            <option value="">Alle Scores</option>
            <option value="7" ${min === '7' ? 'selected' : ''}>≥ 7 (Hoch)</option>
            <option value="4" ${min === '4' ? 'selected' : ''}>≥ 4 (Mittel+)</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary">Filtern</button>
        ${search || status || min ? `<a href="/leads" class="btn btn-secondary">Reset</a>` : ''}
      </form>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      ${leads.length === 0 ? `<div class="empty-state"><div class="icon">📭</div><p>Keine Leads gefunden.</p></div>` : `
      <table>
        <thead><tr><th>Score</th><th>Kontakt</th><th>Betreff</th><th>Portal</th><th>Kaufabsicht</th><th>Status</th><th>Eingang</th></tr></thead>
        <tbody>
          ${leads.map(l => `
          <tr style="cursor:pointer" onclick="location.href='/leads/${l.id}'">
            <td>${scorePill(l.score)}</td>
            <td>
              <div style="font-weight:600">${l.from_name || '–'}</div>
              <div class="text-sm text-muted">${l.from_email}</div>
            </td>
            <td style="max-width:220px">
              <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${l.subject}</div>
              ${l.wiedervorlage ? `<div class="text-sm" style="color:var(--yellow)">⏰ ${l.wiedervorlage}</div>` : ''}
            </td>
            <td><span class="badge badge-blue">${l.portal}</span></td>
            <td>${kaufBadge(l.kaufabsicht)}</td>
            <td>${statusBadge(l.status)}</td>
            <td class="text-muted text-sm">${timeAgo(l.received_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`}
    </div>
  </div>
  </body></html>`);
});

// ─── LEAD DETAIL ──────────────────────────────────────────────────────────────

app.get('/leads/:id', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const lead = db.getLeadById(req.params.id, req.session.userId);
  if (!lead) return res.redirect('/leads');

  const scoreClass = lead.score >= 7 ? 'score-high' : lead.score >= 4 ? 'score-mid' : lead.score > 0 ? 'score-low' : 'score-none';
  const kaufColor = { Hoch: 'var(--green)', Mittel: 'var(--yellow)', Niedrig: 'var(--red)' }[lead.kaufabsicht] || 'var(--muted)';

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${lead.from_name || lead.from_email} – LexLead</title>${baseStyles}</head><body>
  ${navbar('leads', user)}
  <div class="page">
    <div style="margin-bottom:16px"><a href="/leads" class="btn btn-secondary btn-sm">← Zurück</a></div>

    <div style="display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start">
      <!-- Main -->
      <div>
        <div class="card mb-4">
          <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:20px">
            <span class="score-pill ${scoreClass}" style="width:44px;height:44px;font-size:1.1rem">${lead.score || '?'}</span>
            <div style="flex:1">
              <div style="font-size:1.15rem;font-weight:700">${lead.from_name || lead.from_email}</div>
              <div class="text-muted text-sm">${lead.from_email}</div>
              <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
                <span class="badge badge-blue">${lead.portal}</span>
                ${lead.objekt_ref ? `<span class="badge badge-gray">Objekt #${lead.objekt_ref}</span>` : ''}
                <span class="badge ${lead.status === 'neu' ? 'badge-blue' : lead.status === 'beantwortet' ? 'badge-green' : lead.status === 'abgelehnt' ? 'badge-red' : 'badge-yellow'}">${lead.status}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px">
              <select id="statusSelect" onchange="updateStatus(this.value)" class="btn btn-secondary btn-sm" style="width:auto;padding:6px 12px">
                <option value="neu" ${lead.status === 'neu' ? 'selected' : ''}>Neu</option>
                <option value="beantwortet" ${lead.status === 'beantwortet' ? 'selected' : ''}>Beantwortet</option>
                <option value="warten" ${lead.status === 'warten' ? 'selected' : ''}>Warten</option>
                <option value="abgelehnt" ${lead.status === 'abgelehnt' ? 'selected' : ''}>Abgelehnt</option>
              </select>
            </div>
          </div>

          <div class="divider"></div>

          <div style="font-weight:700;margin-bottom:8px">Betreff</div>
          <div style="color:var(--muted)">${lead.subject}</div>

          <div class="divider"></div>

          <div style="font-weight:700;margin-bottom:12px">KI-Analyse</div>
          <div class="grid-2" style="margin-bottom:16px;gap:12px">
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Kaufabsicht</div>
              <div style="font-weight:700;color:${kaufColor}">${lead.kaufabsicht || '–'}</div>
            </div>
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Finanzierung</div>
              <div style="font-weight:700">${lead.finanzierung || '–'}</div>
            </div>
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Zeitrahmen</div>
              <div style="font-weight:700">${lead.zeitrahmen || '–'}</div>
            </div>
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px">
              <div class="text-sm text-muted" style="margin-bottom:3px">Eingang</div>
              <div style="font-weight:700">${lead.received_at ? new Date(lead.received_at).toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '–'}</div>
            </div>
          </div>

          ${lead.zusammenfassung ? `
          <div style="background:rgba(79,142,247,0.06);border:1px solid rgba(79,142,247,0.15);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px">
            <div style="font-size:0.78rem;font-weight:700;color:var(--accent);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">KI-Zusammenfassung</div>
            <div style="font-size:0.9rem;line-height:1.6">${lead.zusammenfassung}</div>
          </div>` : ''}

          <div class="divider"></div>
          <div style="font-weight:700;margin-bottom:10px">Original E-Mail</div>
          <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px;font-size:0.85rem;line-height:1.7;white-space:pre-wrap;max-height:300px;overflow-y:auto;color:var(--muted)">${(lead.body || '').substring(0, 3000)}</div>
        </div>

        <!-- Antwort-Entwurf -->
        ${lead.antwort_entwurf ? `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-weight:700">✨ KI-Antwort-Entwurf</div>
            <button onclick="copyDraft()" class="btn btn-primary btn-sm" id="copyBtn">Kopieren</button>
          </div>
          <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px;font-size:0.88rem;line-height:1.7;white-space:pre-wrap" id="draftText">${lead.antwort_entwurf}</div>
        </div>` : ''}
      </div>

      <!-- Sidebar -->
      <div>
        <!-- Notizen -->
        <div class="card mb-4">
          <div style="font-weight:700;margin-bottom:12px">📝 Notiz</div>
          <textarea id="notizText" rows="4" placeholder="Interne Notiz hinzufügen…">${lead.notiz || ''}</textarea>
          <button onclick="saveNotiz()" class="btn btn-secondary btn-sm mt-4" style="width:100%;justify-content:center">Speichern</button>
        </div>

        <!-- Wiedervorlage -->
        <div class="card mb-4">
          <div style="font-weight:700;margin-bottom:12px">⏰ Wiedervorlage</div>
          <input type="date" id="wiedervorlageDate" value="${lead.wiedervorlage || ''}" min="${new Date().toISOString().split('T')[0]}">
          <button onclick="saveWiedervorlage()" class="btn btn-secondary btn-sm mt-4" style="width:100%;justify-content:center">Setzen</button>
        </div>

        <!-- Termin erstellen -->
        <div class="card mb-4">
          <div style="font-weight:700;margin-bottom:12px">📅 Termin erstellen</div>
          <div class="form-group">
            <label>Typ</label>
            <select id="terminTyp">
              <option value="besichtigung">Besichtigung</option>
              <option value="anruf">Anruf</option>
              <option value="termin">Termin</option>
              <option value="frist">Frist</option>
            </select>
          </div>
          <div class="form-group">
            <label>Datum</label>
            <input type="date" id="terminDatum" min="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label>Uhrzeit</label>
            <input type="time" id="terminUhrzeit">
          </div>
          <button onclick="createTermin()" class="btn btn-success btn-sm" style="width:100%;justify-content:center">Termin speichern</button>
        </div>

        <!-- Lead archivieren -->
        <button onclick="if(confirm('Lead archivieren?')) fetch('/api/leads/${lead.id}/archive',{method:'POST'}).then(()=>location.href='/leads')"
          class="btn btn-secondary" style="width:100%;justify-content:center;color:var(--muted)">
          🗑 Archivieren
        </button>
      </div>
    </div>
  </div>
  <script>
    async function updateStatus(val) {
      await fetch('/api/leads/${lead.id}/status', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status: val}) });
      showToast('Status aktualisiert');
    }
    async function saveNotiz() {
      const notiz = document.getElementById('notizText').value;
      await fetch('/api/leads/${lead.id}/notiz', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({notiz}) });
      showToast('Notiz gespeichert');
    }
    async function saveWiedervorlage() {
      const datum = document.getElementById('wiedervorlageDate').value;
      await fetch('/api/leads/${lead.id}/wiedervorlage', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({datum}) });
      showToast('Wiedervorlage gesetzt: ' + datum);
    }
    async function createTermin() {
      const typ = document.getElementById('terminTyp').value;
      const datum = document.getElementById('terminDatum').value;
      const uhrzeit = document.getElementById('terminUhrzeit').value;
      if (!datum) { showToast('Bitte Datum wählen', 'error'); return; }
      const titel = typ.charAt(0).toUpperCase() + typ.slice(1) + ' – ' + '${(lead.from_name || lead.from_email).replace(/'/g, "\\'")}';
      await fetch('/api/termine', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({leadId: ${lead.id}, titel, typ, datum, uhrzeit}) });
      showToast('Termin erstellt');
    }
    function copyDraft() {
      navigator.clipboard.writeText(document.getElementById('draftText').innerText);
      const btn = document.getElementById('copyBtn');
      btn.textContent = '✓ Kopiert!';
      setTimeout(() => btn.textContent = 'Kopieren', 2000);
    }
    function showToast(msg, type='success') {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-weight:600;z-index:9999;transition:opacity 0.3s;font-size:0.88rem;';
      t.style.background = type === 'error' ? '#ef4444' : '#22c55e';
      t.style.color = '#fff';
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
    }
  </script>
  </body></html>`);
});

// ─── KALENDER ────────────────────────────────────────────────────────────────

app.get('/kalender', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);
  const monatStr = `${year}-${String(month).padStart(2, '0')}`;
  const termine = db.getTermine(req.session.userId, monatStr);

  const monatName = new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const ersterTag = new Date(year, month - 1, 1).getDay();
  const offset = ersterTag === 0 ? 6 : ersterTag - 1;
  const tageImMonat = new Date(year, month, 0).getDate();

  const prevM = month === 1 ? 12 : month - 1;
  const prevY = month === 1 ? year - 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const nextY = month === 12 ? year + 1 : year;

  const terminByDay = {};
  termine.forEach(t => {
    const day = parseInt(t.datum.split('-')[2]);
    if (!terminByDay[day]) terminByDay[day] = [];
    terminByDay[day].push(t);
  });

  const typeColor = { besichtigung: 'var(--accent)', anruf: 'var(--green)', termin: 'var(--yellow)', frist: 'var(--red)' };
  const typeIcon = { besichtigung: '🏠', anruf: '📞', termin: '👔', frist: '⚠️' };

  let calCells = '';
  for (let i = 0; i < offset; i++) calCells += `<div class="cal-cell cal-empty"></div>`;
  for (let d = 1; d <= tageImMonat; d++) {
    const isToday = d === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
    const dayTermine = terminByDay[d] || [];
    calCells += `
      <div class="cal-cell ${isToday ? 'cal-today' : ''}">
        <div class="cal-day">${d}</div>
        ${dayTermine.slice(0, 3).map(t => `
          <div class="cal-event" style="background:${typeColor[t.typ] || 'var(--accent)'}20;border-left:2px solid ${typeColor[t.typ] || 'var(--accent)'};" title="${t.titel}">
            ${typeIcon[t.typ] || '📌'} <span>${t.uhrzeit ? t.uhrzeit + ' ' : ''}${t.titel.substring(0, 20)}</span>
          </div>
        `).join('')}
        ${dayTermine.length > 3 ? `<div class="text-sm text-muted">+${dayTermine.length - 3} mehr</div>` : ''}
      </div>`;
  }

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kalender – LexLead</title>${baseStyles}<style>
    .cal-grid { display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-top:10px; }
    .cal-header-cell { text-align:center;padding:10px;font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em; }
    .cal-cell { background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;min-height:90px;transition:background 0.15s; }
    .cal-cell:hover { background:var(--bg3); }
    .cal-empty { background:transparent;border-color:transparent; }
    .cal-today { border-color:var(--accent);background:rgba(79,142,247,0.04); }
    .cal-day { font-size:0.85rem;font-weight:700;margin-bottom:6px; }
    .cal-today .cal-day { color:var(--accent); }
    .cal-event { font-size:0.72rem;padding:3px 6px;border-radius:4px;margin-bottom:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer; }
  </style></head><body>
  ${navbar('kalender', user)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="page-title">Kalender</div>
        <div class="page-sub">${termine.length} Termine in ${monatName}</div>
      </div>
      <button onclick="document.getElementById('terminModal').classList.add('open')" class="btn btn-primary">+ Termin</button>
    </div>

    <div class="card" style="padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <a href="/kalender?year=${prevY}&month=${prevM}" class="btn btn-secondary btn-sm">← Zurück</a>
        <div style="font-weight:800;font-size:1.1rem">${monatName}</div>
        <a href="/kalender?year=${nextY}&month=${nextM}" class="btn btn-secondary btn-sm">Weiter →</a>
      </div>
      <div class="cal-grid">
        ${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d => `<div class="cal-header-cell">${d}</div>`).join('')}
        ${calCells}
      </div>
    </div>

    <!-- Termine Liste -->
    ${termine.length > 0 ? `
    <div class="card mt-6">
      <div style="font-weight:700;margin-bottom:14px">Alle Termine diesen Monat</div>
      ${termine.map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:1.3rem">${typeIcon[t.typ] || '📌'}</div>
          <div style="flex:1">
            <div style="font-weight:600">${t.titel}</div>
            <div class="text-sm text-muted">${t.datum}${t.uhrzeit ? ' · ' + t.uhrzeit : ''}</div>
            ${t.notiz ? `<div class="text-sm text-muted">${t.notiz}</div>` : ''}
          </div>
          <button onclick="deleteTermin(${t.id})" class="btn btn-secondary btn-sm btn-icon">✕</button>
        </div>
      `).join('')}
    </div>` : ''}
  </div>

  <!-- Termin Modal -->
  <div class="modal-overlay" id="terminModal" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal">
      <div class="modal-header">
        Neuer Termin
        <button onclick="document.getElementById('terminModal').classList.remove('open')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div class="form-group"><label>Titel</label><input id="tTitel" placeholder="Besichtigung Musterstraße 5"></div>
      <div class="form-group"><label>Typ</label>
        <select id="tTyp">
          <option value="termin">Termin</option>
          <option value="besichtigung">Besichtigung</option>
          <option value="anruf">Anruf</option>
          <option value="frist">Frist</option>
        </select>
      </div>
      <div class="grid-2">
        <div class="form-group"><label>Datum</label><input type="date" id="tDatum"></div>
        <div class="form-group"><label>Uhrzeit</label><input type="time" id="tUhrzeit"></div>
      </div>
      <div class="form-group"><label>Notiz (optional)</label><textarea id="tNotiz" rows="2" placeholder="Zusätzliche Infos…"></textarea></div>
      <button onclick="createTerminFromModal()" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px">Speichern</button>
    </div>
  </div>
  <script>
    async function createTerminFromModal() {
      const titel = document.getElementById('tTitel').value;
      const typ = document.getElementById('tTyp').value;
      const datum = document.getElementById('tDatum').value;
      const uhrzeit = document.getElementById('tUhrzeit').value;
      const notiz = document.getElementById('tNotiz').value;
      if (!titel || !datum) { alert('Bitte Titel und Datum angeben.'); return; }
      await fetch('/api/termine', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({titel, typ, datum, uhrzeit, notiz}) });
      location.reload();
    }
    async function deleteTermin(id) {
      if (!confirm('Termin löschen?')) return;
      await fetch('/api/termine/' + id, { method: 'DELETE' });
      location.reload();
    }
  </script>
  </body></html>`);
});

// ─── EINSTELLUNGEN ────────────────────────────────────────────────────────────

app.get('/einstellungen', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const accounts = db.getEmailAccounts(req.session.userId);

  const hostHints = [
    { name: 'Gmail', host: 'imap.gmail.com', port: 993 },
    { name: 'Outlook / Hotmail', host: 'outlook.office365.com', port: 993 },
    { name: 'GMX', host: 'imap.gmx.net', port: 993 },
    { name: 'Web.de', host: 'imap.web.de', port: 993 },
    { name: 'T-Online', host: 'secureimap.t-online.de', port: 993 },
    { name: 'iCloud', host: 'imap.mail.me.com', port: 993 },
    { name: 'Strato', host: 'imap.strato.de', port: 993 },
    { name: '1&1 / IONOS', host: 'imap.ionos.de', port: 993 },
  ];

  const apiKeyStatus = process.env.ANTHROPIC_API_KEY
    ? `<span class="badge badge-green">✓ Konfiguriert</span>`
    : `<span class="badge badge-red">✗ Fehlt – KI-Analyse inaktiv</span>`;

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Einstellungen – LexLead</title>${baseStyles}</head><body>
  ${navbar('einstellungen', user)}
  <div class="page" style="max-width:760px">
    <div class="page-header"><div class="page-title">Einstellungen</div></div>

    ${req.query.msg ? `<div class="alert ${req.query.error ? 'alert-error' : 'alert-success'}">${req.query.msg}</div>` : ''}

    <!-- E-Mail Accounts -->
    <div class="card mb-4">
      <div style="font-weight:700;font-size:1.05rem;margin-bottom:16px">📬 E-Mail-Postfächer</div>

      ${accounts.length > 0 ? `
      <div style="margin-bottom:16px">
        ${accounts.map(a => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--green)"></div>
          <div style="flex:1">
            <div style="font-weight:600">${a.label || a.email}</div>
            <div class="text-sm text-muted">${a.email} · ${a.host}:${a.port}</div>
            ${a.last_check ? `<div class="text-sm text-muted">Zuletzt geprüft: ${new Date(a.last_check).toLocaleString('de-DE')}</div>` : ''}
          </div>
          <button onclick="if(confirm('Account entfernen?')) fetch('/api/accounts/${a.id}',{method:'DELETE'}).then(()=>location.reload())" class="btn btn-danger btn-sm">Entfernen</button>
        </div>`).join('')}
      </div>` : `<p class="text-muted text-sm" style="margin-bottom:16px">Noch kein E-Mail-Account verbunden.</p>`}

      <div style="border:1px solid var(--border2);border-radius:var(--radius-sm);padding:16px">
        <div style="font-weight:700;margin-bottom:14px">Neues Postfach hinzufügen</div>
        <div class="form-group">
          <label>Anbieter (für Host-Vorausfüllung)</label>
          <select onchange="fillHost(this.value)">
            <option value="">– Anbieter wählen –</option>
            ${hostHints.map(h => `<option value="${h.host}:${h.port}">${h.name}</option>`).join('')}
            <option value="custom">Eigener Server</option>
          </select>
        </div>
        <div class="grid-2">
          <div class="form-group"><label>Label</label><input id="acc_label" placeholder="Mein Geschäftspostfach"></div>
          <div class="form-group"><label>E-Mail-Adresse</label><input id="acc_email" type="email" placeholder="makler@firma.de"></div>
        </div>
        <div class="form-group"><label>Passwort / App-Passwort</label><input id="acc_pw" type="password" placeholder="••••••••"></div>
        <div class="grid-2">
          <div class="form-group"><label>IMAP-Host</label><input id="acc_host" placeholder="imap.gmail.com"></div>
          <div class="form-group"><label>Port</label><input id="acc_port" type="number" value="993"></div>
        </div>
        <div style="display:flex;gap:10px">
          <button onclick="testAccount()" class="btn btn-secondary" id="testBtn">Verbindung testen</button>
          <button onclick="addAccount()" class="btn btn-primary" id="addBtn">Postfach speichern</button>
        </div>
        <div id="testResult" style="margin-top:10px"></div>
      </div>

      <div class="mt-4" style="background:var(--bg3);border-radius:var(--radius-sm);padding:12px">
        <div style="font-size:0.8rem;font-weight:700;color:var(--muted);margin-bottom:6px">💡 HINWEIS: Gmail & Google Workspace</div>
        <div class="text-sm text-muted">Bei Gmail bitte ein <strong>App-Passwort</strong> verwenden (Google-Konto → Sicherheit → 2FA → App-Passwörter). Normales Google-Passwort funktioniert nicht mit IMAP.</div>
      </div>
    </div>

    <!-- KI-Status -->
    <div class="card mb-4">
      <div style="font-weight:700;font-size:1.05rem;margin-bottom:12px">🤖 KI-Analyse (Claude)</div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div class="text-sm text-muted">Anthropic API Key Status</div>
          <div style="margin-top:4px">${apiKeyStatus}</div>
        </div>
      </div>
      ${!process.env.ANTHROPIC_API_KEY ? `
      <div class="mt-4 text-sm text-muted">
        Tragen Sie den API Key als Environment Variable <code style="background:var(--bg3);padding:2px 6px;border-radius:4px">ANTHROPIC_API_KEY</code> in Render ein.<br>
        API Key erhalten: <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>
      </div>` : ''}
    </div>

    <!-- Profil -->
    <div class="card">
      <div style="font-weight:700;font-size:1.05rem;margin-bottom:16px">👤 Profil</div>
      <div class="grid-2">
        <div><label>Name</label><div style="padding:10px 0;font-weight:600">${user.name}</div></div>
        <div><label>E-Mail</label><div style="padding:10px 0;color:var(--muted)">${user.email}</div></div>
        <div><label>Firma</label><div style="padding:10px 0;color:var(--muted)">${user.firma || '–'}</div></div>
        <div><label>Plan</label><div style="padding:10px 0"><span class="badge badge-blue">${user.plan === 'trial' ? 'Testphase' : user.plan}</span></div></div>
      </div>
    </div>
  </div>

  <script>
    function fillHost(val) {
      if (!val || val === 'custom') return;
      const [host, port] = val.split(':');
      document.getElementById('acc_host').value = host;
      document.getElementById('acc_port').value = port;
    }
    async function testAccount() {
      const btn = document.getElementById('testBtn');
      const res = document.getElementById('testResult');
      btn.disabled = true; btn.textContent = '⏳ Teste…';
      const data = {
        email: document.getElementById('acc_email').value,
        password: document.getElementById('acc_pw').value,
        host: document.getElementById('acc_host').value,
        port: parseInt(document.getElementById('acc_port').value) || 993
      };
      try {
        const r = await fetch('/api/accounts/test', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
        const d = await r.json();
        res.innerHTML = d.ok
          ? '<div class="alert alert-success">✓ Verbindung erfolgreich!</div>'
          : '<div class="alert alert-error">✗ Fehler: ' + (d.error || 'Unbekannt') + '</div>';
      } catch { res.innerHTML = '<div class="alert alert-error">Netzwerkfehler</div>'; }
      btn.disabled = false; btn.textContent = 'Verbindung testen';
    }
    async function addAccount() {
      const btn = document.getElementById('addBtn');
      btn.disabled = true; btn.textContent = '⏳ Speichere…';
      const data = {
        label: document.getElementById('acc_label').value,
        email: document.getElementById('acc_email').value,
        password: document.getElementById('acc_pw').value,
        host: document.getElementById('acc_host').value,
        port: parseInt(document.getElementById('acc_port').value) || 993
      };
      if (!data.email || !data.password || !data.host) {
        alert('Bitte alle Pflichtfelder ausfüllen.');
        btn.disabled = false; btn.textContent = 'Postfach speichern';
        return;
      }
      const r = await fetch('/api/accounts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      const d = await r.json();
      if (d.ok) location.reload();
      else alert('Fehler: ' + (d.error || 'Unbekannt'));
      btn.disabled = false; btn.textContent = 'Postfach speichern';
    }
  </script>
  </body></html>`);
});

// ─── API ROUTES ───────────────────────────────────────────────────────────────

app.post('/api/check-now', apiAuth, async (req, res) => {
  try {
    const { checkAccount } = require('./mailer');
    const accounts = db.getEmailAccounts(req.session.userId);
    let total = 0;
    for (const acc of accounts) total += await checkAccount(acc);
    res.json({ ok: true, neue: total });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/accounts', apiAuth, async (req, res) => {
  const { label, email, password, host, port } = req.body;
  if (!email || !password || !host) return res.json({ ok: false, error: 'Pflichtfelder fehlen' });
  db.addEmailAccount(req.session.userId, label, email, password, host, port || 993, true);
  res.json({ ok: true });
});

app.post('/api/accounts/test', apiAuth, async (req, res) => {
  const result = await testConnection(req.body);
  res.json(result);
});

app.delete('/api/accounts/:id', apiAuth, (req, res) => {
  db.deleteEmailAccount(req.params.id, req.session.userId);
  res.json({ ok: true });
});

app.post('/api/leads/:id/status', apiAuth, (req, res) => {
  db.updateLeadStatus(req.params.id, req.session.userId, req.body.status);
  res.json({ ok: true });
});

app.post('/api/leads/:id/notiz', apiAuth, (req, res) => {
  db.updateLeadNotiz(req.params.id, req.session.userId, req.body.notiz);
  res.json({ ok: true });
});

app.post('/api/leads/:id/wiedervorlage', apiAuth, (req, res) => {
  db.updateLeadWiedervorlage(req.params.id, req.session.userId, req.body.datum);
  res.json({ ok: true });
});

app.post('/api/leads/:id/archive', apiAuth, (req, res) => {
  db.archiveLead(req.params.id, req.session.userId);
  res.json({ ok: true });
});

app.post('/api/termine', apiAuth, (req, res) => {
  const { leadId, titel, typ, datum, uhrzeit, notiz } = req.body;
  db.createTermin(req.session.userId, leadId, titel, typ, datum, uhrzeit, notiz);
  res.json({ ok: true });
});

app.delete('/api/termine/:id', apiAuth, (req, res) => {
  db.deleteTermin(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ─── START ────────────────────────────────────────────────────────────────────

async function start() {
  await db.initDB();

  // E-Mails alle 5 Minuten prüfen
  cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ Cron: E-Mail-Check startet…');
    await checkAllAccounts();
  });

  app.listen(PORT, () => {
    console.log(`🚀 LexLead v2.0 läuft auf Port ${PORT}`);
    console.log(`   API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Konfiguriert' : '⚠️  Fehlt (Demo-Modus)'}`);
  });
}

start().catch(console.error);

app.get('/legal', (req, res) => res.sendFile('/legal.html'));


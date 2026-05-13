require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const db = require('./database');
const { syncAccount, testConnection } = require('./mailer');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lexlead-secret-2024',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const auth = (req, res, next) => {
  if (req.session.uid) return next();
  req.path.startsWith('/api') ? res.status(401).json({ error: 'Nicht angemeldet' }) : res.redirect('/login');
};

// ─── AUTH ROUTES ────────────────────────────────────────────

app.get('/login', (req, res) => res.send(authPage('login', req.query.e)));
app.get('/register', (req, res) => res.send(authPage('register', req.query.e)));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const u = db.get('SELECT * FROM users WHERE email=?', [email?.toLowerCase().trim()]);
  if (!u || !await bcrypt.compare(password, u.password_hash))
    return res.redirect('/login?e=E-Mail oder Passwort falsch');
  db.run('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?', [u.id]);
  req.session.uid = u.id; req.session.name = u.name;
  res.redirect('/');
});

app.post('/register', async (req, res) => {
  const { name, email, password, company } = req.body;
  if (!name || !email || !password) return res.redirect('/register?e=Alle Felder ausf%C3%BCllen');
  if (password.length < 8) return res.redirect('/register?e=Passwort mind. 8 Zeichen');
  if (db.get('SELECT id FROM users WHERE email=?', [email.toLowerCase()]))
    return res.redirect('/register?e=E-Mail bereits registriert');
  const hash = await bcrypt.hash(password, 12);
  db.run('INSERT INTO users (id,email,password_hash,name,company) VALUES (?,?,?,?,?)',
    [uuidv4(), email.toLowerCase().trim(), hash, name, company || null]);
  res.redirect('/login');
});

// ─── API ROUTES ─────────────────────────────────────────────

app.get('/api/stats', auth, (req, res) => {
  const uid = req.session.uid;
  res.json({
    total:    db.get('SELECT COUNT(*) n FROM leads WHERE user_id=?', [uid])?.n || 0,
    hot:      db.get("SELECT COUNT(*) n FROM leads WHERE user_id=? AND label='hot' AND status='new'", [uid])?.n || 0,
    today:    db.get("SELECT COUNT(*) n FROM leads WHERE user_id=? AND date(received)=date('now')", [uid])?.n || 0,
    unread:   db.get("SELECT COUNT(*) n FROM leads WHERE user_id=? AND status='new'", [uid])?.n || 0
  });
});

app.get('/api/leads', auth, (req, res) => {
  const uid = req.session.uid;
  const f = req.query.filter || 'all';
  let where = 'WHERE l.user_id=?'; const p = [uid];
  if (f === 'hot')      { where += " AND l.label='hot'"; }
  else if (f === 'warm') { where += " AND l.label='warm'"; }
  else if (f === 'cold') { where += " AND l.label IN ('cold','spam')"; }
  else if (f === 'new')  { where += " AND l.status='new'"; }
  const leads = db.all(`
    SELECT l.*, a.label acc_label FROM leads l
    LEFT JOIN accounts a ON l.account_id=a.id
    ${where} ORDER BY
      CASE l.label WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 ELSE 3 END,
      l.score DESC, l.received DESC LIMIT 100`, p);
  res.json(leads);
});

app.get('/api/leads/:id', auth, (req, res) => {
  const l = db.get('SELECT * FROM leads WHERE id=? AND user_id=?', [req.params.id, req.session.uid]);
  l ? res.json(l) : res.status(404).json({ error: 'Nicht gefunden' });
});

app.patch('/api/leads/:id', auth, (req, res) => {
  const { status, notes } = req.body;
  const valid = ['new','reviewed','replied','archived'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Ungueltig' });
  db.run('UPDATE leads SET status=@s, notes=COALESCE(@n,notes) WHERE id=@id AND user_id=@u',
    { s: status, n: notes || null, id: req.params.id, u: req.session.uid });
  res.json({ ok: true });
});

// Notiz speichern
app.post('/api/leads/:id/note', auth, (req, res) => {
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Notiz leer' });
  db.run('UPDATE leads SET notes=@n WHERE id=@id AND user_id=@u',
    { n: note.trim(), id: req.params.id, u: req.session.uid });
  res.json({ ok: true });
});

// Wiedervorlage setzen
app.post('/api/leads/:id/followup', auth, (req, res) => {
  const { date } = req.body;
  db.run('UPDATE leads SET followup_date=@d WHERE id=@id AND user_id=@u',
    { d: date || null, id: req.params.id, u: req.session.uid });
  res.json({ ok: true });
});

// Tages-Zusammenfassung
app.get('/api/summary', auth, (req, res) => {
  const uid = req.session.uid;
  const hot     = db.all("SELECT * FROM leads WHERE user_id=? AND label='hot' AND status='new' ORDER BY received DESC LIMIT 5", [uid]);
  const waiting = db.all("SELECT * FROM leads WHERE user_id=? AND status='reviewed' ORDER BY received DESC LIMIT 5", [uid]);
  const today   = db.get("SELECT COUNT(*) n FROM leads WHERE user_id=? AND date(received)=date('now')", [uid])?.n || 0;
  const followups = db.all("SELECT * FROM leads WHERE user_id=? AND followup_date<=date('now') AND status NOT IN ('replied','archived') ORDER BY followup_date ASC", [uid]);
  res.json({ hot, waiting, today, followups });
});

app.get('/api/accounts', auth, (req, res) => {
  const rows = db.all(`SELECT id,label,host,username,last_checked,active,
    (SELECT COUNT(*) FROM leads WHERE account_id=accounts.id) cnt
    FROM accounts WHERE user_id=?`, [req.session.uid]);
  res.json(rows);
});

app.post('/api/accounts', auth, async (req, res) => {
  const { label, host, port, ssl, username, password } = req.body;
  if (!label || !host || !username || !password)
    return res.status(400).json({ error: 'Alle Felder ausf\u00fcllen' });
  const test = await testConnection({ host, port, ssl, username, password });
  if (!test.ok) return res.status(400).json({ error: 'Verbindung fehlgeschlagen: ' + test.error });
  const id = uuidv4();
  db.run('INSERT INTO accounts (id,user_id,label,host,port,ssl,username,password) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.session.uid, label, host, parseInt(port)||993, ssl?1:0, username, password]);
  res.json({ ok: true, id });
  syncNow(req.session.uid);
});

app.delete('/api/accounts/:id', auth, (req, res) => {
  db.run('DELETE FROM accounts WHERE id=? AND user_id=?', [req.params.id, req.session.uid]);
  res.json({ ok: true });
});

app.post('/api/sync', auth, (req, res) => {
  res.json({ ok: true });
  syncNow(req.session.uid);
});

app.get('/api/profile', auth, (req, res) => {
  const u = db.get('SELECT name, email, company, phone FROM users WHERE id=?', [req.session.uid]);
  res.json(u || {});
});

app.post('/api/profile', auth, async (req, res) => {
  const { name, company, phone } = req.body;
  db.run('UPDATE users SET name=@n, company=@c, phone=@p WHERE id=@id',
    { n: name, c: company || null, p: phone || null, id: req.session.uid });
  req.session.name = name;
  res.json({ ok: true });
});

// ─── SYNC ENGINE ────────────────────────────────────────────

async function syncNow(userId) {
  const accs = db.all('SELECT * FROM accounts WHERE active=1 AND user_id=?', [userId || '']);
  if (!accs.length) return;
  for (const acc of accs) {
    try { await syncAccount(acc); } catch(e) { console.error('Sync err:', e.message); }
  }
}

async function syncAll() {
  const accs = db.all('SELECT * FROM accounts WHERE active=1');
  for (const acc of accs) {
    try { await syncAccount(acc); } catch(e) { console.error('Sync err:', e.message); }
  }
}

cron.schedule('*/5 * * * *', syncAll);

// ─── DASHBOARD ──────────────────────────────────────────────

app.get('/', auth, (req, res) => res.send(dashHTML(req.session.name || 'Makler')));

// ─── START ──────────────────────────────────────────────────

async function start() {
  await db.boot();
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('HIER')) {
    console.warn('⚠  Kein API Key — E-Mails werden empfangen aber nicht analysiert');
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ LexLead laeuft: http://localhost:${PORT}`));
  setTimeout(syncAll, 5000);
}
start();

// ─── HTML ───────────────────────────────────────────────────

function authPage(type, err) {
  const isLogin = type === 'login';
  return `<!DOCTYPE html><html lang="de"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isLogin ? 'Anmelden' : 'Registrieren'} · LexLead</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d14;
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.box{background:#16161f;border:1px solid #252535;border-radius:16px;padding:36px;width:100%;max-width:380px}
.logo{font-size:24px;font-weight:800;color:#fff;margin-bottom:4px}
.sub{font-size:13px;color:#555;margin-bottom:28px}
.err{background:#1f0f0f;border:1px solid #4a1f1f;color:#f87171;padding:10px 14px;
  border-radius:8px;font-size:13px;margin-bottom:18px}
label{display:block;font-size:12px;color:#888;margin-bottom:5px;margin-top:14px;font-weight:500}
input{width:100%;background:#0d0d14;border:1px solid #252535;border-radius:8px;
  padding:10px 13px;color:#fff;font-size:14px;outline:none}
input:focus{border-color:#6366f1}
.btn{width:100%;background:#6366f1;color:#fff;border:none;border-radius:8px;
  padding:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:20px}
.btn:hover{background:#4f52d8}
.foot{text-align:center;font-size:13px;color:#555;margin-top:18px}
.foot a{color:#6366f1;text-decoration:none}
</style></head><body><div class="box">
<div class="logo">⚡ LexLead</div>
<div class="sub">KI-Anfragen-Filter für Immobilienmakler</div>
${err ? `<div class="err">${err}</div>` : ''}
<form method="POST" action="/${type}">
${!isLogin ? `<label>Vollständiger Name</label><input name="name" required placeholder="Max Mustermann">
<label>Unternehmen (optional)</label><input name="company" placeholder="Mustermann Immobilien">` : ''}
<label>E-Mail</label><input type="email" name="email" required placeholder="max@immobilien.de">
<label>Passwort${!isLogin?' (mind. 8 Zeichen)':''}</label>
<input type="password" name="password" required ${!isLogin?'minlength="8"':''} placeholder="••••••••">
<button class="btn">${isLogin ? 'Anmelden' : 'Account erstellen'}</button>
</form>
<div class="foot">${isLogin
  ? 'Noch kein Account? <a href="/register">Registrieren</a>'
  : 'Bereits registriert? <a href="/login">Anmelden</a>'}</div>
</div></body></html>`;
}

function dashHTML(name) {
  return `<!DOCTYPE html><html lang="de"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LexLead · Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d0d14;--surface:#16161f;--border:#252535;--text:#e8e8f0;--muted:#555;
  --hot:#f97316;--warm:#f59e0b;--cold:#60a5fa;--spam:#555;--accent:#6366f1;
  --green:#22c55e;--red:#f87171}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:var(--bg);color:var(--text);min-height:100vh;display:flex}

/* SIDEBAR */
.sb{width:210px;min-width:210px;background:var(--surface);border-right:1px solid var(--border);
  display:flex;flex-direction:column;height:100vh;position:sticky;top:0}
.sb-logo{padding:20px 18px 14px;border-bottom:1px solid var(--border)}
.sb-logo-text{font-size:20px;font-weight:800;color:#fff}
.sb-logo-sub{font-size:10px;color:var(--muted);margin-top:2px;letter-spacing:1px;text-transform:uppercase}
.sb-nav{padding:10px 8px;flex:1}
.sb-nav-title{font-size:10px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;
  padding:12px 10px 5px;font-weight:600}
.nb{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;
  cursor:pointer;font-size:13px;color:#888;margin-bottom:1px;transition:all .15s;
  border:none;background:none;width:100%;text-align:left}
.nb:hover{background:#1e1e2e;color:#ccc}
.nb.on{background:#1e1e30;color:#fff;font-weight:500}
.nb-icon{font-size:16px;width:18px;text-align:center}
.sb-foot{padding:14px 16px;border-top:1px solid var(--border)}
.sb-user{font-size:13px;color:#aaa;font-weight:500;margin-bottom:3px}
.sb-logout{font-size:12px;color:var(--muted);text-decoration:none}
.sb-logout:hover{color:#aaa}

/* MAIN */
.main{flex:1;min-width:0;overflow-y:auto}
.topbar{padding:14px 22px;border-bottom:1px solid var(--border);display:flex;
  align-items:center;justify-content:space-between;background:var(--surface);
  position:sticky;top:0;z-index:10}
.topbar-title{font-size:15px;font-weight:600;color:#fff}
.topbar-right{display:flex;align-items:center;gap:10px}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);
  animation:pulse 2s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.live-txt{font-size:12px;color:var(--muted)}
.btn{padding:7px 14px;border-radius:8px;font-size:13px;font-weight:500;
  cursor:pointer;border:none;transition:all .15s}
.btn-ghost{background:#1e1e2e;color:#aaa;border:1px solid var(--border)}
.btn-ghost:hover{background:#252535;color:#ddd}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:#4f52d8}
.btn-sm{padding:5px 11px;font-size:12px}

/* STATS */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:18px 22px}
@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}
.stat-lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:7px}
.stat-val{font-size:28px;font-weight:700;line-height:1}
.stat-sub{font-size:11px;color:var(--muted);margin-top:3px}
.s-hot .stat-val{color:var(--hot)}
.s-accent .stat-val{color:var(--accent)}

/* FILTER */
.filters{padding:0 22px 14px;display:flex;gap:7px;flex-wrap:wrap}
.fb{padding:5px 13px;border-radius:20px;font-size:12px;cursor:pointer;
  border:1px solid var(--border);background:var(--surface);color:var(--muted);transition:all .15s}
.fb:hover{background:#1e1e2e;color:#ccc}
.fb.on{background:var(--accent);border-color:var(--accent);color:#fff}

/* LEADS */
.leads{padding:0 22px 22px}
.lead-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:14px 16px;margin-bottom:8px;cursor:pointer;transition:all .15s;
  display:grid;grid-template-columns:48px 1fr auto;gap:13px;align-items:start}
.lead-card:hover{border-color:#353548;background:#18182a}
.lead-card.selected{border-color:var(--accent)}
.score-box{width:48px;height:48px;border-radius:10px;display:flex;align-items:center;
  justify-content:center;font-size:18px;font-weight:700;flex-shrink:0}
.sc-hot{background:#1f0e03;color:var(--hot);border:1px solid #5a2500}
.sc-warm{background:#1a1200;color:var(--warm);border:1px solid #4a3200}
.sc-cold{background:#051526;color:var(--cold);border:1px solid #0a2a4a}
.sc-spam{background:#111118;color:var(--muted);border:1px solid #252535}
.sc-new{background:#111118;color:var(--muted);border:1px solid #252535}
.lead-body{min-width:0}
.lead-top{display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap}
.lead-from{font-size:14px;font-weight:600;color:var(--text)}
.lead-subj{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px}
.lead-sum{font-size:13px;color:#999;line-height:1.5;margin-bottom:7px}
.tags{display:flex;gap:5px;flex-wrap:wrap}
.tag{font-size:10px;padding:2px 7px;border-radius:5px;font-weight:500}
.tg{background:#031a0e;color:#4ade80;border:1px solid #0a3d1e}
.ta{background:#1a1000;color:#fbbf24;border:1px solid #3a2a00}
.tb{background:#030f1f;color:var(--cold);border:1px solid #0a2040}
.tr{background:#1a0505;color:var(--red);border:1px solid #3a1010}
.tm{background:#111118;color:var(--muted);border:1px solid var(--border)}
.lead-right{text-align:right;flex-shrink:0}
.lead-time{font-size:11px;color:var(--muted);margin-bottom:6px;white-space:nowrap}
.lead-action{font-size:11px;color:#aaa;max-width:140px;line-height:1.4;text-align:right}
.status-badge{font-size:10px;padding:2px 7px;border-radius:5px;margin-top:5px;display:inline-block}
.st-new{background:#111128;color:var(--accent);border:1px solid #2a2a5a}
.st-reviewed{background:#031a0e;color:var(--green);border:1px solid #0a3d1e}
.st-replied{background:#1a1000;color:var(--warm);border:1px solid #3a2a00}
.st-archived{background:#111118;color:var(--muted);border:1px solid var(--border)}

/* DETAIL PANEL */
.dp{position:fixed;top:0;right:0;bottom:0;width:460px;background:var(--surface);
  border-left:1px solid var(--border);z-index:200;overflow-y:auto;
  transform:translateX(100%);transition:transform .25s ease}
.dp.open{transform:none}
.dp-head{padding:18px 20px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;background:var(--surface);z-index:5}
.dp-title{font-size:14px;font-weight:600;color:#fff}
.dp-close{background:#1e1e2e;border:1px solid var(--border);color:#aaa;
  border-radius:7px;width:30px;height:30px;cursor:pointer;font-size:15px;
  display:flex;align-items:center;justify-content:center}
.dp-close:hover{color:#fff;background:#252535}
.dp-body{padding:18px 20px}
.dp-section{margin-bottom:20px}
.dp-section-title{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;
  color:var(--muted);margin-bottom:9px;font-weight:600}
.score-big{display:flex;align-items:center;gap:14px;background:var(--bg);
  border:1px solid var(--border);border-radius:11px;padding:14px;margin-bottom:12px}
.score-num{font-size:44px;font-weight:800;line-height:1}
.score-info .sl{font-size:14px;font-weight:600;margin-bottom:3px}
.score-info .ss{font-size:12px;color:var(--muted)}
.dp-box{background:var(--bg);border:1px solid var(--border);border-radius:10px;
  padding:13px;font-size:13px;color:#aaa;line-height:1.7}
.dp-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.dp-item{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px}
.dp-item-lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.dp-item-val{font-size:13px;color:#ddd;font-weight:500}
.dp-draft{background:var(--bg);border:1px solid var(--border);border-radius:10px;
  padding:13px;font-size:13px;color:#aaa;line-height:1.7;white-space:pre-wrap;
  max-height:200px;overflow-y:auto}
.dp-actions{display:flex;gap:7px;flex-wrap:wrap}
.da{padding:8px 14px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;
  border:1px solid var(--border);background:#1e1e2e;color:#aaa;transition:all .15s}
.da:hover{background:#252535;color:#ddd}
.da-g{background:#031a0e;border-color:#0a3d1e;color:#4ade80}
.da-g:hover{background:#052a18}
.notice{background:#0a0a1f;border:1px solid #1a1a4a;border-radius:8px;
  padding:11px 13px;font-size:12px;color:#888;line-height:1.6;margin-bottom:12px}

/* SETTINGS */
.settings{display:none;padding:22px}
.settings.show{display:block}
.set-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:18px;margin-bottom:14px}
.set-title{font-size:14px;font-weight:600;color:#fff;margin-bottom:16px}
.field{margin-bottom:13px}
.field label{display:block;font-size:12px;color:#888;margin-bottom:5px;font-weight:500}
.field input,.field select{width:100%;background:var(--bg);border:1px solid var(--border);
  border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;outline:none}
.field input:focus,.field select:focus{border-color:var(--accent)}
.field-row{display:grid;grid-template-columns:1fr 80px 70px;gap:10px}
.acc-row{display:flex;align-items:center;justify-content:space-between;
  padding:10px 0;border-bottom:1px solid var(--border)}
.acc-row:last-child{border-bottom:none}
.acc-name{font-size:13px;font-weight:500;color:var(--text)}
.acc-sub{font-size:11px;color:var(--muted);margin-top:2px}
.btn-del{background:#1a0505;border:1px solid #3a1010;color:var(--red);
  padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer}
.btn-del:hover{background:#2a0808}
.f-err{background:#1a0505;border:1px solid #3a1010;color:var(--red);
  padding:9px 12px;border-radius:7px;font-size:12px;margin-bottom:11px;display:none}
.f-ok{background:#031a0e;border:1px solid #0a3d1e;color:var(--green);
  padding:9px 12px;border-radius:7px;font-size:12px;margin-bottom:11px;display:none}

/* EMPTY / LOADER */
.empty{text-align:center;padding:50px 20px;color:var(--muted)}
.empty-icon{font-size:44px;margin-bottom:14px}
.empty-title{font-size:15px;color:#888;margin-bottom:7px}
.empty-sub{font-size:13px}
.loader{display:inline-block;width:18px;height:18px;border:2px solid var(--border);
  border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading{text-align:center;padding:40px}
@media(max-width:600px){.sb{display:none}.dp{width:100%}.lead-card{grid-template-columns:42px 1fr}}
</style></head><body>

<!-- SIDEBAR -->
<div class="sb">
  <div class="sb-logo">
    <div class="sb-logo-text">⚡ LexLead</div>
    <div class="sb-logo-sub">KI-Anfragen-Filter</div>
  </div>
  <nav class="sb-nav">
    <div class="sb-nav-title">Anfragen</div>
    <button class="nb on" id="nb-all" onclick="nav('all',this)">
      <span class="nb-icon">📋</span>Alle Anfragen
    </button>
    <button class="nb" id="nb-hot" onclick="nav('hot',this)">
      <span class="nb-icon">🔥</span>Heiße Leads
    </button>
    <button class="nb" id="nb-new" onclick="nav('new',this)">
      <span class="nb-icon">🔔</span>Neu & Ungelesen
    </button>
    <div class="sb-nav-title">Einstellungen</div>
    <button class="nb" id="nb-settings" onclick="nav('settings',this)">
      <span class="nb-icon">⚙️</span>E-Mail verbinden
    </button>
    <button class="nb" id="nb-profile" onclick="nav('profile',this)">
      <span class="nb-icon">👤</span>Profil & SMS
    </button>
  </nav>
  <div class="sb-foot">
    <div class="sb-user">${name}</div>
    <a href="/logout" class="sb-logout">Abmelden</a>
  </div>
</div>

<!-- MAIN -->
<div class="main">
  <div class="topbar">
    <div class="topbar-title" id="page-title">Alle Anfragen</div>
    <div class="topbar-right">
      <div class="live-dot"></div>
      <span class="live-txt" id="sync-txt">Auto-Sync aktiv</span>
      <button class="btn btn-ghost btn-sm" onclick="manualSync()">Jetzt prüfen</button>
    </div>
  </div>

  <!-- TAGES-ZUSAMMENFASSUNG BANNER -->
  <div id="summary-banner" style="display:none;margin:0 22px 14px;background:#0a1f0a;border:1px solid #1a3a1a;border-radius:12px;padding:14px 18px">
    <div style="font-size:12px;font-weight:600;color:#4ade80;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">☀️ Guten Morgen — Dein Tagesüberblick</div>
    <div id="summary-content" style="font-size:13px;color:#aaa;line-height:1.7"></div>
    <button onclick="document.getElementById('summary-banner').style.display='none'" style="margin-top:10px;background:none;border:1px solid #1a3a1a;color:#555;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">Schließen</button>
  </div>

  <!-- STATS -->
  <div class="stats" id="stats">
    <div class="stat"><div class="stat-lbl">Gesamt</div><div class="stat-val" id="s-total">—</div><div class="stat-sub">Anfragen</div></div>
    <div class="stat s-hot"><div class="stat-lbl">Heiß 🔥</div><div class="stat-val" id="s-hot">—</div><div class="stat-sub">Sofort anrufen</div></div>
    <div class="stat s-accent"><div class="stat-lbl">Ungelesen</div><div class="stat-val" id="s-unread">—</div><div class="stat-sub">Neu eingegangen</div></div>
    <div class="stat"><div class="stat-lbl">Heute</div><div class="stat-val" id="s-today">—</div><div class="stat-sub">Heute erhalten</div></div>
  </div>

  <!-- FILTER TABS -->
  <div class="filters" id="filter-row">
    <button class="fb on" onclick="filter('all',this)">Alle</button>
    <button class="fb" onclick="filter('hot',this)">🔥 Heiß</button>
    <button class="fb" onclick="filter('warm',this)">🟡 Warm</button>
    <button class="fb" onclick="filter('cold',this)">❄️ Kalt & Spam</button>
    <button class="fb" onclick="filter('new',this)">● Ungelesen</button>
  </div>

  <!-- LEAD LIST -->
  <div class="leads" id="lead-list">
    <div class="loading"><div class="loader"></div></div>
  </div>

  <!-- PROFILE -->
  <div class="settings" id="profile-panel">
    <div class="set-card">
      <div class="set-title">Profil & SMS-Benachrichtigungen</div>
      <div class="notice">
        <strong>SMS bei heißem Lead:</strong> Sobald ein Lead mit Score 8–10 reinkommt,
        bekommst du sofort eine SMS. Dafür brauchst du einen Twilio-Account (twilio.com).<br><br>
        <strong>Twilio einrichten:</strong> twilio.com → Account erstellen → Nummer kaufen (~1$/Monat)
        → SID und Token in Render unter "Environment" eintragen als TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM.
      </div>
      <div class="field"><label>Dein Name</label><input id="p-name" placeholder="Max Mustermann"></div>
      <div class="field"><label>Unternehmen</label><input id="p-company" placeholder="Mustermann Immobilien GmbH"></div>
      <div class="field">
        <label>Handynummer für SMS-Alerts (mit Ländercode)</label>
        <input id="p-phone" placeholder="+4915123456789" type="tel">
      </div>
      <div class="f-err" id="p-err"></div>
      <div class="f-ok" id="p-ok">✓ Profil gespeichert</div>
      <button class="btn btn-primary" onclick="saveProfile()">Speichern</button>
    </div>
    <div class="set-card">
      <div class="set-title">ImmoScout24 & andere Portale</div>
      <div class="notice" style="border-color:#1a3a1a;background:#0a1f0a;color:#aaa">
        <strong>Kein extra Setup nötig.</strong> Sobald dein Postfach verbunden ist, erkennt LexLead
        automatisch Anfragen von ImmoScout24, Immowelt und Kleinanzeigen und analysiert sie speziell.
      </div>
    </div>
  </div>

</div>

<!-- DETAIL PANEL -->
    <div class="set-card">
      <div class="set-title">E-Mail-Account verbinden</div>
      <div class="notice">
        <strong>Gmail:</strong> Normales Passwort funktioniert nicht. Du brauchst ein App-Passwort:<br>
        myaccount.google.com → Sicherheit → 2-Schritt → App-Passwörter → Mail → 16-stelligen Code verwenden.<br><br>
        <strong>Outlook/GMX/Web.de:</strong> Normales Passwort funktioniert direkt.
      </div>
      <div class="field">
        <label>Anbieter wählen (setzt Host automatisch)</label>
        <select id="preset" onchange="applyPreset()">
          <option value="">Eigene Einstellungen...</option>
          <option value="imap.gmail.com|993|1">Gmail</option>
          <option value="outlook.office365.com|993|1">Outlook / Office 365</option>
          <option value="imap.gmx.net|993|1">GMX</option>
          <option value="imap.web.de|993|1">Web.de</option>
          <option value="imap.1und1.de|993|1">1&1 / IONOS</option>
          <option value="imap.strato.de|993|1">Strato</option>
        </select>
      </div>
      <div class="field"><label>Bezeichnung</label><input id="f-label" placeholder="z.B. Büro-Postfach"></div>
      <div class="field-row">
        <div class="field"><label>IMAP-Host</label><input id="f-host" placeholder="imap.gmail.com"></div>
        <div class="field"><label>Port</label><input id="f-port" type="number" value="993"></div>
        <div class="field"><label>SSL</label><select id="f-ssl"><option value="1">Ja</option><option value="0">Nein</option></select></div>
      </div>
  <!-- SETTINGS -->
  <div class="settings" id="settings-panel">
    <div class="set-card">
      <div class="set-title">E-Mail-Account verbinden</div>
      <div class="notice">
        <strong>Gmail:</strong> Normales Passwort funktioniert nicht. Du brauchst ein App-Passwort:<br>
        myaccount.google.com → Sicherheit → 2-Schritt → App-Passwörter → Mail → 16-stelligen Code verwenden.<br><br>
        <strong>Outlook/GMX/Web.de:</strong> Normales Passwort funktioniert direkt.
      </div>
      <div class="field">
        <label>Anbieter wählen (setzt Host automatisch)</label>
        <select id="preset" onchange="applyPreset()">
          <option value="">Eigene Einstellungen...</option>
          <option value="imap.gmail.com|993|1">Gmail</option>
          <option value="outlook.office365.com|993|1">Outlook / Office 365</option>
          <option value="imap.gmx.net|993|1">GMX</option>
          <option value="imap.web.de|993|1">Web.de</option>
          <option value="imap.1und1.de|993|1">1&1 / IONOS</option>
          <option value="imap.strato.de|993|1">Strato</option>
        </select>
      </div>
      <div class="field"><label>Bezeichnung</label><input id="f-label" placeholder="z.B. Büro-Postfach"></div>
      <div class="field-row">
        <div class="field"><label>IMAP-Host</label><input id="f-host" placeholder="imap.gmail.com"></div>
        <div class="field"><label>Port</label><input id="f-port" type="number" value="993"></div>
        <div class="field"><label>SSL</label><select id="f-ssl"><option value="1">Ja</option><option value="0">Nein</option></select></div>
      </div>
      <div class="field"><label>E-Mail-Adresse</label><input id="f-user" type="email" placeholder="makler@gmail.com"></div>
      <div class="field"><label>Passwort / App-Passwort</label><input id="f-pass" type="password" placeholder="••••••••"></div>
      <div class="f-err" id="conn-err"></div>
      <div class="f-ok" id="conn-ok">✓ Verbunden! Erster Sync läuft...</div>
      <button class="btn btn-primary" onclick="addAccount()" id="conn-btn">Verbindung testen & speichern</button>
    </div>
    <div class="set-card">
      <div class="set-title">Verbundene Accounts</div>
      <div id="acc-list"><div class="loading"><div class="loader"></div></div></div>
    </div>
  </div>

<!-- DETAIL PANEL -->
<div class="dp" id="dp">
  <div class="dp-head">
    <div class="dp-title">Anfrage Details</div>
    <button class="dp-close" onclick="closeDP()">✕</button>
  </div>
  <div class="dp-body" id="dp-body"></div>
</div>

<script>
// ── State ─────────────────────────────────────────────────
let currentFilter = 'all';
let currentView = 'all';

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStats(); loadLeads(); loadSummary();
  setInterval(loadStats, 30000);
  setInterval(() => loadLeads(false), 90000);
});

// ── API helper ────────────────────────────────────────────
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
}

// ── Stats ─────────────────────────────────────────────────
async function loadStats() {
  const s = await api('/api/stats');
  document.getElementById('s-total').textContent  = s.total  ?? '—';
  document.getElementById('s-hot').textContent    = s.hot    ?? '—';
  document.getElementById('s-unread').textContent = s.unread ?? '—';
  document.getElementById('s-today').textContent  = s.today  ?? '—';
}

// ── Leads ─────────────────────────────────────────────────
async function loadLeads(showLoader = true) {
  const el = document.getElementById('lead-list');
  if (showLoader) el.innerHTML = '<div class="loading"><div class="loader"></div></div>';
  const leads = await api('/api/leads?filter=' + currentFilter);
  renderLeads(Array.isArray(leads) ? leads : []);
}

function renderLeads(leads) {
  const el = document.getElementById('lead-list');
  if (!leads.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">Keine Anfragen</div><div class="empty-sub">Verbinde einen E-Mail-Account unter "E-Mail verbinden"</div></div>';
    return;
  }
  el.innerHTML = leads.map(l => cardHTML(l)).join('');
}

function cardHTML(l) {
  const sc = l.label || 'new';
  const scClass = { hot:'sc-hot', warm:'sc-warm', cold:'sc-cold', spam:'sc-spam' }[sc] || 'sc-new';
  const scoreDisplay = l.score || '?';

  const tags = [];
  if (l.financing === 'bestaetigt') tags.push('<span class="tag tg">✓ Finanziert</span>');
  if (l.timeframe === 'sofort' || l.timeframe === '1_monat') tags.push('<span class="tag ta">⏱ Dringend</span>');
  if (l.intent === 'ernst') tags.push('<span class="tag tb">Ernsthaft</span>');
  if (l.label === 'spam') tags.push('<span class="tag tr">Spam</span>');

  const stClass = { new:'st-new', reviewed:'st-reviewed', replied:'st-replied', archived:'st-archived' }[l.status] || 'st-new';
  const stLabel = { new:'Neu', reviewed:'Gesehen', replied:'Beantwortet', archived:'Archiviert' }[l.status] || 'Neu';

  return \`<div class="lead-card" onclick="openLead('\${l.id}')">
    <div class="score-box \${scClass}">\${scoreDisplay}</div>
    <div class="lead-body">
      <div class="lead-top">
        <span class="lead-from">\${esc(l.from_name || l.from_email)}</span>
        <span class="lead-subj">\${esc(l.subject || '(kein Betreff)')}</span>
      </div>
      <div class="lead-sum">\${esc(l.summary || 'Wird analysiert...')}</div>
      <div class="tags">\${tags.join('')}</div>
    </div>
    <div class="lead-right">
      <div class="lead-time">\${ago(l.received)}</div>
      \${l.action ? \`<div class="lead-action">\${esc(l.action)}</div>\` : ''}
      <span class="status-badge \${stClass}">\${stLabel}</span>
    </div>
  </div>\`;
}

// ── Lead Detail ───────────────────────────────────────────
async function openLead(id) {
  const dp = document.getElementById('dp');
  document.getElementById('dp-body').innerHTML = '<div class="loading"><div class="loader"></div></div>';
  dp.classList.add('open');

  const l = await api('/api/leads/' + id);
  if (l.status === 'new') {
    await api('/api/leads/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'reviewed' }) });
    loadStats();
  }

  const colors = { hot: '#f97316', warm: '#f59e0b', cold: '#60a5fa', spam: '#555' };
  const col = colors[l.label] || '#888';
  const labelTxt = { hot:'🔥 Heißer Lead — sofort anrufen', warm:'🟡 Warmer Lead — heute kontaktieren',
    cold:'❄️ Kalt — niedrige Priorität', spam:'🚫 Spam / unqualifiziert' }[l.label] || 'Nicht analysiert';
  const intentTxt = { ernst:'Ernsthaft interessiert', informell:'Informationsanfrage',
    spekulativ:'Spekulativ', unklar:'Unklar' }[l.intent] || '—';
  const finTxt = { bestaetigt:'✓ Bestätigt', unklar:'Unklar', kein_signal:'Kein Signal',
    problematisch:'⚠ Problematisch' }[l.financing] || '—';
  const tfTxt = { sofort:'Sofort', '1_monat':'1 Monat', '3_monate':'3 Monate',
    unklar:'Unklar', kein_kauf:'Kein Kauf' }[l.timeframe] || '—';

  document.getElementById('dp-body').innerHTML = \`
    <div class="dp-section">
      <div class="score-big">
        <div class="score-num" style="color:\${col}">\${l.score || '?'}</div>
        <div class="score-info">
          <div class="sl">\${labelTxt}</div>
          <div class="ss">\${esc(l.from_name || l.from_email)}</div>
          <div class="ss">\${esc(l.from_email)}</div>
          <div class="ss" style="margin-top:3px">\${fmtDate(l.received)}</div>
        </div>
      </div>
      \${l.action ? \`<div class="dp-box" style="border-color:#2a3a2a;color:#ccc"><strong>→</strong> \${esc(l.action)}</div>\` : ''}
    </div>

    \${l.summary ? \`<div class="dp-section">
      <div class="dp-section-title">KI-Zusammenfassung</div>
      <div class="dp-box">\${esc(l.summary)}</div>
    </div>\` : ''}

    <div class="dp-section">
      <div class="dp-section-title">Bewertung</div>
      <div class="dp-grid">
        <div class="dp-item"><div class="dp-item-lbl">Kaufabsicht</div><div class="dp-item-val">\${intentTxt}</div></div>
        <div class="dp-item"><div class="dp-item-lbl">Finanzierung</div><div class="dp-item-val">\${finTxt}</div></div>
        <div class="dp-item"><div class="dp-item-lbl">Zeitrahmen</div><div class="dp-item-val">\${tfTxt}</div></div>
        <div class="dp-item"><div class="dp-item-lbl">Account</div><div class="dp-item-val">\${esc(l.acc_label || '—')}</div></div>
      </div>
    </div>

    \${l.draft ? \`<div class="dp-section">
      <div class="dp-section-title">KI-Antwort-Entwurf</div>
      <div class="dp-draft" id="draft-text">\${esc(l.draft)}</div>
      <button class="da" style="margin-top:8px" onclick="copyDraft()">📋 Antwort kopieren</button>
    </div>\` : ''}

    <div class="dp-section">
      <div class="dp-section-title">Notiz</div>
      <textarea id="note-input" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical;min-height:70px;outline:none" placeholder="z.B. Angerufen, Termin Dienstag 14h...">\${esc(l.notes || '')}</textarea>
      <button class="da da-g" style="margin-top:6px" onclick="saveNote('\${l.id}')">Notiz speichern</button>
    </div>

    <div class="dp-section">
      <div class="dp-section-title">Wiedervorlage</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="date" id="followup-input" value="\${l.followup_date || ''}" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:13px;outline:none">
        <button class="da" onclick="saveFollowup('\${l.id}')">Setzen</button>
        \${l.followup_date ? \`<button class="da" onclick="clearFollowup('\${l.id}')">Entfernen</button>\` : ''}
      </div>
      \${l.followup_date ? \`<div style="font-size:12px;color:#f59e0b;margin-top:6px">⏰ Wiedervorlage: \${fmtDate(l.followup_date)}</div>\` : ''}
    </div>

    <div class="dp-section">
      <div class="dp-section-title">Aktionen</div>
      <div class="dp-actions">
        <button class="da da-g" onclick="setStatus('\${l.id}','replied')">✓ Beantwortet</button>
        <button class="da" onclick="setStatus('\${l.id}','archived')">Archivieren</button>
      </div>
    </div>

    <div class="dp-section">
      <div class="dp-section-title">Original E-Mail</div>
      <div class="dp-draft" style="font-size:12px">\${esc(l.body || '(leer)')}</div>
    </div>\`;
}

function closeDP() {
  document.getElementById('dp').classList.remove('open');
  loadLeads(false);
}

async function setStatus(id, status) {
  await api('/api/leads/' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
  closeDP();
}

// ── Navigation ────────────────────────────────────────────
const titles = { all:'Alle Anfragen', hot:'Heiße Leads 🔥', new:'Neu & Ungelesen', settings:'E-Mail verbinden', profile:'Profil & SMS' };

function nav(view, btn) {
  currentView = view;
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('page-title').textContent = titles[view] || view;

  const isSettings = view === 'settings';
  const isProfile  = view === 'profile';
  const isSpecial  = isSettings || isProfile;

  document.getElementById('stats').style.display      = isSpecial ? 'none' : 'grid';
  document.getElementById('filter-row').style.display = isSpecial ? 'none' : 'flex';
  document.getElementById('lead-list').style.display  = isSpecial ? 'none' : 'block';

  const sp = document.getElementById('settings-panel');
  const pp = document.getElementById('profile-panel');
  if (sp) sp.classList.toggle('show', isSettings);
  if (pp) pp.classList.toggle('show', isProfile);

  if (isSettings) { loadAccounts(); return; }
  if (isProfile)  { loadProfile();  return; }

  currentFilter = view === 'hot' ? 'hot' : view === 'new' ? 'new' : 'all';
  if (view !== 'all') {
    document.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
    const map = { hot: 1, new: 4 };
    const fbs = document.querySelectorAll('.fb');
    if (map[view] !== undefined) fbs[map[view]]?.classList.add('on');
  }
  loadLeads();
}

function filter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  loadLeads();
}

// ── Sync ──────────────────────────────────────────────────
async function manualSync() {
  const btn = event.currentTarget;
  btn.disabled = true; btn.textContent = 'Prüfe...';
  document.getElementById('sync-txt').textContent = 'Synchronisiere...';
  await api('/api/sync', { method: 'POST' });
  setTimeout(() => {
    loadStats(); loadLeads(false);
    btn.disabled = false; btn.textContent = 'Jetzt prüfen';
    document.getElementById('sync-txt').textContent = 'Auto-Sync aktiv';
  }, 5000);
}

// ── Accounts ──────────────────────────────────────────────
function applyPreset() {
  const v = document.getElementById('preset').value;
  if (!v) return;
  const [host, port, ssl] = v.split('|');
  document.getElementById('f-host').value = host;
  document.getElementById('f-port').value = port;
  document.getElementById('f-ssl').value = ssl;
}

async function addAccount() {
  const btn = document.getElementById('conn-btn');
  const errEl = document.getElementById('conn-err');
  const okEl = document.getElementById('conn-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Teste Verbindung...';

  const body = {
    label:    document.getElementById('f-label').value,
    host:     document.getElementById('f-host').value,
    port:     document.getElementById('f-port').value,
    ssl:      document.getElementById('f-ssl').value,
    username: document.getElementById('f-user').value,
    password: document.getElementById('f-pass').value
  };

  const res = await api('/api/accounts', { method: 'POST', body: JSON.stringify(body) });
  btn.disabled = false; btn.textContent = 'Verbindung testen & speichern';

  if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
  okEl.style.display = 'block';
  ['f-label','f-host','f-user','f-pass'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('preset').value = '';
  loadAccounts();
}

async function loadAccounts() {
  const el = document.getElementById('acc-list');
  const accs = await api('/api/accounts');
  if (!Array.isArray(accs) || !accs.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">Noch kein Account verbunden.</div>';
    return;
  }
  el.innerHTML = accs.map(a => \`
    <div class="acc-row">
      <div><div class="acc-name">\${esc(a.label)}</div>
      <div class="acc-sub">\${esc(a.username)} · \${a.cnt || 0} Leads · \${a.last_checked ? 'zuletzt ' + ago(a.last_checked) : 'nie geprüft'}</div></div>
      <button class="btn-del" onclick="delAccount('\${a.id}')">Entfernen</button>
    </div>\`).join('');
}

async function delAccount(id) {
  if (!confirm('Account wirklich entfernen?')) return;
  await api('/api/accounts/' + id, { method: 'DELETE' });
  loadAccounts();
}

// ── Kopieren ──────────────────────────────────────────────
function copyDraft() {
  const txt = document.getElementById('draft-text')?.innerText || '';
  navigator.clipboard.writeText(txt).then(() => {
    const btn = event.currentTarget;
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => btn.textContent = '📋 Antwort kopieren', 2000);
  });
}

// ── Notiz ─────────────────────────────────────────────────
async function saveNote(id) {
  const note = document.getElementById('note-input')?.value || '';
  await api('/api/leads/' + id + '/note', { method: 'POST', body: JSON.stringify({ note }) });
  const btn = event.currentTarget;
  btn.textContent = '✓ Gespeichert';
  setTimeout(() => btn.textContent = 'Notiz speichern', 2000);
}

// ── Wiedervorlage ─────────────────────────────────────────
async function saveFollowup(id) {
  const date = document.getElementById('followup-input')?.value;
  if (!date) return;
  await api('/api/leads/' + id + '/followup', { method: 'POST', body: JSON.stringify({ date }) });
  const btn = event.currentTarget;
  btn.textContent = '✓ Gesetzt';
  setTimeout(() => btn.textContent = 'Setzen', 2000);
}
async function clearFollowup(id) {
  await api('/api/leads/' + id + '/followup', { method: 'POST', body: JSON.stringify({ date: null }) });
  openLead(id);
}

// ── Tages-Zusammenfassung ─────────────────────────────────
async function loadSummary() {
  const data = await api('/api/summary');
  const lines = [];
  if (data.today > 0) lines.push('<strong>' + data.today + '</strong> neue Anfragen heute');
  if (data.hot?.length) lines.push('\uD83D\uDD25 <strong>' + data.hot.length + '</strong> hei\u00DFe Leads warten auf deinen Anruf');
  if (data.waiting?.length) lines.push('\u23F3 <strong>' + data.waiting.length + '</strong> Leads warten auf Antwort');
  if (data.followups?.length) lines.push('\u23F0 <strong>' + data.followups.length + '</strong> Wiedervorlage' + (data.followups.length > 1 ? 'n' : '') + ' f\u00E4llig');
  if (lines.length > 0) {
    document.getElementById('summary-content').innerHTML = lines.join('<br>');
    document.getElementById('summary-banner').style.display = 'block';
  }
}

// ── Profile ───────────────────────────────────────────────
async function loadProfile() {
  const p = await api('/api/profile');
  document.getElementById('p-name').value    = p.name    || '';
  document.getElementById('p-company').value = p.company || '';
  document.getElementById('p-phone').value   = p.phone   || '';
}

async function saveProfile() {
  const errEl = document.getElementById('p-err');
  const okEl  = document.getElementById('p-ok');
  errEl.style.display = 'none'; okEl.style.display = 'none';
  const body = {
    name:    document.getElementById('p-name').value,
    company: document.getElementById('p-company').value,
    phone:   document.getElementById('p-phone').value
  };
  if (!body.name) { errEl.textContent = 'Name darf nicht leer sein'; errEl.style.display = 'block'; return; }
  const res = await api('/api/profile', { method: 'POST', body: JSON.stringify(body) });
  if (res.ok) okEl.style.display = 'block';
  else { errEl.textContent = 'Fehler beim Speichern'; errEl.style.display = 'block'; }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function ago(dt) {
  const d = new Date(dt), n = new Date(), diff = Math.floor((n - d) / 1000);
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return Math.floor(diff / 60) + ' Min.';
  if (diff < 86400) return Math.floor(diff / 3600) + ' Std.';
  if (diff < 604800) return Math.floor(diff / 86400) + ' Tage';
  return d.toLocaleDateString('de-DE');
}
function fmtDate(dt) {
  return new Date(dt).toLocaleString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
</script>
</body></html>`;
}

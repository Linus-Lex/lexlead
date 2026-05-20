// server.js — LexLead v3.2
// Production-ready · Stripe · Trial-Sperrung · Outlook OAuth2 · iCloud · Landing · Legal · Resend E-Mail

require('dotenv').config();

// ─── RESEND ───────────────────────────────────────────────────────────────────
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const cron    = require('node-cron');
const db      = require('./database');
const { checkAllAccounts, testConnection } = require('./mailer');

// ─── STRIPE ───────────────────────────────────────────────────────────────────
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// ─── OUTLOOK OAUTH2 (MSAL) ────────────────────────────────────────────────────
let msalClient = null;
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  const msal = require('@azure/msal-node');
  msalClient = new msal.ConfidentialClientApplication({
    auth: {
      clientId:     process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      authority:    'https://login.microsoftonline.com/common',
    }
  });
}

const app  = express();
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

// ─── RESEND HELPER ────────────────────────────────────────────────────────────
async function sendResetEmail(user, code) {
  if (!resend) {
    console.warn('⚠️  Resend nicht konfiguriert — Reset-Code nur in Logs: ' + code);
    return;
  }
  try {
    await resend.emails.send({
      from:    process.env.RESEND_FROM || 'LexLead <noreply@lexlead.de>',
      to:      user.email,
      subject: 'Dein LexLead Passwort-Reset Code',
      html: `
        <!DOCTYPE html>
        <html lang="de">
        <head><meta charset="UTF-8"></head>
        <body style="margin:0;padding:0;background:#080a0f;font-family:'DM Sans',Arial,sans-serif">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#080a0f;padding:40px 20px">
            <tr><td align="center">
              <table width="480" cellpadding="0" cellspacing="0" style="background:#0e1117;border:1px solid #1e2433;border-radius:16px;overflow:hidden;max-width:480px">
                <tr>
                  <td style="background:#3d7ef6;padding:28px 32px;text-align:center">
                    <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.5px">⬟ LexLead</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px 32px">
                    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#edf0f7">Passwort zurücksetzen</p>
                    <p style="margin:0 0 28px;font-size:14px;color:#6b7a99">Hey ${user.name.split(' ')[0]}, hier ist dein Reset-Code:</p>
                    <div style="background:#161b24;border:1px solid #2a3347;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px">
                      <div style="font-family:'Courier New',monospace;font-size:36px;font-weight:900;letter-spacing:10px;color:#5b8ff8">${code}</div>
                      <div style="font-size:12px;color:#6b7a99;margin-top:8px">Gültig für diese Sitzung · Nicht weitergeben</div>
                    </div>
                    <p style="margin:0 0 24px;font-size:13px;color:#6b7a99;line-height:1.7">
                      Gib diesen Code auf der Passwort-Reset Seite ein, um dein Passwort zu ändern.<br>
                      Falls du das nicht warst, ignoriere diese E-Mail einfach.
                    </p>
                    <a href="${APP_URL}/forgot-password?sent=1" style="display:inline-block;background:#3d7ef6;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:14px">Jetzt Passwort ändern →</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 32px;border-top:1px solid #1e2433;text-align:center">
                    <p style="margin:0;font-size:12px;color:#6b7a99">© 2026 LexLead · Patrick Rümmler · <a href="${APP_URL}/legal" style="color:#6b7a99;text-decoration:none">Impressum</a></p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `,
    });
    console.log(`✉️  Reset-Mail gesendet an ${user.email}`);
  } catch (err) {
    console.error('Resend Fehler:', err.message);
  }
}

// ─── STRIPE WEBHOOK (vor express.json!) ───────────────────────────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe nicht konfiguriert' });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook Signatur ungültig:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = parseInt(s.metadata?.userId);
        if (userId) {
          const until = new Date();
          until.setMonth(until.getMonth() + 1);
          db.activateSubscription(userId, s.subscription, s.customer, until.toISOString());
          console.log(`✅ Abo aktiviert: User ${userId}`);
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const until = new Date();
        until.setMonth(until.getMonth() + 1);
        db.renewSubscription(event.data.object.customer, until.toISOString());
        break;
      }
      case 'invoice.payment_failed':
        db.markPaymentFailed(event.data.object.customer);
        break;
      case 'customer.subscription.deleted':
        db.cancelSubscription(event.data.object.customer);
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook Fehler:', err);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lexlead-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ─── AUTH GUARDS ──────────────────────────────────────────────────────────────
function auth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}
function apiAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Nicht eingeloggt' });
  next();
}
function subscriptionGuard(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const user = db.getUserById(req.session.userId);
  if (!user) return res.redirect('/login');

  if (user.plan === 'paid') {
    if (user.paid_until && new Date(user.paid_until) < new Date()) {
      db.setUserPlan(user.id, 'expired');
      return res.redirect('/upgrade?reason=expired');
    }
    return next();
  }
  if (user.plan === 'trial' || !user.plan) {
    const created  = new Date(user.created_at || Date.now());
    const trialEnd = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (new Date() > trialEnd) {
      db.setUserPlan(user.id, 'trial_expired');
      return res.redirect('/upgrade?reason=trial');
    }
    req.trialDaysLeft = Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24));
    return next();
  }
  if (['trial_expired','expired','cancelled'].includes(user.plan)) {
    return res.redirect('/upgrade?reason=' + user.plan);
  }
  next();
}

// ─── DESIGN SYSTEM ────────────────────────────────────────────────────────────
const baseStyles = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#080a0f;--bg2:#0e1117;--bg3:#161b24;--bg4:#1e2433;
      --border:#1e2433;--border2:#2a3347;
      --text:#edf0f7;--muted:#6b7a99;--muted2:#8a9abf;
      --accent:#3d7ef6;--accent2:#5b8ff8;--accent-glow:rgba(61,126,246,0.18);
      --green:#10b981;--yellow:#f59e0b;--red:#ef4444;--purple:#8b5cf6;
      --radius:14px;--radius-sm:9px;--radius-xs:6px;
      --font-display:'Syne',sans-serif;--font-body:'DM Sans',sans-serif;--font-mono:'JetBrains Mono',monospace;
    }
    html{font-size:15px;scroll-behavior:smooth}
    body{font-family:var(--font-body);background:var(--bg);color:var(--text);min-height:100vh;line-height:1.65;-webkit-font-smoothing:antialiased}
    a{color:var(--accent2);text-decoration:none;transition:opacity 0.15s}
    a:hover{opacity:0.75}
    input,textarea,select{width:100%;padding:10px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font-body);font-size:0.9rem;transition:border-color 0.2s,box-shadow 0.2s;outline:none;appearance:none}
    input:focus,textarea:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
    input::placeholder,textarea::placeholder{color:var(--muted)}
    textarea{resize:vertical;min-height:80px}
    label{display:block;font-size:0.78rem;font-weight:600;color:var(--muted2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;font-family:var(--font-display)}
    .btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:var(--radius-sm);font-weight:600;font-size:0.88rem;cursor:pointer;border:none;transition:all 0.18s;font-family:var(--font-body);white-space:nowrap}
    .btn-primary{background:var(--accent);color:#fff;box-shadow:0 2px 12px rgba(61,126,246,0.35)}
    .btn-primary:hover{background:var(--accent2);transform:translateY(-1px)}
    .btn-secondary{background:var(--bg3);color:var(--text);border:1px solid var(--border2)}
    .btn-secondary:hover{background:var(--bg4)}
    .btn-success{background:var(--green);color:#fff}
    .btn-success:hover{filter:brightness(1.1)}
    .btn-danger{background:var(--red);color:#fff}
    .btn-danger:hover{filter:brightness(1.1)}
    .btn-outlook{background:#0078d4;color:#fff;box-shadow:0 2px 12px rgba(0,120,212,0.3)}
    .btn-outlook:hover{background:#106ebe;transform:translateY(-1px)}
    .btn-upgrade{background:linear-gradient(135deg,#3d7ef6,#8b5cf6);color:#fff;box-shadow:0 2px 16px rgba(139,92,246,0.4)}
    .btn-upgrade:hover{box-shadow:0 4px 24px rgba(139,92,246,0.55);transform:translateY(-1px)}
    .btn-sm{padding:6px 12px;font-size:0.8rem}
    .btn-lg{padding:13px 28px;font-size:0.95rem}
    .btn-icon{padding:7px 10px}
    .btn:disabled{opacity:0.5;cursor:not-allowed;transform:none!important}
    .card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
    .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:100px;font-size:0.73rem;font-weight:700;letter-spacing:0.04em;font-family:var(--font-display)}
    .badge-green{background:rgba(16,185,129,0.12);color:var(--green)}
    .badge-yellow{background:rgba(245,158,11,0.12);color:var(--yellow)}
    .badge-red{background:rgba(239,68,68,0.12);color:var(--red)}
    .badge-blue{background:rgba(61,126,246,0.12);color:var(--accent2)}
    .badge-gray{background:var(--bg3);color:var(--muted)}
    .alert{padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.88rem}
    .alert-error{background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);color:#fca5a5}
    .alert-success{background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);color:#6ee7b7}
    .alert-info{background:rgba(61,126,246,0.08);border:1px solid rgba(61,126,246,0.2);color:#93c5fd}
    .alert-warning{background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);color:#fcd34d}
    .nav{background:rgba(8,10,15,0.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 24px;display:flex;align-items:center;height:58px;gap:2px;position:sticky;top:0;z-index:200}
    .nav-brand{font-family:var(--font-display);font-weight:800;font-size:1.1rem;color:var(--text);margin-right:16px;display:flex;align-items:center;gap:9px}
    .logo-mark{width:30px;height:30px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(61,126,246,0.45)}
    .nav-link{padding:6px 13px;border-radius:var(--radius-sm);color:var(--muted);font-weight:500;font-size:0.88rem;transition:all 0.15s;display:flex;align-items:center;gap:6px}
    .nav-link:hover,.nav-link.active{color:var(--text);background:var(--bg3);opacity:1}
    .nav-right{margin-left:auto;display:flex;align-items:center;gap:10px}
    .trial-pill{padding:4px 12px;border-radius:100px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);color:var(--yellow);font-size:0.76rem;font-weight:700;font-family:var(--font-display)}
    .page{max-width:1200px;margin:0 auto;padding:28px 20px}
    .page-title{font-size:1.45rem;font-weight:800;font-family:var(--font-display);letter-spacing:-0.02em}
    .page-sub{color:var(--muted);margin-top:3px;font-size:0.88rem}
    .page-header{margin-bottom:24px}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
    .stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;position:relative;overflow:hidden}
    .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--accent-line,var(--accent));opacity:0.6}
    .stat-value{font-size:2rem;font-weight:800;line-height:1;font-family:var(--font-display)}
    .stat-label{font-size:0.76rem;color:var(--muted);margin-top:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;font-family:var(--font-display)}
    .stat-sub{font-size:0.8rem;color:var(--muted);margin-top:5px}
    .score-bar{height:5px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-top:6px}
    .score-fill{height:100%;border-radius:3px;transition:width 0.5s cubic-bezier(0.4,0,0.2,1)}
    .score-pill{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-weight:800;font-size:0.88rem;font-family:var(--font-display)}
    .score-high{background:rgba(16,185,129,0.15);color:var(--green)}
    .score-mid{background:rgba(245,158,11,0.15);color:var(--yellow)}
    .score-low{background:rgba(239,68,68,0.15);color:var(--red)}
    .score-none{background:var(--bg3);color:var(--muted)}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:10px 14px;font-size:0.73rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--border);font-family:var(--font-display)}
    td{padding:13px 14px;border-bottom:1px solid var(--border);font-size:0.88rem;vertical-align:middle}
    tr:hover td{background:rgba(255,255,255,0.018)}
    tr:last-child td{border-bottom:none}
    .text-muted{color:var(--muted)}.text-muted2{color:var(--muted2)}
    .text-sm{font-size:0.82rem}.text-xs{font-size:0.75rem}
    .flex{display:flex;align-items:center}
    .gap-2{gap:8px}.gap-3{gap:12px}
    .mt-2{margin-top:8px}.mt-4{margin-top:16px}.mt-6{margin-top:24px}.mb-4{margin-bottom:16px}
    .divider{height:1px;background:var(--border);margin:20px 0}
    .form-group{margin-bottom:16px}
    .empty-state{text-align:center;padding:60px 20px;color:var(--muted)}
    .empty-state .icon{font-size:2.5rem;margin-bottom:12px;opacity:0.5}
    .empty-state p{font-size:0.88rem}
    .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:1000;align-items:center;justify-content:center}
    .modal-overlay.open{display:flex}
    .modal{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius);padding:26px;width:90%;max-width:540px;max-height:90vh;overflow-y:auto;animation:modalIn 0.2s ease}
    @keyframes modalIn{from{opacity:0;transform:scale(0.96) translateY(8px)}}
    .modal-header{font-size:1.05rem;font-weight:800;font-family:var(--font-display);margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
    .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-top:10px}
    .cal-header-cell{text-align:center;padding:10px 4px;font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;font-family:var(--font-display)}
    .cal-cell{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:9px;min-height:88px;transition:background 0.15s}
    .cal-cell:hover{background:var(--bg3)}
    .cal-empty{background:transparent;border-color:transparent}
    .cal-today{border-color:var(--accent);background:rgba(61,126,246,0.04)}
    .cal-day{font-size:0.82rem;font-weight:700;margin-bottom:5px;font-family:var(--font-display)}
    .cal-today .cal-day{color:var(--accent)}
    .cal-event{font-size:0.7rem;padding:3px 6px;border-radius:5px;margin-bottom:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .toast-container{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px}
    .toast{padding:12px 20px;border-radius:var(--radius-sm);font-weight:600;font-size:0.85rem;animation:toastIn 0.25s ease;max-width:320px}
    @keyframes toastIn{from{opacity:0;transform:translateY(8px)}}
    .toast-success{background:var(--green);color:#fff}
    .toast-error{background:var(--red);color:#fff}
    .toast-info{background:var(--accent);color:#fff}
    .hint-box{background:var(--bg3);border-radius:var(--radius-sm);padding:14px;margin-top:12px}
    .hint-box .hint-title{font-size:0.76rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;font-family:var(--font-display);margin-bottom:8px}
    .hint-step{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;font-size:0.83rem;color:var(--muted2)}
    .hint-step-num{background:var(--border2);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;flex-shrink:0;margin-top:1px}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:var(--bg2)}
    ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
    @media(max-width:768px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.nav-link span{display:none}.page{padding:20px 14px}}
  </style>
`;

const toastScript = `
<div class="toast-container" id="toastContainer"></div>
<script>
function showToast(msg,type='success'){
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div');
  t.className='toast toast-'+type;t.textContent=msg;c.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity 0.3s';setTimeout(()=>t.remove(),300)},2800);
}
<\/script>`;

const logoSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 12L8 4L13 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 9.5H10.5" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`;

function navbar(active, user, trialDaysLeft) {
  const links = [
    {href:'/dashboard',    icon:'▦', label:'Dashboard',     key:'dashboard'},
    {href:'/leads',        icon:'✉', label:'Leads',         key:'leads'},
    {href:'/kalender',     icon:'◷', label:'Kalender',      key:'kalender'},
    {href:'/einstellungen',icon:'⚙', label:'Einstellungen', key:'einstellungen'},
  ];
  const trialBadge = (user?.plan==='trial' && trialDaysLeft!=null)
    ? `<div class="trial-pill">⏱ ${trialDaysLeft}d Trial</div>` : '';
  return `<nav class="nav">
    <div class="nav-brand"><div class="logo-mark">${logoSvg}</div>LexLead</div>
    ${links.map(l=>`<a href="${l.href}" class="nav-link ${active===l.key?'active':''}">${l.icon} <span>${l.label}</span></a>`).join('')}
    <div class="nav-right">
      ${trialBadge}
      ${user?.plan==='trial'?`<a href="/upgrade" class="btn btn-upgrade btn-sm">Upgrade</a>`:''}
      <span class="text-sm text-muted">${user?.name?.split(' ')[0]||''}</span>
      <a href="/logout" class="btn btn-secondary btn-sm">Logout</a>
    </div>
  </nav>`;
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LexLead – KI-Filter für Immobilien-Anfragen</title>${baseStyles}<style>
    .hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px;position:relative;overflow:hidden}
    .hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(61,126,246,0.18) 0%,transparent 60%),radial-gradient(ellipse 60% 40% at 80% 80%,rgba(139,92,246,0.1) 0%,transparent 50%);pointer-events:none}
    .hero-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 16px;border-radius:100px;background:rgba(61,126,246,0.1);border:1px solid rgba(61,126,246,0.25);color:var(--accent2);font-size:0.8rem;font-weight:700;font-family:var(--font-display);margin-bottom:28px}
    .hero h1{font-family:var(--font-display);font-size:clamp(2.2rem,6vw,4rem);font-weight:800;line-height:1.1;letter-spacing:-0.03em;margin-bottom:20px;max-width:820px}
    .gradient{background:linear-gradient(135deg,var(--accent2),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .hero p{font-size:1.1rem;color:var(--muted2);max-width:540px;margin-bottom:36px;line-height:1.7}
    .hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    .features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1000px;margin:80px auto 0;padding:0 20px}
    .feature-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:22px;transition:border-color 0.2s,transform 0.2s}
    .feature-card:hover{border-color:var(--border2);transform:translateY(-2px)}
    .feature-icon{width:40px;height:40px;border-radius:10px;background:var(--accent-glow);border:1px solid rgba(61,126,246,0.2);display:flex;align-items:center;justify-content:center;font-size:1.1rem;margin-bottom:14px}
    .feature-card h3{font-family:var(--font-display);font-weight:700;font-size:0.95rem;margin-bottom:7px}
    .feature-card p{font-size:0.85rem;color:var(--muted);margin:0;line-height:1.6}
    .pricing-section{max-width:460px;margin:80px auto 0;padding:0 20px;text-align:center}
    .pricing-card{background:var(--bg2);border:1px solid var(--border2);border-radius:20px;padding:36px;position:relative;box-shadow:0 8px 48px rgba(0,0,0,0.4)}
    .pricing-card::before{content:'';position:absolute;inset:0;border-radius:20px;background:linear-gradient(135deg,rgba(61,126,246,0.06),rgba(139,92,246,0.06));pointer-events:none}
    .price-tag{font-family:var(--font-display);font-size:3.2rem;font-weight:800;letter-spacing:-0.03em}
    .price-tag sup{font-size:1.4rem;vertical-align:top;margin-top:10px}
    .price-tag sub{font-size:1rem;font-weight:500;color:var(--muted)}
    .price-features{list-style:none;margin:24px 0;text-align:left}
    .price-features li{padding:9px 0;border-bottom:1px solid var(--border);font-size:0.88rem;display:flex;align-items:center;gap:10px}
    .price-features li:last-child{border-bottom:none}
    .price-features li::before{content:'✓';color:var(--green);font-weight:800}
    .land-nav{position:fixed;top:0;left:0;right:0;background:rgba(8,10,15,0.8);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 32px;height:58px;display:flex;align-items:center;z-index:100}
    .land-nav-brand{font-family:var(--font-display);font-weight:800;font-size:1.1rem;display:flex;align-items:center;gap:9px}
    .land-nav-right{margin-left:auto;display:flex;gap:10px;align-items:center}
    footer{text-align:center;padding:40px 20px;color:var(--muted);font-size:0.82rem;margin-top:80px;border-top:1px solid var(--border)}
    footer a{color:var(--muted)}footer a:hover{color:var(--text)}
    @media(max-width:768px){.features{grid-template-columns:1fr}.hero{padding-top:100px}}
  </style></head><body>
  <nav class="land-nav">
    <div class="land-nav-brand"><div class="logo-mark" style="width:30px;height:30px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(61,126,246,0.45)">${logoSvg}</div>LexLead</div>
    <div class="land-nav-right">
      <a href="/login" class="btn btn-secondary btn-sm">Einloggen</a>
      <a href="/login?tab=register" class="btn btn-primary btn-sm">Kostenlos testen</a>
    </div>
  </nav>
  <section class="hero" style="padding-top:100px">
    <div class="hero-badge">✦ KI-gestützte Lead-Qualifizierung</div>
    <h1>Nie wieder Zeit<br>mit <span class="gradient">schlechten Leads</span> verschwenden</h1>
    <p>LexLead filtert eingehende Immobilien-Anfragen automatisch, bewertet jeden Lead per KI und erstellt fertige Antwort-Entwürfe — in Sekunden.</p>
    <div class="hero-cta">
      <a href="/login?tab=register" class="btn btn-upgrade btn-lg">30 Tage kostenlos testen →</a>
      <a href="#features" class="btn btn-secondary btn-lg">Mehr erfahren</a>
    </div>
  </section>
  <section class="features" id="features">
    ${[['🤖','KI-Scoring 1–10','Claude analysiert Kaufabsicht, Finanzierung und Zeitrahmen jeder Anfrage automatisch.'],['✉','Alle Portale','ImmoScout24, Immowelt, Kleinanzeigen, Gmail, Outlook, iCloud — ein System für alles.'],['⚡','Antwort in 1 Klick','Fertige Antwort-Entwürfe per KI. Kopieren, anpassen, senden — fertig.'],['📅','Kalender & Termine','Besichtigungen, Anrufe, Fristen — direkt aus dem Lead heraus erstellen.'],['🔔','Wiedervorlage','Kein Lead geht vergessen. Wiedervorlage setzen, Erinnerung erhalten.'],['📊','Dashboard','Überblick über alle Leads, Scores und Konversionsraten auf einen Blick.']].map(([i,h,p])=>`
    <div class="feature-card"><div class="feature-icon">${i}</div><h3>${h}</h3><p>${p}</p></div>`).join('')}
  </section>
  <section class="pricing-section">
    <div style="font-family:var(--font-display);font-weight:800;font-size:1.3rem;margin-bottom:8px">Einfaches Pricing</div>
    <p style="color:var(--muted);font-size:0.9rem;margin-bottom:24px">Ein Plan, ein Preis. Keine versteckten Kosten.</p>
    <div class="pricing-card">
      <div class="price-tag"><sup>€</sup>149<sub>/Monat</sub></div>
      <p style="color:var(--muted);margin:8px 0 0;font-size:0.88rem">Pro Maklerbüro · Jederzeit kündbar</p>
      <ul class="price-features">
        ${['Unbegrenzte Leads & Postfächer','KI-Analyse mit Claude Sonnet','Automatischer E-Mail-Abruf','Gmail, Outlook, iCloud & mehr','Kalender & Wiedervorlage','Antwort-Entwürfe per KI'].map(f=>`<li>${f}</li>`).join('')}
      </ul>
      <a href="/login?tab=register" class="btn btn-upgrade btn-lg" style="width:100%;justify-content:center">30 Tage kostenlos starten →</a>
      <p style="color:var(--muted);font-size:0.78rem;margin-top:12px">Nach Trial: 149€/Monat · Keine Kreditkarte für Trial nötig</p>
    </div>
  </section>
  <footer>
    <p style="margin-bottom:8px">© 2026 LexLead · Patrick Rümmler</p>
    <p><a href="/legal">Impressum & Datenschutz</a></p>
  </footer>
  </body></html>`);
});

// ─── LEGAL ────────────────────────────────────────────────────────────────────
app.get('/legal', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Impressum, AGB & Datenschutz – LexLead</title>${baseStyles}<style>
    .legal-nav{background:var(--bg2);border-bottom:1px solid var(--border);padding:0 24px;height:58px;display:flex;align-items:center}
    .legal-nav-brand{font-family:var(--font-display);font-weight:800;font-size:1.1rem;display:flex;align-items:center;gap:9px}
    .legal-nav-right{margin-left:auto}
    .page{max-width:760px}
    h1{font-family:var(--font-display);font-size:1.6rem;font-weight:800;margin-bottom:6px}
    h2{font-family:var(--font-display);font-size:1rem;font-weight:700;margin:28px 0 8px;color:var(--accent2)}
    p{color:#c0c8da;font-size:0.9rem;margin-bottom:10px;line-height:1.75}
    ul{color:#c0c8da;font-size:0.9rem;padding-left:20px;margin-bottom:12px}
    ul li{margin-bottom:5px}
    .info-block{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:18px 22px;margin-bottom:10px}
    .info-block .info-label{font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:4px;font-family:var(--font-display)}
    .info-block p{margin:0;color:var(--text)}
    .tabs{display:flex;gap:8px;margin-bottom:32px;flex-wrap:wrap}
    .tab{padding:8px 18px;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-size:0.85rem;border:1px solid var(--border2);color:var(--muted);background:transparent;font-family:var(--font-display);transition:all 0.15s}
    .tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
    .pane{display:none}.pane.active{display:block}
  </style></head><body>
  <nav class="legal-nav">
    <div class="legal-nav-brand"><div style="width:30px;height:30px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center">${logoSvg}</div>LexLead</div>
    <div class="legal-nav-right"><a href="/" class="btn btn-secondary btn-sm">← Zurück</a></div>
  </nav>
  <div class="page" style="padding:40px 20px 80px">
    <div class="tabs">
      <button class="tab active" onclick="showTab('impressum',this)">Impressum</button>
      <button class="tab" onclick="showTab('agb',this)">AGB</button>
      <button class="tab" onclick="showTab('datenschutz',this)">Datenschutz</button>
    </div>
    <div id="impressum" class="pane active">
      <h1>Impressum</h1>
      <p style="color:var(--muted);margin-bottom:28px">Angaben gemäß § 5 TMG</p>
      <div class="info-block"><div class="info-label">Anbieter</div><p>Patrick Rümmler</p></div>
      <div class="info-block"><div class="info-label">Anschrift</div><p>Ossietzkystraße 11C<br>13187 Berlin<br>Deutschland</p></div>
      <div class="info-block"><div class="info-label">Kontakt</div><p>E-Mail: <a href="mailto:lpruemmler@gmail.com">lpruemmler@gmail.com</a></p></div>
      <h2>Verantwortlich für den Inhalt</h2><p>Patrick Rümmler, Ossietzkystraße 11C, 13187 Berlin</p>
      <h2>Hinweis zur Umsatzsteuer</h2><p>Patrick Rümmler ist Kleinunternehmer im Sinne von § 19 UStG. Es wird daher keine Umsatzsteuer berechnet und ausgewiesen.</p>
      <h2>Streitschlichtung</h2><p>Die EU-Kommission stellt eine Plattform zur Online-Streitbeilegung bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank">ec.europa.eu/consumers/odr</a>. Wir nehmen nicht an Streitbeilegungsverfahren teil.</p>
    </div>
    <div id="agb" class="pane">
      <h1>Allgemeine Geschäftsbedingungen</h1>
      <p style="color:var(--muted);margin-bottom:28px">Stand: Mai 2026 · LexLead · Patrick Rümmler</p>
      <h2>§ 1 Geltungsbereich</h2><p>Diese AGB gelten für alle Verträge zwischen Patrick Rümmler, Ossietzkystraße 11C, 13187 Berlin und den Nutzern der SaaS-Plattform LexLead.</p>
      <h2>§ 2 Leistungsbeschreibung</h2><p>LexLead ist eine webbasierte Software (SaaS) zur KI-gestützten Analyse eingehender E-Mail-Anfragen für Immobilienmakler.</p>
      <h2>§ 3 Testphase</h2><p>Neukunden erhalten 30 Tage kostenlos. Danach wird der Zugang gesperrt bis ein Abo abgeschlossen wird.</p>
      <h2>§ 4 Preise und Zahlung</h2><p>149,00 Euro/Monat pro Maklerbüro. Zahlung monatlich im Voraus über Stripe. Kleinunternehmer gem. § 19 UStG — keine USt.</p>
      <h2>§ 5 Kündigung</h2><p>Jederzeit zum Monatsende kündbar per Stripe-Portal oder E-Mail an lpruemmler@gmail.com.</p>
      <h2>§ 6 Haftung</h2><p>KI-Analysen sind Empfehlungen ohne Gewähr. Haftung für leichte Fahrlässigkeit auf 3-fachen Monatsbeitrag begrenzt.</p>
      <h2>§ 7 Schlussbestimmungen</h2><p>Deutsches Recht. Gerichtsstand Berlin.</p>
    </div>
    <div id="datenschutz" class="pane">
      <h1>Datenschutzerklärung</h1>
      <p style="color:var(--muted);margin-bottom:28px">Stand: Mai 2026 · Verantwortlicher: Patrick Rümmler</p>
      <h2>1. Verantwortlicher</h2><p>Patrick Rümmler, Ossietzkystraße 11C, 13187 Berlin · lpruemmler@gmail.com</p>
      <h2>2. Erhobene Daten</h2>
      <ul>
        <li><strong>Registrierungsdaten:</strong> Name, E-Mail, Firma</li>
        <li><strong>E-Mail-Zugangsdaten (IMAP/OAuth2):</strong> zur Postfach-Verbindung</li>
        <li><strong>Lead-Daten:</strong> E-Mail-Inhalte zur KI-Analyse</li>
        <li><strong>Zahlungsdaten:</strong> nur durch Stripe verarbeitet</li>
      </ul>
      <h2>3. Dritte</h2>
      <ul>
        <li><strong>Anthropic (USA)</strong> — KI-Analyse (SCC)</li>
        <li><strong>Stripe (USA)</strong> — Zahlung, PCI-DSS (SCC)</li>
        <li><strong>Microsoft (USA)</strong> — Outlook OAuth2 (SCC)</li>
        <li><strong>Resend (USA)</strong> — E-Mail-Versand (SCC)</li>
        <li><strong>Render (USA)</strong> — Hosting (SCC)</li>
      </ul>
      <h2>4. Rechte</h2><p>Auskunft, Berichtigung, Löschung gem. DSGVO Art. 15–21. Kontakt: lpruemmler@gmail.com</p>
      <h2>5. Cookies</h2><p>Nur technisch notwendige Session-Cookies. Kein Tracking.</p>
    </div>
  </div>
  <script>
    function showTab(id,el){document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.getElementById(id).classList.add('active');el.classList.add('active')}
    if(location.hash==='#agb')showTab('agb',document.querySelectorAll('.tab')[1]);
    if(location.hash==='#datenschutz')showTab('datenschutz',document.querySelectorAll('.tab')[2]);
  </script>
  </body></html>`);
});

// ─── UPGRADE PAGE ─────────────────────────────────────────────────────────────
app.get('/upgrade', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const reason = req.query.reason || 'trial';
  const messages = {
    trial:    {title:'Dein Trial ist abgelaufen', sub:'30 Tage kostenlos — deine Zeit ist um.'},
    expired:  {title:'Abo abgelaufen',            sub:'Bitte erneuere dein Abonnement.'},
    cancelled:{title:'Abo gekündigt',             sub:'Du kannst es jederzeit reaktivieren.'},
  };
  const msg = messages[reason] || messages.trial;
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Upgrade – LexLead</title>${baseStyles}</head><body>
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(ellipse 70% 50% at 50% 0%,rgba(61,126,246,0.12) 0%,transparent 60%)">
    <div style="width:100%;max-width:460px;text-align:center">
      <div style="font-size:3rem;margin-bottom:16px">🔒</div>
      <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;margin-bottom:8px">${msg.title}</div>
      <p style="color:var(--muted);margin-bottom:36px">${msg.sub}</p>
      <div class="card" style="text-align:left;margin-bottom:20px">
        <div style="font-family:var(--font-display);font-size:2.5rem;font-weight:800;text-align:center;margin-bottom:4px">€149<span style="font-size:1rem;font-weight:500;color:var(--muted)">/Monat</span></div>
        <p style="text-align:center;color:var(--muted);font-size:0.85rem;margin-bottom:20px">Pro Maklerbüro · Jederzeit kündbar</p>
        <ul style="list-style:none;margin-bottom:20px">
          ${['Unbegrenzte Leads','KI-Scoring mit Claude','Alle Postfächer','Kalender & Wiedervorlage','Antwort-Entwürfe'].map(f=>`<li style="padding:8px 0;border-bottom:1px solid var(--border);font-size:0.88rem;display:flex;align-items:center;gap:10px"><span style="color:var(--green);font-weight:800">✓</span>${f}</li>`).join('')}
        </ul>
        <button onclick="startCheckout()" id="upgradeBtn" class="btn btn-upgrade btn-lg" style="width:100%;justify-content:center">Jetzt für 149€/Monat freischalten</button>
      </div>
      <a href="/logout" style="color:var(--muted);font-size:0.82rem">Logout</a>
    </div>
  </div>
  ${toastScript}
  <script>
    async function startCheckout(){
      const btn=document.getElementById('upgradeBtn');
      btn.disabled=true;btn.textContent='⏳ Weiterleitung zu Stripe…';
      try{const r=await fetch('/api/create-checkout',{method:'POST'});const d=await r.json();
        if(d.ok&&d.url)window.location.href=d.url;
        else{showToast(d.error||'Fehler','error');btn.disabled=false;btn.textContent='Jetzt für 149€/Monat freischalten';}
      }catch{showToast('Netzwerkfehler','error');btn.disabled=false;btn.textContent='Jetzt für 149€/Monat freischalten';}
    }
  </script></body></html>`);
});

// ─── LOGIN / REGISTER ─────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login – LexLead</title>${baseStyles}<style>
    .auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(ellipse 60% 50% at 50% -10%,rgba(61,126,246,0.15) 0%,transparent 55%)}
    .auth-box{width:100%;max-width:400px}
    .auth-logo{text-align:center;margin-bottom:28px}
    .auth-logo h1{font-family:var(--font-display);font-size:1.8rem;font-weight:800;letter-spacing:-0.02em}
    .auth-logo p{color:var(--muted);font-size:0.88rem;margin-top:5px}
    .auth-card{background:var(--bg2);border:1px solid var(--border2);border-radius:18px;padding:30px}
    .auth-tabs{display:flex;gap:6px;margin-bottom:22px}
    .auth-tab{flex:1;padding:9px;text-align:center;border-radius:var(--radius-sm);cursor:pointer;font-weight:700;font-size:0.85rem;border:1px solid var(--border2);color:var(--muted);background:transparent;font-family:var(--font-display);transition:all 0.15s}
    .auth-tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
    .pane{display:none}.pane.active{display:block}
  </style></head><body>
  <div class="auth-page"><div class="auth-box">
    <div class="auth-logo"><h1>⬟ LexLead</h1><p>KI-Filter für Immobilien-Anfragen</p></div>
    <div class="auth-card">
      <div class="auth-tabs">
        <button class="auth-tab active" onclick="showTab('login',this)">Einloggen</button>
        <button class="auth-tab" onclick="showTab('register',this)">Registrieren</button>
      </div>
      ${req.query.error   ?`<div class="alert alert-error">${req.query.error}</div>`:''}
      ${req.query.success ?`<div class="alert alert-success">${req.query.success}</div>`:''}
      <div id="login" class="pane active">
        <form method="POST" action="/login">
          <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required autofocus></div>
          <div class="form-group"><label>Passwort</label><input type="password" name="password" placeholder="••••••••" required></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px">Einloggen</button>
        </form>
        <div style="text-align:center;margin-top:14px"><a href="/forgot-password" style="color:var(--muted);font-size:0.82rem">Passwort vergessen?</a></div>
      </div>
      <div id="register" class="pane">
        <form method="POST" action="/register">
          <div class="form-group"><label>Name</label><input type="text" name="name" placeholder="Max Mustermann" required></div>
          <div class="form-group"><label>Maklerbüro (optional)</label><input type="text" name="firma" placeholder="Immobilien GmbH"></div>
          <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required></div>
          <div class="form-group"><label>Passwort</label><input type="password" name="password" placeholder="Min. 6 Zeichen" required minlength="6"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px">30 Tage kostenlos testen</button>
        </form>
      </div>
    </div>
    <p style="text-align:center;color:var(--muted);font-size:0.76rem;margin-top:14px">149€/Monat nach Trial · <a href="/legal" style="color:var(--muted)">Impressum</a></p>
  </div></div>
  <script>
    function showTab(id,el){document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));document.getElementById(id).classList.add('active');el.classList.add('active')}
    if(location.search.includes('tab=register'))showTab('register',document.querySelectorAll('.auth-tab')[1]);
  </script></body></html>`);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.getUserByEmail(email?.toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.redirect('/login?error=E-Mail+oder+Passwort+falsch');
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/register', async (req, res) => {
  const { name, email, password, firma } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.redirect('/login?tab=register&error=Bitte+alle+Felder+ausfüllen');
  if (db.getUserByEmail(email.toLowerCase().trim()))
    return res.redirect('/login?error=E-Mail+bereits+registriert');
  const hash = await bcrypt.hash(password, 10);
  const user = db.createUser(name, email.toLowerCase().trim(), hash, firma);
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login?success=Erfolgreich+ausgeloggt'); });

// ─── PASSWORT VERGESSEN ───────────────────────────────────────────────────────
app.get('/forgot-password', (req, res) => {
  const resendOk = !!resend;
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Passwort vergessen – LexLead</title>${baseStyles}</head><body>
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">
    <div style="width:100%;max-width:400px">
      <a href="/login" class="btn btn-secondary btn-sm" style="margin-bottom:20px">← Zurück</a>
      <div class="card">
        <div style="font-family:var(--font-display);font-weight:800;font-size:1.1rem;margin-bottom:16px">Passwort zurücksetzen</div>
        ${req.query.sent
          ? `<div class="alert alert-success">✉️ Reset-Code gesendet${resendOk ? ' — schau in dein Postfach' : ' — sieh in den Server-Logs nach (Resend nicht konfiguriert)'}.</div>`
          : ''}
        ${req.query.error ? `<div class="alert alert-error">${req.query.error}</div>` : ''}
        ${!req.query.sent ? `
        <form method="POST" action="/forgot-password">
          <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required autofocus></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">Code anfordern</button>
        </form>` : `
        <form method="POST" action="/reset-password">
          <div class="form-group"><label>E-Mail</label><input type="email" name="email" placeholder="makler@beispiel.de" required autofocus></div>
          <div class="form-group"><label>Reset-Code (aus der E-Mail)</label><input type="text" name="code" placeholder="z.B. A3F9X2K1" required style="text-transform:uppercase"></div>
          <div class="form-group"><label>Neues Passwort</label><input type="password" name="password" placeholder="Min. 6 Zeichen" required minlength="6"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">Passwort ändern</button>
        </form>`}
      </div>
    </div>
  </div></body></html>`);
});

app.post('/forgot-password', async (req, res) => {
  const user = db.getUserByEmail(req.body.email?.toLowerCase().trim());
  if (user) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    db.setResetCode(user.id, code);
    console.log(`🔑 PASSWORT-RESET CODE für ${user.email}: ${code}`);
    await sendResetEmail(user, code);
  }
  // Immer redirect — kein Hinweis ob E-Mail existiert (Security)
  res.redirect('/forgot-password?sent=1');
});

app.post('/reset-password', async (req, res) => {
  const { email, code, password } = req.body;
  const user = db.getUserByEmail(email?.toLowerCase().trim());
  if (!user) return res.redirect('/forgot-password?error=E-Mail+nicht+gefunden');
  const entry = db.getUserByResetCode(code?.toUpperCase());
  if (!entry || entry.id !== user.id)
    return res.redirect('/forgot-password?sent=1&error=Code+ungültig+oder+abgelaufen');
  const hash = await bcrypt.hash(password, 10);
  db.updatePassword(user.id, hash);
  db.clearResetCode(user.id);
  res.redirect('/login?success=Passwort+erfolgreich+geändert');
});

// ─── OUTLOOK OAUTH2 ───────────────────────────────────────────────────────────
app.get('/auth/outlook', auth, (req, res) => {
  if (!msalClient) return res.redirect('/einstellungen?msg=Outlook+OAuth2+nicht+konfiguriert&error=1');
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.MICROSOFT_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(APP_URL+'/auth/outlook/callback')}&scope=https%3A%2F%2Foutlook.office.com%2FIMAP.AccessAsUser.All+offline_access+openid+email+profile&state=${req.session.userId}`;
  res.redirect(url);
});

app.get('/auth/outlook/callback', auth, async (req, res) => {
  const { code, state } = req.query;
  if (!code || !msalClient) return res.redirect('/einstellungen?msg=OAuth+Fehler&error=1');
  try {
    const result = await msalClient.acquireTokenByCode({
      code,
      scopes: ['https://outlook.office.com/IMAP.AccessAsUser.All','offline_access','openid','email','profile'],
      redirectUri: APP_URL + '/auth/outlook/callback',
    });
    const email = result.account?.username || result.idTokenClaims?.email || result.idTokenClaims?.preferred_username;
    if (!email) return res.redirect('/einstellungen?msg=E-Mail+konnte+nicht+ermittelt+werden&error=1');
    db.addEmailAccount(
      req.session.userId,
      'Outlook – ' + email,
      email,
      result.accessToken,
      'outlook.office365.com',
      993,
      true
    );
    res.redirect('/einstellungen?msg=Outlook+erfolgreich+verbunden');
  } catch (err) {
    console.error('Outlook OAuth Fehler:', err.message);
    res.redirect('/einstellungen?msg=Outlook+Verbindung+fehlgeschlagen&error=1');
  }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
app.get('/dashboard', subscriptionGuard, (req, res) => {
  const user           = db.getUserById(req.session.userId);
  const stats          = db.getLeadStats(req.session.userId);
  const topLeads       = db.getLeads(req.session.userId, { limit: 5 });
  const wiedervorlagen = db.getWiedervorlagen(req.session.userId);
  const accounts       = db.getEmailAccounts(req.session.userId);

  const scorePill = s=>`<span class="score-pill ${s>=7?'score-high':s>=4?'score-mid':s>0?'score-low':'score-none'}">${s||'?'}</span>`;
  const statusBadge = s=>{const m={neu:['badge-blue','Neu'],beantwortet:['badge-green','Beantwortet'],abgelehnt:['badge-red','Abgelehnt'],warten:['badge-yellow','Warten']};const[c,l]=m[s]||['badge-gray',s];return`<span class="badge ${c}">${l}</span>`};
  const heute = new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard – LexLead</title>${baseStyles}</head><body>
  ${navbar('dashboard',user,req.trialDaysLeft)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><div class="page-title">Guten Tag, ${user.name.split(' ')[0]} 👋</div><div class="page-sub">${heute} · ${stats.heute} neue Leads heute</div></div>
      <button onclick="checkNow(this)" class="btn btn-secondary">↻ Jetzt abrufen</button>
    </div>
    ${accounts.length===0?`<div class="alert alert-info mb-4">ℹ️ Noch kein E-Mail-Account verbunden. <a href="/einstellungen" style="font-weight:700">Jetzt verbinden →</a></div>`:''}
    ${wiedervorlagen.length>0?`
    <div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.18);border-radius:var(--radius);padding:16px 20px;margin-bottom:20px">
      <div style="font-weight:700;color:var(--yellow);margin-bottom:10px;font-family:var(--font-display)">⏰ ${wiedervorlagen.length} Wiedervorlage${wiedervorlagen.length>1?'n':''} heute fällig</div>
      ${wiedervorlagen.slice(0,3).map(l=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(245,158,11,0.1)">
        ${scorePill(l.score)}
        <div style="flex:1"><div style="font-weight:600;font-size:0.88rem">${l.from_name||l.from_email}</div><div class="text-sm text-muted">${l.subject}</div></div>
        <a href="/leads/${l.id}" class="btn btn-secondary btn-sm">Öffnen</a>
      </div>`).join('')}
    </div>`:''}
    <div class="grid-4 mb-4">
      <div class="stat-card" style="--accent-line:var(--accent)"><div class="stat-value">${stats.gesamt}</div><div class="stat-label">Leads gesamt</div><div class="stat-sub">${stats.heute} heute neu</div></div>
      <div class="stat-card" style="--accent-line:var(--green)"><div class="stat-value" style="color:var(--green)">${stats.hoch}</div><div class="stat-label">Score ≥ 7</div><div class="stat-sub">Hohe Priorität</div></div>
      <div class="stat-card" style="--accent-line:var(--yellow)"><div class="stat-value" style="color:var(--yellow)">${stats.mittel}</div><div class="stat-label">Score 4–6</div><div class="stat-sub">Mittlere Priorität</div></div>
      <div class="stat-card" style="--accent-line:var(--purple)"><div class="stat-value" style="color:var(--accent)">${stats.beantwortet}</div><div class="stat-label">Beantwortet</div><div class="stat-sub">Quote: ${stats.gesamt>0?Math.round(stats.beantwortet/stats.gesamt*100):0}%</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-weight:700;font-family:var(--font-display)">Top Leads</div>
          <a href="/leads" class="btn btn-secondary btn-sm">Alle anzeigen</a>
        </div>
        ${topLeads.length===0?`<div class="empty-state" style="padding:30px 0"><div class="icon">📭</div><p>Noch keine Leads</p></div>`:`
        <table><thead><tr><th>Score</th><th>Kontakt</th><th>Portal</th><th>Status</th></tr></thead><tbody>
          ${topLeads.map(l=>`<tr style="cursor:pointer" onclick="location.href='/leads/${l.id}'">
            <td>${scorePill(l.score)}</td>
            <td><div style="font-weight:600">${l.from_name||'–'}</div><div class="text-sm text-muted" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</div></td>
            <td><span class="badge badge-blue">${l.portal}</span></td>
            <td>${statusBadge(l.status)}</td>
          </tr>`).join('')}
        </tbody></table>`}
      </div>
      <div class="card">
        <div style="font-weight:700;font-family:var(--font-display);margin-bottom:16px">Verteilung</div>
        ${stats.gesamt>0?[['Hoch (≥7)','hoch','var(--green)'],['Mittel (4–6)','mittel','var(--yellow)'],['Niedrig (1–3)','niedrig','var(--red)']].map(([label,key,color])=>`
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span class="text-sm">${label}</span><span class="text-sm" style="color:${color}">${stats[key]}</span></div>
          <div class="score-bar"><div class="score-fill" style="width:${Math.round(stats[key]/stats.gesamt*100)}%;background:${color}"></div></div>
        </div>`).join(''):`<div class="text-muted text-sm">Noch keine Daten.</div>`}
        <div class="divider"></div>
        <div style="font-weight:700;font-family:var(--font-display);margin-bottom:12px">Verbundene Postfächer</div>
        ${accounts.length===0?`<div class="text-muted text-sm">Kein Postfach verbunden</div>`:
          accounts.map(a=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="width:7px;height:7px;border-radius:50%;background:var(--green)"></div>
            <div style="flex:1"><div style="font-weight:600;font-size:0.88rem">${a.label||a.email}</div><div class="text-sm text-muted">${a.email}</div></div>
          </div>`).join('')}
      </div>
    </div>
  </div>
  ${toastScript}
  <script>
    async function checkNow(btn){
      btn.disabled=true;btn.textContent='⏳ Abruf…';
      try{const r=await fetch('/api/check-now',{method:'POST'});const d=await r.json();
        btn.textContent='✓ '+(d.neue||0)+' neue Leads';showToast((d.neue||0)+' neue Leads abgerufen');
        setTimeout(()=>location.reload(),1800);
      }catch{btn.textContent='↻ Fehler';btn.disabled=false;}
    }
  </script></body></html>`);
});

// ─── LEADS LIST ───────────────────────────────────────────────────────────────
app.get('/leads', subscriptionGuard, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const { status, portal, search, min } = req.query;
  const leads = db.getLeads(req.session.userId, {status:status||null,portal:portal||null,search:search||null,minScore:min?parseInt(min):null});

  const scorePill = s=>`<span class="score-pill ${s>=7?'score-high':s>=4?'score-mid':s>0?'score-low':'score-none'}">${s||'?'}</span>`;
  const statusBadge = s=>{const m={neu:['badge-blue','Neu'],beantwortet:['badge-green','Beantwortet'],abgelehnt:['badge-red','Abgelehnt'],warten:['badge-yellow','Warten']};const[c,l]=m[s]||['badge-gray',s];return`<span class="badge ${c}">${l}</span>`};
  const kaufBadge = k=>{const m={Hoch:'badge-green',Mittel:'badge-yellow',Niedrig:'badge-red'};return k?`<span class="badge ${m[k]||'badge-gray'}">${k}</span>`:'<span class="text-muted">–</span>'};
  const timeAgo = dt=>{if(!dt)return'';const h=Math.floor((Date.now()-new Date(dt))/3600000);if(h<1)return'Gerade eben';if(h<24)return`vor ${h}h`;return`vor ${Math.floor(h/24)}d`};

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leads – LexLead</title>${baseStyles}</head><body>
  ${navbar('leads',user,req.trialDaysLeft)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><div class="page-title">Leads</div><div class="page-sub">${leads.length} Ergebnis${leads.length!==1?'se':''}</div></div>
    </div>
    <div class="card mb-4" style="padding:14px 16px">
      <form method="GET" action="/leads" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:180px"><label>Suche</label><input name="search" placeholder="Name, E-Mail, Betreff…" value="${search||''}"></div>
        <div style="min-width:130px"><label>Status</label><select name="status"><option value="">Alle</option><option value="neu" ${status==='neu'?'selected':''}>Neu</option><option value="beantwortet" ${status==='beantwortet'?'selected':''}>Beantwortet</option><option value="warten" ${status==='warten'?'selected':''}>Warten</option><option value="abgelehnt" ${status==='abgelehnt'?'selected':''}>Abgelehnt</option></select></div>
        <div style="min-width:130px"><label>Min. Score</label><select name="min"><option value="">Alle</option><option value="7" ${min==='7'?'selected':''}>≥ 7 Hoch</option><option value="4" ${min==='4'?'selected':''}>≥ 4 Mittel+</option></select></div>
        <button type="submit" class="btn btn-primary">Filtern</button>
        ${search||status||min?`<a href="/leads" class="btn btn-secondary">Reset</a>`:''}
      </form>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${leads.length===0?`<div class="empty-state"><div class="icon">📭</div><p>Keine Leads gefunden.</p></div>`:`
      <table><thead><tr><th>Score</th><th>Kontakt</th><th>Betreff</th><th>Portal</th><th>Kaufabsicht</th><th>Status</th><th>Eingang</th></tr></thead><tbody>
        ${leads.map(l=>`<tr style="cursor:pointer" onclick="location.href='/leads/${l.id}'">
          <td>${scorePill(l.score)}</td>
          <td><div style="font-weight:600">${l.from_name||'–'}</div><div class="text-sm text-muted">${l.from_email}</div></td>
          <td style="max-width:200px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.subject}</div>${l.wiedervorlage?`<div class="text-xs" style="color:var(--yellow)">⏰ ${l.wiedervorlage}</div>`:''}</td>
          <td><span class="badge badge-blue">${l.portal}</span></td>
          <td>${kaufBadge(l.kaufabsicht)}</td>
          <td>${statusBadge(l.status)}</td>
          <td class="text-muted text-sm">${timeAgo(l.received_at)}</td>
        </tr>`).join('')}
      </tbody></table>`}
    </div>
  </div></body></html>`);
});

// ─── LEAD DETAIL ──────────────────────────────────────────────────────────────
app.get('/leads/:id', subscriptionGuard, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const lead = db.getLeadById(req.params.id, req.session.userId);
  if (!lead) return res.redirect('/leads');
  const sc = lead.score>=7?'score-high':lead.score>=4?'score-mid':lead.score>0?'score-low':'score-none';
  const kaufColor = {Hoch:'var(--green)',Mittel:'var(--yellow)',Niedrig:'var(--red)'}[lead.kaufabsicht]||'var(--muted)';

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${lead.from_name||lead.from_email} – LexLead</title>${baseStyles}</head><body>
  ${navbar('leads',user,req.trialDaysLeft)}
  <div class="page">
    <div style="margin-bottom:16px"><a href="/leads" class="btn btn-secondary btn-sm">← Zurück</a></div>
    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:start">
      <div>
        <div class="card mb-4">
          <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:20px">
            <span class="score-pill ${sc}" style="width:46px;height:46px;font-size:1.1rem;flex-shrink:0">${lead.score||'?'}</span>
            <div style="flex:1">
              <div style="font-size:1.15rem;font-weight:700;font-family:var(--font-display)">${lead.from_name||lead.from_email}</div>
              <div class="text-muted text-sm">${lead.from_email}</div>
              <div style="margin-top:8px;display:flex;gap:7px;flex-wrap:wrap">
                <span class="badge badge-blue">${lead.portal}</span>
                ${lead.objekt_ref?`<span class="badge badge-gray">Obj. #${lead.objekt_ref}</span>`:''}
              </div>
            </div>
            <select onchange="updateStatus(this.value)" style="width:auto;padding:7px 12px;min-width:140px">
              <option value="neu" ${lead.status==='neu'?'selected':''}>Neu</option>
              <option value="beantwortet" ${lead.status==='beantwortet'?'selected':''}>Beantwortet</option>
              <option value="warten" ${lead.status==='warten'?'selected':''}>Warten</option>
              <option value="abgelehnt" ${lead.status==='abgelehnt'?'selected':''}>Abgelehnt</option>
            </select>
          </div>
          <div class="divider"></div>
          <div style="font-weight:700;font-family:var(--font-display);margin-bottom:6px">Betreff</div>
          <div style="color:var(--muted2)">${lead.subject}</div>
          <div class="divider"></div>
          <div style="font-weight:700;font-family:var(--font-display);margin-bottom:14px">KI-Analyse</div>
          <div class="grid-2" style="gap:10px;margin-bottom:16px">
            ${[['Kaufabsicht',lead.kaufabsicht,kaufColor],['Finanzierung',lead.finanzierung,'var(--text)'],['Zeitrahmen',lead.zeitrahmen,'var(--text)'],['Eingang',lead.received_at?new Date(lead.received_at).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}):'–','var(--text)']].map(([lbl,val,col])=>`
            <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:13px">
              <div class="text-xs text-muted" style="margin-bottom:3px">${lbl}</div>
              <div style="font-weight:700;color:${col}">${val||'–'}</div>
            </div>`).join('')}
          </div>
          ${lead.zusammenfassung?`
          <div style="background:rgba(61,126,246,0.05);border:1px solid rgba(61,126,246,0.14);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px">
            <div style="font-size:0.72rem;font-weight:700;color:var(--accent2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;font-family:var(--font-display)">KI-Zusammenfassung</div>
            <div style="font-size:0.88rem;line-height:1.65">${lead.zusammenfassung}</div>
          </div>`:''}
          <div class="divider"></div>
          <div style="font-weight:700;font-family:var(--font-display);margin-bottom:10px">Original E-Mail</div>
          <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px;font-size:0.83rem;line-height:1.75;white-space:pre-wrap;max-height:280px;overflow-y:auto;color:var(--muted2)">${(lead.body||'').substring(0,3000)}</div>
        </div>
        ${lead.antwort_entwurf?`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-weight:700;font-family:var(--font-display)">✨ KI-Antwort-Entwurf</div>
            <button onclick="copyDraft()" class="btn btn-primary btn-sm" id="copyBtn">Kopieren</button>
          </div>
          <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:14px;font-size:0.87rem;line-height:1.7;white-space:pre-wrap" id="draftText">${lead.antwort_entwurf}</div>
        </div>`:''}
      </div>
      <div>
        <div class="card mb-4">
          <div style="font-weight:700;font-family:var(--font-display);margin-bottom:12px">📝 Notiz</div>
          <textarea id="notizText" rows="4" placeholder="Interne Notiz…">${lead.notiz||''}</textarea>
          <button onclick="saveNotiz()" class="btn btn-secondary btn-sm mt-4" style="width:100%;justify-content:center">Speichern</button>
        </div>
        <div class="card mb-4">
          <div style="font-weight:700;font-family:var(--font-display);margin-bottom:12px">⏰ Wiedervorlage</div>
          <input type="date" id="wiedervorlageDate" value="${lead.wiedervorlage||''}" min="${new Date().toISOString().split('T')[0]}">
          <button onclick="saveWiedervorlage()" class="btn btn-secondary btn-sm mt-4" style="width:100%;justify-content:center">Setzen</button>
        </div>
        <div class="card mb-4">
          <div style="font-weight:700;font-family:var(--font-display);margin-bottom:12px">📅 Termin erstellen</div>
          <div class="form-group"><label>Typ</label><select id="terminTyp"><option value="besichtigung">Besichtigung</option><option value="anruf">Anruf</option><option value="termin">Termin</option><option value="frist">Frist</option></select></div>
          <div class="form-group"><label>Datum</label><input type="date" id="terminDatum" min="${new Date().toISOString().split('T')[0]}"></div>
          <div class="form-group"><label>Uhrzeit</label><input type="time" id="terminUhrzeit"></div>
          <button onclick="createTermin()" class="btn btn-success btn-sm" style="width:100%;justify-content:center">Termin speichern</button>
        </div>
        <button onclick="if(confirm('Lead archivieren?'))fetch('/api/leads/${lead.id}/archive',{method:'POST'}).then(()=>location.href='/leads')" class="btn btn-secondary" style="width:100%;justify-content:center;color:var(--muted)">🗑 Archivieren</button>
      </div>
    </div>
  </div>
  ${toastScript}
  <script>
    const leadId=${lead.id};
    async function updateStatus(val){await fetch('/api/leads/'+leadId+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:val})});showToast('Status aktualisiert')}
    async function saveNotiz(){await fetch('/api/leads/'+leadId+'/notiz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notiz:document.getElementById('notizText').value})});showToast('Notiz gespeichert')}
    async function saveWiedervorlage(){const datum=document.getElementById('wiedervorlageDate').value;await fetch('/api/leads/'+leadId+'/wiedervorlage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datum})});showToast('Wiedervorlage gesetzt: '+datum)}
    async function createTermin(){
      const typ=document.getElementById('terminTyp').value;
      const datum=document.getElementById('terminDatum').value;
      const uhrzeit=document.getElementById('terminUhrzeit').value;
      if(!datum){showToast('Bitte Datum wählen','error');return;}
      const titel=typ.charAt(0).toUpperCase()+typ.slice(1)+' – ${(lead.from_name||lead.from_email).replace(/'/g,"\\'")}';
      await fetch('/api/termine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId,titel,typ,datum,uhrzeit})});
      showToast('Termin erstellt');
    }
    function copyDraft(){navigator.clipboard.writeText(document.getElementById('draftText').innerText);const btn=document.getElementById('copyBtn');btn.textContent='✓ Kopiert!';setTimeout(()=>btn.textContent='Kopieren',2000)}
  </script></body></html>`);
});

// ─── KALENDER ─────────────────────────────────────────────────────────────────
app.get('/kalender', subscriptionGuard, (req, res) => {
  const user = db.getUserById(req.session.userId);
  const now  = new Date();
  const year  = parseInt(req.query.year)  || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth()+1);
  const monatStr  = `${year}-${String(month).padStart(2,'0')}`;
  const termine   = db.getTermine(req.session.userId, monatStr);
  const monatName = new Date(year,month-1,1).toLocaleDateString('de-DE',{month:'long',year:'numeric'});
  const offset    = (() => { const d=new Date(year,month-1,1).getDay(); return d===0?6:d-1; })();
  const tageImMonat = new Date(year,month,0).getDate();
  const prevM=month===1?12:month-1, prevY=month===1?year-1:year;
  const nextM=month===12?1:month+1, nextY=month===12?year+1:year;
  const byDay={};
  termine.forEach(t=>{const d=parseInt(t.datum.split('-')[2]);if(!byDay[d])byDay[d]=[];byDay[d].push(t)});
  const typeColor={besichtigung:'var(--accent)',anruf:'var(--green)',termin:'var(--yellow)',frist:'var(--red)'};
  const typeIcon={besichtigung:'🏠',anruf:'📞',termin:'👔',frist:'⚠️'};
  let cells='';
  for(let i=0;i<offset;i++) cells+=`<div class="cal-cell cal-empty"></div>`;
  for(let d=1;d<=tageImMonat;d++){
    const isToday=d===now.getDate()&&month===now.getMonth()+1&&year===now.getFullYear();
    const dayT=byDay[d]||[];
    cells+=`<div class="cal-cell ${isToday?'cal-today':''}"><div class="cal-day">${d}</div>
      ${dayT.slice(0,3).map(t=>`<div class="cal-event" style="background:${typeColor[t.typ]||'var(--accent)'}18;border-left:2px solid ${typeColor[t.typ]||'var(--accent)'}" title="${t.titel}">${typeIcon[t.typ]||'📌'} ${t.uhrzeit?t.uhrzeit+' ':''}${t.titel.substring(0,18)}</div>`).join('')}
      ${dayT.length>3?`<div class="text-xs text-muted">+${dayT.length-3} mehr</div>`:''}
    </div>`;
  }

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kalender – LexLead</title>${baseStyles}</head><body>
  ${navbar('kalender',user,req.trialDaysLeft)}
  <div class="page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div><div class="page-title">Kalender</div><div class="page-sub">${termine.length} Termine in ${monatName}</div></div>
      <button onclick="document.getElementById('terminModal').classList.add('open')" class="btn btn-primary">+ Termin</button>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <a href="/kalender?year=${prevY}&month=${prevM}" class="btn btn-secondary btn-sm">← Zurück</a>
        <div style="font-weight:800;font-family:var(--font-display);font-size:1.05rem">${monatName}</div>
        <a href="/kalender?year=${nextY}&month=${nextM}" class="btn btn-secondary btn-sm">Weiter →</a>
      </div>
      <div class="cal-grid">
        ${['Mo','Di','Mi','Do','Fr','Sa','So'].map(d=>`<div class="cal-header-cell">${d}</div>`).join('')}
        ${cells}
      </div>
    </div>
    ${termine.length>0?`
    <div class="card mt-6">
      <div style="font-weight:700;font-family:var(--font-display);margin-bottom:14px">Alle Termine diesen Monat</div>
      ${termine.map(t=>`<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:1.2rem">${typeIcon[t.typ]||'📌'}</div>
        <div style="flex:1"><div style="font-weight:600">${t.titel}</div><div class="text-sm text-muted">${t.datum}${t.uhrzeit?' · '+t.uhrzeit:''}</div></div>
        <button onclick="deleteTermin(${t.id})" class="btn btn-secondary btn-sm btn-icon">✕</button>
      </div>`).join('')}
    </div>`:''}
  </div>
  <div class="modal-overlay" id="terminModal" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal">
      <div class="modal-header">Neuer Termin <button onclick="document.getElementById('terminModal').classList.remove('open')" class="btn btn-secondary btn-sm">✕</button></div>
      <div class="form-group"><label>Titel</label><input id="tTitel" placeholder="Besichtigung Musterstr. 5"></div>
      <div class="form-group"><label>Typ</label><select id="tTyp"><option value="termin">Termin</option><option value="besichtigung">Besichtigung</option><option value="anruf">Anruf</option><option value="frist">Frist</option></select></div>
      <div class="grid-2"><div class="form-group"><label>Datum</label><input type="date" id="tDatum"></div><div class="form-group"><label>Uhrzeit</label><input type="time" id="tUhrzeit"></div></div>
      <div class="form-group"><label>Notiz (optional)</label><textarea id="tNotiz" rows="2"></textarea></div>
      <button onclick="createTerminFromModal()" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px">Speichern</button>
    </div>
  </div>
  ${toastScript}
  <script>
    async function createTerminFromModal(){
      const titel=document.getElementById('tTitel').value;const datum=document.getElementById('tDatum').value;
      if(!titel||!datum){showToast('Titel und Datum erforderlich','error');return;}
      await fetch('/api/termine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({titel,typ:document.getElementById('tTyp').value,datum,uhrzeit:document.getElementById('tUhrzeit').value,notiz:document.getElementById('tNotiz').value})});
      location.reload();
    }
    async function deleteTermin(id){if(!confirm('Termin löschen?'))return;await fetch('/api/termine/'+id,{method:'DELETE'});location.reload()}
  </script></body></html>`);
});

// ─── EINSTELLUNGEN ────────────────────────────────────────────────────────────
app.get('/einstellungen', subscriptionGuard, (req, res) => {
  const user     = db.getUserById(req.session.userId);
  const accounts = db.getEmailAccounts(req.session.userId);
  const paidUntil = user.paid_until ? new Date(user.paid_until).toLocaleDateString('de-DE') : null;
  const planBadge = user.plan==='paid'
    ? `<span class="badge badge-green">✓ Aktiv bis ${paidUntil}</span>`
    : `<span class="badge badge-yellow">Trial</span>`;
  const outlookConfigured = !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Einstellungen – LexLead</title>${baseStyles}</head><body>
  ${navbar('einstellungen',user,req.trialDaysLeft)}
  <div class="page" style="max-width:740px">
    <div class="page-header"><div class="page-title">Einstellungen</div></div>
    ${req.query.msg?`<div class="alert ${req.query.error?'alert-error':'alert-success'}">${req.query.msg}</div>`:''}

    <!-- E-Mail Accounts -->
    <div class="card mb-4">
      <div style="font-weight:700;font-family:var(--font-display);font-size:1rem;margin-bottom:16px">📬 E-Mail-Postfächer</div>

      ${accounts.length>0?`<div style="margin-bottom:20px">
        ${accounts.map(a=>`<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0"></div>
          <div style="flex:1"><div style="font-weight:600">${a.label||a.email}</div><div class="text-sm text-muted">${a.email} · ${a.host}:${a.port}</div>${a.last_check?`<div class="text-xs text-muted">Zuletzt: ${new Date(a.last_check).toLocaleString('de-DE')}</div>`:''}</div>
          <button onclick="if(confirm('Account entfernen?'))fetch('/api/accounts/${a.id}',{method:'DELETE'}).then(()=>location.reload())" class="btn btn-danger btn-sm">Entfernen</button>
        </div>`).join('')}
      </div>`:`<p class="text-muted text-sm" style="margin-bottom:20px">Noch kein Postfach verbunden.</p>`}

      <!-- Schnellverbindung Outlook -->
      <div style="margin-bottom:20px">
        <div style="font-weight:700;font-family:var(--font-display);margin-bottom:10px;font-size:0.9rem">Schnellverbindung</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${outlookConfigured
            ? `<a href="/auth/outlook" class="btn btn-outlook">🏢 Mit Outlook verbinden</a>`
            : `<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:12px 16px;font-size:0.85rem;color:var(--muted)">🏢 Outlook OAuth2 — <a href="#outlook-setup" onclick="document.getElementById('outlookHint').style.display='block'">Einrichtung anzeigen</a></div>`}
        </div>

        <div id="outlookHint" style="display:none" class="hint-box mt-4">
          <div class="hint-title">🏢 Outlook / Microsoft 365 einrichten (einmalig für dich als Betreiber)</div>
          <div class="hint-step"><div class="hint-step-num">1</div><div>Gehe zu <strong>portal.azure.com</strong> → Microsoft Entra ID → App-Registrierungen → Neue Registrierung</div></div>
          <div class="hint-step"><div class="hint-step-num">2</div><div>Name: <strong>LexLead</strong> · Unterstützte Kontotypen: <strong>Alle Organisationsverzeichnisse + Microsoft-Konten</strong></div></div>
          <div class="hint-step"><div class="hint-step-num">3</div><div>Redirect URI: <strong>${APP_URL}/auth/outlook/callback</strong></div></div>
          <div class="hint-step"><div class="hint-step-num">4</div><div>Nach Erstellung: <strong>Anwendungs-ID (Client-ID)</strong> kopieren</div></div>
          <div class="hint-step"><div class="hint-step-num">5</div><div>Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel → kopieren</div></div>
          <div class="hint-step"><div class="hint-step-num">6</div><div>API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegiert → <strong>IMAP.AccessAsUser.All, offline_access, openid, email</strong></div></div>
          <div class="hint-step"><div class="hint-step-num">7</div><div>In Render als Environment Variables eintragen: <code style="background:var(--bg4);padding:2px 6px;border-radius:4px">MICROSOFT_CLIENT_ID</code> und <code style="background:var(--bg4);padding:2px 6px;border-radius:4px">MICROSOFT_CLIENT_SECRET</code></div></div>
        </div>
      </div>

      <!-- Manuell IMAP -->
      <div style="border:1px solid var(--border2);border-radius:var(--radius-sm);padding:18px">
        <div style="font-weight:700;font-family:var(--font-display);margin-bottom:6px">Manuell verbinden (IMAP)</div>
        <div class="text-sm text-muted" style="margin-bottom:14px">Für Gmail, GMX, Web.de, iCloud, T-Online, Strato, IONOS etc.</div>
        <div class="form-group">
          <label>Anbieter (Host vorausfüllen)</label>
          <select onchange="fillHost(this.value)">
            <option value="">– Wählen –</option>
            <option value="imap.gmail.com:993:gmail">Gmail</option>
            <option value="imap.gmx.net:993:standard">GMX</option>
            <option value="imap.web.de:993:standard">Web.de</option>
            <option value="imap.mail.me.com:993:icloud">iCloud</option>
            <option value="secureimap.t-online.de:993:standard">T-Online</option>
            <option value="imap.strato.de:993:standard">Strato</option>
            <option value="imap.ionos.de:993:standard">1&1 / IONOS</option>
            <option value="outlook.office365.com:993:outlook-imap">Outlook (App-Passwort)</option>
            <option value="custom:993:standard">Eigener Server</option>
          </select>
        </div>

        <div id="hintGmail" class="hint-box" style="display:none">
          <div class="hint-title">📧 Gmail — App-Passwort erforderlich</div>
          <div class="hint-step"><div class="hint-step-num">1</div><div>Gehe zu <strong>myaccount.google.com</strong> → Sicherheit</div></div>
          <div class="hint-step"><div class="hint-step-num">2</div><div>2-Faktor-Authentifizierung aktivieren (falls noch nicht aktiv)</div></div>
          <div class="hint-step"><div class="hint-step-num">3</div><div>Suche nach <strong>"App-Passwörter"</strong> → App: Mail → Gerät: Anderes → Name: LexLead</div></div>
          <div class="hint-step"><div class="hint-step-num">4</div><div>Das generierte <strong>16-stellige Passwort</strong> unten als Passwort eingeben (Leerzeichen ignorieren)</div></div>
        </div>

        <div id="hintIcloud" class="hint-box" style="display:none">
          <div class="hint-title">🍎 iCloud — App-spezifisches Passwort erforderlich</div>
          <div class="hint-step"><div class="hint-step-num">1</div><div>Gehe zu <strong>appleid.apple.com</strong> → Anmelden</div></div>
          <div class="hint-step"><div class="hint-step-num">2</div><div>Anmelden und Sicherheit → <strong>App-spezifische Passwörter</strong></div></div>
          <div class="hint-step"><div class="hint-step-num">3</div><div>+ Generieren → Name: <strong>LexLead</strong> → Passwort kopieren (Format: xxxx-xxxx-xxxx-xxxx)</div></div>
          <div class="hint-step"><div class="hint-step-num">4</div><div>E-Mail: deine <strong>@icloud.com</strong> Adresse · Host: imap.mail.me.com · Passwort: das generierte</div></div>
          <div class="hint-step"><div class="hint-step-num">5</div><div>Hinweis: 2-Faktor-Authentifizierung muss in deinem Apple-Konto aktiv sein</div></div>
        </div>

        <div id="hintOutlookImap" class="hint-box" style="display:none">
          <div class="hint-title">🏢 Outlook — Manueller IMAP-Zugang</div>
          <div class="hint-step"><div class="hint-step-num">1</div><div>Gehe zu <strong>account.microsoft.com</strong> → Sicherheit → Erweiterte Sicherheitsoptionen</div></div>
          <div class="hint-step"><div class="hint-step-num">2</div><div><strong>App-Passwörter</strong> → Neues App-Passwort erstellen</div></div>
          <div class="hint-step"><div class="hint-step-num">3</div><div>Das generierte Passwort unten eingeben. Hinweis: Nur bei Microsoft-Konten mit 2FA möglich.</div></div>
          <div class="hint-step"><div class="hint-step-num">4</div><div>Alternative: Den <strong>Outlook OAuth2-Button</strong> oben verwenden — einfacher und ohne App-Passwort.</div></div>
        </div>

        <div class="grid-2">
          <div class="form-group"><label>Label</label><input id="acc_label" placeholder="Geschäftspostfach"></div>
          <div class="form-group"><label>E-Mail</label><input id="acc_email" type="email" placeholder="makler@firma.de"></div>
        </div>
        <div class="form-group"><label>Passwort / App-Passwort</label><input id="acc_pw" type="password" placeholder="••••••••"></div>
        <div class="grid-2">
          <div class="form-group"><label>IMAP-Host</label><input id="acc_host" placeholder="imap.gmail.com"></div>
          <div class="form-group"><label>Port</label><input id="acc_port" type="number" value="993"></div>
        </div>
        <div style="display:flex;gap:10px">
          <button onclick="testAccount()" class="btn btn-secondary" id="testBtn">Verbindung testen</button>
          <button onclick="addAccount()" class="btn btn-primary" id="addBtn">Speichern</button>
        </div>
        <div id="testResult" style="margin-top:10px"></div>
      </div>
    </div>

    <!-- KI-Status -->
    <div class="card mb-4">
      <div style="font-weight:700;font-family:var(--font-display);font-size:1rem;margin-bottom:12px">🤖 KI-Analyse (Claude)</div>
      <div style="margin-top:4px">
        ${process.env.ANTHROPIC_API_KEY
          ? `<span class="badge badge-green">✓ Konfiguriert</span>`
          : `<span class="badge badge-red">✗ Fehlt — Score 5 für alle Leads (Demo-Modus)</span>`}
      </div>
      ${!process.env.ANTHROPIC_API_KEY?`<p class="text-sm text-muted mt-2">API Key unter <strong>console.anthropic.com</strong> erstellen → in Render als <code style="background:var(--bg3);padding:2px 6px;border-radius:4px">ANTHROPIC_API_KEY</code> eintragen.</p>`:''}
    </div>

    <!-- Resend Status -->
    <div class="card mb-4">
      <div style="font-weight:700;font-family:var(--font-display);font-size:1rem;margin-bottom:12px">✉️ E-Mail-Versand (Resend)</div>
      <div style="margin-top:4px">
        ${resend
          ? `<span class="badge badge-green">✓ Konfiguriert — Passwort-Reset E-Mails aktiv</span>`
          : `<span class="badge badge-red">✗ Fehlt — Reset-Codes nur in Server-Logs</span>`}
      </div>
      ${!resend?`<p class="text-sm text-muted mt-2">API Key unter <strong>resend.com</strong> erstellen → in Render als <code style="background:var(--bg3);padding:2px 6px;border-radius:4px">RESEND_API_KEY</code> eintragen. Absender-Domain in Resend verifizieren und als <code style="background:var(--bg3);padding:2px 6px;border-radius:4px">RESEND_FROM</code> setzen (z.B. <em>LexLead &lt;noreply@lexlead.de&gt;</em>).</p>`:''}
    </div>

    <!-- Profil & Abo -->
    <div class="card">
      <div style="font-weight:700;font-family:var(--font-display);font-size:1rem;margin-bottom:16px">👤 Profil & Abo</div>
      <div class="grid-2">
        <div><label>Name</label><div style="padding:8px 0;font-weight:600">${user.name}</div></div>
        <div><label>E-Mail</label><div style="padding:8px 0;color:var(--muted2)">${user.email}</div></div>
        <div><label>Firma</label><div style="padding:8px 0;color:var(--muted2)">${user.firma||'–'}</div></div>
        <div><label>Plan</label>
          <div style="padding:8px 0;display:flex;align-items:center;gap:10px">
            ${planBadge}
            ${user.plan!=='paid'?`<button onclick="startCheckout()" id="upgradeBtn" class="btn btn-upgrade btn-sm">Jetzt upgraden</button>`:''}
          </div>
        </div>
      </div>
    </div>
  </div>
  ${toastScript}
  <script>
    const hints={gmail:'hintGmail',icloud:'hintIcloud','outlook-imap':'hintOutlookImap'};
    function fillHost(val){
      Object.values(hints).forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none'});
      if(!val||val==='custom:993:standard')return;
      const parts=val.split(':');
      document.getElementById('acc_host').value=parts[0];
      document.getElementById('acc_port').value=parts[1];
      const hintKey=parts[2];
      if(hints[hintKey]){const h=document.getElementById(hints[hintKey]);if(h)h.style.display='block';}
    }
    async function testAccount(){
      const btn=document.getElementById('testBtn');const res=document.getElementById('testResult');
      btn.disabled=true;btn.textContent='⏳ Teste…';
      try{
        const r=await fetch('/api/accounts/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('acc_email').value,password:document.getElementById('acc_pw').value,host:document.getElementById('acc_host').value,port:parseInt(document.getElementById('acc_port').value)||993})});
        const d=await r.json();
        res.innerHTML=d.ok?'<div class="alert alert-success">✓ Verbindung erfolgreich!</div>':'<div class="alert alert-error">✗ '+( d.error||'Unbekannt')+'</div>';
      }catch{res.innerHTML='<div class="alert alert-error">Netzwerkfehler</div>';}
      btn.disabled=false;btn.textContent='Verbindung testen';
    }
    async function addAccount(){
      const btn=document.getElementById('addBtn');btn.disabled=true;btn.textContent='⏳ Speichere…';
      const data={label:document.getElementById('acc_label').value,email:document.getElementById('acc_email').value,password:document.getElementById('acc_pw').value,host:document.getElementById('acc_host').value,port:parseInt(document.getElementById('acc_port').value)||993};
      if(!data.email||!data.password||!data.host){alert('Pflichtfelder fehlen');btn.disabled=false;btn.textContent='Speichern';return;}
      const r=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const d=await r.json();
      if(d.ok){showToast('Postfach gespeichert');setTimeout(()=>location.reload(),1200);}
      else{showToast(d.error||'Fehler','error');btn.disabled=false;btn.textContent='Speichern';}
    }
    async function startCheckout(){
      const btn=document.getElementById('upgradeBtn');btn.disabled=true;btn.textContent='⏳…';
      try{const r=await fetch('/api/create-checkout',{method:'POST'});const d=await r.json();
        if(d.ok&&d.url)window.location.href=d.url;
        else{showToast(d.error||'Fehler','error');btn.disabled=false;btn.textContent='Jetzt upgraden';}
      }catch{showToast('Netzwerkfehler','error');btn.disabled=false;btn.textContent='Jetzt upgraden';}
    }
  </script></body></html>`);
});

// ─── PAYMENT ROUTES ───────────────────────────────────────────────────────────
app.post('/api/create-checkout', apiAuth, async (req, res) => {
  if (!stripe) return res.json({ ok: false, error: 'Stripe nicht konfiguriert' });
  const user = db.getUserById(req.session.userId);
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: user.email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/payment/cancel`,
      metadata: { userId: String(user.id) },
      subscription_data: { metadata: { userId: String(user.id) } },
    });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('Checkout Fehler:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.get('/payment/success', auth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Zahlung erfolgreich</title>${baseStyles}</head><body>
  ${navbar('dashboard',user)}
  <div style="min-height:80vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px 20px">
    <div>
      <div style="font-size:4rem;margin-bottom:20px">🎉</div>
      <div style="font-family:var(--font-display);font-size:1.6rem;font-weight:800;margin-bottom:10px">Zahlung erfolgreich!</div>
      <p style="color:var(--muted);margin-bottom:30px;max-width:400px">Dein LexLead-Account ist jetzt aktiv. Du erhältst eine Bestätigung von Stripe per E-Mail.</p>
      <a href="/dashboard" class="btn btn-primary btn-lg">Zum Dashboard →</a>
    </div>
  </div></body></html>`);
});

app.get('/payment/cancel', auth, (req, res) => {
  res.redirect('/einstellungen?msg=Zahlung+abgebrochen');
});

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.post('/api/check-now', apiAuth, async (req, res) => {
  try {
    const { checkAccount } = require('./mailer');
    const accounts = db.getEmailAccounts(req.session.userId);
    let total = 0;
    for (const acc of accounts) total += await checkAccount(acc);
    res.json({ ok: true, neue: total });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/accounts', apiAuth, (req, res) => {
  const { label, email, password, host, port } = req.body;
  if (!email || !password || !host) return res.json({ ok: false, error: 'Pflichtfelder fehlen' });
  db.addEmailAccount(req.session.userId, label, email, password, host, port||993, true);
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

  cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ Cron: E-Mail-Check…');
    await checkAllAccounts();
  });

  app.listen(PORT, () => {
    console.log(`🚀 LexLead v3.2 auf Port ${PORT}`);
    console.log(`   Stripe:    ${stripe                          ? '✅' : '⚠️  nicht konfiguriert'}`);
    console.log(`   Anthropic: ${process.env.ANTHROPIC_API_KEY  ? '✅' : '⚠️  Demo-Modus'}`);
    console.log(`   Outlook:   ${msalClient                     ? '✅' : '⚠️  OAuth2 nicht konfiguriert'}`);
    console.log(`   Resend:    ${resend                         ? '✅' : '⚠️  nicht konfiguriert (Reset-Codes nur in Logs)'}`);
    console.log(`   APP_URL:   ${APP_URL || '⚠️  nicht gesetzt'}`);
  });
}

start().catch(console.error);

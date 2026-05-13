const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { analyze } = require('./ai');
const { detectPortal, enrichPromptWithPortal } = require('./immoscout');

async function syncAccount(acc) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: acc.username, password: acc.password,
      host: acc.host, port: acc.port || 993,
      tls: acc.ssl === 1,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000, authTimeout: 10000
    });

    let fetched = 0;

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return resolve({ fetched: 0, error: err.message }); }

        const lastUid = acc.last_uid || 0;
        const criteria = lastUid > 0 ? [['UID', `${lastUid + 1}:*`]] : [['SINCE', daysAgo(14)]];

        imap.search(criteria, async (err, uids) => {
          if (err || !uids || !uids.length) { imap.end(); return resolve({ fetched: 0 }); }

          const newUids = uids.filter(u => u > lastUid);
          if (!newUids.length) { imap.end(); return resolve({ fetched: 0 }); }

          console.log(`📬 ${newUids.length} neue Mails (${acc.label})`);

          const fetch = imap.fetch(newUids, { bodies: '', markSeen: false });
          const jobs = [];

          fetch.on('message', (msg) => {
            let uid = null;
            msg.on('attributes', a => { uid = a.uid; });
            let raw = '';
            msg.on('body', s => { s.on('data', c => raw += c.toString()); });
            msg.once('end', () => jobs.push(processMsg(raw, uid, acc)));
          });

          fetch.once('end', async () => {
            await Promise.allSettled(jobs);
            const maxUid = Math.max(...newUids);
            db.run('UPDATE accounts SET last_uid=@u, last_checked=CURRENT_TIMESTAMP WHERE id=@id',
              { u: maxUid, id: acc.id });
            fetched = jobs.length;
            imap.end();
          });
        });
      });
    });

    imap.once('error', (e) => resolve({ fetched: 0, error: e.message }));
    imap.once('end', () => resolve({ fetched }));
    imap.connect();
  });
}

async function processMsg(raw, uid, acc) {
  try {
    const parsed = await simpleParser(raw);
    if (isSystemMail(parsed)) return;

    const existing = db.get('SELECT id FROM leads WHERE account_id=? AND uid=?', [acc.id, uid]);
    if (existing) return;

    const from = parsed.from?.value?.[0];
    const body = extractText(parsed);
    const id = uuidv4();

    const lead = {
      id, user_id: acc.user_id, account_id: acc.id,
      from_email: from?.address || 'unbekannt',
      from_name: from?.name || null,
      subject: parsed.subject || null,
      body, uid,
      received: (parsed.date || new Date()).toISOString(),
      status: 'new'
    };

    // Portal erkennen (ImmoScout, Immowelt, Kleinanzeigen)
    const portal = detectPortal(lead.from_email, lead.subject, lead.body);
    const enrichedBody = enrichPromptWithPortal(lead.body, portal);

    db.run(`INSERT INTO leads
      (id,user_id,account_id,from_email,from_name,subject,body,uid,received,status)
      VALUES (@id,@user_id,@account_id,@from_email,@from_name,@subject,@body,@uid,@received,@status)`,
      lead);

    // Für Analyse angereichertes Body verwenden
    const analysis = await analyze({ ...lead, body: enrichedBody });
    if (analysis) {
      // Analyse speichern
      db.run(`UPDATE leads SET
        score=@score, label=@label, summary=@summary,
        intent=@intent, financing=@financing, timeframe=@timeframe,
        action=@action, draft=@draft, analyzed=CURRENT_TIMESTAMP
        WHERE id=@id`,
        { ...analysis, id });
    } else {
      db.run('UPDATE leads SET score=5, label=@l WHERE id=@id',
        { l: 'cold', id });
    }
  } catch (e) {
    console.error('processMsg error:', e.message);
  }
}

async function testConnection(cfg) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: cfg.username, password: cfg.password,
      host: cfg.host, port: cfg.port || 993,
      tls: cfg.ssl !== 0,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000, authTimeout: 8000
    });
    imap.once('ready', () => { imap.end(); resolve({ ok: true }); });
    imap.once('error', e => resolve({ ok: false, error: e.message }));
    imap.connect();
  });
}

function isSystemMail(p) {
  const from = (p.from?.value?.[0]?.address || '').toLowerCase();
  const sub = (p.subject || '').toLowerCase();
  return ['noreply','no-reply','mailer-daemon','postmaster','newsletter'].some(x => from.includes(x))
    || ['abwesenheit','out of office','unzustellbar','automatische'].some(x => sub.includes(x));
}

function extractText(p) {
  let t = p.text || '';
  if (!t && p.html) t = p.html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return t.substring(0, 4000);
}

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d;
}

module.exports = { syncAccount, testConnection };

// mailer.js — LexLead v2.0 — IMAP E-Mail-Empfang
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const db = require('./database');
const { analyzeEmail } = require('./ai');

// ─── PORTAL-ERKENNUNG ─────────────────────────────────────────────────────────

function detectPortal(from, subject, body) {
  const text = `${from} ${subject} ${body}`.toLowerCase();

  if (text.includes('immobilienscout24') || text.includes('is24') || text.includes('@immobilienscout24.de')) return 'ImmoScout24';
  if (text.includes('immowelt') || text.includes('@immowelt.de')) return 'Immowelt';
  if (text.includes('immonet') || text.includes('@immonet.de')) return 'Immonet';
  if (text.includes('kleinanzeigen') || text.includes('ebay-kleinanzeigen') || text.includes('@kleinanzeigen.de')) return 'Kleinanzeigen';
  if (text.includes('wg-gesucht') || text.includes('@wg-gesucht.de')) return 'WG-Gesucht';
  if (text.includes('propstack') || text.includes('@propstack')) return 'Propstack';
  if (text.includes('immoworld') || text.includes('@immoworld.de')) return 'ImmoWorld';
  if (text.includes('homegate') || text.includes('@homegate.ch')) return 'Homegate';

  return 'Direkt';
}

function extractObjektRef(subject, body) {
  // ImmoScout-style: "Anfrage zu Objekt-Nr. 12345"
  const patterns = [
    /objekt[- ]?(?:nr\.?|nummer)[\s:]*(\d+)/i,
    /expose[- ]?(?:nr\.?|nummer)[\s:]*(\w+)/i,
    /referenz[\s:]*(\w+)/i,
    /angebot[\s:]*(\w+)/i,
    /#(\d{4,})/
  ];
  const text = `${subject} ${body}`;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return '';
}

// ─── IMAP VERBINDUNG ──────────────────────────────────────────────────────────

function fetchEmails(account) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: account.email,
      password: account.password,
      host: account.host,
      port: account.port || 993,
      tls: account.tls === 1,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000
    });

    const emails = [];

    imap.once('error', (err) => {
      console.error(`IMAP Fehler (${account.email}):`, err.message);
      resolve([]);
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) { imap.end(); resolve([]); return; }

        // Letzte 7 Tage
        const since = new Date();
        since.setDate(since.getDate() - 7);
        const sinceStr = since.toISOString().split('T')[0].replace(/-/g, '-');

        imap.search(['UNSEEN', ['SINCE', since]], (err, results) => {
          if (err || !results || !results.length) {
            imap.end();
            resolve([]);
            return;
          }

          const fetch = imap.fetch(results.slice(-50), { bodies: '' });

          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', chunk => { buffer += chunk.toString('utf8'); });
              stream.once('end', () => {
                emails.push(buffer);
              });
            });
          });

          fetch.once('error', (err) => { console.error('Fetch error:', err); });
          fetch.once('end', () => { imap.end(); });
        });
      });
    });

    imap.once('end', () => resolve(emails));
    imap.connect();
  });
}

// ─── HAUPTFUNKTION ────────────────────────────────────────────────────────────

async function checkAccount(account) {
  console.log(`📬 Prüfe E-Mails: ${account.email}`);
  let processed = 0;

  try {
    const rawEmails = await fetchEmails(account);

    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw);

        const fromEmail = parsed.from?.value?.[0]?.address || '';
        const fromName = parsed.from?.value?.[0]?.name || fromEmail;
        const subject = parsed.subject || '(Kein Betreff)';
        const body = parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '';
        const receivedAt = parsed.date?.toISOString() || new Date().toISOString();

        // Duplikat-Prüfung
        if (db.leadExists(account.user_id, fromEmail, subject)) continue;

        const portal = detectPortal(fromEmail, subject, body);
        const objektRef = extractObjektRef(subject, body);

        const leadId = db.createLead({
          userId: account.user_id,
          accountId: account.id,
          fromEmail,
          fromName,
          subject,
          body: body.substring(0, 5000),
          receivedAt,
          portal,
          objektRef
        });

        if (leadId) {
          const analysis = await analyzeEmail(body, fromName, subject);
          db.updateLeadAnalysis(leadId, analysis);
          processed++;
          console.log(`  ✅ Lead gespeichert: ${fromName} — Score ${analysis.score}`);
        }
      } catch (e) {
        console.error('  ❌ Parse-Fehler:', e.message);
      }
    }

    db.updateLastCheck(account.id);
  } catch (err) {
    console.error(`Fehler bei ${account.email}:`, err.message);
  }

  return processed;
}

async function checkAllAccounts() {
  const accounts = db.getAllEmailAccounts();
  let total = 0;
  for (const account of accounts) {
    total += await checkAccount(account);
  }
  console.log(`📊 E-Mail-Check abgeschlossen: ${total} neue Leads`);
  return total;
}

async function testConnection(config) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: config.email,
      password: config.password,
      host: config.host,
      port: config.port || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 8000
    });

    let success = false;

    imap.once('ready', () => {
      success = true;
      imap.end();
    });

    imap.once('error', (err) => {
      resolve({ ok: false, error: err.message });
    });

    imap.once('end', () => {
      if (success) resolve({ ok: true });
    });

    imap.connect();
  });
}

module.exports = { checkAllAccounts, checkAccount, testConnection };

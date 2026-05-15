// mailer.js — LexLead v3.0 — IMAP E-Mail-Empfang
const Imap           = require('imap');
const { simpleParser } = require('mailparser');
const db             = require('./database');
const { analyzeEmail } = require('./ai');

// ─── PORTAL-ERKENNUNG ─────────────────────────────────────────────────────────

function detectPortal(from, subject, body) {
  const text = `${from} ${subject} ${body}`.toLowerCase();
  if (text.includes('immobilienscout24') || text.includes('is24') || text.includes('@immobilienscout24.de')) return 'ImmoScout24';
  if (text.includes('immowelt')          || text.includes('@immowelt.de'))                                   return 'Immowelt';
  if (text.includes('immonet')           || text.includes('@immonet.de'))                                    return 'Immonet';
  if (text.includes('kleinanzeigen')     || text.includes('ebay-kleinanzeigen') || text.includes('@kleinanzeigen.de')) return 'Kleinanzeigen';
  if (text.includes('wg-gesucht')        || text.includes('@wg-gesucht.de'))                                 return 'WG-Gesucht';
  if (text.includes('propstack')         || text.includes('@propstack'))                                     return 'Propstack';
  if (text.includes('immoworld')         || text.includes('@immoworld.de'))                                  return 'ImmoWorld';
  if (text.includes('homegate')          || text.includes('@homegate.ch'))                                   return 'Homegate';
  return 'Direkt';
}

function extractObjektRef(subject, body) {
  const patterns = [
    /objekt[- ]?(?:nr\.?|nummer)[\s:]*(\d+)/i,
    /expose[- ]?(?:nr\.?|nummer)[\s:]*(\w+)/i,
    /referenz[\s:]*(\w+)/i,
    /angebot[\s:]*(\w+)/i,
    /#(\d{4,})/
  ];
  for (const p of patterns) {
    const m = `${subject} ${body}`.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── IMAP FETCH ───────────────────────────────────────────────────────────────

function fetchEmails(account) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user:       account.email,
      password:   account.password,
      host:       account.host,
      port:       account.port || 993,
      tls:        true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });

    const emails = [];

    imap.once('error', (err) => {
      console.error(`IMAP Fehler (${account.email}):`, err.message);
      resolve([]);
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); resolve([]); return; }

        const since = new Date();
        since.setDate(since.getDate() - 7); // Letzte 7 Tage

        imap.search(['UNSEEN', ['SINCE', since]], (err, results) => {
          if (err || !results || !results.length) {
            imap.end();
            resolve([]);
            return;
          }

          // Max 50 E-Mails pro Durchlauf
          const toFetch = results.slice(-50);
          const fetch   = imap.fetch(toFetch, { bodies: '' });

          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data',  (chunk) => { buffer += chunk.toString('utf8'); });
              stream.once('end', ()      => { emails.push(buffer); });
            });
          });

          fetch.once('error', (err) => { console.error('Fetch Fehler:', err.message); });
          fetch.once('end',   ()    => { imap.end(); });
        });
      });
    });

    imap.once('end', () => resolve(emails));
    imap.connect();
  });
}

// ─── ACCOUNT PRÜFEN ───────────────────────────────────────────────────────────

async function checkAccount(account) {
  console.log(`📬 Prüfe: ${account.email}`);
  let processed = 0;

  try {
    const rawEmails = await fetchEmails(account);

    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw);

        // Message-ID als Duplikat-Schlüssel
        const messageId = parsed.messageId || null;

        // Duplikat überspringen — prüft message_id in DB
        if (messageId && db.leadExists(messageId)) {
          continue;
        }

        const fromEmail  = parsed.from?.value?.[0]?.address || '';
        const fromName   = parsed.from?.value?.[0]?.name    || fromEmail;
        const subject    = parsed.subject                   || '(Kein Betreff)';
        const bodyText   = parsed.text
          || (parsed.html ? parsed.html.replace(/<[^>]+>/g, ' ') : '')
          || '';

        const portal    = detectPortal(fromEmail, subject, bodyText);
        const objektRef = extractObjektRef(subject, bodyText);

        // KI-Analyse — läuft vor dem Speichern
        const analysis = await analyzeEmail(bodyText, fromName, subject);

        // Alles in einem Schritt speichern
        db.createLead(account.user_id, account.id, {
          from_email:      fromEmail,
          from_name:       fromName,
          subject,
          body:            bodyText.substring(0, 5000),
          portal,
          objekt_ref:      objektRef,
          score:           analysis.score,
          kaufabsicht:     analysis.kaufabsicht,
          finanzierung:    analysis.finanzierung,
          zeitrahmen:      analysis.zeitrahmen,
          zusammenfassung: analysis.zusammenfassung,
          antwort_entwurf: analysis.antwortEntwurf,
          message_id:      messageId,
        });

        processed++;
        console.log(`  ✅ Lead: ${fromName} — Score ${analysis.score} — ${portal}`);

      } catch (e) {
        console.error('  ❌ Parse/Analyse-Fehler:', e.message);
      }
    }

    // Letzten Check-Zeitstempel aktualisieren
    db.updateAccountLastCheck(account.id);

  } catch (err) {
    console.error(`Fehler bei ${account.email}:`, err.message);
  }

  return processed;
}

// ─── ALLE ACCOUNTS (Cron-Job) ─────────────────────────────────────────────────
// Holt alle aktiven Accounts aus allen User-Datenbanken
// Nutzt eine interne DB-Query ohne User-Kontext

async function checkAllAccounts() {
  // Alle aktiven Email-Accounts über alle User holen
  const accounts = db.getAllActiveEmailAccounts();
  let total = 0;
  for (const account of accounts) {
    total += await checkAccount(account);
  }
  console.log(`📊 Check abgeschlossen: ${total} neue Leads`);
  return total;
}

// ─── VERBINDUNGSTEST ──────────────────────────────────────────────────────────

function testConnection(config) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user:       config.email,
      password:   config.password,
      host:       config.host,
      port:       config.port || 993,
      tls:        true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 8000,
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

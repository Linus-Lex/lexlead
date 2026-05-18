// database.js
const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, 'lexlead.db');
let db = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('📦 Datenbank geladen:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('📦 Neue Datenbank erstellt');
  }

  // Sauber beenden
  process.on('exit',    () => saveDB());
  process.on('SIGINT',  () => { saveDB(); process.exit(0); });
  process.on('SIGTERM', () => { saveDB(); process.exit(0); });

  // Periodisch speichern alle 60 Sekunden
  setInterval(() => saveDB(), 60 * 1000);

  createTables();
  runMigrations();
  saveDB();
  console.log('✅ Datenbank initialisiert');
  return db;
}

function saveDB() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB Speicherfehler:', e.message);
  }
}

// ─── TABLES ───────────────────────────────────────────────────────────────────

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      name                   TEXT NOT NULL,
      email                  TEXT UNIQUE NOT NULL,
      password               TEXT NOT NULL,
      firma                  TEXT,
      plan                   TEXT DEFAULT 'trial',
      subscription_status    TEXT DEFAULT 'trial',
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      paid_until             TEXT,
      reset_code             TEXT,
      reset_expires          TEXT,
      created_at             TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      label      TEXT,
      email      TEXT NOT NULL,
      password   TEXT NOT NULL,
      host       TEXT NOT NULL,
      port       INTEGER DEFAULT 993,
      active     INTEGER DEFAULT 1,
      last_check TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      account_id      INTEGER,
      from_email      TEXT,
      from_name       TEXT,
      subject         TEXT,
      body            TEXT,
      portal          TEXT DEFAULT 'Direkt',
      objekt_ref      TEXT,
      score           INTEGER DEFAULT 0,
      kaufabsicht     TEXT,
      finanzierung    TEXT,
      zeitrahmen      TEXT,
      zusammenfassung TEXT,
      antwort_entwurf TEXT,
      status          TEXT DEFAULT 'neu',
      notiz           TEXT,
      wiedervorlage   TEXT,
      message_id      TEXT UNIQUE,
      received_at     TEXT DEFAULT (datetime('now')),
      archived        INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS termine (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      lead_id    INTEGER,
      titel      TEXT NOT NULL,
      typ        TEXT DEFAULT 'termin',
      datum      TEXT NOT NULL,
      uhrzeit    TEXT,
      notiz      TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

// ─── MIGRATIONS ───────────────────────────────────────────────────────────────

function runMigrations() {
  const migrations = [
    `ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`,
    `ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`,
    `ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'trial'`,
    `ALTER TABLE users ADD COLUMN paid_until TEXT`,
    `ALTER TABLE users ADD COLUMN reset_code TEXT`,
    `ALTER TABLE users ADD COLUMN reset_expires TEXT`,
    `ALTER TABLE leads ADD COLUMN archived INTEGER DEFAULT 0`,
    `ALTER TABLE leads ADD COLUMN message_id TEXT`,
  ];
  for (const sql of migrations) {
    try { db.run(sql); } catch (e) { /* Spalte existiert bereits — ok */ }
  }
}

// ─── USERS ────────────────────────────────────────────────────────────────────

function createUser(name, email, passwordHash, firma) {
  db.run(
    `INSERT INTO users (name, email, password, firma, plan, subscription_status, created_at)
     VALUES (?, ?, ?, ?, 'trial', 'trial', datetime('now'))`,
    [name, email, passwordHash, firma || null]
  );
  saveDB();
  return getUserByEmail(email);
}

function getUserByEmail(email) {
  const stmt = db.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`);
  stmt.bind([email]);
  if (stmt.step()) return stmt.getAsObject();
  stmt.free();
  return null;
}

function getUserById(id) {
  const stmt = db.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`);
  stmt.bind([id]);
  if (stmt.step()) return stmt.getAsObject();
  stmt.free();
  return null;
}

function getUserByStripeCustomerId(customerId) {
  const stmt = db.prepare(`SELECT * FROM users WHERE stripe_customer_id = ? LIMIT 1`);
  stmt.bind([customerId]);
  if (stmt.step()) return stmt.getAsObject();
  stmt.free();
  return null;
}

function setUserPlan(userId, plan) {
  db.run(`UPDATE users SET plan = ? WHERE id = ?`, [plan, userId]);
  saveDB();
}

// ─── STRIPE / SUBSCRIPTION ────────────────────────────────────────────────────

function activateSubscription(userId, stripeSubscriptionId, stripeCustomerId, paidUntil) {
  db.run(
    `UPDATE users SET
       plan = 'paid',
       subscription_status = 'active',
       stripe_subscription_id = ?,
       stripe_customer_id = ?,
       paid_until = ?
     WHERE id = ?`,
    [stripeSubscriptionId, stripeCustomerId, paidUntil, userId]
  );
  saveDB();
  console.log(`✅ Abo aktiviert: User ${userId} bis ${paidUntil}`);
}

function renewSubscription(stripeCustomerId, paidUntil) {
  db.run(
    `UPDATE users SET
       plan = 'paid',
       subscription_status = 'active',
       paid_until = ?
     WHERE stripe_customer_id = ?`,
    [paidUntil, stripeCustomerId]
  );
  saveDB();
}

function markPaymentFailed(stripeCustomerId) {
  db.run(
    `UPDATE users SET subscription_status = 'payment_failed'
     WHERE stripe_customer_id = ?`,
    [stripeCustomerId]
  );
  saveDB();
}

function cancelSubscription(stripeCustomerId) {
  db.run(
    `UPDATE users SET plan = 'cancelled', subscription_status = 'cancelled'
     WHERE stripe_customer_id = ?`,
    [stripeCustomerId]
  );
  saveDB();
}

// ─── PASSWORT RESET ───────────────────────────────────────────────────────────

function setResetCode(userId, code) {
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 Minuten
  db.run(
    `UPDATE users SET reset_code = ?, reset_expires = ? WHERE id = ?`,
    [code, expires, userId]
  );
  saveDB();
}

function getUserByResetCode(code) {
  const stmt = db.prepare(
    `SELECT * FROM users WHERE reset_code = ? AND reset_expires > datetime('now') LIMIT 1`
  );
  stmt.bind([code]);
  if (stmt.step()) return stmt.getAsObject();
  stmt.free();
  return null;
}

function clearResetCode(userId) {
  db.run(
    `UPDATE users SET reset_code = NULL, reset_expires = NULL WHERE id = ?`,
    [userId]
  );
  saveDB();
}

function updatePassword(userId, hashedPassword) {
  db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, userId]);
  saveDB();
}

// ─── EMAIL ACCOUNTS ───────────────────────────────────────────────────────────

function getEmailAccounts(userId) {
  const stmt = db.prepare(
    `SELECT * FROM email_accounts WHERE user_id = ? AND active = 1 ORDER BY id`
  );
  stmt.bind([userId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function getAllActiveEmailAccounts() {
  const stmt = db.prepare(
    `SELECT * FROM email_accounts WHERE active = 1 ORDER BY user_id, id`
  );
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function addEmailAccount(userId, label, email, password, host, port, active) {
  db.run(
    `INSERT INTO email_accounts (user_id, label, email, password, host, port, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, label || null, email, password, host, port || 993, active ? 1 : 0]
  );
  saveDB();
}

function deleteEmailAccount(accountId, userId) {
  db.run(
    `DELETE FROM email_accounts WHERE id = ? AND user_id = ?`,
    [accountId, userId]
  );
  saveDB();
}

function updateAccountLastCheck(accountId) {
  db.run(
    `UPDATE email_accounts SET last_check = datetime('now') WHERE id = ?`,
    [accountId]
  );
  // Kein saveDB() hier — passiert im Batch am Ende
}

// ─── LEADS ───────────────────────────────────────────────────────────────────

function leadExists(messageId) {
  if (!messageId) return false;
  const stmt = db.prepare(`SELECT id FROM leads WHERE message_id = ? LIMIT 1`);
  stmt.bind([messageId]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

function createLead(userId, accountId, data) {
  db.run(
    `INSERT INTO leads
       (user_id, account_id, from_email, from_name, subject, body, portal,
        objekt_ref, score, kaufabsicht, finanzierung, zeitrahmen,
        zusammenfassung, antwort_entwurf, status, message_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'neu', ?, datetime('now'))`,
    [
      userId, accountId,
      data.from_email    || null,
      data.from_name     || null,
      data.subject       || null,
      data.body          || null,
      data.portal        || 'Direkt',
      data.objekt_ref    || null,
      data.score         || 0,
      data.kaufabsicht   || null,
      data.finanzierung  || null,
      data.zeitrahmen    || null,
      data.zusammenfassung  || null,
      data.antwort_entwurf  || null,
      data.message_id    || null,
    ]
  );
  saveDB();
}

function getLeads(userId, options = {}) {
  const { status, portal, search, minScore, limit } = options;
  let query    = `SELECT * FROM leads WHERE user_id = ? AND archived = 0`;
  const params = [userId];

  if (status)   { query += ` AND status = ?`;    params.push(status);   }
  if (portal)   { query += ` AND portal = ?`;    params.push(portal);   }
  if (minScore) { query += ` AND score >= ?`;    params.push(minScore); }
  if (search) {
    query += ` AND (from_name LIKE ? OR from_email LIKE ? OR subject LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  query += ` ORDER BY received_at DESC`;
  if (limit) { query += ` LIMIT ?`; params.push(limit); }

  const stmt = db.prepare(query);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function getLeadById(id, userId) {
  const stmt = db.prepare(`SELECT * FROM leads WHERE id = ? AND user_id = ? LIMIT 1`);
  stmt.bind([id, userId]);
  if (stmt.step()) return stmt.getAsObject();
  stmt.free();
  return null;
}

function updateLeadStatus(id, userId, status) {
  db.run(`UPDATE leads SET status = ? WHERE id = ? AND user_id = ?`, [status, id, userId]);
  saveDB();
}

function updateLeadNotiz(id, userId, notiz) {
  db.run(`UPDATE leads SET notiz = ? WHERE id = ? AND user_id = ?`, [notiz, id, userId]);
  saveDB();
}

function updateLeadWiedervorlage(id, userId, datum) {
  db.run(
    `UPDATE leads SET wiedervorlage = ? WHERE id = ? AND user_id = ?`,
    [datum || null, id, userId]
  );
  saveDB();
}

function archiveLead(id, userId) {
  db.run(`UPDATE leads SET archived = 1 WHERE id = ? AND user_id = ?`, [id, userId]);
  saveDB();
}

function getWiedervorlagen(userId) {
  const today = new Date().toISOString().split('T')[0];
  const stmt  = db.prepare(
    `SELECT * FROM leads
     WHERE user_id = ? AND wiedervorlage <= ? AND archived = 0
     ORDER BY wiedervorlage`
  );
  stmt.bind([userId, today]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─── STATS ───────────────────────────────────────────────────────────────────

function getLeadStats(userId) {
  const res = db.exec(`
    SELECT
      COUNT(*)                                                    as gesamt,
      SUM(CASE WHEN score >= 7 THEN 1 ELSE 0 END)               as hoch,
      SUM(CASE WHEN score >= 4 AND score < 7 THEN 1 ELSE 0 END) as mittel,
      SUM(CASE WHEN score > 0 AND score < 4 THEN 1 ELSE 0 END)  as niedrig,
      SUM(CASE WHEN status = 'beantwortet' THEN 1 ELSE 0 END)   as beantwortet,
      SUM(CASE WHEN date(received_at) = date('now') THEN 1 ELSE 0 END) as heute
    FROM leads WHERE user_id = ${parseInt(userId)} AND archived = 0
  `);
  if (res.length && res[0].values.length) {
    const [gesamt, hoch, mittel, niedrig, beantwortet, heute] = res[0].values[0];
    return {
      gesamt:      gesamt      || 0,
      hoch:        hoch        || 0,
      mittel:      mittel      || 0,
      niedrig:     niedrig     || 0,
      beantwortet: beantwortet || 0,
      heute:       heute       || 0,
    };
  }
  return { gesamt: 0, hoch: 0, mittel: 0, niedrig: 0, beantwortet: 0, heute: 0 };
}

// ─── TERMINE ─────────────────────────────────────────────────────────────────

function getTermine(userId, monatStr) {
  const stmt = db.prepare(
    `SELECT * FROM termine WHERE user_id = ? AND datum LIKE ? ORDER BY datum, uhrzeit`
  );
  stmt.bind([userId, `${monatStr}%`]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function createTermin(userId, leadId, titel, typ, datum, uhrzeit, notiz) {
  db.run(
    `INSERT INTO termine (user_id, lead_id, titel, typ, datum, uhrzeit, notiz)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, leadId || null, titel, typ || 'termin', datum, uhrzeit || null, notiz || null]
  );
  saveDB();
}

function deleteTermin(id, userId) {
  db.run(`DELETE FROM termine WHERE id = ? AND user_id = ?`, [id, userId]);
  saveDB();
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  initDB,
  saveDB,

  // Users
  createUser,
  getUserByEmail,
  getUserById,
  getUserByStripeCustomerId,
  setUserPlan,

  // Stripe / Subscription
  activateSubscription,
  renewSubscription,
  markPaymentFailed,
  cancelSubscription,

  // Passwort Reset
  setResetCode,
  getUserByResetCode,
  clearResetCode,
  updatePassword,

  // Email Accounts
  getEmailAccounts,
  getAllActiveEmailAccounts,
  addEmailAccount,
  deleteEmailAccount,
  updateAccountLastCheck,

  // Leads
  leadExists,
  createLead,
  getLeads,
  getLeadById,
  updateLeadStatus,
  updateLeadNotiz,
  updateLeadWiedervorlage,
  archiveLead,
  getWiedervorlagen,

  // Stats
  getLeadStats,

  // Termine
  getTermine,
  createTermin,
  deleteTermin,
};

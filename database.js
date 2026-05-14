// database.js — LexLead v2.0
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'lexlead.db');
let db = null;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      firma TEXT,
      plan TEXT DEFAULT 'trial',
      trial_ends TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      label TEXT,
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 993,
      tls INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      last_check TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      email_account_id INTEGER,
      from_email TEXT,
      from_name TEXT,
      subject TEXT,
      body TEXT,
      received_at TEXT,
      portal TEXT DEFAULT 'Unbekannt',
      objekt_ref TEXT,
      score INTEGER DEFAULT 0,
      kaufabsicht TEXT,
      finanzierung TEXT,
      zeitrahmen TEXT,
      zusammenfassung TEXT,
      antwort_entwurf TEXT,
      status TEXT DEFAULT 'neu',
      notiz TEXT,
      wiedervorlage TEXT,
      archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS termine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lead_id INTEGER,
      titel TEXT NOT NULL,
      typ TEXT DEFAULT 'termin',
      datum TEXT NOT NULL,
      uhrzeit TEXT,
      notiz TEXT,
      erledigt INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      datum TEXT NOT NULL,
      leads_gesamt INTEGER DEFAULT 0,
      leads_hoch INTEGER DEFAULT 0,
      leads_mittel INTEGER DEFAULT 0,
      leads_niedrig INTEGER DEFAULT 0,
      antworten INTEGER DEFAULT 0,
      UNIQUE(user_id, datum)
    )
  `);

  saveDB();
  console.log('✅ Datenbank initialisiert');
  return db;
}

function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── USERS ───────────────────────────────────────────────────────────────────

function createUser(name, email, password, firma) {
  db.run(
    `INSERT INTO users (name, email, password, firma, trial_ends) VALUES (?, ?, ?, ?, datetime('now', '+14 days'))`,
    [name, email, password, firma || '']
  );
  saveDB();
  return getUserByEmail(email);
}

function getUserByEmail(email) {
  const res = db.exec(`SELECT * FROM users WHERE email = ? LIMIT 1`, [email]);
  if (!res.length || !res[0].values.length) return null;
  return rowToObj(res[0]);
}

function getUserById(id) {
  const res = db.exec(`SELECT * FROM users WHERE id = ? LIMIT 1`, [id]);
  if (!res.length || !res[0].values.length) return null;
  return rowToObj(res[0]);
}

// ─── EMAIL ACCOUNTS ───────────────────────────────────────────────────────────

function addEmailAccount(userId, label, email, password, host, port, tls) {
  db.run(
    `INSERT INTO email_accounts (user_id, label, email, password, host, port, tls) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, label || email, email, password, host, port, tls ? 1 : 0]
  );
  saveDB();
}

function getEmailAccounts(userId) {
  const res = db.exec(`SELECT * FROM email_accounts WHERE user_id = ? AND active = 1 ORDER BY id`, [userId]);
  return res.length ? resToArr(res[0]) : [];
}

function getAllEmailAccounts() {
  const res = db.exec(`SELECT * FROM email_accounts WHERE active = 1`);
  return res.length ? resToArr(res[0]) : [];
}

function updateLastCheck(accountId) {
  db.run(`UPDATE email_accounts SET last_check = datetime('now') WHERE id = ?`, [accountId]);
  saveDB();
}

function deleteEmailAccount(id, userId) {
  db.run(`UPDATE email_accounts SET active = 0 WHERE id = ? AND user_id = ?`, [id, userId]);
  saveDB();
}

// ─── LEADS ───────────────────────────────────────────────────────────────────

function createLead(data) {
  db.run(
    `INSERT INTO leads (user_id, email_account_id, from_email, from_name, subject, body, received_at, portal, objekt_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.userId, data.accountId, data.fromEmail, data.fromName, data.subject,
     data.body, data.receivedAt || new Date().toISOString(), data.portal || 'Unbekannt', data.objektRef || '']
  );
  saveDB();
  // Return the newly created lead
  const res = db.exec(`SELECT id FROM leads WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [data.userId]);
  return res[0]?.values[0]?.[0];
}

function leadExists(userId, fromEmail, subject) {
  const res = db.exec(
    `SELECT id FROM leads WHERE user_id = ? AND from_email = ? AND subject = ? LIMIT 1`,
    [userId, fromEmail, subject]
  );
  return res.length > 0 && res[0].values.length > 0;
}

function updateLeadAnalysis(id, analysis) {
  db.run(
    `UPDATE leads SET score = ?, kaufabsicht = ?, finanzierung = ?, zeitrahmen = ?,
     zusammenfassung = ?, antwort_entwurf = ? WHERE id = ?`,
    [analysis.score, analysis.kaufabsicht, analysis.finanzierung, analysis.zeitrahmen,
     analysis.zusammenfassung, analysis.antwortEntwurf, id]
  );
  saveDB();
}

function getLeads(userId, filters = {}) {
  let query = `SELECT * FROM leads WHERE user_id = ? AND archived = 0`;
  const params = [userId];

  if (filters.status) { query += ` AND status = ?`; params.push(filters.status); }
  if (filters.portal) { query += ` AND portal = ?`; params.push(filters.portal); }
  if (filters.minScore) { query += ` AND score >= ?`; params.push(filters.minScore); }
  if (filters.search) {
    query += ` AND (from_name LIKE ? OR from_email LIKE ? OR subject LIKE ?)`;
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }

  query += ` ORDER BY score DESC, received_at DESC`;
  if (filters.limit) { query += ` LIMIT ?`; params.push(filters.limit); }

  const res = db.exec(query, params);
  return res.length ? resToArr(res[0]) : [];
}

function getLeadById(id, userId) {
  const res = db.exec(`SELECT * FROM leads WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!res.length || !res[0].values.length) return null;
  return rowToObj(res[0]);
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
  db.run(`UPDATE leads SET wiedervorlage = ? WHERE id = ? AND user_id = ?`, [datum, id, userId]);
  saveDB();
}

function archiveLead(id, userId) {
  db.run(`UPDATE leads SET archived = 1 WHERE id = ? AND user_id = ?`, [id, userId]);
  saveDB();
}

function getLeadStats(userId) {
  const today = new Date().toISOString().split('T')[0];
  const res = db.exec(`
    SELECT
      COUNT(*) as gesamt,
      SUM(CASE WHEN score >= 7 THEN 1 ELSE 0 END) as hoch,
      SUM(CASE WHEN score >= 4 AND score < 7 THEN 1 ELSE 0 END) as mittel,
      SUM(CASE WHEN score < 4 AND score > 0 THEN 1 ELSE 0 END) as niedrig,
      SUM(CASE WHEN status = 'beantwortet' THEN 1 ELSE 0 END) as beantwortet,
      SUM(CASE WHEN DATE(received_at) = ? THEN 1 ELSE 0 END) as heute
    FROM leads WHERE user_id = ? AND archived = 0
  `, [today, userId]);

  if (!res.length || !res[0].values.length) return { gesamt: 0, hoch: 0, mittel: 0, niedrig: 0, beantwortet: 0, heute: 0 };
  const cols = res[0].columns;
  const vals = res[0].values[0];
  const obj = {};
  cols.forEach((c, i) => obj[c] = vals[i] || 0);
  return obj;
}

function getWiedervorlagen(userId) {
  const today = new Date().toISOString().split('T')[0];
  const res = db.exec(
    `SELECT * FROM leads WHERE user_id = ? AND wiedervorlage <= ? AND wiedervorlage IS NOT NULL AND archived = 0 ORDER BY wiedervorlage`,
    [userId, today]
  );
  return res.length ? resToArr(res[0]) : [];
}

// ─── TERMINE ─────────────────────────────────────────────────────────────────

function createTermin(userId, leadId, titel, typ, datum, uhrzeit, notiz) {
  db.run(
    `INSERT INTO termine (user_id, lead_id, titel, typ, datum, uhrzeit, notiz) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, leadId || null, titel, typ || 'termin', datum, uhrzeit || '', notiz || '']
  );
  saveDB();
}

function getTermine(userId, monat) {
  let query = `SELECT * FROM termine WHERE user_id = ?`;
  const params = [userId];
  if (monat) { query += ` AND datum LIKE ?`; params.push(`${monat}%`); }
  query += ` ORDER BY datum, uhrzeit`;
  const res = db.exec(query, params);
  return res.length ? resToArr(res[0]) : [];
}

function deleteTermin(id, userId) {
  db.run(`DELETE FROM termine WHERE id = ? AND user_id = ?`, [id, userId]);
  saveDB();
}

function erledigeTermin(id, userId) {
  db.run(`UPDATE termine SET erledigt = 1 WHERE id = ? AND user_id = ?`, [id, userId]);
  saveDB();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function rowToObj(result) {
  if (!result || !result.values.length) return null;
  const obj = {};
  result.columns.forEach((col, i) => { obj[col] = result.values[0][i]; });
  return obj;
}

function resToArr(result) {
  return result.values.map(row => {
    const obj = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

module.exports = {
  initDB, saveDB,
  createUser, getUserByEmail, getUserById,
  addEmailAccount, getEmailAccounts, getAllEmailAccounts, updateLastCheck, deleteEmailAccount,
  createLead, leadExists, updateLeadAnalysis, getLeads, getLeadById,
  updateLeadStatus, updateLeadNotiz, updateLeadWiedervorlage, archiveLead,
  getLeadStats, getWiedervorlagen,
  createTermin, getTermine, deleteTermin, erledigeTermin
};

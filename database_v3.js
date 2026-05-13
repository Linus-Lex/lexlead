const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './lexlead.db';
let db = null;

async function boot() {
  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');

  run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, name TEXT NOT NULL,
    company TEXT, phone TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login TEXT
  )`);
  run(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
    host TEXT NOT NULL, port INTEGER DEFAULT 993, ssl INTEGER DEFAULT 1,
    username TEXT NOT NULL, password TEXT NOT NULL,
    last_uid INTEGER DEFAULT 0, last_checked TEXT, active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  run(`CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT,
    from_email TEXT NOT NULL, from_name TEXT, subject TEXT, body TEXT,
    received TEXT NOT NULL, uid INTEGER,
    score INTEGER, label TEXT, summary TEXT,
    intent TEXT, financing TEXT, timeframe TEXT,
    action TEXT, draft TEXT,
    analyzed TEXT, status TEXT DEFAULT 'new',
    notes TEXT, followup_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  save();
  console.log('✓ DB ready');
}

function save() {
  if (!db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function named(sql, obj) {
  const keys = [];
  const re = /@(\w+)/g; let m;
  while ((m = re.exec(sql)) !== null) keys.push(m[1]);
  return keys.map(k => obj[k] === undefined ? null : obj[k]);
}

function norm(sql, p) {
  if (!p || (Array.isArray(p) && p.length === 0)) return [];
  if (Array.isArray(p)) return p;
  if (typeof p === 'object') return named(sql, p);
  return [p];
}

function all(sql, p) {
  if (!db) return [];
  try {
    const r = db.exec(sql, norm(sql, p));
    if (!r.length) return [];
    return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]])));
  } catch (e) { console.error('DB.all', e.message); return []; }
}

function get(sql, p) {
  const rows = all(sql, p);
  return rows[0];
}

function run(sql, p) {
  if (!db) return 0;
  try {
    db.run(sql, norm(sql, p));
    save();
    return db.getRowsModified();
  } catch (e) { console.error('DB.run', e.message); return 0; }
}

module.exports = { boot, all, get, run };

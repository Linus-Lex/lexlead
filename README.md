# ⬟ LexLead v2.0

**KI-gestützter Anfragen-Filter für Immobilienmakler**

Automatischer IMAP-Abruf · KI-Analyse mit Claude · Score 1–10 · Antwort-Entwürfe

---

## 🚀 Deployment auf Render.com

### 1. GitHub Repository einrichten

```bash
git init
git add .
git commit -m "LexLead v2.0"
git remote add origin https://github.com/DEIN_NAME/lexlead.git
git push -u origin main
```

### 2. Render Web Service erstellen

1. render.com → New → Web Service
2. GitHub Repo verbinden
3. Settings:
   - **Name:** lexlead
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free (zum Testen) → später Starter ($7/mo)

### 3. Environment Variables in Render setzen

| Key | Wert |
|-----|------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (von console.anthropic.com) |
| `SESSION_SECRET` | Beliebiger langer Zufallsstring |

### 4. Deploy

Render deployed automatisch bei jedem `git push`.

---

## 💻 Lokale Entwicklung

```bash
npm install
cp .env.example .env
# .env bearbeiten und API Keys einfügen
node server.js
# → http://localhost:3000
```

---

## 📁 Dateistruktur

```
lexlead/
├── server.js       # Express App, alle Routes, HTML-Templates
├── database.js     # SQLite (sql.js) Datenbanklogik
├── ai.js           # Claude API Analyse
├── mailer.js       # IMAP E-Mail-Empfang + Portal-Erkennung
├── package.json
├── .env.example
└── .gitignore
```

---

## 🔧 Features

- **Login / Registrierung** mit 14-Tage-Trial
- **IMAP-Postfächer** verbinden (Gmail, Outlook, GMX, etc.)
- **Automatischer E-Mail-Abruf** alle 5 Minuten
- **KI-Analyse** (Claude): Score 1–10, Kaufabsicht, Finanzierung, Zeitrahmen
- **Antwort-Entwurf** per KI, 1-Klick kopieren
- **Portal-Erkennung**: ImmoScout24, Immowelt, Kleinanzeigen, etc.
- **Notizen** pro Lead
- **Wiedervorlage** mit Datum
- **Kalender** mit Terminen, Besichtigungen, Anrufen, Fristen
- **Dashboard** mit Statistiken

---

## 📧 Gmail: App-Passwort verwenden

1. Google-Konto → Sicherheit → 2-Faktor-Authentifizierung aktivieren
2. Google-Konto → Sicherheit → App-Passwörter → "Mail" → Passwort generieren
3. Dieses 16-stellige Passwort in LexLead als E-Mail-Passwort verwenden

---

## 💰 Geschäftsmodell

- **Preis:** 149€/Monat pro Büro
- **Kosten:** ~20€/Monat (Server + API)
- **Marge:** ~130€/Monat pro Kunde

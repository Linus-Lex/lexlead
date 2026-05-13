// ─── SMS-Benachrichtigungen via Twilio ───────────────────
// Sendet automatisch eine SMS wenn ein heißer Lead reinkommt

const fetch = require('node-fetch');

async function sendSMS(to, message) {
  const sid  = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from  = process.env.TWILIO_FROM;

  // Wenn Twilio nicht konfiguriert → nur loggen, kein Fehler
  if (!sid || sid.includes('HIER') || !token || !from) {
    console.log('📱 SMS (nicht gesendet, Twilio nicht konfiguriert):', message);
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
      }
    );
    const data = await res.json();
    if (data.sid) {
      console.log('✅ SMS gesendet an', to);
      return { ok: true, sid: data.sid };
    } else {
      console.error('SMS Fehler:', data.message);
      return { ok: false, error: data.message };
    }
  } catch (e) {
    console.error('SMS Fehler:', e.message);
    return { ok: false, error: e.message };
  }
}

// Wird aufgerufen nachdem ein Lead analysiert wurde
async function notifyIfHot(lead, userPhone) {
  if (!userPhone) return;
  if (lead.label !== 'hot') return;

  const name = lead.from_name || lead.from_email;
  const score = lead.score || '?';
  const action = lead.action || 'Jetzt prüfen';

  const msg =
    `🔥 Heißer Lead! Score ${score}/10\n` +
    `Von: ${name}\n` +
    `Betreff: ${(lead.subject || '').substring(0, 50)}\n` +
    `→ ${action}\n` +
    `lexlead.onrender.com`;

  await sendSMS(userPhone, msg);
}

module.exports = { sendSMS, notifyIfHot };

// ─── ImmoScout24 E-Mail Parser ───────────────────────────
// ImmoScout schickt Anfragen per E-Mail an den Makler.
// Diese Datei erkennt und parst diese E-Mails automatisch.
//
// EINRICHTUNG für den Makler (einmalig, 2 Minuten):
// ImmoScout24 → Mein Konto → Benachrichtigungen
// → Kontaktanfragen weiterleiten an: [makler@gmail.com]
// Danach kommen alle ImmoScout-Anfragen in LexLead an.

function isImmoScoutMail(from, subject, body) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  const b = (body || '').toLowerCase();

  return (
    f.includes('immobilienscout24') ||
    f.includes('is24.de') ||
    f.includes('scout24') ||
    s.includes('neue kontaktanfrage') ||
    s.includes('immobilienscout') ||
    s.includes('anfrage zu ihrer immobilie') ||
    b.includes('immobilienscout24.de') ||
    b.includes('kontaktanfrage über immobilienscout')
  );
}

function isImmoweltMail(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  return f.includes('immowelt') || f.includes('immonet') ||
    s.includes('immowelt') || s.includes('immonet');
}

function isKleinanzeigenMail(from, subject) {
  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  return f.includes('kleinanzeigen') || f.includes('ebay-kleinanzeigen') ||
    s.includes('kleinanzeigen') || s.includes('neue nachricht zu deiner anzeige');
}

// Extrahiert strukturierte Daten aus ImmoScout-Mails
function parseImmoScoutMail(body) {
  const result = {
    portal: 'ImmoScout24',
    interessent_name: null,
    interessent_email: null,
    interessent_telefon: null,
    objekt_titel: null,
    objekt_id: null,
    nachricht: null
  };

  if (!body) return result;

  // Name extrahieren
  const nameMatch = body.match(/(?:Name|Absender|Von)[\s:]+([A-ZÄÖÜ][a-zA-ZäöüÄÖÜß\s\-]+?)(?:\n|<|E-Mail)/i);
  if (nameMatch) result.interessent_name = nameMatch[1].trim();

  // E-Mail extrahieren
  const emailMatch = body.match(/[\w.\-+]+@[\w.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) result.interessent_email = emailMatch[0];

  // Telefon extrahieren
  const telMatch = body.match(/(?:Telefon|Tel|Mobil|Handy)[\s:]+([0-9\s\+\-\/\(\)]{8,20})/i);
  if (telMatch) result.interessent_telefon = telMatch[1].trim();

  // Objekt-ID extrahieren
  const idMatch = body.match(/(?:Objekt-?ID|Expose-?Nr|Anzeigen-?ID|Immobilien-?ID)[\s:]+([0-9]+)/i);
  if (idMatch) result.objekt_id = idMatch[1];

  // Objekt-Titel
  const titelMatch = body.match(/(?:Objekt|Immobilie|Anzeige)[\s:]+([^\n]{10,80})/i);
  if (titelMatch) result.objekt_titel = titelMatch[1].trim();

  // Nachricht des Interessenten
  const nachrichtMatch = body.match(/(?:Nachricht|Mitteilung|Kommentar)[\s:]*\n+([\s\S]{20,500}?)(?:\n\n|\-\-|___)/i);
  if (nachrichtMatch) result.nachricht = nachrichtMatch[1].trim();

  return result;
}

// Gibt Portal-Name zurück oder null wenn keine Portal-Mail
function detectPortal(from, subject, body) {
  if (isImmoScoutMail(from, subject, body)) return 'ImmoScout24';
  if (isImmoweltMail(from, subject)) return 'Immowelt';
  if (isKleinanzeigenMail(from, subject)) return 'Kleinanzeigen';
  return null;
}

// Ergänzt den Analyse-Prompt mit Portal-Kontext
function enrichPromptWithPortal(body, portal) {
  if (!portal) return body;

  const parsed = portal === 'ImmoScout24' ? parseImmoScoutMail(body) : null;
  const portalInfo = parsed
    ? `\n[Portal: ${portal}${parsed.objekt_id ? ` | Objekt-ID: ${parsed.objekt_id}` : ''}${parsed.interessent_telefon ? ` | Tel: ${parsed.interessent_telefon}` : ''}]\n`
    : `\n[Portal: ${portal}]\n`;

  return portalInfo + body;
}

module.exports = { detectPortal, parseImmoScoutMail, enrichPromptWithPortal };

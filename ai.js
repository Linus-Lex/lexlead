// ai.js — LexLead v2.0 — Claude Analyse
const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function analyzeEmail(emailText, fromName, subject) {
  const ai = getClient();

  if (!ai) {
    console.warn('⚠️ Kein Anthropic API Key — Demo-Analyse wird verwendet');
    return getDemoAnalysis(subject);
  }

  const prompt = `Du bist ein Experte für Immobilien-Anfragen-Analyse. Analysiere diese E-Mail und gib die Antwort NUR als JSON zurück, KEIN Markdown, KEIN Text davor oder danach.

Von: ${fromName || 'Unbekannt'}
Betreff: ${subject || ''}

Inhalt:
${emailText.substring(0, 3000)}

Analysiere und antworte ausschließlich mit diesem JSON (keine weiteren Zeichen):
{
  "score": <1-10, Kaufbereitschaft/Ernsthaftigkeit>,
  "kaufabsicht": "<Hoch|Mittel|Niedrig>",
  "finanzierung": "<Vorhanden|Unklar|Fehlt|Unbekannt>",
  "zeitrahmen": "<Sofort|3 Monate|6 Monate|Über 1 Jahr|Unbekannt>",
  "zusammenfassung": "<2-3 Sätze: Wer ist das, was wollen sie, warum dieser Score>",
  "antwortEntwurf": "<Professioneller Antwort-Entwurf auf Deutsch, 3-5 Sätze, persönlich angepasst>"
}

Score-Kriterien:
8-10: Konkreter Kaufinteressent, klares Budget, baldiger Zeitrahmen
5-7: Interessiert aber noch vage, Finanzierung unklar
1-4: Allgemeine Anfrage, kein konkretes Interesse`;

  try {
    const message = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text.trim();
    // Strip markdown fences if present
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(clean);

    return {
      score: Math.min(10, Math.max(1, parseInt(result.score) || 5)),
      kaufabsicht: result.kaufabsicht || 'Unbekannt',
      finanzierung: result.finanzierung || 'Unbekannt',
      zeitrahmen: result.zeitrahmen || 'Unbekannt',
      zusammenfassung: result.zusammenfassung || '',
      antwortEntwurf: result.antwortEntwurf || ''
    };
  } catch (err) {
    console.error('AI-Analyse Fehler:', err.message);
    return getDemoAnalysis(subject);
  }
}

function getDemoAnalysis(subject) {
  return {
    score: 5,
    kaufabsicht: 'Mittel',
    finanzierung: 'Unklar',
    zeitrahmen: 'Unbekannt',
    zusammenfassung: '[Demo-Modus] API Key nicht konfiguriert. Bitte Anthropic API Key in den Einstellungen hinterlegen.',
    antwortEntwurf: `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage bezüglich "${subject || 'unseres Angebots'}".\n\nGerne stehen wir Ihnen für weitere Informationen zur Verfügung und freuen uns auf Ihre Rückmeldung.\n\nMit freundlichen Grüßen`
  };
}

module.exports = { analyzeEmail };

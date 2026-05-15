// ai.js — LexLead v3.0 — Claude Analyse
const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// ─── HAUPT-ANALYSE ────────────────────────────────────────────────────────────

async function analyzeEmail(emailText, fromName, subject) {
  const ai = getClient();

  if (!ai) {
    console.warn('⚠️  Kein API Key — Demo-Analyse');
    return getDemoAnalysis(subject);
  }

  const prompt = `Du bist ein Experte für Immobilien-Anfragen-Analyse. Analysiere diese E-Mail und antworte NUR mit dem JSON-Objekt, ohne Markdown, ohne Erklärungen, ohne Backticks.

Von: ${fromName || 'Unbekannt'}
Betreff: ${subject || ''}
Inhalt:
${emailText.substring(0, 3000)}

Antworte ausschließlich mit diesem JSON:
{
  "score": <Zahl 1-10>,
  "kaufabsicht": "<Hoch|Mittel|Niedrig>",
  "finanzierung": "<Vorhanden|Unklar|Fehlt|Unbekannt>",
  "zeitrahmen": "<Sofort|3 Monate|6 Monate|Über 1 Jahr|Unbekannt>",
  "zusammenfassung": "<2-3 präzise Sätze: Wer ist das, was wollen sie, warum dieser Score>",
  "antwortEntwurf": "<Professioneller Antwort-Entwurf auf Deutsch, 3-5 Sätze, persönlich auf diese Anfrage angepasst>"
}

Score-Kriterien:
8-10: Konkreter Kaufinteressent, klares Budget, baldiger Zeitrahmen, konkrete Fragen
5-7:  Interessiert aber noch vage, Finanzierung unklar, allgemeine Fragen
1-4:  Allgemeine Anfrage ohne konkretes Interesse, Spam-verdächtig, unvollständig`;

  try {
    const message = await ai.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw   = message.content[0].text.trim();
    // Markdown-Fences entfernen falls Claude sie trotzdem setzt
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(clean);

    return {
      score:           Math.min(10, Math.max(1, parseInt(result.score) || 5)),
      kaufabsicht:     result.kaufabsicht     || 'Unbekannt',
      finanzierung:    result.finanzierung    || 'Unbekannt',
      zeitrahmen:      result.zeitrahmen      || 'Unbekannt',
      zusammenfassung: result.zusammenfassung || '',
      antwortEntwurf:  result.antwortEntwurf  || '',
    };

  } catch (err) {
    console.error('KI-Analyse Fehler:', err.message);
    return getDemoAnalysis(subject);
  }
}

// ─── FALLBACK OHNE API KEY ────────────────────────────────────────────────────

function getDemoAnalysis(subject) {
  return {
    score:           5,
    kaufabsicht:     'Mittel',
    finanzierung:    'Unklar',
    zeitrahmen:      'Unbekannt',
    zusammenfassung: '[Demo-Modus] Kein Anthropic API Key konfiguriert. Bitte ANTHROPIC_API_KEY in den Render Environment Variables hinterlegen.',
    antwortEntwurf:  `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage bezüglich "${subject || 'unseres Angebots'}".\n\nGerne stehen wir Ihnen für ein persönliches Gespräch zur Verfügung und freuen uns auf Ihre Rückmeldung.\n\nMit freundlichen Grüßen`,
  };
}

module.exports = { analyzeEmail };

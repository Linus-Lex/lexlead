const fetch = require('node-fetch');

const SYSTEM = `Du bist KI-Assistent fuer deutsche Immobilienmakler.
Analysiere eingehende Kaufanfragen. Antworte NUR als JSON, kein Markdown, keine Erklaerungen.

Format:
{
  "score": <1-10>,
  "label": "<hot|warm|cold|spam>",
  "summary": "<max 2 Saetze auf Deutsch>",
  "intent": "<ernst|informell|spekulativ|unklar>",
  "financing": "<bestaetigt|unklar|kein_signal|problematisch>",
  "timeframe": "<sofort|1_monat|3_monate|unklar|kein_kauf>",
  "action": "<max 10 Woerter, konkrete Handlung>",
  "draft": "<hoefliche Antwort auf Deutsch, 3-4 Saetze>"
}

Score-Regeln:
9-10 = hot: Finanzierung bestaetigt, konkretes Objekt, enger Zeitplan -> sofort anrufen
7-8  = warm: Ernsthaftes Interesse, kleinere Luecken -> heute kontaktieren
5-6  = cold: Vage, kein Zeitplan, kein Budget -> Standard-Antwort
1-4  = spam: Automatisch, Konkurrenz, sinnlos -> ignorieren`;

async function analyze(lead) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.includes('HIER')) return null;

  const prompt = `Von: ${lead.from_name || ''} <${lead.from_email}>
Betreff: ${lead.subject || '(kein Betreff)'}
Nachricht:
${(lead.body || '').substring(0, 3000)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Kein JSON in Antwort');
    const parsed = JSON.parse(match[0]);

    return {
      score: Math.min(10, Math.max(1, parseInt(parsed.score) || 5)),
      label: ['hot','warm','cold','spam'].includes(parsed.label) ? parsed.label : 'cold',
      summary: parsed.summary || '',
      intent: parsed.intent || 'unklar',
      financing: parsed.financing || 'kein_signal',
      timeframe: parsed.timeframe || 'unklar',
      action: parsed.action || 'Manuell pruefen',
      draft: parsed.draft || ''
    };
  } catch (e) {
    console.error('AI error:', e.message);
    return null;
  }
}

module.exports = { analyze };

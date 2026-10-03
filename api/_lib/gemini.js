// Minimal Gemini REST client (models.generateContent). No SDK, no dependencies.
// The API key is read from the server environment and sent in a header, never to the browser.
import { LIMITS } from './config.js';

const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/**
 * Call Gemini and return parsed JSON plus token usage.
 * Throws an Error with .code ('timeout' | 'http' | 'blocked' | 'truncated' | 'bad_json').
 */
export async function generateJson({ apiKey, model, system, user, schema, maxOutputTokens = LIMITS.maxOutputTokens }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens,
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: schema,
      // Thinking tokens count against maxOutputTokens, so keep reasoning minimal.
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  };

  let res = await post(model, apiKey, body);
  // Some models reject thinkingConfig; retry once without it.
  if (res.status === 400 && /thinking/i.test(res.text)) {
    delete body.generationConfig.thinkingConfig;
    res = await post(model, apiKey, body);
  }
  if (!res.ok) throw err('http', `Gemini HTTP ${res.status}: ${res.text.slice(0, 300)}`);

  const data = JSON.parse(res.text);
  if (data.promptFeedback?.blockReason) throw err('blocked', `Blocked: ${data.promptFeedback.blockReason}`);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const usage = {
    input_tokens: data.usageMetadata?.promptTokenCount ?? null,
    output_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    thought_tokens: data.usageMetadata?.thoughtsTokenCount ?? 0,
  };
  if (cand?.finishReason === 'MAX_TOKENS') throw Object.assign(err('truncated', 'Output hit the token cap'), { usage });
  if (cand?.finishReason === 'SAFETY') throw Object.assign(err('blocked', 'Output blocked by safety filter'), { usage });

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw Object.assign(err('bad_json', `Model did not return JSON: ${text.slice(0, 200)}`), { usage });
  }
  return { json, usage, latency_ms: res.ms, model_version: data.modelVersion ?? model };
}

async function post(model, apiKey, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIMITS.geminiTimeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(ENDPOINT(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { ok: r.ok, status: r.status, text: await r.text(), ms: Date.now() - t0 };
  } catch (e) {
    if (e.name === 'AbortError') throw err('timeout', 'Gemini took too long');
    throw err('http', `Network error calling Gemini: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function err(code, message) {
  return Object.assign(new Error(message), { code });
}

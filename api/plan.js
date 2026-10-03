// POST /api/plan - the live 3F Split demo.
// Flow: validate -> per-visitor cap -> compute Fixed/Free, Monday number and run-out date in code
//       -> Gemini reads the note (Future cost), picks two cuts and writes the words
//       -> guardrails -> store request + response in Supabase -> return plan + live stats.
// Secrets (GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY) come only from Vercel environment variables.
import { createHash } from 'node:crypto';
import { LIMITS, MODEL_DEFAULT, PRODUCT } from './_lib/config.js';
import { validateInput, computeSplit, futureAdjust, sanitizeCuts, fmt, ordinal } from './_lib/plan-math.js';
import { generateJson } from './_lib/gemini.js';
import { insertPlan, countVisitorSince, countAllSince, getStats } from './_lib/supabase.js';
import { enforce, redactGoal, violation, REFUSAL_TEXT } from './_lib/guardrails.js';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserMessage } from './_lib/prompt.js';

const reply = (status, obj) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const t0 = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  const dbReady = process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!apiKey || !dbReady) return reply(500, { error: 'config', message: 'The demo is not configured yet.' });

  // 1. Validate input (numbers only, plus an optional 120-character note).
  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: 'bad_json', message: 'Please send the form as JSON.' });
  }
  const checked = validateInput(body);
  if (!checked.ok) return reply(400, { error: 'invalid', message: checked.error });
  const input = { ...checked.value, goal: redactGoal(checked.value.goal) };

  // 2. Identify the visitor without storing personal data: browser id + salted hash of the IP.
  const ip = (request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown').split(',')[0].trim();
  const ipHash = createHash('sha256').update(`${process.env.IP_HASH_SALT || 'thirty-demo'}:${ip}`).digest('hex').slice(0, 32);
  const model = process.env.GEMINI_MODEL || MODEL_DEFAULT;
  const now = new Date();
  const { visitor_id, goal, ...amounts } = input;
  const baseRow = { visitor_id, ip_hash: ipHash, model, input: { ...amounts, goal } };

  // 3. Abuse and cost controls: 5 plans per browser and 20 per network per 24 h, plus a site-wide daily ceiling.
  let used;
  try {
    const counts = await countVisitorSince({ visitorId: visitor_id, ipHash, sinceIso: new Date(now - 86400000).toISOString() });
    used = counts.byVisitor;
    if (used >= LIMITS.perVisitorPer24h || counts.byIp >= LIMITS.perIpPer24h) {
      await insertPlan({ ...baseRow, status: 'capped' }).catch(() => {});
      return reply(429, {
        error: 'cap',
        remaining: 0,
        message: `You've used your ${LIMITS.perVisitorPer24h} free plans for today. Come back tomorrow, or join the waitlist for the full app.`,
      });
    }
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    if ((await countAllSince(dayStart)) >= LIMITS.globalPerDay) {
      return reply(503, { error: 'busy', message: 'The demo has reached its daily limit. Please try again tomorrow.' });
    }
  } catch (e) {
    console.error('cap check failed:', e.message);
    return reply(503, { error: 'db', message: 'Could not reach the database. Please try again in a minute.' });
  }

  // 4. Code does the arithmetic; Gemini only reads the note, chooses the two cuts and writes the words.
  const split = computeSplit(input);
  let gen;
  try {
    const ask = (extra = '') => generateJson({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(input, split, now) + extra,
      schema: RESPONSE_SCHEMA,
      maxOutputTokens: LIMITS.maxOutputTokens,
    });
    try {
      gen = await ask();
    } catch (first) {
      // Replies sit close to the 300-token cap; if one is cut off, retry once and ask for shorter sentences.
      if (first.code !== 'truncated') throw first;
      gen = await ask('\nYour last reply was too long. Keep every sentence under 10 words.');
    }
  } catch (e) {
    console.error('gemini failed:', e.code, e.message);
    await insertPlan({
      ...baseRow,
      status: 'error',
      output: { error: e.code || 'gemini', detail: String(e.message).slice(0, 300) },
      input_tokens: e.usage?.input_tokens ?? null,
      output_tokens: e.usage?.output_tokens ?? null,
      thought_tokens: e.usage?.thought_tokens ?? null,
      latency_ms: Date.now() - t0,
    }).catch(() => {});
    const message = e.code === 'timeout' ? 'Gemini took too long. Please try again.' : 'Could not generate a plan right now. Please try again.';
    return reply(502, { error: e.code || 'gemini', message });
  }

  // 5. Guardrails: re-check every sentence Gemini wrote; validate and clamp the cuts in code.
  const fallbacks = {
    summary: [
      `${split.committed_pct}% of your Rs ${fmt(input.take_home)} is committed before the month starts.`,
      `Your Monday number is Rs ${fmt(split.monday_number)} a week; you are planning Rs ${fmt(split.weekly_pace)}.`,
      split.runout_day
        ? `At that pace your flexible money runs out around the ${ordinal(split.runout_day)}.`
        : `At that pace your money lasts the month, with Rs ${fmt(split.gap)} to spare.`,
    ],
    monday_tip: "Every Monday, move only this week's number to the account you spend from, and leave the rest alone.",
  };
  const { clean, flags } = enforce(gen.json, fallbacks);
  const cuts = sanitizeCuts(clean.cuts, input);
  const identifiedSaving = cuts.reduce((s, c) => s + c.amount, 0);
  // Future amounts must come from the visitor's own words: no number in the note, no Future item.
  const future = clean.future_item && /\d/.test(input.goal) ? futureAdjust(split, clean.future_item) : null;
  const refusal = gen.json.refusal === true || violation(input.goal) !== null;

  const plan = {
    product: PRODUCT.name,
    method: PRODUCT.method,
    split,
    future,
    summary: clean.summary,
    cuts,
    identified_saving: identifiedSaving,
    monday_tip: clean.monday_tip,
    refusal_note: refusal ? REFUSAL_TEXT : '',
    disclaimer: 'Arithmetic on the numbers you entered, assuming even spending across the month. Not financial, investment, tax or legal advice.',
  };

  // 6. Store the full exchange, then read the live numbers back for the page.
  try {
    await insertPlan({
      ...baseRow,
      status: 'ok',
      output: plan,
      input_tokens: gen.usage.input_tokens,
      output_tokens: gen.usage.output_tokens,
      thought_tokens: gen.usage.thought_tokens,
      latency_ms: Date.now() - t0,
      identified_saving: identifiedSaving,
      overspending: split.gap < 0,
      runout_day: split.runout_day,
      future_amount: future ? future.amount : null,
      refusal,
      guardrail_flags: flags,
    });
  } catch (e) {
    console.error('insert failed:', e.message); // the visitor still gets their plan
  }
  let stats = null;
  try {
    stats = await getStats();
  } catch (e) {
    console.error('stats failed:', e.message);
  }

  return reply(200, { plan, stats, remaining: Math.max(0, LIMITS.perVisitorPer24h - used - 1) });
}

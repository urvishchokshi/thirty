// Input validation and all arithmetic for Thirty's Fixed / Future / Free split.
// Code does the maths; Gemini only reads the visitor's note, chooses two cuts and writes the words,
// so every number shown to the visitor is calculated, never generated.
import { LIMITS, CATEGORIES, FIXED_KEYS, FLEX_KEYS, CUTTABLE_KEYS, MAX_FUTURE_AMOUNT } from './config.js';

const WEEKS_PER_MONTH = 4.33;
const DAYS_PER_MONTH = 30;

const toInt = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
};
const round100 = (n) => Math.round(n / 100) * 100;
const round10 = (n) => Math.round(n / 10) * 10;

/** Validate the request body. Returns { ok: true, value } or { ok: false, error }. */
export function validateInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Send a JSON body.' };

  const takeHome = toInt(body.take_home);
  if (!(takeHome >= LIMITS.minPay && takeHome <= LIMITS.maxPay)) {
    return { ok: false, error: `Take-home pay must be between Rs ${fmt(LIMITS.minPay)} and Rs ${fmt(LIMITS.maxPay)}.` };
  }

  const spend = {};
  for (const key of Object.keys(CATEGORIES)) {
    const v = toInt(body[key] ?? 0);
    if (!(v >= 0 && v <= LIMITS.maxCategory)) {
      return { ok: false, error: `${CATEGORIES[key]} must be a number between 0 and Rs ${fmt(LIMITS.maxCategory)}.` };
    }
    spend[key] = v;
  }

  const visitorId = String(body.visitor_id ?? '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(visitorId)) return { ok: false, error: 'Missing visitor id.' };

  let goal = typeof body.goal === 'string' ? body.goal : '';
  goal = goal.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.goalMaxChars);

  return { ok: true, value: { take_home: takeHome, ...spend, goal, visitor_id: visitorId } };
}

/** Day of the month the flexible money runs out at an even pace (null = it lasts the month). */
function runOutDay(free, flex) {
  if (flex <= 0 || flex <= free) return null;
  if (free <= 0) return 1;
  return Math.max(1, Math.min(DAYS_PER_MONTH, Math.floor((DAYS_PER_MONTH * free) / flex)));
}

/** Fixed / Free split, the Monday number, the visitor's pace, the honest run-out date and the honesty check. */
export function computeSplit(input) {
  const fixed = FIXED_KEYS.reduce((s, k) => s + input[k], 0);
  const flex = FLEX_KEYS.reduce((s, k) => s + input[k], 0);
  const free = input.take_home - fixed;
  const honestFlex = flex + Math.round(input.food_delivery * 0.2); // people underestimate food & delivery
  return {
    take_home: input.take_home,
    fixed,
    committed_pct: Math.round((100 * fixed) / input.take_home),
    free,
    monday_number: Math.max(0, round10(free / WEEKS_PER_MONTH)),
    flex_spend: flex,
    weekly_pace: round10(flex / WEEKS_PER_MONTH),
    gap: free - flex, // negative = spending more than the Free money
    yearly_gap: (free - flex) * 12,
    runout_day: runOutDay(free, flex),
    honesty_runout_day: runOutDay(free, honestFlex), // same, with food & delivery +20%
  };
}

/**
 * Future: one upcoming cost Gemini read from the visitor's note, spread evenly over the paydays before it.
 * Returns null when the note named no cost.
 */
export function futureAdjust(split, item) {
  const amount = round100(toInt(item?.amount));
  const months = Math.min(12, Math.max(1, toInt(item?.months_away) || 1));
  const label = String(item?.label ?? '').trim().slice(0, 60);
  if (!label || !(amount >= 100 && amount <= MAX_FUTURE_AMOUNT)) return null;
  const perMonth = round100(amount / months);
  const freeAfter = split.free - perMonth;
  return {
    label,
    amount,
    months_away: months,
    per_month: perMonth,
    monday_number_after: Math.max(0, round10(freeAfter / WEEKS_PER_MONTH)),
    runout_day_after: runOutDay(freeAfter, split.flex_spend),
  };
}

/**
 * Keep exactly the cuts that make sense: cuttable category, at least Rs 100,
 * at most 40% of that category, rounded to Rs 100, max two, one per category.
 */
export function sanitizeCuts(rawCuts, input) {
  const out = [];
  const used = new Set();
  for (const c of Array.isArray(rawCuts) ? rawCuts : []) {
    if (out.length === 2) break;
    const cat = String(c?.category ?? '');
    if (!CUTTABLE_KEYS.includes(cat) || used.has(cat)) continue;
    const ceiling = Math.floor((input[cat] * 0.4) / 100) * 100;
    let amount = round100(toInt(c?.amount));
    if (!Number.isFinite(amount) || ceiling < 100) continue;
    amount = Math.min(Math.max(amount, 100), ceiling);
    const action = String(c?.action ?? '').trim().slice(0, 180);
    if (!action) continue;
    used.add(cat);
    out.push({ category: cat, label: CATEGORIES[cat], amount, action });
  }
  return out;
}

/** Indian digit grouping without the currency symbol, e.g. 125000 -> "1,25,000". */
export function fmt(n) {
  return Math.round(n).toLocaleString('en-IN');
}

export function ordinal(d) {
  if (d == null) return '';
  const s = d % 100 >= 11 && d % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th';
  return `${d}${s}`;
}

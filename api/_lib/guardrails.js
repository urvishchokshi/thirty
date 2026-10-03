// Server-side guardrails. The system prompt asks Gemini to follow these rules;
// this file enforces them again on the way out, so a single bad generation can't reach the visitor.

const INVESTMENT = /\b(mutual\s*funds?|mfs?|sips?|elss|index\s*funds?|etfs?|stocks?|shares|equit(?:y|ies)|crypto\w*|bitcoin|fixed\s*deposits?|fds?|recurring\s*deposits?|ppf|nps|bonds?|sovereign\s*gold|digital\s*gold|gold\s*(?:etf|bonds?)|ulips?|demat|smallcase|nifty|sensex|annuit(?:y|ies)|insurance\s*(?:plans?|polic(?:y|ies)))\b/i;
const TAX_LEGAL = /\b(80c|80d|section\s*80\w*|tax[-\s]*(?:saving|saver|deductions?|regime|exemptions?|filing|returns?)|income\s*tax|itr|hra\s*exemption|legal\s*advice|lawyers?|advocates?)\b/i;
const LENDING = /\b(personal\s*loans?|take\s*(?:out\s*)?(?:a\s*)?loans?|borrow\w*|credit\s*lines?|loan\s*apps?|bnpl\s*(?:plans?|offers?)|emi\s*conversion|balance\s*transfer)\b/i;

export const REFUSAL_TEXT =
  "Thirty doesn't recommend investments or give tax, legal or loan advice. For that, speak to a SEBI-registered investment adviser or a chartered accountant.";

/** Returns the name of the rule a piece of text breaks, or null. */
export function violation(text) {
  const t = String(text || '');
  if (INVESTMENT.test(t)) return 'investment_product';
  if (TAX_LEGAL.test(t)) return 'tax_or_legal';
  if (LENDING.test(t)) return 'lending';
  return null;
}

/** Does the visitor's note ask for advice we refuse to give? (used for logging and the refusal line) */
export function asksForRefusedAdvice(goal) {
  return violation(goal) !== null || /\b(invest\w*|tax\w*|loan|legal)\b/i.test(goal || '');
}

/**
 * Check every text field Gemini wrote (summary, tip, cut actions, future label). Breaking fields are replaced with safe fallbacks.
 * Returns { clean, flags } where flags lists what was replaced and why.
 */
export function enforce(model, fallbacks) {
  const flags = [];
  const clean = { ...model };
  const summary = Array.isArray(model.summary) ? model.summary.slice(0, 3).map((x) => String(x)) : [];
  clean.summary = summary.map((line, i) => {
    const rule = violation(line);
    if (!rule) return line;
    flags.push(`summary${i + 1}:${rule}`);
    return fallbacks.summary[i] || fallbacks.summary[0];
  });
  if (clean.summary.length === 0) clean.summary = fallbacks.summary;
  const tipRule = violation(clean.monday_tip);
  if (tipRule || !clean.monday_tip) {
    if (tipRule) flags.push(`monday_tip:${tipRule}`);
    clean.monday_tip = fallbacks.monday_tip;
  }
  clean.cuts = (Array.isArray(model.cuts) ? model.cuts : []).map((c, i) => {
    const rule = violation(c?.action);
    if (!rule) return c;
    flags.push(`cut${i + 1}:${rule}`);
    return { ...c, action: 'Trim this category by the amount shown, starting this week.' };
  });
  const futureRule = violation(model.future_item?.label);
  if (futureRule) {
    flags.push(`future_item:${futureRule}`);
    clean.future_item = null;
  }
  return { clean, flags };
}

/** Strip contact details and long account-like numbers before the note is stored or sent to Gemini. */
export function redactGoal(goal) {
  return String(goal || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(\+?91[-\s]?)?[6-9]\d{9}\b/g, '[phone]')
    .replace(/\d{9,}/g, '[number]');
}

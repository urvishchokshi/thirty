// Everything product-specific lives in this one file.
// Files in /api whose names start with "_" are helpers, not public endpoints.

export const PRODUCT = {
  name: 'Thirty',
  method: 'Fixed / Future / Free',
  promise: 'Every Monday, know what you can spend and still reach payday.',
};

export const LIMITS = {
  maxOutputTokens: 300,     // hard cap on Gemini output per request
  perVisitorPer24h: 5,      // plans per visitor (browser id) per 24 hours
  perIpPer24h: 20,          // plans per network (hashed IP) per 24 hours, so shared office Wi-Fi still works
  globalPerDay: 400,        // whole-site daily ceiling to protect the free Gemini quota
  goalMaxChars: 120,        // optional free-text 'anything coming up?' note
  minPay: 10000,            // Rs per month
  maxPay: 1000000,
  maxCategory: 500000,
  geminiTimeoutMs: 9000,
};

// Gemini 2.5 models are closed to new projects (Google, Sep 2026); 3.5 Flash-Lite is the recommended low-cost model.
// Override with the GEMINI_MODEL environment variable in Vercel if needed.
export const MODEL_DEFAULT = 'gemini-3.5-flash-lite';

// The five demo categories. Fixed ones are never cut (rent, EMIs, family).
export const CATEGORIES = {
  rent_bills: 'Rent & bills',
  emis_cards: 'EMIs & card dues',
  family: 'Money sent home',
  food_delivery: 'Food, groceries & delivery',
  lifestyle: 'Outings, shopping & travel',
};
export const FIXED_KEYS = ['rent_bills', 'emis_cards', 'family'];
export const FLEX_KEYS = ['food_delivery', 'lifestyle'];
export const CUTTABLE_KEYS = ['food_delivery', 'lifestyle'];
export const MAX_FUTURE_AMOUNT = 500000; // Rs; a single upcoming cost parsed from the note

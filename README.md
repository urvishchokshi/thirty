# Thirty: landing page and live 3-number demo

**Thirty: every Monday, know what you can spend and still reach payday.**

Live: https://thirty-sigma.vercel.app (Task 4) · https://thirty-sigma.vercel.app/landing-task3.html (Task 3)

This repository holds two pages and two serverless functions:

- `index.html` is the landing page (Task 3), extended with the live AI feature (Task 4).
- `landing-task3.html` is the Task 3 version, kept as it was: a static page with the calculator only.
- `api/plan.js` (POST) calculates the Fixed / Future / Free split in code. Gemini then reads the visitor's note, picks two cuts and writes the plan. The function saves the request and the response in Supabase.
- `api/stats.js` (GET) returns the live numbers shown on the page: plans made, average cuts found, the share of visitors who run out before payday, and the average run-out date.
- `supabase/schema.sql` creates the table and the stats view.
- `tests/` holds the offline tests, run with `npm test`. They mock Gemini and Supabase.

There are no npm dependencies and no build step. API keys exist only as Vercel environment variables, never in this repo.

## Deploy (about 15 minutes)

### 1. GitHub
1. Go to github.com/new and create a **public** repo called `thirty`, with no README.
2. Click **uploading an existing file** and drag in *everything* from this folder, including the `api` and `supabase` folders.
3. Click **Commit**.

### 2. Supabase (the database)
1. Go to supabase.com, open **New project**, name it `thirty`, choose the region **Mumbai (ap-south-1)**, set a database password and click **Create**.
2. Open **SQL Editor**, then **New query**. Paste all of `supabase/schema.sql` and click **Run**. You should see "Success. No rows returned".
3. Open **Project Settings**, then **API Keys**, and copy two values:
   - the **Project URL** (`https://xxxx.supabase.co`), for `SUPABASE_URL`;
   - a **secret key**: click **+ New secret key** and copy the `sb_secret_...` value, for `SUPABASE_SERVICE_KEY`. A legacy `service_role` key (starting `eyJ...`) also works.

### 3. Gemini key
1. Go to aistudio.google.com and click **Get API key**, then **Create API key**.
2. Copy the key. This is `GEMINI_API_KEY`.

### 4. Vercel
1. Go to vercel.com, click **Add New**, then **Project**, and import the `thirty` repo. Leave Framework Preset set to **Other** and leave the build settings empty.
2. Before you click Deploy, open **Environment Variables** and add these three:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | your AI Studio key |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `sb_secret_...` |

   There are two optional variables: `GEMINI_MODEL` (the default is `gemini-3.5-flash-lite`) and `IP_HASH_SALT` (any random string).
3. Click **Deploy**. The site appears at `https://thirty-xxxx.vercel.app`.
   - The Task 3 page is at `/landing-task3.html`.
   - The Task 4 page is at `/`.

### 5. Check it works
- Open the site and click **Get my Monday plan**. A plan should appear within about 5 seconds.
- In Supabase, open **Table Editor** and then `plans`. Each try adds a row.
- The "Thirty so far" numbers on the page update.
- In GitHub, search the repo for the first four characters of your Gemini key. The search should find nothing.

If the plan fails, open Vercel, go to the project, then **Logs**:
- `Gemini HTTP 404` means the model name is wrong for your key. Set `GEMINI_MODEL` to a model listed in AI Studio and redeploy.
- `Supabase HTTP 401` means the key is wrong.

## Safety and cost controls
- Gemini output is capped at **300 tokens**.
- The cap is **5 plans per browser** and **20 per network** every 24 hours, plus a site-wide limit of 400 a day.
- Inputs are numbers only, plus an optional 120-character note. Emails and phone numbers are removed from the note before it is stored or sent anywhere.
- The guardrail works in two layers:
  - the system prompt refuses investment, tax, legal and loan advice;
  - the server re-checks every sentence Gemini writes against a list of investment, tax and lending terms, and replaces any sentence that matches.
- Every number the visitor sees is calculated in code. Gemini's Future amount is used only if the visitor's note contains a number.
- No raw IPs, names or emails are stored. Row Level Security is on with no policies, so only the server key can read or write the table.

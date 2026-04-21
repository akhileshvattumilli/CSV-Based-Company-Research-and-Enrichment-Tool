# AI Lead Enrichment Pipeline — Decision Log

> This document tracks every architectural decision, tool choice, and technical tradeoff made during the build.
> Update this after every major prompt/session in Cursor.

---

## Project Overview

**Goal:** Accept a CSV of companies, enrich each using multiple external data sources + multi-step AI processing, and email the enriched CSV back to the user.

**Stack:** Next.js (TypeScript) · Deployed on Vercel · Claude API (Haiku 4.5) · Firecrawl · Serper · GNews · Resend

---

## Architecture

```
User (Browser)
    │
    ▼
Next.js Frontend (app/page.tsx)
  - CSV file upload input
  - Email address input
  - Submit triggers POST to /api/enrich
    │
    ▼
Next.js API Route (app/api/enrich/route.ts)
  - Parses incoming CSV with Papaparse
  - Runs Promise.all() across all company rows in parallel
  - Each row → enrichRow(company) function
  - Reconstructs enriched CSV
  - Sends email with Resend
    │
    ▼
enrichRow(company) — lib/enrichRow.ts
  - Orchestrates one company's full pipeline:
    1. scrape(website)        → lib/scrape.ts     → Firecrawl API
    2. search(companyName)    → lib/search.ts     → Serper API
    3. getNews(companyName)   → lib/news.ts       → GNews API
    4. extractProfile(...)    → lib/ai.ts (Call 1) → Claude API
    5. generateInsights(...)  → lib/ai.ts (Call 2) → Claude API
  - Returns a fully enriched row object
```

---

## Decision Log

---

### D-001 · Framework: Next.js (App Router)

**Decision:** Use Next.js 14 with the App Router.

**Reasoning:**
- Single repo for both frontend (upload UI) and backend (API routes) — no need to manage two separate services.
- Vercel is built by the Next.js team. Deploying is a single `git push` with zero configuration.
- App Router allows `export const maxDuration = 60` per route, which is required to handle the processing time for 10 companies.
- Alternative considered: Python (FastAPI on Railway). Rejected because deployment would require more setup and the JS ecosystem has better SDKs for all required services (Firecrawl, Resend, Anthropic).

---

### D-002 · Deployment: Vercel (Hobby Tier)

**Decision:** Deploy to Vercel Hobby tier.

**Reasoning:**
- Free, instant deployment from GitHub.
- The assignment requires a publicly accessible URL — Vercel provides this automatically.
- Main constraint: 60-second function timeout on Hobby tier.
- **How we solve the timeout:** All 10 companies are processed in parallel using `Promise.all()`. Each company takes ~10-15 seconds. In parallel, total wall time stays well under 60 seconds.
- `export const maxDuration = 60` is added to the API route to use the full available window.
- Alternative considered: Railway (no timeout). Rejected to keep deployment simpler — Vercel's constraint is solvable with parallelism.

---

### D-003 · CSV Parsing: Papaparse

**Decision:** Use Papaparse for CSV parsing and reconstruction.

**Reasoning:**
- Best-in-class CSV parser for JavaScript. Handles edge cases like quoted commas, special characters, and UTF-8 BOM (the sample CSV had a BOM character `\uFEFF`).
- Works both client-side and server-side (Node.js).
- Output columns map directly to the required CSV schema:
  `Industry, Sub-Industry, Primary Product / Service, Target Customer (ICP), Estimated Company Size, Recent News Summary, Key Offering Summary, Sales Angle 1/2/3, Risk Signal 1/2/3, Data Sources Used`

---

### D-004 · Website Scraping: Firecrawl v2

**Decision:** Use Firecrawl v2 (`@mendable/firecrawl-js`) as the primary website data retrieval tool.

**Reasoning:**
- Designed specifically for converting websites into clean, structured markdown — ideal as an LLM input.
- Handles JavaScript-rendered pages, anti-scraping measures, and dynamic content automatically.
- Alternative considered: `fetch` + `cheerio` (raw HTML parsing). Rejected because it requires writing custom extractors per site and struggles with JS-heavy pages. Firecrawl abstracts all of that.
- Free tier supports enough requests for the assignment (10 companies).
- Data retrieved: Full page text as markdown → fed into AI Call 1.
- **Implementation note:** Uses v2 API (`app.scrape(url, { formats: ['markdown'] })`) not v1 (`scrapeUrl`). v2 returns `Document` directly and throws on error, cleaner than v1's `{ success: boolean }` pattern. URL normalization prepends `https://` if missing.

---

### D-005 · External Data Source 1: Serper (Google Search API)

**Decision:** Use Serper.dev as the first of the two required external data sources.

**Reasoning:**
- Provides structured Google Search results as JSON via a simple REST API.
- The most flexible external source available — you can search for anything: `"[Company] funding"`, `"[Company] CEO"`, `"[Company] competitors"`, etc.
- Returns organic results, knowledge graph data, and related questions — all useful for building a company profile.
- 2,500 free credits on signup, which is more than enough.
- Alternative considered: Apollo.io API (firmographic data). Rejected because free tier is very limited and the data quality for lesser-known companies is inconsistent.

---

### D-006 · External Data Source 2: GNews (migrated from NewsAPI)

**Decision:** Use GNews (`https://gnews.io/api/v4/search`) as the second required external data source. Originally NewsAPI was planned, but we migrated to GNews for better coverage of smaller/B2B companies and a simpler free tier.

**Reasoning:**
- Required output column `Recent News Summary` maps directly to what a news API provides.
- Returns recent news articles about any company by name.
- Free tier (100 req/day) is sufficient for a 10-row CSV.
- Provides concrete, time-stamped signals (funding rounds, layoffs, product launches, regulatory issues) which directly power the `Risk Signal` and `Sales Angle` outputs.
- `Data Sources Used` column logs which APIs returned real data. Small/unknown companies often have no news hits — handled gracefully via a placeholder article (see D-006a).

---

### D-007 · AI Orchestration: Two-Step Claude Pipeline

**Decision:** Use two separate Claude API calls per company with structured JSON outputs.

**Why two calls instead of one:**
- The assignment explicitly requires multi-step AI orchestration with structured intermediate outputs.
- More importantly, it produces better results: Call 1 focuses purely on extraction/classification, Call 2 focuses on sales intelligence generation using the structured output from Call 1 as clean input.
- Single large prompts tend to produce lower quality on all sub-tasks. Splitting creates specialization.

**Call 1 — Profile Extraction (lib/ai.ts → extractProfile)**
- Input: Raw scraped website text + Serper search results
- Task: Extract factual, structured company profile
- Output (JSON):
  ```json
  {
    "industry": "...",
    "subIndustry": "...",
    "primaryProduct": "...",
    "targetCustomer": "...",
    "estimatedSize": "...",
    "keyOffering": "..."
  }
  ```
- Reasoning: This call does data extraction, not generation. Keeping it separate ensures the second call starts from verified structured data, not raw text.

**Call 2 — Sales Intelligence (lib/ai.ts → generateInsights)**
- Input: Structured profile from Call 1 + NewsAPI results
- Task: Generate sales angles, risk signals, and news summary
- Output (JSON):
  ```json
  {
    "salesAngle1": "...",
    "salesAngle2": "...",
    "salesAngle3": "...",
    "riskSignal1": "...",
    "riskSignal2": "...",
    "riskSignal3": "...",
    "recentNewsSummary": "..."
  }
  ```
- Reasoning: This call does generation/synthesis. It receives clean structured input (not raw scrape text), which reduces hallucination risk and improves output quality.

**Model:** `claude-haiku-4-5`
- Cheapest + fastest Claude model, which is what this workload actually needs — both calls are structured JSON generation from clean inputs, not long-horizon reasoning.
- Earlier iterations used `claude-sonnet-4-20250514` and `claude-3-5-sonnet-20241022`; both were dropped after testing showed Haiku 4.5 produced equivalent quality on the structured profile + insights outputs at a fraction of the token cost and latency. Deprecated/invalid model IDs (e.g. `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`) returned 404s during migration and were replaced with current slugs.
- `max_tokens: 2048` for both calls to fit the longer, more detailed insight prompts.
- `generateInsights` runs at `temperature: 0.3` for more deterministic, evidence-grounded output.

**JSON enforcement & Zod forgiveness:**
- Both calls use system prompts that instruct Claude to respond only in valid JSON (no prose, no markdown fences).
- A `stripJsonFences()` helper defensively removes accidental ```` ```json ```` wrappers before parsing.
- Zod schemas for both `ProfileSchema` and `InsightsSchema` use `z.string().optional().default('Unavailable')` for every field — so a missing or malformed field fills in `"Unavailable"` instead of throwing and nuking the whole row.
- `generateInsights` uses `safeParse` + logs `result.error.flatten()` and the raw Claude response when validation falls back, so prompt drift is debuggable.

**Prompt quality (latest pass):**
- `extractProfile` pushes for specificity (e.g. "Vertical SaaS for logistics", not "SaaS"), maturity signals, growth indicators, B2B/B2C classification.
- `generateInsights` is written as a senior sales strategist brief: every sales angle must cover WHICH pain, WHY now, HOW to open; every risk signal must hit a different category (competitive, market, concentration, funding, platform, regulatory, talent); anti-patterns are called out explicitly in the prompt.

**Missing-news handling (`hasRealNews` flag):**
- `getNews` returns a synthetic placeholder article (`title: "No recent news found for <company>"`) when GNews returns zero hits — this keeps the downstream shape consistent.
- `enrichRow` computes `hasRealNews = articles.length > 0 && !articles[0].title.includes("No recent news")` and passes it into `generateInsights`.
- When `hasRealNews` is false, the prompt explicitly tells Claude to infer from profile + website context instead of saying "no news available", and to suffix `recentNewsSummary` with `" (Based on website analysis and market position)"`. Sales angles and risk signals are still produced in every case.

---

### D-008 · Email Delivery: Resend

**Decision:** Use Resend for email delivery with the enriched CSV as an attachment.

**Reasoning:**
- Best developer experience of any email API (SendGrid, SES, Mailgun were alternatives).
- SDK is one function call: `resend.emails.send({ from, to, subject, attachments })`.
- Free tier: 3,000 emails/month, 100/day — more than enough.
- Attachment support is built-in, no need to upload to S3 or generate a link.
- Alternative considered: SendGrid. Rejected because API setup and domain verification is more involved.
- Note: A verified sender email must be set in `.env.local` as `RESEND_FROM_EMAIL`.

---

### D-009 · Parallelism Strategy: Promise.all

**Decision:** Process all companies simultaneously using `Promise.all()`.

**Reasoning:**
- Each company's enrichment is fully independent — no shared state, no ordering requirement.
- Sequential processing (one company at a time) would take ~10-15s × 10 = 100-150s, exceeding Vercel's 60s limit.
- `Promise.all()` runs all 10 in parallel. Wall time = time of the slowest single company (~15s), well within the 60s limit.
- Error handling: `Promise.allSettled()` is used instead of `Promise.all()` so one failed company doesn't abort the entire batch. Failed rows get logged with an error message in the CSV.

---

### D-006a · GNews Wrapper Implementation (`lib/news.ts`)

**Decision:** Implement `getNews(companyName)` as a thin `fetch`-based wrapper around `https://gnews.io/api/v4/search`, returning `{ articles: NewsArticle[] }` limited to 5 recent articles, with retry-on-429 and a synthetic placeholder when no news exists.

**Implementation details:**
- **No SDK** — plain `fetch()` GET request. Keeps the dependency surface small.
- **Query params:** `q=companyName`, `lang=en`, `max=5`, `sortby=publishedAt`, `apikey=GNEWS_API_KEY`.
- **Env var validation** — throws immediately if `GNEWS_API_KEY` is missing, so failures surface at call time rather than as a confusing 401.
- **Retry with backoff + jitter (`fetchWithRetry`)** — GNews free tier aggressively rate-limits. The wrapper retries on `429` and `503` with exponential backoff (`base * 2^attempt + random jitter`) up to a small number of attempts before surfacing the error to `enrichRow`.
- **Error propagation** — no swallowing internal errors. Network errors and non-2xx responses throw; `enrichRow.ts` owns per-step try/catch and records status in `Data Sources Used`.
- **Empty-results placeholder** — if GNews returns zero articles (common for small/unknown companies), `getNews` returns `{ articles: [noNewsPlaceholder(companyName)] }` where the placeholder is `{ title: "No recent news found for <company>", source: "Claude (backup analysis)", ... }`. Keeps the downstream shape consistent so `generateInsights` always sees an array it can iterate; `enrichRow` detects the placeholder via `hasRealNews` and tells Claude to infer instead.
- **Response shape** — `{ title, publishedAt, description, source? }` per article. Everything else (url, image, content) is dropped to keep the Claude prompt compact.
- **Types exported:** `NewsArticle` and `NewsResult = { articles: NewsArticle[] }`. `NewsResult` is preserved so the existing import in `lib/enrichRow.ts` keeps compiling unchanged.

**Why limit to 5 articles:**
- Claude Call 2 (`generateInsights`) only needs enough recency signal to write a short news summary and inform risk signals — 5 recent articles are sufficient.
- Keeps the AI prompt compact and reduces token cost per row.

---

### D-010 · Error Handling Strategy

**Decision:** Fail gracefully per-row, never abort the batch.

**Reasoning:**
- A company's website might be down. A news search might return 0 results. An AI call might time out.
- The user should still receive a CSV — just with that row's fields showing `"Data unavailable"` or the error reason.
- Each step in `enrichRow.ts` is wrapped in try/catch. Errors are caught, logged to console, and the pipeline continues with whatever data was collected up to that point.
- `Data Sources Used` column records exactly which sources returned real data, giving full transparency (see D-011).

---

### D-011 · `Data Sources Used` — Detailed, Per-Call Audit String

**Decision:** The `Data Sources Used` output column is not just a list of API names; it's a human-readable audit of every external call made for that row, including the specific hosts/URLs touched and per-source success/failure status.

**Format (example):**
```
Firecrawl (acme.com), Serper (search results from linkedin.com, crunchbase.com, acme.com), GNews (3 news articles), Claude (2 AI calls)
```

**Failure-mode examples:**
```
Firecrawl (attempted: acme.com - failed), Serper (no results), GNews (no recent news), Claude (profile only)
```

**Per-source rules (implemented in `lib/enrichRow.ts`):**
- **Firecrawl** — success: `Firecrawl (<host>)`; empty markdown: `Firecrawl (attempted: <host> - no content)`; thrown error: `Firecrawl (attempted: <host> - failed)`. Host is derived via a small `hostFromUrl()` helper that normalizes missing protocols and strips `www.`.
- **Serper** — success: `Serper (search results from <host1>, <host2>, <host3>)` using the top 3 unique result hosts; zero results: `Serper (no results)`; thrown error: `Serper (failed)`.
- **GNews** — success: `GNews (<N> news article[s])` (pluralization handled); placeholder-only (no real news): `GNews (no recent news)`; thrown error: `GNews (failed)`.
- **Claude** — both calls ok: `Claude (2 AI calls)`; only one succeeded: `Claude (profile only)` or `Claude (insights only)`; both failed: `Claude (failed)`. Tracked via `profileOk` / `insightsOk` booleans set inside the existing try/catch blocks — no extra calls, no changes to error-handling flow.

**Why this shape:**
- Gives the end user (and us during debugging) a single-column, at-a-glance explanation of exactly where each row's data came from and what was missing — without needing to open server logs.
- Keeps the existing schema (`Data Sources Used` is one of the required output columns) while making it genuinely useful instead of a static list of API names.
- Every source string is appended only from inside its own try/catch, so the column always reflects the real outcome of the pipeline for that row.

---

## Folder Structure

```
/
├── app/
│   ├── page.tsx                   # Upload UI
│   └── api/
│       └── enrich/
│           └── route.ts           # Main pipeline endpoint
├── lib/
│   ├── scrape.ts                  # Firecrawl — website content retrieval
│   ├── search.ts                  # Serper — Google search results
│   ├── news.ts                    # GNews — recent news (with retry + placeholder)
│   ├── ai.ts                      # Claude — two-step AI calls
│   ├── email.ts                   # Resend — email with CSV attachment
│   └── enrichRow.ts               # Orchestrator — one company end-to-end
├── .env.local                     # API keys (never committed)
├── DECISION_LOG.md                # This file
└── README.md
```

---

## Environment Variables

| Variable | Service | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | Claude API access |
| `FIRECRAWL_API_KEY` | Firecrawl | Website scraping |
| `SERPER_API_KEY` | Serper.dev | Google search results |
| `GNEWS_API_KEY` | GNews.io | Recent company news |
| `RESEND_API_KEY` | Resend | Email delivery |
| `RESEND_FROM_EMAIL` | Resend | Verified sender address |

---

## Build Log

> Fill this in as you go through each Cursor session.

| Session | What was built | Key decisions made |
|---|---|---|
| 1 | Project scaffold, folder structure, Vercel deploy | D-001, D-002 |
| 2 | `enrichRow.ts` orchestrator + stub lib files (`scrape.ts`, `search.ts`, `news.ts`, `ai.ts`) | D-009, D-010 |
| 3 | `scrape.ts` (Firecrawl v2 wrapper, handles URL normalization) | D-004 |
| 4 | `search.ts` (Serper wrapper) | D-005 |
| 5 | `news.ts` (NewsAPI wrapper — `fetch`-based, header auth, top-5 articles via `pageSize=5`, throws on failure, returns `{ articles }` only) | D-006, D-006a |
| 6 | `ai.ts` (both Claude calls with Zod validation) | D-007 |
| 7 | `email.ts` + `route.ts` | D-003, D-008 |
| 8 | Upload UI (`page.tsx`) | — |
| 9 | End-to-end testing + bug fixes | — |
| 10 | `search.ts` implementation + type reconciliation (SearchResult vs SearchResponse) | D-005 |
| 11 | `ai.ts` implementation (extractProfile + generateInsights with Anthropic SDK + Zod) | D-007 |
| 12 | Serper 404 fix (correct endpoint `https://google.serper.dev/search`) + Claude model fixes (4xx on deprecated IDs → moved to `claude-haiku-4-5`) | D-005, D-007 |
| 13 | Migrated `news.ts` from NewsAPI to GNews (`gnews.io/api/v4/search`) with `fetchWithRetry` (exponential backoff + jitter) for 429/503 | D-006, D-006a |
| 14 | Prompt quality pass — both Claude prompts rewritten: `extractProfile` for specificity/maturity/ICP, `generateInsights` as a senior-sales brief (WHY/HOW, distinct risk categories, anti-patterns); `max_tokens=2048`, `temperature=0.3` for insights | D-007 |
| 15 | Missing-news graceful path — placeholder article in `news.ts`, `hasRealNews` flag in `enrichRow.ts`, conditional prompt branch in `generateInsights`, Zod schemas made forgiving (`.optional().default('Unavailable')`), raw-response + validation-error logging | D-006a, D-007 |
| 16 | `Data Sources Used` upgraded to detailed per-call audit with hosts + success/failure (new `hostFromUrl` helper, per-source status strings) | D-011 |
| 17 | Frontend polish — `app/page.tsx` upload UI + `suppressHydrationWarning` on `<body>` in `app/layout.tsx` to silence browser-extension hydration mismatches | — |

---

## Loom Video Outline (2–5 min)

Use this as a script guide:

1. **(0:00–0:30) — Demo** — Upload the sample CSV, show the enriched email arriving
2. **(0:30–1:30) — Architecture walkthrough** — Walk through the folder structure and the flow from upload → enrichRow → email
3. **(1:30–2:30) — API choices** — Why Firecrawl over raw scraping, why Serper for flexibility, why NewsAPI for the news signal column
4. **(2:30–3:30) — AI orchestration** — Explain the two-call design: Call 1 extracts structure, Call 2 generates intelligence from that structure. Show the JSON schemas.
5. **(3:30–4:00) — Deployment** — Show Vercel dashboard, explain the 60s timeout solution (Promise.all parallelism), show env vars setup
6. **(4:00–5:00) — Code quality** — Walk through error handling in enrichRow.ts, show how failed rows are handled gracefully

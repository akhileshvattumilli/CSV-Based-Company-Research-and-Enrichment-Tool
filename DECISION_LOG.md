# AI Lead Enrichment Pipeline — Decision Log

> This document tracks every architectural decision, tool choice, and technical tradeoff made during the build.
> Update this after every major prompt/session in Cursor.

---

## Project Overview

**Goal:** Accept a CSV of companies, enrich each using multiple external data sources + multi-step AI processing, and email the enriched CSV back to the user.

**Stack:** Next.js (TypeScript) · Deployed on Vercel · Claude API · Firecrawl · Serper · NewsAPI · Resend

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
    3. getNews(companyName)   → lib/news.ts       → NewsAPI
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

### D-006 · External Data Source 2: NewsAPI

**Decision:** Use NewsAPI as the second required external data source.

**Reasoning:**
- Required output column `Recent News Summary` maps directly to what NewsAPI provides.
- Returns recent news articles about any company by name or domain.
- Free developer tier allows 100 requests/day — sufficient for the assignment.
- Provides concrete, time-stamped signals (funding rounds, layoffs, product launches, regulatory issues) which directly power the `Risk Signal` and `Sales Angle` outputs.
- Note: `Data Sources Used` column logs which APIs returned real data (e.g., some small companies may have no news hits — this is handled gracefully with a fallback message).

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

**Model:** `claude-sonnet-4-20250514`
- Best balance of speed and quality for structured extraction tasks.
- Faster and cheaper than Opus, more reliable than Haiku for structured JSON output.

**JSON enforcement:** Both calls use system prompts that instruct Claude to respond only in valid JSON. `JSON.parse()` is wrapped in try/catch with a fallback empty object.

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

### D-006a · NewsAPI Wrapper Implementation (`lib/news.ts`)

**Decision:** Implement `getNews(companyName)` as a thin `fetch`-based wrapper around `https://newsapi.org/v2/everything`, returning only `{ articles: NewsArticle[] }` limited to the 5 most recent articles.

**Implementation details:**
- **No SDK** — plain `fetch()` GET request. Keeps the dependency surface small and avoids any SDK-side retry/transform behavior we don't control.
- **Query params** built with `URLSearchParams`: `q=companyName`, `sortBy=publishedAt`, `language=en`, `pageSize=5`. Requesting `pageSize=5` at the source avoids pulling the default 100-result payload just to slice it client-side.
- **Auth via header** (`X-Api-Key`) instead of query string. Keeps the API key out of URLs/logs; NewsAPI accepts both, and the header form is the safer default.
- **Env var validation** — throws immediately if `NEWS_API_KEY` is missing, so failures surface at call time rather than as a confusing 401 from NewsAPI.
- **Error propagation** — no internal `try/catch`. Network errors, non-2xx responses, and NewsAPI error payloads (`status !== 'ok'`) all throw. This matches the project-wide pattern where `enrichRow.ts` owns per-step error handling and records which sources succeeded in `Data Sources Used`.
- **Empty-results handling** — if NewsAPI returns zero articles (common for small/unknown companies), we return `{ articles: [] }` rather than throwing. No news is a valid result, not an error.
- **Response shape** — only `{ title, publishedAt, description }` per article is returned. `totalResults`, `url`, `source`, `author`, `urlToImage`, and `content` are dropped to keep the payload small for the downstream Claude call in `generateInsights`.
- **Types exported:** `NewsArticle` (per-article shape) and `NewsResult = { articles: NewsArticle[] }`. `NewsResult` is kept so the existing import in `lib/enrichRow.ts` continues to compile unchanged.

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
- `Data Sources Used` column records exactly which sources returned real data, giving full transparency.

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
│   ├── news.ts                    # NewsAPI — recent news
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
| `NEWS_API_KEY` | NewsAPI.org | Recent company news |
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

---

## Loom Video Outline (2–5 min)

Use this as a script guide:

1. **(0:00–0:30) — Demo** — Upload the sample CSV, show the enriched email arriving
2. **(0:30–1:30) — Architecture walkthrough** — Walk through the folder structure and the flow from upload → enrichRow → email
3. **(1:30–2:30) — API choices** — Why Firecrawl over raw scraping, why Serper for flexibility, why NewsAPI for the news signal column
4. **(2:30–3:30) — AI orchestration** — Explain the two-call design: Call 1 extracts structure, Call 2 generates intelligence from that structure. Show the JSON schemas.
5. **(3:30–4:00) — Deployment** — Show Vercel dashboard, explain the 60s timeout solution (Promise.all parallelism), show env vars setup
6. **(4:00–5:00) — Code quality** — Walk through error handling in enrichRow.ts, show how failed rows are handled gracefully

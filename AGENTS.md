# CSV Lead Enrichment Pipeline — Agent Rules

## Project Overview
Building a Next.js 14 application that:
1. Accepts CSV upload + recipient email
2. Enriches each company via Firecrawl, Serper, NewsAPI
3. Runs two-step Claude AI pipeline (extract → insights)
4. Sends enriched CSV via Resend email

## Critical Constraints

### Vercel Deployment (60s timeout)
- **MUST use `Promise.all()` for all 10 companies in parallel**
- Each company takes ~10-15s, parallel = stays under 60s
- Add `export const maxDuration = 60` to route.ts
- Sequential processing will timeout — never do that

### CSV Schema
**Input columns:** Company Name, Website
**Output columns:** Industry, Sub-Industry, Primary Product / Service, Target Customer (ICP), Estimated Company Size, Recent News Summary, Key Offering Summary, Sales Angle 1/2/3, Risk Signal 1/2/3, Data Sources Used

### AI Orchestration (Two Calls, Not One)
**Call 1 — extractProfile(rawData):**
- Input: Firecrawl markdown + Serper results
- Output: JSON with {industry, subIndustry, primaryProduct, targetCustomer, estimatedSize, keyOffering}
- Purpose: Extract structured facts from raw data

**Call 2 — generateInsights(profileJSON):**
- Input: Profile from Call 1 + NewsAPI results
- Output: JSON with {salesAngle1/2/3, riskSignal1/2/3, recentNewsSummary}
- Purpose: Generate sales intelligence from structured profile

Both calls must respond in valid JSON only. Use Zod to validate output schemas.

## Stack & APIs

| Component | Service | Key | Free Tier |
|---|---|---|---|
| Website scraping | Firecrawl | FIRECRAWL_API_KEY | ~100 credits |
| Search results | Serper | SERPER_API_KEY | 2,500 credits |
| Recent news | NewsAPI | NEWS_API_KEY | 100 req/day |
| AI model | Anthropic Claude | ANTHROPIC_API_KEY | Pay-per-use |
| Email delivery | Resend | RESEND_API_KEY | 3,000/month |
| Sender email | Resend | RESEND_FROM_EMAIL | onboarding@resend.dev |

## Error Handling Strategy
- **Never abort the batch** — if one company fails, log it and continue
- Each step (scrape, search, news, AI calls) wrapped in try/catch
- Failed rows show "Data unavailable" or error message
- `Data Sources Used` column logs which APIs succeeded for each row

## Code Structure & Folder Layout

app/
page.tsx                    # Upload UI (form + email input)
api/
enrich/
route.ts                # POST endpoint (main orchestrator)
lib/
enrichRow.ts                # enrichRow(company) → enriched row
scrape.ts                   # scrape(website) → markdown
search.ts                   # search(companyName) → results
news.ts                     # getNews(companyName) → articles
ai.ts                       # extractProfile(), generateInsights()
email.ts                    # sendEmail(to, csvBuffer)
.env.local                    # API keys (never commit)
DECISION_LOG.md               # Architecture decisions

## Build Order (do in this order)
1. **lib/enrichRow.ts** — Orchestrator (calls all other lib functions in sequence)
2. **lib/scrape.ts** — Firecrawl wrapper
3. **lib/search.ts** — Serper wrapper
4. **lib/news.ts** — NewsAPI wrapper
5. **lib/ai.ts** — Both Claude calls with Zod validation
6. **lib/email.ts** — Resend email with CSV attachment
7. **app/api/enrich/route.ts** — POST endpoint (uses enrichRow in Promise.all)
8. **app/page.tsx** — Upload UI

## TypeScript & Validation
- Strict mode enabled (tsconfig.json)
- Use Zod for all external API responses
- Never use `any` type
- Type all function parameters and returns

## Environment Variables Required
```env
ANTHROPIC_API_KEY=sk-ant-...
FIRECRAWL_API_KEY=fc-...
SERPER_API_KEY=...
NEWS_API_KEY=...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=onboarding@resend.dev
```

## Next Steps
1. Ensure all `.env.local` vars are set in Vercel
2. Start coding with **lib/enrichRow.ts**
3. Build top-down: enrichRow orchestrates everything below it
4. Test each lib function individually before wiring into route.ts
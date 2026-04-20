import { scrape, type ScrapeResult } from './scrape'
import { search, type SearchResponse } from './search'
import { getNews, type NewsResult } from './news'
import {
  extractProfile,
  generateInsights,
  type ProfileResult,
  type InsightsResult,
} from './ai'

export interface CompanyInput {
  'Company Name': string
  Website: string
}

export interface EnrichedCompany extends CompanyInput {
  Industry: string
  'Sub-Industry': string
  'Primary Product / Service': string
  'Target Customer (ICP)': string
  'Estimated Company Size': string
  'Recent News Summary': string
  'Key Offering Summary': string
  'Sales Angle 1': string
  'Sales Angle 2': string
  'Sales Angle 3': string
  'Risk Signal 1': string
  'Risk Signal 2': string
  'Risk Signal 3': string
  'Data Sources Used': string
}

const UNAVAILABLE = 'Data unavailable'

const emptyProfile: ProfileResult = {
  industry: UNAVAILABLE,
  subIndustry: UNAVAILABLE,
  primaryProduct: UNAVAILABLE,
  targetCustomer: UNAVAILABLE,
  estimatedSize: UNAVAILABLE,
  keyOffering: UNAVAILABLE,
}

const emptyInsights: InsightsResult = {
  salesAngle1: UNAVAILABLE,
  salesAngle2: UNAVAILABLE,
  salesAngle3: UNAVAILABLE,
  riskSignal1: UNAVAILABLE,
  riskSignal2: UNAVAILABLE,
  riskSignal3: UNAVAILABLE,
  recentNewsSummary: UNAVAILABLE,
}

export async function enrichRow(company: CompanyInput): Promise<EnrichedCompany> {
  const companyName = company['Company Name']
  const website = company.Website
  const sourcesUsed: string[] = []

  let scrapeData: ScrapeResult = { markdown: '' }
  try {
    scrapeData = await scrape(website)
    if (scrapeData.markdown.length > 0) sourcesUsed.push('Firecrawl')
  } catch (error) {
    console.error(`[enrichRow] scrape failed for ${companyName}:`, error)
  }

  let searchData: SearchResponse = { results: [] }
  try {
    searchData = await search(companyName)
    if (searchData.results.length > 0) sourcesUsed.push('Serper')
  } catch (error) {
    console.error(`[enrichRow] search failed for ${companyName}:`, error)
  }

  let newsData: NewsResult = { articles: [] }
  try {
    newsData = await getNews(companyName)
    if (newsData.articles.length > 0) sourcesUsed.push('NewsAPI')
  } catch (error) {
    console.error(`[enrichRow] getNews failed for ${companyName}:`, error)
  }

  let profile: ProfileResult = emptyProfile
  try {
    profile = await extractProfile({
      companyName,
      website,
      scrape: scrapeData,
      search: searchData,
    })
    sourcesUsed.push('Claude (profile)')
  } catch (error) {
    console.error(`[enrichRow] extractProfile failed for ${companyName}:`, error)
  }

  let insights: InsightsResult = emptyInsights
  try {
    insights = await generateInsights({
      companyName,
      profile,
      news: newsData,
    })
    sourcesUsed.push('Claude (insights)')
  } catch (error) {
    console.error(`[enrichRow] generateInsights failed for ${companyName}:`, error)
  }

  return {
    'Company Name': companyName,
    Website: website,
    Industry: profile.industry || UNAVAILABLE,
    'Sub-Industry': profile.subIndustry || UNAVAILABLE,
    'Primary Product / Service': profile.primaryProduct || UNAVAILABLE,
    'Target Customer (ICP)': profile.targetCustomer || UNAVAILABLE,
    'Estimated Company Size': profile.estimatedSize || UNAVAILABLE,
    'Recent News Summary': insights.recentNewsSummary || UNAVAILABLE,
    'Key Offering Summary': profile.keyOffering || UNAVAILABLE,
    'Sales Angle 1': insights.salesAngle1 || UNAVAILABLE,
    'Sales Angle 2': insights.salesAngle2 || UNAVAILABLE,
    'Sales Angle 3': insights.salesAngle3 || UNAVAILABLE,
    'Risk Signal 1': insights.riskSignal1 || UNAVAILABLE,
    'Risk Signal 2': insights.riskSignal2 || UNAVAILABLE,
    'Risk Signal 3': insights.riskSignal3 || UNAVAILABLE,
    'Data Sources Used': sourcesUsed.length > 0 ? sourcesUsed.join(', ') : 'None',
  }
}

// src/layers/layer1_acquisition.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — DOCUMENT ACQUISITION
// Responsibilities:
//   • Resolve company names → SEC CIK numbers via EDGAR full-text search
//   • Fetch filing index pages and locate the primary document
//   • Download PDFs or HTML filings to Apify KeyValueStore
//   • Fallback: DuckDuckGo/web search for non-US companies
// ══════════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { KeyValueStore } from 'apify';
import pRetry from 'p-retry';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Layer1:Acquisition');

// Free SEC EDGAR API endpoints (no key required)
const EDGAR_BASE = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index?q=%22{query}%22&dateRange=custom&startdt={year}-01-01&enddt={year}-12-31&forms={forms}';
const EDGAR_COMPANY_SEARCH = 'https://www.sec.gov/cgi-bin/browse-edgar?company={name}&CIK=&type={form}&dateb=&owner=include&count=10&search_text=&action=getcompany&output=atom';
const EDGAR_SUBMISSIONS = 'https://data.sec.gov/submissions/CIK{cik}.json';
const EDGAR_FILING_INDEX = 'https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/';

const USER_AGENT = 'AnnualReportExtractor/2.0 (contact@yourapp.com)';

// ── Resolve company name → CIK ─────────────────────────────────────────────
export async function resolveCompanyToCIK(companyName) {
  log.info(`Resolving company: ${companyName}`);
  const normalizedQuery = normalizeCompanyName(companyName);
  const queryLooksLikeTicker = /^[A-Z]{1,6}$/.test(companyName.trim().toUpperCase());

  // Method 1: EDGAR company search (free)
  try {
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&forms=10-K,20-F&dateRange=custom&startdt=2020-01-01&enddt=2025-12-31`;
    const resp = await axiosGet(searchUrl);
    const hits = resp.data?.hits?.hits || [];
    if (hits.length > 0) {
      const candidates = hits
        .map((hit) => hit?._source)
        .filter(Boolean)
        .map((source) => {
          const names = (source.display_names || []).filter(Boolean);
          const bestName = names[0] || source.entity_name || companyName;
          const bestNameNormalized = normalizeCompanyName(bestName);
          const ticker = source.tickers?.[0] || null;
          const tickerNormalized = (ticker || '').toUpperCase();

          let score = 0;
          if (bestNameNormalized === normalizedQuery) score += 100;
          if (bestNameNormalized.includes(normalizedQuery)) score += 40;
          if (normalizedQuery.includes(bestNameNormalized)) score += 20;
          if (tickerNormalized && queryLooksLikeTicker && tickerNormalized === companyName.trim().toUpperCase()) score += 90;

          return {
            score,
            cik: String(source.entity_id || source.cik || '').padStart(10, '0'),
            company_name: bestName,
            ticker
          };
        })
        .filter((candidate) => /^\d{10}$/.test(candidate.cik))
        .sort((a, b) => b.score - a.score);

      const top = candidates[0];
      if (top && top.score > 0) {
        return {
          cik: top.cik,
          company_name: top.company_name,
          ticker: top.ticker
        };
      }
    }
  } catch (err) {
    log.warn(`EDGAR full-text search failed for ${companyName}: ${err.message}`);
  }

  // Method 2: EDGAR browse by company name (free)
  try {
    const browseUrl = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&CIK=&type=10-K&dateb=&owner=include&count=5&search_text=&action=getcompany&output=atom`;
    const resp = await axiosGet(browseUrl, { headers: { 'Accept': 'application/xml', 'User-Agent': USER_AGENT } });
    const xml = resp.data;
    const cikMatch = xml.match(/CIK=(\d+)/);
    const nameMatch = xml.match(/<company-name>([^<]+)<\/company-name>/);
    if (cikMatch) {
      return {
        cik: cikMatch[1].padStart(10, '0'),
        company_name: nameMatch ? nameMatch[1] : companyName,
        ticker: null
      };
    }
  } catch (err) {
    log.warn(`EDGAR browse search failed: ${err.message}`);
  }

  // Method 3: EDGAR ticker lookup (free)
  try {
    const tickerResp = await axiosGet('https://www.sec.gov/files/company_tickers.json');
    const tickers = tickerResp.data;
    const normalizedSearch = normalizedQuery;
    const upperSearch = companyName.trim().toUpperCase();
    for (const [, data] of Object.entries(tickers)) {
      const normalizedName = normalizeCompanyName(data.title);
      const normalizedTicker = (data.ticker || '').toUpperCase();
      if (
        normalizedName === normalizedSearch ||
        normalizedName.includes(normalizedSearch) ||
        normalizedSearch.includes(normalizedName) ||
        (queryLooksLikeTicker && normalizedTicker === upperSearch)
      ) {
        return {
          cik: String(data.cik_str).padStart(10, '0'),
          company_name: data.title,
          ticker: data.ticker
        };
      }
    }
  } catch (err) {
    log.warn(`Ticker lookup failed: ${err.message}`);
  }

  throw new Error(`Could not resolve CIK for company: ${companyName}`);
}

// ── Get latest filing metadata for a CIK ──────────────────────────────────
export async function getLatestFilingForCIK(cik, filingTypes = ['10-K', '20-F'], targetYear = null) {
  log.info(`Fetching filing index for CIK: ${cik}`);
  
  const paddedCIK = String(cik).padStart(10, '0');
  const subUrl = `https://data.sec.gov/submissions/CIK${paddedCIK}.json`;
  
  const resp = await axiosGet(subUrl, { headers: { 'User-Agent': USER_AGENT } });
  const submissions = resp.data;
  
  const filings = submissions.filings?.recent || {};
  const forms = filings.form || [];
  const accessions = filings.accessionNumber || [];
  const dates = filings.filingDate || [];
  const docs = filings.primaryDocument || [];

  // Find matching filing
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    const date = dates[i];
    const year = date ? parseInt(date.slice(0, 4)) : null;

    if (!filingTypes.some(ft => form.startsWith(ft))) continue;
    if (targetYear && year !== targetYear && year !== targetYear - 1) continue;

    const accession = accessions[i].replace(/-/g, '');
    const primaryDoc = docs[i];
    const baseUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accession}`;

    return {
      cik: paddedCIK,
      company_name: submissions.name,
      ticker: submissions.tickers?.[0] || null,
      accession_number: accessions[i],
      filing_type: form,
      filing_date: date,
      report_year: year,
      primary_doc_url: `${baseUrl}/${primaryDoc}`,
      index_url: `${baseUrl}/${accession}-index.htm`
    };
  }

  throw new Error(`No matching ${filingTypes.join('/')} filing found for CIK ${cik}${targetYear ? ` in year ${targetYear}` : ''}`);
}

// ── Fetch all documents from a filing index page ──────────────────────────
export async function getFilingDocuments(filingMeta) {
  log.info(`Fetching filing documents from index: ${filingMeta.index_url}`);
  
  try {
    const resp = await axiosGet(filingMeta.index_url, { headers: { 'User-Agent': USER_AGENT } });
    const html = resp.data;
    
    // Parse document links from filing index
    const docRegex = /href="([^"]+\.(htm|html|pdf|txt))"[^>]*>([^<]*)<\/a>/gi;
    const docs = [];
    let match;
    
    while ((match = docRegex.exec(html)) !== null) {
      const href = match[1];
      const type = match[2].toLowerCase();
      const description = match[3].trim();
      
      if (href.includes('..') || href.startsWith('http')) continue;
      
      const baseUrl = filingMeta.index_url.replace(/-index\.htm.*$/, '');
      docs.push({
        url: href.startsWith('/') ? `https://www.sec.gov${href}` : `${baseUrl}/${href}`,
        type,
        description
      });
    }

    // Prioritize: PDF > full submission text > primary htm
    const sorted = docs.sort((a, b) => {
      const priority = { pdf: 0, htm: 1, html: 1, txt: 2 };
      return (priority[a.type] ?? 3) - (priority[b.type] ?? 3);
    });

    return sorted.length > 0 ? sorted : [{ url: filingMeta.primary_doc_url, type: 'htm', description: 'Primary Document' }];
  } catch (err) {
    log.warn(`Could not parse filing index, using primary doc: ${err.message}`);
    return [{ url: filingMeta.primary_doc_url, type: 'htm', description: 'Primary Document' }];
  }
}

// ── Download PDF or HTML to KeyValueStore ─────────────────────────────────
export async function downloadDocument(url, key, proxyConfig = null) {
  log.info(`Downloading document: ${url}`);
  
  const kvStore = await KeyValueStore.open();
  
  // Check cache first
  const cached = await kvStore.getValue(key);
  if (cached) {
    log.debug(`Cache hit for: ${key}`);
    return { key, cached: true, size: cached.length };
  }

  const axiosConfig = {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': USER_AGENT },
    timeout: 60000,
    maxContentLength: 50 * 1024 * 1024 // 50MB max
  };

  if (proxyConfig?.useApifyProxy) {
    // Apify proxy integration
    const { ProxyConfiguration } = await import('apify');
    const proxy = await ProxyConfiguration.create(proxyConfig);
    const proxyUrl = await proxy.newUrl();
    axiosConfig.proxy = false;
    axiosConfig.httpsAgent = new (await import('https-proxy-agent')).HttpsProxyAgent(proxyUrl);
  }

  const resp = await pRetry(
    () => axios.get(url, axiosConfig),
    { 
      retries: 3, 
      minTimeout: 2000,
      onFailedAttempt: (err) => log.warn(`Download attempt ${err.attemptNumber} failed: ${err.message}`)
    }
  );

  const contentType = resp.headers['content-type'] || '';
  const isPDF = contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf');
  
  await kvStore.setValue(key, Buffer.from(resp.data), {
    contentType: isPDF ? 'application/pdf' : 'text/html'
  });

  log.info(`Downloaded ${(resp.data.byteLength / 1024).toFixed(0)}KB → KVStore:${key}`);
  return { key, cached: false, size: resp.data.byteLength, isPDF, contentType };
}

// ── Pipeline: company name → downloaded document ──────────────────────────
export async function acquireFromCompanyName(companyName, options = {}) {
  const { report_year, filing_types, proxy_configuration, allow_non_sec_fallback = true } = options;
  
  let resolved;
  try {
    // Step 1: Resolve company to CIK
    resolved = await resolveCompanyToCIK(companyName);
    log.info(`Resolved "${companyName}" → CIK: ${resolved.cik}, Name: ${resolved.company_name}`);
  } catch (err) {
    if (!allow_non_sec_fallback) throw err;

    log.warn(`SEC resolution failed for "${companyName}". Trying public annual-report URL fallback.`);
    const fallbackUrl = await discoverAnnualReportUrlForCompany(companyName);
    if (!fallbackUrl) {
      throw new Error(`${err.message}. No public annual-report URL found for "${companyName}". Try input_mode:"pdf_urls" with a direct annual report link.`);
    }

    const fallbackDoc = await acquireFromURL(fallbackUrl, {
      proxy_configuration,
      company_name_override: companyName,
      report_year_override: report_year || undefined
    });

    return {
      ...fallbackDoc,
      filing_type: fallbackDoc.filing_type || 'Annual Report (web fallback)',
      source_url: fallbackDoc.source_url || fallbackUrl,
      metadata: {
        acquisition_method: 'web_fallback',
        sec_resolution_error: err.message
      }
    };
  }

  // Step 2: Find the latest annual filing
  const filingMeta = await getLatestFilingForCIK(resolved.cik, filing_types, report_year);
  log.info(`Found filing: ${filingMeta.filing_type} filed ${filingMeta.filing_date}`);

  // Step 3: Get filing documents
  const docs = await getFilingDocuments(filingMeta);
  
  // Step 4: Download the best available document
  const primaryDoc = docs[0];
  const docKey = `filing_${resolved.cik}_${filingMeta.report_year}_${Date.now()}`;
  const downloadResult = await downloadDocument(primaryDoc.url, docKey, proxy_configuration);

  return {
    ...filingMeta,
    ...resolved,
    document_key: docKey,
    document_url: primaryDoc.url,
    document_type: primaryDoc.type,
    is_pdf: downloadResult.isPDF,
    document_size_bytes: downloadResult.size
  };
}

// ── Pipeline: direct PDF URL → downloaded document ──────────────────────
export async function acquireFromURL(url, options = {}) {
  const { company_name_override = null, report_year_override = null } = options;
  const docKey = `url_doc_${Buffer.from(url).toString('base64').slice(0, 20)}_${Date.now()}`;
  const downloadResult = await downloadDocument(url, docKey, options.proxy_configuration);

  // Try to infer company/year from URL
  const yearMatch = url.match(/20\d{2}/);
  
  return {
    company_name: company_name_override || extractCompanyFromURL(url),
    report_year: report_year_override || (yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear()),
    filing_type: 'Annual Report',
    source_url: url,
    document_key: docKey,
    document_url: url,
    document_type: downloadResult.isPDF ? 'pdf' : 'html',
    is_pdf: downloadResult.isPDF,
    document_size_bytes: downloadResult.size
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function axiosGet(url, config = {}) {
  return pRetry(
    () => axios.get(url, { 
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
      ...config 
    }),
    { retries: 2, minTimeout: 1500 }
  );
}

function extractCompanyFromURL(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace('www.', '').split('.')[0].replace(/-/g, ' ');
  } catch {
    return 'Unknown Company';
  }
}

function normalizeCompanyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(inc|corp|corporation|co|company|plc|ltd|limited|holdings?|group)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function discoverAnnualReportUrlForCompany(companyName) {
  const query = `${companyName} annual report pdf`;
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const resp = await axiosGet(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html'
      }
    });

    const html = String(resp.data || '');
    const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>/gi)]
      .map((m) => decodeURIComponent(m[1]))
      .filter((href) => href.startsWith('http'))
      .filter((href) => !href.includes('duckduckgo.com'))
      .filter((href) => {
        const lower = href.toLowerCase();
        return lower.endsWith('.pdf') || lower.includes('annual') || lower.includes('investor');
      });

    return links[0] || null;
  } catch (err) {
    log.warn(`Web fallback discovery failed for "${companyName}": ${err.message}`);
    return null;
  }
}

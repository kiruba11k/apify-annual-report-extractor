// src/layers/layer1_acquisition.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — MULTI-SOURCE DOCUMENT ACQUISITION
// Sources (tried in order):
//   1. SEC EDGAR — US public companies (10-K, 20-F), free API
//   2. annualreports.com — curated PDFs for global companies
//   3. Investor Relations page discovery — common IR URL patterns
//   4. SEDAR+ (Canada), Companies House (UK), ASX (Australia)
//   5. Web search fallback (DuckDuckGo + Bing scraping)
// ══════════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import * as cheerio from 'cheerio';
import { KeyValueStore } from 'apify';
import pRetry from 'p-retry';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Layer1:Acquisition');

const USER_AGENT = 'AnnualReportExtractor/3.0 (research@annualreportextractor.com)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Normalise / validate CIK ─────────────────────────────────────────────────
function normalizeCIK(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits || digits === '0') return null;
  return String(parseInt(digits, 10)).padStart(10, '0');
}

function resolveSourceCIK(source) {
  const candidates = [
    source?.cik,
    ...(Array.isArray(source?.ciks) ? source.ciks : []),
    source?.entity_id
  ];
  for (const c of candidates) {
    const cik = normalizeCIK(c);
    if (cik) return cik;
  }
  return null;
}

function normalizeCompanyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(inc|corp|corporation|co|company|plc|ltd|limited|holdings?|group|sa|ag|nv|bv|se)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function extractCompanyFromURL(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace('www.', '').split('.')[0].replace(/-/g, ' ');
  } catch {
    return 'Unknown Company';
  }
}

// ─── Shared axios helper ───────────────────────────────────────────────────────
async function axiosGet(url, config = {}) {
  return pRetry(
    () => axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
      ...config
    }),
    {
      retries: 3,
      minTimeout: 1500,
      factor: 1.8,
      onFailedAttempt: (err) =>
        log.debug(`GET ${url} attempt ${err.attemptNumber} failed: ${err.message}`)
    }
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 1 — SEC EDGAR
// ══════════════════════════════════════════════════════════════════════════════

export async function resolveCompanyToCIK(companyName) {
  log.info(`Resolving company via EDGAR: ${companyName}`);
  const normalizedQuery = normalizeCompanyName(companyName);
  const queryLooksLikeTicker = /^[A-Z]{1,6}$/.test(companyName.trim().toUpperCase());

  // Method 1: EDGAR full-text search
  try {
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&forms=10-K,20-F&dateRange=custom&startdt=2018-01-01&enddt=2026-12-31`;
    const resp = await axiosGet(searchUrl);
    const hits = resp.data?.hits?.hits || [];
    if (hits.length > 0) {
      const candidates = hits
        .map(hit => hit?._source).filter(Boolean)
        .map(source => {
          const names = (source.display_names || []).filter(Boolean);
          const bestName = names[0] || source.entity_name || companyName;
          const ticker = source.tickers?.[0] || null;
          const tickerUp = (ticker || '').toUpperCase();
          const resolvedCik = resolveSourceCIK(source);
          const bNN = normalizeCompanyName(bestName);

          let score = 0;
          if (bNN === normalizedQuery) score += 100;
          else if (bNN.includes(normalizedQuery)) score += 40;
          else if (normalizedQuery.includes(bNN)) score += 20;
          if (queryLooksLikeTicker && tickerUp === companyName.trim().toUpperCase()) score += 90;

          return { score, cik: resolvedCik, company_name: bestName, ticker };
        })
        .filter(c => c.cik)
        .sort((a, b) => b.score - a.score);

      const top = candidates[0];
      if (top && top.score > 0) {
        return { cik: top.cik, company_name: top.company_name, ticker: top.ticker };
      }
    }
  } catch (err) {
    log.warn(`EDGAR full-text search failed for ${companyName}: ${err.message}`);
  }

  // Method 2: EDGAR browse
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

  // Method 3: EDGAR ticker file
  try {
    const tickerResp = await axiosGet('https://www.sec.gov/files/company_tickers.json');
    const tickers = tickerResp.data;
    const upperSearch = companyName.trim().toUpperCase();
    for (const [, data] of Object.entries(tickers)) {
      const nName = normalizeCompanyName(data.title);
      const nTicker = (data.ticker || '').toUpperCase();
      if (
        nName === normalizedQuery ||
        nName.includes(normalizedQuery) ||
        normalizedQuery.includes(nName) ||
        (queryLooksLikeTicker && nTicker === upperSearch)
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

  throw new Error(`Could not resolve EDGAR CIK for: ${companyName}`);
}

export async function getLatestFilingForCIK(cik, filingTypes = ['10-K', '20-F'], targetYear = null) {
  log.info(`Fetching filing index for CIK: ${cik}`);
  const paddedCIK = normalizeCIK(cik);
  if (!paddedCIK) throw new Error(`Invalid CIK: ${cik}`);

  const cikInt = parseInt(paddedCIK, 10);
  const subUrl = `https://data.sec.gov/submissions/CIK${paddedCIK}.json`;
  const resp = await axiosGet(subUrl, { headers: { 'User-Agent': USER_AGENT } });
  const submissions = resp.data;

  const filings = submissions.filings?.recent || {};
  const forms = filings.form || [];
  const accessions = filings.accessionNumber || [];
  const dates = filings.filingDate || [];
  const docs = filings.primaryDocument || [];

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    const date = dates[i];
    const year = date ? parseInt(date.slice(0, 4)) : null;

    if (!filingTypes.some(ft => form.startsWith(ft))) continue;
    if (targetYear && year !== targetYear && year !== targetYear - 1) continue;

    const accession = accessions[i].replace(/-/g, '');
    const primaryDoc = docs[i];
    const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accession}`;

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

  // Also check older filings pages (EDGAR paginates)
  try {
    const olderFilings = submissions.filings?.files || [];
    for (const fileRef of olderFilings.slice(0, 3)) {
      const olderResp = await axiosGet(`https://data.sec.gov${fileRef.name}`, { headers: { 'User-Agent': USER_AGENT } });
      const older = olderResp.data;
      const oForms = older.form || [];
      const oAccessions = older.accessionNumber || [];
      const oDates = older.filingDate || [];
      const oDocs = older.primaryDocument || [];

      for (let i = 0; i < oForms.length; i++) {
        const form = oForms[i];
        const date = oDates[i];
        const year = date ? parseInt(date.slice(0, 4)) : null;
        if (!filingTypes.some(ft => form.startsWith(ft))) continue;
        if (targetYear && year !== targetYear && year !== targetYear - 1) continue;

        const accession = oAccessions[i].replace(/-/g, '');
        const primaryDoc = oDocs[i];
        const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accession}`;

        return {
          cik: paddedCIK,
          company_name: submissions.name,
          ticker: submissions.tickers?.[0] || null,
          accession_number: oAccessions[i],
          filing_type: form,
          filing_date: date,
          report_year: year,
          primary_doc_url: `${baseUrl}/${primaryDoc}`,
          index_url: `${baseUrl}/${accession}-index.htm`
        };
      }
    }
  } catch (_) { /* ignore */ }

  throw new Error(`No matching ${filingTypes.join('/')} filing found for CIK ${cik}${targetYear ? ` in year ${targetYear}` : ''}`);
}

export async function getFilingDocuments(filingMeta) {
  log.info(`Fetching filing document index: ${filingMeta.index_url}`);
  try {
    const resp = await axiosGet(filingMeta.index_url, { headers: { 'User-Agent': USER_AGENT } });
    const html = resp.data;
    const $ = cheerio.load(html);
    const docs = [];

    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;
      const desc = $(cells[1]).text().trim();
      const link = $(cells[2]).find('a').attr('href');
      if (!link) return;
      const type = link.split('.').pop().toLowerCase();
      const url = link.startsWith('/') ? `https://www.sec.gov${link}` : link;
      docs.push({ url, type, description: desc });
    });

    // Fallback: regex-based parse
    if (docs.length === 0) {
      const docRegex = /href="([^"]+\.(htm|html|pdf|txt))"[^>]*>([^<]*)<\/a>/gi;
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
    }

    const sorted = docs.sort((a, b) => {
      const priority = { pdf: 0, htm: 1, html: 1, txt: 2 };
      return (priority[a.type] ?? 3) - (priority[b.type] ?? 3);
    });

    // Prefer the actual annual report doc, not exhibits
    const filtered = sorted.filter(d =>
      !d.description.toLowerCase().includes('exhibit') &&
      !d.description.toLowerCase().includes('ex-')
    );

    return (filtered.length > 0 ? filtered : sorted).length > 0
      ? (filtered.length > 0 ? filtered : sorted)
      : [{ url: filingMeta.primary_doc_url, type: 'htm', description: 'Primary Document' }];
  } catch (err) {
    log.warn(`Could not parse filing index: ${err.message}`);
    return [{ url: filingMeta.primary_doc_url, type: 'htm', description: 'Primary Document' }];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 2 — annualreports.com
// ══════════════════════════════════════════════════════════════════════════════

async function searchAnnualReportsCom(companyName, targetYear = null) {
  log.info(`Searching annualreports.com for: ${companyName}`);
  try {
    const searchUrl = `https://www.annualreports.com/Companies?search=${encodeURIComponent(companyName)}`;
    const resp = await axiosGet(searchUrl, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
      timeout: 20000
    });
    const $ = cheerio.load(resp.data);

    const results = [];
    // annualreports.com uses company links in the format /HostedData/AnnualReports/...
    $('a[href*="/HostedData/AnnualReports"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.endsWith('.pdf') || href.includes('PDF'))) {
        const yearMatch = href.match(/20\d{2}/);
        const year = yearMatch ? parseInt(yearMatch[0]) : null;
        if (!targetYear || year === targetYear || year === targetYear - 1 || !year) {
          const fullUrl = href.startsWith('http') ? href : `https://www.annualreports.com${href}`;
          results.push({ url: fullUrl, year, source: 'annualreports.com' });
        }
      }
    });

    // Also check company page links
    $('a.company-link, .company-name a, h3 a, h2 a').each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href');
      if (!href) return;
      if (normalizeCompanyName(text).includes(normalizeCompanyName(companyName)) ||
          normalizeCompanyName(companyName).includes(normalizeCompanyName(text))) {
        const fullUrl = href.startsWith('http') ? href : `https://www.annualreports.com${href}`;
        results.push({ url: fullUrl, year: null, source: 'annualreports.com', needsVisit: true });
      }
    });

    // Try to visit company page to get direct PDF link
    for (const r of results.filter(r => r.needsVisit).slice(0, 2)) {
      try {
        const pageResp = await axiosGet(r.url, {
          headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
          timeout: 15000
        });
        const $page = cheerio.load(pageResp.data);
        $page('a[href*=".pdf"], a[href*="PDF"], a[href*="Annual"]').each((_, el) => {
          const href = $page(el).attr('href');
          if (!href) return;
          const yearMatch = href.match(/20\d{2}/);
          const year = yearMatch ? parseInt(yearMatch[0]) : null;
          const fullUrl = href.startsWith('http') ? href : `https://www.annualreports.com${href}`;
          results.push({ url: fullUrl, year, source: 'annualreports.com' });
        });
      } catch (_) { /* ignore */ }
    }

    // Sort: prefer target year, then most recent
    const pdfs = results.filter(r => !r.needsVisit && r.url.toLowerCase().includes('.pdf'));
    pdfs.sort((a, b) => {
      if (targetYear) {
        if (a.year === targetYear && b.year !== targetYear) return -1;
        if (b.year === targetYear && a.year !== targetYear) return 1;
      }
      return (b.year || 0) - (a.year || 0);
    });

    return pdfs[0]?.url || null;
  } catch (err) {
    log.warn(`annualreports.com search failed for "${companyName}": ${err.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 3 — Investor Relations page discovery
// ══════════════════════════════════════════════════════════════════════════════

const IR_PATH_PATTERNS = [
  '/investor-relations/annual-reports',
  '/investors/annual-reports',
  '/ir/annual-reports',
  '/annual-reports',
  '/investor-relations/financial-information/annual-reports',
  '/investors/financial-information/annual-reports',
  '/about/investors/annual-reports',
  '/en/investors/annual-reports',
  '/en/investor-relations/annual-reports',
  '/corporate/investors/annual-reports',
];

const IR_SUBDOMAIN_PATTERNS = [
  'ir',
  'investors',
  'investor-relations',
];

async function discoverIRPagePDF(companyName, targetYear = null) {
  log.info(`Trying IR page discovery for: ${companyName}`);

  // Guess domain slug from company name
  const slug = companyName.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');

  const domains = [
    `${slug}.com`,
    `${slug}corp.com`,
    `${slug}inc.com`,
    `${slug}group.com`,
    `${slug}.co`,
  ];

  const urlsToTry = [];
  for (const domain of domains) {
    // Subdomain patterns
    for (const sub of IR_SUBDOMAIN_PATTERNS) {
      urlsToTry.push(`https://${sub}.${domain}/`);
    }
    // Path patterns
    for (const path of IR_PATH_PATTERNS) {
      urlsToTry.push(`https://www.${domain}${path}`);
      urlsToTry.push(`https://${domain}${path}`);
    }
  }

  for (const irUrl of urlsToTry.slice(0, 15)) {
    try {
      const resp = await axios.get(irUrl, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
        timeout: 8000,
        maxRedirects: 5
      });
      if (resp.status !== 200) continue;

      const $ = cheerio.load(resp.data);
      const pdfLinks = [];

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim().toLowerCase();
        if (!href) return;

        const isRelevant =
          href.toLowerCase().endsWith('.pdf') ||
          text.includes('annual report') ||
          text.includes('annual review') ||
          href.toLowerCase().includes('annual') ||
          href.toLowerCase().includes('annual-report');

        if (isRelevant) {
          const fullUrl = href.startsWith('http') ? href : new URL(href, irUrl).href;
          const yearMatch = (href + text).match(/20\d{2}/);
          const year = yearMatch ? parseInt(yearMatch[0]) : null;
          pdfLinks.push({ url: fullUrl, year });
        }
      });

      if (pdfLinks.length > 0) {
        pdfLinks.sort((a, b) => {
          if (targetYear) {
            if (a.year === targetYear) return -1;
            if (b.year === targetYear) return 1;
          }
          return (b.year || 0) - (a.year || 0);
        });
        log.info(`Found IR PDF at ${irUrl}: ${pdfLinks[0].url}`);
        return pdfLinks[0].url;
      }
    } catch (_) { /* try next */ }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 4 — International registries
// ══════════════════════════════════════════════════════════════════════════════

async function searchSedarPlus(companyName, targetYear = null) {
  log.info(`Searching SEDAR+ for: ${companyName}`);
  try {
    const searchUrl = `https://www.sedarplus.ca/csa-party/records/search.html?companyName=${encodeURIComponent(companyName)}&docType=Annual+Report`;
    const resp = await axiosGet(searchUrl, {
      headers: { 'User-Agent': BROWSER_UA },
      timeout: 15000
    });
    const $ = cheerio.load(resp.data);
    const links = [];
    $('a[href$=".pdf"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `https://www.sedarplus.ca${href}`;
        const yearMatch = href.match(/20\d{2}/);
        links.push({ url: fullUrl, year: yearMatch ? parseInt(yearMatch[0]) : null });
      }
    });
    links.sort((a, b) => (b.year || 0) - (a.year || 0));
    return links[0]?.url || null;
  } catch (err) {
    log.debug(`SEDAR+ search failed: ${err.message}`);
    return null;
  }
}

async function searchCompaniesHouseUK(companyName) {
  log.info(`Searching Companies House (UK) for: ${companyName}`);
  try {
    const searchUrl = `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(companyName)}`;
    const resp = await axiosGet(searchUrl, {
      headers: { 'User-Agent': BROWSER_UA },
      timeout: 15000
    });
    const $ = cheerio.load(resp.data);
    // Companies House links to filing pages, not direct PDFs
    const companyLink = $('a[href*="/company/"]').first().attr('href');
    if (companyLink) {
      const filingUrl = `https://find-and-update.company-information.service.gov.uk${companyLink}/filing-history?type=AA&dateTo=&dateFrom=`;
      const filingResp = await axiosGet(filingUrl, {
        headers: { 'User-Agent': BROWSER_UA },
        timeout: 15000
      });
      const $f = cheerio.load(filingResp.data);
      const docLink = $f('a[href*="/document"]').first().attr('href');
      if (docLink) {
        return `https://find-and-update.company-information.service.gov.uk${docLink}`;
      }
    }
  } catch (err) {
    log.debug(`Companies House search failed: ${err.message}`);
  }
  return null;
}

async function searchASX(companyName) {
  log.info(`Searching ASX for: ${companyName}`);
  try {
    const searchUrl = `https://www.asx.com.au/asx/1/company/${encodeURIComponent(companyName.toUpperCase())}/announcements?count=20&market_sensitive=false`;
    const resp = await axiosGet(searchUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 15000
    });
    const items = resp.data?.data || [];
    const annualReports = items.filter(item =>
      item.header?.toLowerCase().includes('annual report') ||
      item.header?.toLowerCase().includes('annual review')
    );
    if (annualReports.length > 0 && annualReports[0].url) {
      return annualReports[0].url;
    }
  } catch (err) {
    log.debug(`ASX search failed: ${err.message}`);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE 5 — Web search fallback
// ══════════════════════════════════════════════════════════════════════════════

async function webSearchForAnnualReport(companyName, targetYear = null) {
  const yearStr = targetYear ? ` ${targetYear}` : '';
  const queries = [
    `"${companyName}" annual report${yearStr} filetype:pdf`,
    `${companyName} annual report${yearStr} PDF investor relations`,
    `${companyName}${yearStr} 10-K annual report SEC filing`,
    `${companyName} annual report${yearStr} site:annualreports.com OR site:ir.* OR site:investors.*`
  ];

  // Try DuckDuckGo
  for (const query of queries) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const resp = await axiosGet(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
        timeout: 15000
      });
      const $ = cheerio.load(resp.data);
      const links = [];

      $('a.result__url, a[href*="uddg="], .result__a').each((_, el) => {
        let href = $(el).attr('href') || '';
        // DuckDuckGo result links are encoded
        const uddgMatch = href.match(/uddg=([^&]+)/);
        if (uddgMatch) href = decodeURIComponent(uddgMatch[1]);
        if (!href.startsWith('http')) return;
        const lower = href.toLowerCase();
        const isPDF = lower.endsWith('.pdf');
        const isRelevant =
          lower.includes('annual') ||
          lower.includes('investor') ||
          lower.includes('10-k') ||
          lower.includes('20-f');
        if (isPDF || isRelevant) links.push(href);
      });

      // Prefer PDF links
      const pdfs = links.filter(l => l.toLowerCase().endsWith('.pdf'));
      if (pdfs.length > 0) return pdfs[0];
      if (links.length > 0) return links[0];
    } catch (err) {
      log.debug(`DuckDuckGo query failed: ${err.message}`);
    }
  }

  // Try Bing (scrape)
  try {
    const query = `${companyName} annual report${yearStr} PDF`;
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    const resp = await axiosGet(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
      timeout: 15000
    });
    const $ = cheerio.load(resp.data);
    const links = [];

    $('li.b_algo a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !href.startsWith('http')) return;
      const lower = href.toLowerCase();
      if (lower.endsWith('.pdf') || lower.includes('annual') || lower.includes('investor')) {
        links.push(href);
      }
    });

    const pdfs = links.filter(l => l.toLowerCase().endsWith('.pdf'));
    if (pdfs.length > 0) return pdfs[0];
    if (links.length > 0) return links[0];
  } catch (err) {
    log.debug(`Bing search failed: ${err.message}`);
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT DOWNLOAD
// ══════════════════════════════════════════════════════════════════════════════

export async function downloadDocument(url, key, proxyConfig = null) {
  log.info(`Downloading document: ${url}`);

  const kvStore = await KeyValueStore.open();
  const cached = await kvStore.getValue(key);
  if (cached) {
    log.debug(`Cache hit for: ${key}`);
    return { key, cached: true, size: cached.length };
  }

  const isSEC = /(^|\.)sec\.gov$/i.test(new URL(url).hostname);

  const axiosConfig = {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': BROWSER_UA,
      'User-Agent': isSEC ? USER_AGENT : BROWSER_UA,
      'Accept': 'application/pdf,text/html,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 90000,
    maxContentLength: 100 * 1024 * 1024, // 100MB
    maxRedirects: 10
  };

  if (proxyConfig?.useApifyProxy) {
    const { ProxyConfiguration } = await import('apify');
    const proxy = await ProxyConfiguration.create(proxyConfig);
    const proxyUrl = await proxy.newUrl();
    axiosConfig.proxy = false;
    axiosConfig.httpsAgent = new (await import('https-proxy-agent')).HttpsProxyAgent(proxyUrl);
  }

  const resp = await pRetry(
    () => axios.get(url, axiosConfig),
    {
      retries: 4,
      minTimeout: 2000,
      factor: 2,
      onFailedAttempt: (err) =>
        log.warn(`Download attempt ${err.attemptNumber} failed for ${url}: ${err.message}`)
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

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE: company name → downloaded document
// ══════════════════════════════════════════════════════════════════════════════

export async function acquireFromCompanyName(companyName, options = {}) {
  const {
    report_year,
    filing_types = ['10-K', '20-F'],
    proxy_configuration,
    allow_non_sec_fallback = true,
    preferred_sources = ['sec', 'annualreports', 'ir_page', 'international', 'web_search']
  } = options;

  // ── Try SEC EDGAR first ──────────────────────────────────────────────────
  if (preferred_sources.includes('sec')) {
    try {
      const resolved = await resolveCompanyToCIK(companyName);
      log.info(`Resolved "${companyName}" → CIK: ${resolved.cik}, Name: ${resolved.company_name}`);

      const filingMeta = await getLatestFilingForCIK(resolved.cik, filing_types, report_year);
      log.info(`Found filing: ${filingMeta.filing_type} filed ${filingMeta.filing_date}`);

      const docs = await getFilingDocuments(filingMeta);
      const primaryDoc = docs[0];
      const docKey = `filing_${resolved.cik}_${filingMeta.report_year}_${Date.now()}`;
      const downloadResult = await downloadDocument(primaryDoc.url, docKey, proxy_configuration);

      return {
        ...filingMeta,
        ...resolved,
        document_key: docKey,
        document_url: primaryDoc.url,
        source_url: primaryDoc.url,
        document_type: primaryDoc.type,
        is_pdf: downloadResult.isPDF,
        document_size_bytes: downloadResult.size,
        acquisition_source: 'sec_edgar'
      };
    } catch (err) {
      log.warn(`SEC EDGAR acquisition failed for "${companyName}": ${err.message}`);
      if (!allow_non_sec_fallback) throw err;
    }
  }

  if (!allow_non_sec_fallback) {
    throw new Error(`SEC resolution failed for "${companyName}" and fallback is disabled.`);
  }

  // ── Fallback source cascade ──────────────────────────────────────────────
  const fallbackSources = [
    {
      name: 'annualreports.com',
      enabled: preferred_sources.includes('annualreports'),
      fn: () => searchAnnualReportsCom(companyName, report_year)
    },
    {
      name: 'ir_page',
      enabled: preferred_sources.includes('ir_page'),
      fn: () => discoverIRPagePDF(companyName, report_year)
    },
    {
      name: 'sedar+',
      enabled: preferred_sources.includes('international'),
      fn: () => searchSedarPlus(companyName, report_year)
    },
    {
      name: 'asx',
      enabled: preferred_sources.includes('international'),
      fn: () => searchASX(companyName)
    },
    {
      name: 'companies_house',
      enabled: preferred_sources.includes('international'),
      fn: () => searchCompaniesHouseUK(companyName)
    },
    {
      name: 'web_search',
      enabled: preferred_sources.includes('web_search'),
      fn: () => webSearchForAnnualReport(companyName, report_year)
    }
  ];

  for (const source of fallbackSources.filter(s => s.enabled)) {
    try {
      log.info(`Trying source: ${source.name} for "${companyName}"`);
      const url = await source.fn();
      if (!url) continue;

      log.info(`Found URL via ${source.name}: ${url}`);
      const fallbackDoc = await acquireFromURL(url, {
        proxy_configuration,
        company_name_override: companyName,
        report_year_override: report_year || undefined
      });

      return {
        ...fallbackDoc,
        filing_type: fallbackDoc.filing_type || `Annual Report (${source.name})`,
        source_url: url,
        acquisition_source: source.name,
        metadata: { acquisition_method: source.name }
      };
    } catch (err) {
      log.warn(`Source ${source.name} failed for "${companyName}": ${err.message}`);
    }
  }

  throw new Error(
    `All acquisition sources failed for "${companyName}". ` +
    `Tried: SEC EDGAR, annualreports.com, IR page discovery, international registries, web search. ` +
    `Try using input_mode:"pdf_urls" with a direct annual report link.`
  );
}

// ── Pipeline: direct URL → downloaded document ────────────────────────────────
export async function acquireFromURL(url, options = {}) {
  const { company_name_override = null, report_year_override = null } = options;
  const docKey = `url_doc_${Buffer.from(url).toString('base64').slice(0, 20)}_${Date.now()}`;
  const downloadResult = await downloadDocument(url, docKey, options.proxy_configuration);

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
    document_size_bytes: downloadResult.size,
    acquisition_source: 'direct_url'
  };
}

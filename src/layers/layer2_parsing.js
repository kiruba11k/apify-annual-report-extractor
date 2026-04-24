// src/layers/layer2_parsing.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 2 — DOCUMENT PARSING
// Responsibilities:
//   • Extract raw text from PDFs with page-level granularity
//   • Parse HTML filings (SEC EDGAR HTM format)
//   • Segment text into logical sections (MD&A, Risk Factors, Capital Resources…)
//   • Build a page-indexed corpus for downstream extraction
//   • Detect tables and extract financial figures
// ══════════════════════════════════════════════════════════════════════════════

import { KeyValueStore } from 'apify';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Layer2:Parsing');

// Known section headers in annual reports / 10-K filings
const SECTION_PATTERNS = {
  'MD&A': [
    /management.{0,20}discussion.{0,20}analysis/i,
    /results of operations/i,
    /overview of results/i
  ],
  'Risk Factors': [
    /risk factors/i,
    /risks and uncertainties/i,
    /principal risks/i
  ],
  'Capital Resources': [
    /capital resources/i,
    /liquidity and capital/i,
    /capital expenditures/i,
    /capital allocation/i
  ],
  'Strategy': [
    /our strategy/i,
    /strategic priorities/i,
    /strategic objectives/i,
    /business strategy/i,
    /strategic initiatives/i,
    /key priorities/i
  ],
  'Digital & Technology': [
    /digital transformation/i,
    /technology investments/i,
    /information technology/i,
    /digital initiatives/i,
    /technology strategy/i
  ],
  'Outlook': [
    /outlook/i,
    /forward.looking/i,
    /guidance/i,
    /future plans/i
  ],
  'Business Overview': [
    /business overview/i,
    /about our company/i,
    /description of business/i,
    /our business/i
  ],
  'Investments': [
    /investments/i,
    /investing activities/i,
    /acquisitions/i,
    /capital deployment/i
  ]
};

// ─────────────────────────────────────────────────────────────────────────────

// ── Main entry: parse a document from KeyValueStore ─────────────────────────
export async function parseDocument(documentKey, options = {}) {
  const { max_pages = 200 } = options;
  
  log.info(`Parsing document: ${documentKey}`);
  const kvStore = await KeyValueStore.open();
  const value = await kvStore.getValue(documentKey);
  
  if (!value) {
    throw new Error(`Document not found in KeyValueStore: ${documentKey}`);
  }

  const isPDF = detectPDF(value);
  
  let parsed;
  if (isPDF) {
    parsed = await parsePDF(value, max_pages);
  } else {
    // HTML/HTM (SEC EDGAR format)
    parsed = await parseHTML(value.toString('utf-8'), max_pages);
  }

  // Post-process: segment into sections
  parsed.sections = segmentIntoSections(parsed.pages);
  parsed.financial_figures = extractFinancialFigures(parsed.full_text);
  
  log.info(`Parsed ${parsed.total_pages} pages, ${parsed.sections.length} sections identified`);
  return parsed;
}

function detectPDF(value) {
  if (!value) return false;
  if (Buffer.isBuffer(value)) return value.subarray(0, 4).toString('ascii') === '%PDF';
  if (typeof value === 'string') return value.startsWith('%PDF');
  return false;
}

// ── PDF Parsing ─────────────────────────────────────────────────────────────
async function parsePDF(buffer, maxPages) {
  const pdfParse = (await import('pdf-parse')).default;
  
  const pages = [];
  let totalPages = 0;
  
  try {
    const options = {
      max: maxPages > 0 ? maxPages : 0,
      // Page render callback to capture per-page text
      pagerender: async (pageData) => {
        const textContent = await pageData.getTextContent();
        const pageText = textContent.items
          .map(item => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        pages.push({
          page_number: pageData.pageIndex + 1,
          text: pageText,
          char_count: pageText.length
        });
        
        return pageText;
      }
    };

    const data = await pdfParse(buffer, options);
    totalPages = data.numpages;

    // If pagerender didn't populate (some PDF versions), fall back to full text split
    if (pages.length === 0) {
      const fullText = data.text;
      const estimatedPages = Math.ceil(fullText.length / 3000);
      const chunkSize = Math.ceil(fullText.length / estimatedPages);
      
      for (let i = 0; i < estimatedPages; i++) {
        pages.push({
          page_number: i + 1,
          text: fullText.slice(i * chunkSize, (i + 1) * chunkSize),
          char_count: chunkSize,
          estimated: true
        });
      }
    }

    const full_text = pages.map(p => p.text).join('\n\n');
    
    return {
      format: 'pdf',
      total_pages: totalPages,
      pages_processed: pages.length,
      pages,
      full_text,
      metadata: {
        info: data.info,
        metadata: data.metadata
      }
    };
  } catch (err) {
    log.error(`PDF parse failed: ${err.message}`);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
}

// ── HTML Parsing (SEC EDGAR .htm format) ────────────────────────────────────
async function parseHTML(html, maxPages) {
  // Cheerio's transitive undici dependency expects a global File constructor.
  // Node.js 18 does not always expose globalThis.File, so polyfill from node:buffer.
  if (typeof globalThis.File === 'undefined') {
    const { File } = await import('node:buffer');
    globalThis.File = File;
  }

  const { load } = await import('cheerio');
  const $ = load(html);
  
  // Remove boilerplate elements
  $('script, style, nav, header, footer, .menu, #menu').remove();
  
  // Extract main content
  const content = $('body').text() || $.root().text();
  const cleanText = content
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Simulate page breaks (SEC filings use <hr> or page-break classes)
  const pageBreakElements = $('hr, .page-break, [style*="page-break"]');
  const pages = [];
  
  if (pageBreakElements.length > 0) {
    // Use actual page breaks
    let pageNum = 1;
    let currentText = '';
    
    $('body').children().each((_, el) => {
      const elHtml = $(el).prop('tagName');
      if (elHtml === 'HR' || $(el).hasClass('page-break')) {
        if (currentText.trim()) {
          pages.push({ page_number: pageNum++, text: currentText.trim(), char_count: currentText.length });
        }
        currentText = '';
      } else {
        currentText += $(el).text() + '\n';
      }
    });
    if (currentText.trim()) {
      pages.push({ page_number: pageNum, text: currentText.trim(), char_count: currentText.length });
    }
  } else {
    // Chunk by estimated page size (~3500 chars = ~1 page)
    const PAGE_SIZE = 3500;
    const chunks = Math.ceil(cleanText.length / PAGE_SIZE);
    const limitedChunks = maxPages > 0 ? Math.min(chunks, maxPages) : chunks;
    
    for (let i = 0; i < limitedChunks; i++) {
      const text = cleanText.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
      pages.push({
        page_number: i + 1,
        text,
        char_count: text.length,
        estimated: true
      });
    }
  }

  return {
    format: 'html',
    total_pages: pages.length,
    pages_processed: pages.length,
    pages,
    full_text: cleanText,
    metadata: {
      title: $('title').text(),
      has_tables: $('table').length > 0
    }
  };
}

// ── Section Segmentation ────────────────────────────────────────────────────
export function segmentIntoSections(pages) {
  const sections = [];
  let currentSection = { name: 'Preamble', start_page: 1, end_page: null, pages: [] };

  for (const page of pages) {
    let matched = false;
    
    for (const [sectionName, patterns] of Object.entries(SECTION_PATTERNS)) {
      for (const pattern of patterns) {
        // Check first 300 chars of page (headers are at top)
        if (pattern.test(page.text.slice(0, 300))) {
          // Save previous section
          currentSection.end_page = page.page_number - 1;
          if (currentSection.pages.length > 0) {
            sections.push({ ...currentSection });
          }
          // Start new section
          currentSection = {
            name: sectionName,
            start_page: page.page_number,
            end_page: null,
            pages: [page]
          };
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    
    if (!matched) {
      currentSection.pages.push(page);
    }
  }

  // Close last section
  currentSection.end_page = pages[pages.length - 1]?.page_number || 1;
  if (currentSection.pages.length > 0) {
    sections.push(currentSection);
  }

  return sections.map(s => ({
    ...s,
    text: s.pages.map(p => p.text).join('\n'),
    page_count: s.pages.length
  }));
}

// ── Financial Figure Extraction ──────────────────────────────────────────────
export function extractFinancialFigures(text) {
  const figures = [];
  
  // Patterns for dollar amounts with context
  const patterns = [
    { regex: /capital expenditures?(?:[^$\d]{0,50})\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)/gi, label: 'capex' },
    { regex: /\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)\s+(?:in\s+)?(?:capital|capex|infrastructure)/gi, label: 'capex' },
    { regex: /(?:invest(?:ing|ed|ment))[^$\d]{0,40}\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)/gi, label: 'investment' },
    { regex: /(?:digital|technology|IT)\s+(?:spend|investment|budget)[^$\d]{0,40}\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)/gi, label: 'digital_spend' },
    { regex: /(?:R&D|research and development)[^$\d]{0,40}\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B|M)/gi, label: 'rd_spend' }
  ];

  for (const { regex, label } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      const unit = match[2]?.toLowerCase();
      const multiplier = (unit === 'billion' || unit === 'b') ? 1e9 : 1e6;
      
      figures.push({
        label,
        raw: match[0].trim(),
        amount_usd: amount * multiplier,
        formatted: `$${match[1]}${unit ? ' ' + unit : ''}`,
        context: text.slice(Math.max(0, match.index - 100), match.index + 200)
      });
    }
  }

  // Deduplicate similar amounts
  const seen = new Set();
  return figures.filter(f => {
    const key = `${f.label}_${f.amount_usd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Get focused sections for extraction ─────────────────────────────────────
export function getFocusedContent(parsedDoc, focusAreas = []) {
  const focusMap = {
    'capex_focus': ['Capital Resources', 'MD&A', 'Investments'],
    'digital_initiatives': ['Digital & Technology', 'MD&A', 'Strategy'],
    'investment_areas': ['Investments', 'Capital Resources', 'MD&A'],
    'strategic_priorities': ['Strategy', 'Business Overview', 'Outlook'],
    'risk_mentions': ['Risk Factors'],
    'intent_signals': ['MD&A', 'Outlook', 'Strategy', 'Business Overview']
  };

  const targetSections = new Set();
  for (const area of focusAreas) {
    (focusMap[area] || []).forEach(s => targetSections.add(s));
  }

  // Always include top pages (executive summary area)
  const topPages = parsedDoc.pages.slice(0, 10).map(p => p.text).join('\n');

  const relevantSections = parsedDoc.sections
    .filter(s => targetSections.has(s.name))
    .map(s => ({
      name: s.name,
      text: s.text.slice(0, 8000), // Cap at 8K chars per section
      start_page: s.start_page,
      end_page: s.end_page
    }));

  return {
    top_pages_text: topPages,
    sections: relevantSections,
    financial_figures: parsedDoc.financial_figures,
    total_pages: parsedDoc.total_pages
  };
}

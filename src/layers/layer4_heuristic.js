// src/layers/layer4_heuristic.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 4 — HEURISTIC FALLBACK EXTRACTION
// Pure regex + NLP pattern matching when AI providers are unavailable
// Produces lower fidelity but zero-cost, always-available results
// Used as: primary when no API keys, or to cross-validate AI results
// ══════════════════════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';

const log = createLogger('Layer4:Heuristic');

// ── Keyword Dictionaries ─────────────────────────────────────────────────────
const CAPEX_KEYWORDS = {
  'Data Center / Cloud Infrastructure': ['data center', 'cloud infrastructure', 'server capacity', 'computing infrastructure', 'hyperscale'],
  'Manufacturing / Production': ['manufacturing', 'production capacity', 'factory', 'plant expansion', 'assembly'],
  'Real Estate / Facilities': ['real estate', 'facilities', 'office space', 'retail footprint', 'store openings'],
  'Supply Chain / Logistics': ['supply chain', 'logistics', 'distribution center', 'warehouse', 'fulfillment'],
  'R&D / Innovation': ['research and development', 'r&d', 'innovation', 'product development', 'lab'],
  'Energy / Utilities': ['renewable energy', 'solar', 'wind', 'energy infrastructure', 'grid'],
  'Transportation / Fleet': ['fleet', 'transportation', 'vehicles', 'aircraft', 'shipping vessels'],
  'Digital Infrastructure': ['digital infrastructure', 'network', 'fiber', '5g', 'broadband'],
  'Sustainability / ESG': ['sustainability', 'carbon neutral', 'esg', 'green', 'environmental']
};

const DIGITAL_KEYWORDS = {
  high: ['digital transformation', 'ai-first', 'technology-led', 'digital at core', 'cloud-native'],
  medium: ['digital initiatives', 'technology investment', 'automation', 'digitization', 'digital platform'],
  low: ['digital tools', 'it systems', 'software update', 'system upgrade'],
  ai_ml: ['artificial intelligence', 'machine learning', 'large language model', 'generative ai', 'deep learning', 'neural network', 'ai-powered'],
  cloud: ['cloud migration', 'cloud adoption', 'aws', 'azure', 'google cloud', 'saas', 'multi-cloud'],
  cybersecurity: ['cybersecurity', 'information security', 'zero trust', 'data protection', 'soc 2']
};

const STRATEGIC_PATTERNS = [
  { pattern: /our (?:top|key|primary|main|core) (?:priority|priorities|focus|objective|goal)(?:ies)?[^.]{0,200}/gi, category: 'growth' },
  { pattern: /we (?:intend|plan|will|aim|expect) to (?:invest|expand|grow|accelerate|launch|build|acquire)[^.]{0,200}/gi, category: 'expansion' },
  { pattern: /strategic (?:priority|initiative|goal|objective|focus)[^.]{0,200}/gi, category: 'strategy' },
  { pattern: /(?:accelerat|expand|grow|scale)[^.]{0,100}(?:market|revenue|capacity|footprint)[^.]{0,100}/gi, category: 'growth' },
  { pattern: /(?:cost reduction|efficiency|streamline|optimize|rationalize)[^.]{0,200}/gi, category: 'efficiency' }
];

const RISK_PATTERNS = {
  macroeconomic: [/inflation/gi, /interest rate/gi, /recession/gi, /economic downturn/gi, /currency fluctuation/gi],
  geopolitical: [/geopolit/gi, /trade war/gi, /tariff/gi, /sanction/gi, /ukraine/gi, /china.*risk/gi, /taiwan/gi],
  regulatory: [/regulat/gi, /compliance/gi, /legislation/gi, /antitrust/gi, /gdpr/gi, /sec.*rule/gi],
  cybersecurity: [/cyber/gi, /ransomware/gi, /data breach/gi, /hack/gi, /phishing/gi, /information security risk/gi],
  supply_chain: [/supply chain/gi, /supplier/gi, /shortage/gi, /disruption.*supply/gi, /raw material/gi],
  competitive: [/competition/gi, /competitor/gi, /market share/gi, /pricing pressure/gi, /disrupt/gi],
  climate: [/climate change/gi, /extreme weather/gi, /carbon/gi, /esg.*risk/gi, /environmental regulation/gi],
  labor: [/talent/gi, /workforce/gi, /retention/gi, /labor market/gi, /key personnel/gi],
  technology: [/technology.*obsolescence/gi, /ai.*disrupt/gi, /emerging technology/gi, /tech.*risk/gi]
};

const INTENT_SCORING = {
  expansion: ['expand', 'grow', 'scale', 'enter new market', 'geographic expansion', 'new product'],
  consolidation: ['consolidate', 'merge', 'combine', 'integrate', 'streamline operations'],
  transformation: ['transform', 'reinvent', 'pivot', 'restructure', 'new business model'],
  optimization: ['optimize', 'efficiency', 'reduce cost', 'margin improvement', 'productivity'],
  acquisition_mode: ['acquire', 'acquisition', 'm&a', 'bolt-on', 'inorganic growth', 'strategic transaction'],
  divestiture_mode: ['divest', 'sell non-core', 'spin-off', 'portfolio simplification', 'exit'],
  innovation_push: ['innovation', 'r&d investment', 'new technology', 'breakthrough', 'patent'],
  defense: ['protect market share', 'defend', 'competitive response', 'maintain position']
};

// ── Main Heuristic Extractor ─────────────────────────────────────────────────
export async function heuristicExtract(parsedDoc, focusedContent, filingMeta, options = {}) {
  log.info('Running heuristic extraction (free baseline)');
  
  const { pages, full_text } = parsedDoc;
  const { min_evidence_confidence = 0.5 } = options;
  
  const results = {
    capex_focus: [],
    capex_total_mentioned: null,
    investment_areas: [],
    digital_spend_indicator: 'none_mentioned',
    digital_initiatives: [],
    strategic_priorities: [],
    risk_mentions: [],
    intent_signal: 'mixed',
    intent_reasoning: '',
    evidence: []
  };

  // ── Extract CapEx focus ──────────────────────────────────────────────────
  const capexResult = extractCapex(pages, full_text);
  results.capex_focus = capexResult.focus;
  results.capex_total_mentioned = capexResult.total;
  results.evidence.push(...capexResult.evidence);

  // ── Extract digital signals ──────────────────────────────────────────────
  const digitalResult = extractDigital(pages, full_text);
  results.digital_spend_indicator = digitalResult.indicator;
  results.digital_initiatives = digitalResult.initiatives;
  results.evidence.push(...digitalResult.evidence);

  // ── Extract strategic priorities ─────────────────────────────────────────
  const strategyResult = extractStrategicPriorities(pages, full_text);
  results.strategic_priorities = strategyResult.priorities;
  results.investment_areas = strategyResult.investment_areas;
  results.evidence.push(...strategyResult.evidence);

  // ── Extract risks ────────────────────────────────────────────────────────
  const riskResult = extractRisks(pages, full_text);
  results.risk_mentions = riskResult.risks;
  results.evidence.push(...riskResult.evidence);

  // ── Determine intent signal ──────────────────────────────────────────────
  const intentResult = determineIntent(full_text);
  results.intent_signal = intentResult.signal;
  results.intent_reasoning = intentResult.reasoning;

  // ── Filter by confidence ──────────────────────────────────────────────────
  results.evidence = results.evidence
    .filter(e => e.confidence >= min_evidence_confidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50); // Max 50 evidence items from heuristic

  log.info(`Heuristic extraction: ${results.evidence.length} evidence items, ${results.capex_focus.length} capex themes`);
  return results;
}

// ── CapEx Extraction ─────────────────────────────────────────────────────────
function extractCapex(pages, fullText) {
  const focus = [];
  const evidence = [];
  let total = null;

  // Find total capex
  const totalMatch = fullText.match(
    /capital expenditures?[^$\d]{0,60}\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B\b|M\b)/i
  );
  if (totalMatch) {
    total = `$${totalMatch[1]} ${totalMatch[2]}`;
  }

  // Detect capex categories
  for (const [category, keywords] of Object.entries(CAPEX_KEYWORDS)) {
    for (const keyword of keywords) {
      const regex = new RegExp(`(?:invest|capex|capital|spend)[^.]{0,100}${keyword}|${keyword}[^.]{0,100}(?:invest|capex|capital|spend)`, 'gi');
      
      for (const page of pages) {
        const matches = page.text.match(regex);
        if (matches && !focus.includes(category)) {
          focus.push(category);
          
          evidence.push({
            text: matches[0].slice(0, 250),
            page: page.page_number,
            section: 'Capital Resources',
            confidence: 0.72,
            signal_type: 'capex_commitment'
          });
          break;
        }
      }
    }
  }

  return { focus, total, evidence };
}

// ── Digital Signal Extraction ────────────────────────────────────────────────
function extractDigital(pages, fullText) {
  const initiatives = [];
  const evidence = [];
  let score = 0;

  const textLower = fullText.toLowerCase();

  // Score digital intensity
  DIGITAL_KEYWORDS.high.forEach(kw => { if (textLower.includes(kw)) score += 3; });
  DIGITAL_KEYWORDS.medium.forEach(kw => { if (textLower.includes(kw)) score += 2; });
  DIGITAL_KEYWORDS.low.forEach(kw => { if (textLower.includes(kw)) score += 1; });

  let indicator = 'none_mentioned';
  if (score >= 10) indicator = 'digital_transformation_core';
  else if (score >= 6) indicator = 'high_digital_priority';
  else if (score >= 3) indicator = 'moderate_digital_investment';
  else if (score >= 1) indicator = 'low_digital_focus';

  // Extract specific digital mentions with page refs
  const allDigitalKws = [...DIGITAL_KEYWORDS.ai_ml, ...DIGITAL_KEYWORDS.cloud, ...DIGITAL_KEYWORDS.cybersecurity];
  
  for (const page of pages) {
    for (const keyword of allDigitalKws) {
      const idx = page.text.toLowerCase().indexOf(keyword);
      if (idx !== -1) {
        const excerpt = page.text.slice(Math.max(0, idx - 50), idx + 200).trim();
        const initiative = excerpt.slice(0, 120);
        
        if (!initiatives.includes(initiative) && initiatives.length < 10) {
          initiatives.push(initiative);
          evidence.push({
            text: excerpt,
            page: page.page_number,
            section: 'Digital & Technology',
            confidence: 0.68,
            signal_type: 'digital_initiative'
          });
        }
      }
    }
  }

  return { indicator, initiatives, evidence };
}

// ── Strategic Priority Extraction ───────────────────────────────────────────
function extractStrategicPriorities(pages, fullText) {
  const priorities = [];
  const investmentAreas = [];
  const evidence = [];
  const seen = new Set();

  for (const { pattern, category } of STRATEGIC_PATTERNS) {
    const matches = fullText.matchAll(pattern);
    for (const match of matches) {
      const text = match[0].trim().slice(0, 200);
      const key = text.slice(0, 60).toLowerCase();
      
      if (seen.has(key) || text.length < 30) continue;
      seen.add(key);
      
      if (priorities.length < 8) {
        priorities.push(text.replace(/\s+/g, ' '));
      }

      // Find page reference
      const pageNum = findPageForText(pages, text.slice(0, 50));
      
      evidence.push({
        text: text,
        page: pageNum,
        section: 'Strategy',
        confidence: 0.65,
        signal_type: 'strategic_priority'
      });

      // Check if this contains an investment area
      const investMatch = text.match(/invest[^.]{0,80}(?:in\s+)([\w\s]+?)(?:\s*(?:and|,|\.|to))/i);
      if (investMatch) {
        investmentAreas.push({
          area: investMatch[1].trim(),
          magnitude: 'mentioned',
          amount_usd: null,
          timeframe: null,
          evidence_pages: [pageNum]
        });
      }
    }
  }

  return { priorities, investment_areas: investmentAreas, evidence };
}

// ── Risk Extraction ──────────────────────────────────────────────────────────
function extractRisks(pages, fullText) {
  const risks = [];
  const evidence = [];
  const seen = new Set();

  for (const [category, patterns] of Object.entries(RISK_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = fullText.matchAll(pattern);
      for (const match of matches) {
        const start = Math.max(0, match.index - 100);
        const end = Math.min(fullText.length, match.index + 300);
        const context = fullText.slice(start, end).replace(/\s+/g, ' ').trim();
        
        const key = `${category}_${match[0].toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const pageNum = findPageForText(pages, match[0]);
        const severity = determineSeverity(context);
        
        // Filter: only include if context is specific enough
        if (context.length < 80 || isGenericRisk(context)) continue;

        risks.push({
          risk_category: category,
          description: context.slice(0, 250),
          severity,
          pages: [pageNum],
          actionability: extractActionability(context)
        });

        evidence.push({
          text: context.slice(0, 200),
          page: pageNum,
          section: 'Risk Factors',
          confidence: 0.66,
          signal_type: 'risk_disclosure'
        });

        if (risks.length >= 15) break;
      }
      if (risks.length >= 15) break;
    }
  }

  return { risks, evidence };
}

// ── Intent Determination ─────────────────────────────────────────────────────
function determineIntent(fullText) {
  const textLower = fullText.toLowerCase();
  const scores = {};

  for (const [signal, keywords] of Object.entries(INTENT_SCORING)) {
    scores[signal] = keywords.reduce((sum, kw) => {
      const count = (textLower.match(new RegExp(kw, 'g')) || []).length;
      return sum + count;
    }, 0);
  }

  const topSignal = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const secondSignal = Object.entries(scores).sort((a, b) => b[1] - a[1])[1];
  
  const isMixed = topSignal[1] > 0 && secondSignal[1] >= topSignal[1] * 0.7;
  const signal = isMixed ? 'mixed' : (topSignal[1] > 0 ? topSignal[0] : 'mixed');
  
  const reasoning = `Heuristic analysis detected strongest signals for "${topSignal[0]}" ` +
    `(${topSignal[1]} keyword matches) and "${secondSignal[0]}" (${secondSignal[1]} matches). ` +
    `Signal determined as "${signal}" based on relative keyword frequency across the filing.`;

  return { signal, reasoning, scores };
}

// ── Utility Helpers ──────────────────────────────────────────────────────────
function findPageForText(pages, searchText) {
  const needle = searchText.slice(0, 30).toLowerCase();
  for (const page of pages) {
    if (page.text.toLowerCase().includes(needle)) {
      return page.page_number;
    }
  }
  return 1;
}

function determineSeverity(context) {
  const lower = context.toLowerCase();
  if (/material(?:ly)? adverse|critical|severe|significant.*harm|catastrophic/.test(lower)) return 'critical';
  if (/significant|substantial|major|serious|could.*material/.test(lower)) return 'high';
  if (/may|could|potential|possible/.test(lower)) return 'medium';
  return 'low';
}

function isGenericRisk(text) {
  const genericPhrases = [
    'we face competition',
    'general economic conditions',
    'changes in laws',
    'market conditions may change'
  ];
  const lower = text.toLowerCase();
  return genericPhrases.some(phrase => lower.includes(phrase));
}

function extractActionability(context) {
  const actionMatch = context.match(
    /(?:we|the company)\s+(?:have|has|will|intend to|plan to|mitigate|address|manage|monitor)[^.]{0,200}/i
  );
  return actionMatch ? actionMatch[0].trim() : null;
}

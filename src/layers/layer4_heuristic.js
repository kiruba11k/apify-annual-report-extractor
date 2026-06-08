// src/layers/layer4_heuristic.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 4 — ENHANCED HEURISTIC FALLBACK EXTRACTION
// Zero-cost, always-available regex + NLP pattern matching.
// Used when no AI keys are provided, or to cross-validate AI results.
// ══════════════════════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';

const log = createLogger('Layer4:Heuristic');

// ── Keyword Dictionaries ───────────────────────────────────────────────────────
const CAPEX_KEYWORDS = {
  'Data Center / Cloud Infrastructure': [
    'data center', 'datacenter', 'cloud infrastructure', 'server capacity',
    'computing infrastructure', 'hyperscale', 'colocation', 'network capacity',
    'compute capacity', 'storage infrastructure', 'cloud buildout'
  ],
  'Manufacturing / Production': [
    'manufacturing', 'production capacity', 'factory', 'plant expansion',
    'assembly', 'fabrication', 'semiconductor fab', 'gigafactory',
    'production line', 'manufacturing footprint', 'new facility'
  ],
  'Real Estate / Facilities': [
    'real estate', 'facilities', 'office space', 'retail footprint',
    'store openings', 'campus expansion', 'headquarters', 'branch network',
    'leasehold improvements', 'property investment'
  ],
  'Supply Chain / Logistics': [
    'supply chain', 'logistics', 'distribution center', 'warehouse',
    'fulfillment center', 'last-mile', 'cold chain', 'freight',
    'supply network', 'procurement infrastructure'
  ],
  'R&D / Innovation': [
    'research and development', 'r&d', 'innovation', 'product development',
    'lab', 'pilot plant', 'research center', 'technology development',
    'product roadmap investment', 'next-generation'
  ],
  'Energy / Utilities': [
    'renewable energy', 'solar', 'wind', 'energy infrastructure', 'grid',
    'power plant', 'battery storage', 'energy transition', 'clean energy',
    'electrification', 'hydrogen', 'nuclear'
  ],
  'Transportation / Fleet': [
    'fleet', 'transportation', 'vehicles', 'aircraft', 'shipping vessels',
    'rolling stock', 'ev fleet', 'autonomous vehicles', 'mobility'
  ],
  'Digital Infrastructure': [
    'digital infrastructure', 'network', 'fiber', '5g', 'broadband',
    'telecom infrastructure', 'spectrum', 'cell tower', 'it infrastructure',
    'edge computing', 'iot infrastructure'
  ],
  'Sustainability / ESG': [
    'sustainability', 'carbon neutral', 'esg', 'green', 'environmental',
    'net zero', 'emissions reduction', 'circular economy', 'water management',
    'biodiversity', 'social impact investment'
  ],
  'Retail / Consumer Experience': [
    'store renovation', 'retail experience', 'customer-facing', 'omnichannel',
    'point-of-sale', 'checkout technology', 'store format', 'customer experience'
  ]
};

const DIGITAL_KEYWORDS = {
  high: [
    'digital transformation', 'ai-first', 'technology-led', 'digital at core',
    'cloud-native', 'digital-first', 'data-driven company', 'ai strategy',
    'platform business', 'technology company'
  ],
  medium: [
    'digital initiatives', 'technology investment', 'automation', 'digitization',
    'digital platform', 'technology modernization', 'digital capabilities',
    'enterprise software', 'tech stack', 'digital channels', 'digital products'
  ],
  low: [
    'digital tools', 'it systems', 'software update', 'system upgrade',
    'digital marketing', 'website', 'mobile app', 'crm'
  ],
  ai_ml: [
    'artificial intelligence', 'machine learning', 'large language model',
    'generative ai', 'gen ai', 'deep learning', 'neural network', 'ai-powered',
    'predictive analytics', 'computer vision', 'natural language processing',
    'foundation model', 'llm', 'copilot', 'ai assistant', 'recommendation engine'
  ],
  cloud: [
    'cloud migration', 'cloud adoption', 'aws', 'azure', 'google cloud',
    'saas', 'multi-cloud', 'hybrid cloud', 'cloud-first', 'cloud spend',
    'cloud services', 'microsoft 365', 'salesforce', 'workday', 'servicenow'
  ],
  cybersecurity: [
    'cybersecurity', 'information security', 'zero trust', 'data protection',
    'soc 2', 'iso 27001', 'endpoint security', 'threat detection',
    'security operations', 'vulnerability management', 'devsecops', 'siem'
  ],
  data_analytics: [
    'data analytics', 'data warehouse', 'data lake', 'business intelligence',
    'real-time data', 'data platform', 'analytics platform', 'data mesh',
    'data governance', 'master data management'
  ],
  automation: [
    'robotic process automation', 'rpa', 'intelligent automation',
    'process automation', 'workflow automation', 'smart factory',
    'autonomous operations'
  ]
};

const STRATEGIC_PATTERNS = [
  { pattern: /our (?:top|key|primary|main|core|strategic) (?:priority|priorities|focus|objective|goal)(?:ies)?[^.]{0,250}/gi, category: 'growth' },
  { pattern: /we (?:intend|plan|will|aim|expect|are committed) to (?:invest|expand|grow|accelerate|launch|build|acquire|develop|deliver)[^.]{0,250}/gi, category: 'expansion' },
  { pattern: /strategic (?:priority|initiative|goal|objective|focus|direction|roadmap)[^.]{0,250}/gi, category: 'strategy' },
  { pattern: /(?:accelerat|expand|grow|scale)[^.]{0,100}(?:market|revenue|capacity|footprint|customer|presence)[^.]{0,100}/gi, category: 'growth' },
  { pattern: /(?:cost reduction|efficiency gain|streamline|optimize|rationalize|operational excellence)[^.]{0,250}/gi, category: 'efficiency' },
  { pattern: /(?:invest|investing|investment) (?:in|of|across)[^.]{0,250}/gi, category: 'investment' },
  { pattern: /(?:long.term|medium.term|next \d+ years)[^.]{0,250}/gi, category: 'outlook' },
  { pattern: /capital allocation[^.]{0,250}/gi, category: 'capital' },
  { pattern: /return on (?:capital|equity|investment|assets)[^.]{0,200}/gi, category: 'returns' }
];

const RISK_PATTERNS = {
  macroeconomic: [
    /inflation/gi, /interest rate/gi, /recession/gi, /economic downturn/gi,
    /currency fluctuation/gi, /foreign exchange/gi, /forex risk/gi,
    /commodity price/gi, /cost of capital/gi, /credit market/gi
  ],
  geopolitical: [
    /geopolit/gi, /trade war/gi, /tariff/gi, /sanction/gi,
    /ukraine/gi, /china.*risk/gi, /taiwan/gi, /russia/gi,
    /trade restriction/gi, /export control/gi, /market access/gi
  ],
  regulatory: [
    /regulat/gi, /compliance/gi, /legislation/gi, /antitrust/gi,
    /gdpr/gi, /sec.*rule/gi, /tax reform/gi, /environmental regulation/gi,
    /data privacy/gi, /ai regulation/gi, /eu ai act/gi
  ],
  cybersecurity: [
    /cyber/gi, /ransomware/gi, /data breach/gi, /hack/gi,
    /phishing/gi, /information security risk/gi, /malware/gi,
    /ddos/gi, /supply chain attack/gi, /zero.day/gi
  ],
  supply_chain: [
    /supply chain/gi, /supplier/gi, /shortage/gi, /disruption.*supply/gi,
    /raw material/gi, /single.source/gi, /component shortage/gi,
    /lead time/gi, /inventory risk/gi, /logistics disruption/gi
  ],
  competitive: [
    /competition/gi, /competitor/gi, /market share/gi, /pricing pressure/gi,
    /disrupt/gi, /new entrant/gi, /substitute product/gi, /commoditization/gi
  ],
  climate: [
    /climate change/gi, /extreme weather/gi, /carbon/gi, /esg.*risk/gi,
    /environmental regulation/gi, /physical risk/gi, /transition risk/gi,
    /net zero/gi, /stranded asset/gi
  ],
  labor: [
    /talent/gi, /workforce/gi, /retention/gi, /labor market/gi,
    /key personnel/gi, /union/gi, /wage inflation/gi, /attrition/gi,
    /skills shortage/gi, /remote work/gi
  ],
  technology: [
    /technology.*obsolescence/gi, /ai.*disrupt/gi, /emerging technology/gi,
    /tech.*risk/gi, /legacy system/gi, /technical debt/gi,
    /platform dependency/gi, /vendor lock.in/gi
  ],
  financial: [
    /liquidity risk/gi, /debt covenant/gi, /credit risk/gi,
    /impairment/gi, /goodwill write/gi, /pension liability/gi,
    /derivatives.*risk/gi, /market risk/gi
  ],
  operational: [
    /operational risk/gi, /business continuity/gi, /disaster recovery/gi,
    /systems failure/gi, /process failure/gi, /quality control/gi
  ]
};

const INTENT_SCORING = {
  expansion: ['expand', 'grow', 'scale', 'enter new market', 'geographic expansion', 'new product', 'new geography', 'launch', 'new vertical'],
  consolidation: ['consolidate', 'merge', 'combine', 'integrate', 'streamline operations', 'simplify', 'reduce complexity'],
  transformation: ['transform', 'reinvent', 'pivot', 'restructure', 'new business model', 'fundamental change', 'shift to'],
  optimization: ['optimize', 'efficiency', 'reduce cost', 'margin improvement', 'productivity', 'cost discipline', 'operational excellence'],
  acquisition_mode: ['acquire', 'acquisition', 'm&a', 'bolt-on', 'inorganic growth', 'strategic transaction', 'tuck-in', 'buyout'],
  divestiture_mode: ['divest', 'sell non-core', 'spin-off', 'portfolio simplification', 'exit', 'carve-out', 'deconsolidate'],
  innovation_push: ['innovation', 'r&d investment', 'new technology', 'breakthrough', 'patent', 'research investment', 'next-generation', 'cutting-edge'],
  defense: ['protect market share', 'defend', 'competitive response', 'maintain position', 'resilience', 'moat', 'pricing power']
};

// ── Financial figure patterns ──────────────────────────────────────────────────
const FINANCIAL_PATTERNS = [
  { regex: /capital expenditures?\s+(?:were|of|was|totaled?|amounted? to)?\s*\$?([\d,.]+)\s*(billion|million|B\b|M\b)/gi, label: 'capex_stated' },
  { regex: /capex\s+(?:of|was|were|is|totaled?)?\s*\$?([\d,.]+)\s*(billion|million|B\b|M\b)/gi, label: 'capex_stated' },
  { regex: /invested?\s+\$?([\d,.]+)\s*(billion|million|B\b|M\b)\s+in\s+(?:capital|infrastructure|technology)/gi, label: 'investment_stated' },
  { regex: /(?:digital|technology)\s+(?:investment|spend|spending|budget)\s+(?:of|was|is)?\s*\$?([\d,.]+)\s*(billion|million|B\b|M\b)/gi, label: 'digital_spend_stated' },
  { regex: /r&d\s+(?:expense|investment|spend)\s+(?:of|was|totaled?)?\s*\$?([\d,.]+)\s*(billion|million|B\b|M\b)/gi, label: 'rd_stated' }
];

// ── Main Heuristic Extractor ───────────────────────────────────────────────────
export async function heuristicExtract(parsedDoc, focusedContent, filingMeta, options = {}) {
  log.info('Running enhanced heuristic extraction (free baseline)');

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

  const capexResult = extractCapex(pages, full_text);
  results.capex_focus = capexResult.focus;
  results.capex_total_mentioned = capexResult.total;
  results.evidence.push(...capexResult.evidence);

  const digitalResult = extractDigital(pages, full_text);
  results.digital_spend_indicator = digitalResult.indicator;
  results.digital_initiatives = digitalResult.initiatives;
  results.evidence.push(...digitalResult.evidence);

  const strategyResult = extractStrategicPriorities(pages, full_text);
  results.strategic_priorities = strategyResult.priorities;
  results.investment_areas = strategyResult.investment_areas;
  results.evidence.push(...strategyResult.evidence);

  const riskResult = extractRisks(pages, full_text);
  results.risk_mentions = riskResult.risks;
  results.evidence.push(...riskResult.evidence);

  const intentResult = determineIntent(full_text);
  results.intent_signal = intentResult.signal;
  results.intent_reasoning = intentResult.reasoning;

  // Extract stated financial figures
  const financialFigures = extractStatedFinancials(full_text);
  if (financialFigures.capex && !results.capex_total_mentioned) {
    results.capex_total_mentioned = financialFigures.capex;
  }

  results.evidence = results.evidence
    .filter(e => e.confidence >= min_evidence_confidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 60);

  log.info(`Heuristic extraction: ${results.evidence.length} evidence items, ${results.capex_focus.length} capex themes, ${results.risk_mentions.length} risks`);
  return results;
}

// ── CapEx Extraction ───────────────────────────────────────────────────────────
function extractCapex(pages, fullText) {
  const focus = [];
  const evidence = [];
  let total = null;

  // Extract stated total capex
  const totalPatterns = [
    /capital expenditures?[^$\d]{0,60}\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B\b|M\b)/i,
    /capex[^$\d]{0,40}\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B\b|M\b)/i,
    /purchases? of property[^$\d]{0,60}\$?([\d,]+(?:\.\d+)?)\s*(billion|million|B\b|M\b)/i
  ];
  for (const pat of totalPatterns) {
    const m = fullText.match(pat);
    if (m) { total = `$${m[1]} ${m[2]}`; break; }
  }

  for (const [category, keywords] of Object.entries(CAPEX_KEYWORDS)) {
    let categoryFound = false;
    for (const keyword of keywords) {
      if (categoryFound) break;
      const regex = new RegExp(
        `(?:invest|capex|capital|spend|spending|expenditure|allocat)[^.]{0,120}${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|` +
        `${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]{0,120}(?:invest|capex|capital|spend|build|expand)`,
        'gi'
      );

      for (const page of pages) {
        const matches = [...page.text.matchAll(regex)];
        if (matches.length > 0 && !focus.includes(category)) {
          focus.push(category);
          categoryFound = true;
          evidence.push({
            text: matches[0][0].slice(0, 280),
            page: page.page_number,
            section: 'Capital Resources',
            confidence: 0.74,
            signal_type: 'capex_commitment'
          });
          break;
        }
      }
    }
  }

  return { focus, total, evidence };
}

// ── Digital Signal Extraction ──────────────────────────────────────────────────
function extractDigital(pages, fullText) {
  const initiatives = [];
  const evidence = [];
  let score = 0;

  const textLower = fullText.toLowerCase();

  DIGITAL_KEYWORDS.high.forEach(kw => { if (textLower.includes(kw)) score += 3; });
  DIGITAL_KEYWORDS.medium.forEach(kw => { if (textLower.includes(kw)) score += 2; });
  DIGITAL_KEYWORDS.low.forEach(kw => { if (textLower.includes(kw)) score += 1; });

  let indicator = 'none_mentioned';
  if (score >= 12) indicator = 'digital_transformation_core';
  else if (score >= 7) indicator = 'high_digital_priority';
  else if (score >= 3) indicator = 'moderate_digital_investment';
  else if (score >= 1) indicator = 'low_digital_focus';

  const allDigitalKws = [
    ...DIGITAL_KEYWORDS.ai_ml,
    ...DIGITAL_KEYWORDS.cloud,
    ...DIGITAL_KEYWORDS.cybersecurity,
    ...DIGITAL_KEYWORDS.data_analytics,
    ...DIGITAL_KEYWORDS.automation
  ];

  const seen = new Set();
  for (const page of pages) {
    for (const keyword of allDigitalKws) {
      const idx = page.text.toLowerCase().indexOf(keyword);
      if (idx === -1) continue;
      const excerpt = page.text.slice(Math.max(0, idx - 60), idx + 220).trim();
      const key = excerpt.slice(0, 80).toLowerCase();
      if (seen.has(key) || initiatives.length >= 12) continue;
      seen.add(key);
      const initiative = excerpt.slice(0, 140);
      initiatives.push(initiative);
      evidence.push({
        text: excerpt,
        page: page.page_number,
        section: 'Digital & Technology',
        confidence: 0.70,
        signal_type: 'digital_initiative'
      });
    }
  }

  return { indicator, initiatives, evidence };
}

// ── Strategic Priority Extraction ──────────────────────────────────────────────
function extractStrategicPriorities(pages, fullText) {
  const priorities = [];
  const investmentAreas = [];
  const evidence = [];
  const seen = new Set();

  for (const { pattern, category } of STRATEGIC_PATTERNS) {
    const matches = [...fullText.matchAll(pattern)];
    for (const match of matches) {
      const text = match[0].trim().slice(0, 230);
      const key = text.slice(0, 70).toLowerCase();

      if (seen.has(key) || text.length < 30) continue;
      seen.add(key);

      if (priorities.length < 10) {
        priorities.push(text.replace(/\s+/g, ' '));
      }

      const pageNum = findPageForText(pages, text.slice(0, 50));
      evidence.push({
        text,
        page: pageNum,
        section: 'Strategy',
        confidence: 0.67,
        signal_type: 'strategic_priority'
      });

      const investMatch = text.match(/invest[^.]{0,100}(?:in\s+)([\w\s,]+?)(?:\s*(?:and|,|\.|to\s+(?:improve|drive|accelerate)))/i);
      if (investMatch && investMatch[1].length < 60) {
        investmentAreas.push({
          area: investMatch[1].trim(),
          magnitude: detectMagnitude(text),
          amount_usd: extractAmount(text),
          timeframe: extractTimeframe(text),
          evidence_pages: [pageNum]
        });
      }
    }
  }

  return { priorities, investment_areas: investmentAreas, evidence };
}

// ── Risk Extraction ────────────────────────────────────────────────────────────
function extractRisks(pages, fullText) {
  const risks = [];
  const evidence = [];
  const seen = new Set();

  for (const [category, patterns] of Object.entries(RISK_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = [...fullText.matchAll(pattern)];
      for (const match of matches) {
        const start = Math.max(0, match.index - 120);
        const end = Math.min(fullText.length, match.index + 350);
        const context = fullText.slice(start, end).replace(/\s+/g, ' ').trim();

        const key = `${category}_${match[0].toLowerCase().slice(0, 30)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const pageNum = findPageForText(pages, match[0]);
        const severity = determineSeverity(context);

        if (context.length < 80 || isGenericRisk(context)) continue;

        risks.push({
          risk_category: category,
          description: context.slice(0, 280),
          severity,
          pages: [pageNum],
          actionability: extractActionability(context)
        });

        evidence.push({
          text: context.slice(0, 220),
          page: pageNum,
          section: 'Risk Factors',
          confidence: 0.68,
          signal_type: 'risk_disclosure'
        });

        if (risks.length >= 20) break;
      }
      if (risks.length >= 20) break;
    }
    if (risks.length >= 20) break;
  }

  return { risks, evidence };
}

// ── Intent Determination ───────────────────────────────────────────────────────
function determineIntent(fullText) {
  const textLower = fullText.toLowerCase();
  const scores = {};

  for (const [signal, keywords] of Object.entries(INTENT_SCORING)) {
    scores[signal] = keywords.reduce((sum, kw) => {
      return sum + (textLower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    }, 0);
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topSignal, secondSignal] = sorted;

  const isMixed = topSignal[1] > 0 && secondSignal[1] >= topSignal[1] * 0.75;
  const signal = isMixed ? 'mixed' : (topSignal[1] > 0 ? topSignal[0] : 'mixed');

  const reasoning =
    `Heuristic: strongest signal "${topSignal[0]}" (${topSignal[1]} matches), ` +
    `second "${secondSignal[0]}" (${secondSignal[1]} matches). ` +
    `Intent classified as "${signal}".`;

  return { signal, reasoning, scores };
}

// ── Stated Financials Extraction ──────────────────────────────────────────────
function extractStatedFinancials(fullText) {
  const figures = {};
  for (const { regex, label } of FINANCIAL_PATTERNS) {
    const matches = [...fullText.matchAll(regex)];
    if (matches.length > 0) {
      const m = matches[0];
      if (!figures[label]) {
        figures[label] = `$${m[1]} ${m[2]}`;
      }
    }
  }
  return {
    capex: figures.capex_stated || null,
    investment: figures.investment_stated || null,
    digital_spend: figures.digital_spend_stated || null,
    rd: figures.rd_stated || null
  };
}

// ── Utility Helpers ────────────────────────────────────────────────────────────
function findPageForText(pages, searchText) {
  const needle = searchText.slice(0, 40).toLowerCase();
  for (const page of pages) {
    if (page.text.toLowerCase().includes(needle)) return page.page_number;
  }
  return 1;
}

function determineSeverity(context) {
  const lower = context.toLowerCase();
  if (/material(?:ly)? adverse|critical|severe|significant.*harm|catastrophic|existential/.test(lower)) return 'critical';
  if (/significant|substantial|major|serious|could.*material|meaningfully/.test(lower)) return 'high';
  if (/may|could|potential|possible|moderate/.test(lower)) return 'medium';
  return 'low';
}

function isGenericRisk(text) {
  const genericPhrases = [
    'we face competition',
    'general economic conditions',
    'changes in laws',
    'market conditions may change',
    'we cannot predict'
  ];
  const lower = text.toLowerCase();
  return genericPhrases.some(phrase => lower.includes(phrase));
}

function extractActionability(context) {
  const actionMatch = context.match(
    /(?:we|the company|management)\s+(?:have|has|will|intend to|plan to|mitigate|address|manage|monitor|implement|established)[^.]{0,220}/i
  );
  return actionMatch ? actionMatch[0].trim() : null;
}

function detectMagnitude(text) {
  const lower = text.toLowerCase();
  if (/significant|major|substantial|large|billion/i.test(lower)) return 'significant';
  if (/moderate|meaningful|continued|ongoing/i.test(lower)) return 'moderate';
  return 'mentioned';
}

function extractAmount(text) {
  const m = text.match(/\$?([\d,.]+)\s*(billion|million|B\b|M\b)/i);
  return m ? `$${m[1]} ${m[2]}` : null;
}

function extractTimeframe(text) {
  const m = text.match(/(?:by|over the next|in the next|within|through)\s+(?:\d{4}|[\d]+\s+years?|the next \w+)/i);
  return m ? m[0] : null;
}

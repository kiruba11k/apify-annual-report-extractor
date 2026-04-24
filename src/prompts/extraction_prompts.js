// src/prompts/extraction_prompts.js
// ══════════════════════════════════════════════════════════════════════════════
// PROMPT LIBRARY — Carefully engineered prompts for each extraction task
// Designed for maximum specificity, actionability, and evidence grounding
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_PROMPT = `You are an expert financial analyst and strategic intelligence extractor specializing in annual reports, 10-K filings, and investor communications.

Your job is to extract ACTIONABLE, SPECIFIC intelligence — not generic summaries.

RULES:
1. Every claim MUST cite a page number (page_ref)
2. Reject generic statements like "the company faces competition" — only include SPECIFIC insights
3. Extract EXACT figures when mentioned (e.g. "$2.4B capex", "15% YoY increase")
4. Flag forward-looking commitments separately from past results
5. Return ONLY valid JSON — no prose, no markdown, no code fences
6. Confidence scores: 0.9 = verbatim quote with page, 0.7 = strong inference, 0.5 = indirect signal`;

export function buildCapexPrompt(sections, companyName, year) {
  return `Extract capital expenditure intelligence from this ${companyName} ${year} annual filing.

DOCUMENT SECTIONS:
${formatSections(sections)}

Extract and return this exact JSON structure:
{
  "capex_focus": ["list of specific capex categories mentioned, e.g. 'Data center infrastructure', 'Manufacturing capacity expansion'"],
  "capex_total_mentioned": "Total capex figure if stated, e.g. '$3.2B' or null",
  "capex_breakdown": [
    {
      "category": "specific category",
      "amount": "dollar amount or percentage if mentioned",
      "description": "what specifically is being built/bought",
      "forward_looking": true/false,
      "page_ref": page_number_integer
    }
  ],
  "sustainability_capex": "any ESG/green capex mentioned or null",
  "evidence": [
    {
      "text": "exact or paraphrased excerpt proving this",
      "page": page_number_integer,
      "section": "MD&A or Capital Resources etc",
      "confidence": 0.0-1.0,
      "signal_type": "capex_commitment"
    }
  ]
}

IMPORTANT: Only include SPECIFIC capex items. Ignore generic mentions.`;
}

export function buildDigitalPrompt(sections, companyName, year) {
  return `Extract digital transformation and technology investment intelligence from this ${companyName} ${year} annual filing.

DOCUMENT SECTIONS:
${formatSections(sections)}

Return this exact JSON:
{
  "digital_spend_indicator": one of ["none_mentioned", "low_digital_focus", "moderate_digital_investment", "high_digital_priority", "digital_transformation_core"],
  "digital_initiatives": [
    {
      "initiative_name": "specific program name",
      "description": "what exactly is being done",
      "investment_mentioned": "dollar amount or null",
      "technology_type": ["AI/ML", "Cloud", "Automation", "Data Analytics", "IoT", "Blockchain", "Cybersecurity", etc],
      "page_ref": page_number
    }
  ],
  "technology_vendors_mentioned": ["list of specific tech vendors/platforms named"],
  "ai_ml_signal": "specific AI/ML investments or initiatives mentioned or null",
  "cloud_signal": "specific cloud migration/investment or null",
  "evidence": [
    {
      "text": "excerpt",
      "page": page_number,
      "section": "section name",
      "confidence": 0.0-1.0,
      "signal_type": "digital_initiative"
    }
  ]
}`;
}

export function buildStrategyPrompt(sections, companyName, year) {
  return `Extract strategic priorities and investment intent from this ${companyName} ${year} annual filing.

DOCUMENT SECTIONS:
${formatSections(sections)}

Return this exact JSON:
{
  "strategic_priorities": [
    {
      "priority": "specific, actionable strategic objective",
      "category": one of ["growth", "efficiency", "innovation", "market_expansion", "product", "talent", "sustainability", "M&A"],
      "time_horizon": "near-term/medium-term/long-term or specific year",
      "investment_implied": true/false,
      "page_ref": page_number
    }
  ],
  "investment_areas": [
    {
      "area": "specific investment domain",
      "magnitude": one of ["mentioned", "moderate", "significant", "major"],
      "amount_usd": "dollar figure if stated or null",
      "timeframe": "when or null",
      "evidence_pages": [list of page numbers]
    }
  ],
  "intent_signal": one of ["expansion", "consolidation", "transformation", "optimization", "defense", "acquisition_mode", "divestiture_mode", "innovation_push", "mixed"],
  "intent_reasoning": "2-3 sentence specific reasoning citing evidence from the filing",
  "m_and_a_signals": [
    {
      "signal": "specific M&A intent or activity",
      "direction": "acquisition/divestiture/partnership",
      "target_sector": "industry or company if named",
      "page_ref": page_number
    }
  ],
  "evidence": [
    {
      "text": "excerpt",
      "page": page_number,
      "section": "section name",
      "confidence": 0.0-1.0,
      "signal_type": "investment_intent"
    }
  ]
}`;
}

export function buildRiskPrompt(sections, companyName, year) {
  return `Extract specific, actionable risk intelligence from this ${companyName} ${year} annual filing.

DOCUMENT SECTIONS:
${formatSections(sections)}

Return this exact JSON:
{
  "risk_mentions": [
    {
      "risk_category": one of ["macroeconomic", "geopolitical", "regulatory", "competitive", "technology", "cybersecurity", "supply_chain", "climate", "labor", "financial", "operational", "legal", "other"],
      "description": "SPECIFIC risk — not generic. Include named countries, regulations, competitors if mentioned.",
      "severity": one of ["low", "medium", "high", "critical"],
      "quantified": "any dollar impact or probability stated, or null",
      "pages": [list of page numbers],
      "actionability": "what the company says it will do or has done about this risk",
      "new_or_escalated": true/false (is this a newly disclosed or escalating risk)
    }
  ],
  "top_3_risk_themes": ["brief description of the 3 most prominent risk themes"],
  "regulatory_risks": ["any specific regulations or regulatory bodies named"],
  "evidence": [
    {
      "text": "excerpt",
      "page": page_number,
      "section": "Risk Factors",
      "confidence": 0.0-1.0,
      "signal_type": "risk_disclosure"
    }
  ]
}

CRITICAL: Skip generic boilerplate risks. Only include risks with specific context.`;
}

export function buildSynthesisPrompt(partialResults, companyName, year, financialFigures) {
  return `Synthesize these extraction results for ${companyName} ${year} into a final intelligence report.

PARTIAL RESULTS:
${JSON.stringify(partialResults, null, 2)}

FINANCIAL FIGURES DETECTED:
${JSON.stringify(financialFigures, null, 2)}

Produce a final synthesized JSON:
{
  "intent_signal": one of ["expansion", "consolidation", "transformation", "optimization", "defense", "acquisition_mode", "divestiture_mode", "innovation_push", "mixed"],
  "intent_reasoning": "clear 2-3 sentence rationale citing specific evidence",
  "digital_spend_indicator": one of ["none_mentioned", "low_digital_focus", "moderate_digital_investment", "high_digital_priority", "digital_transformation_core"],
  "top_capex_themes": ["3-5 most prominent capex themes"],
  "top_investment_signals": ["3-5 highest confidence investment signals an investor should act on"],
  "competitor_intelligence": ["any competitor names or moves mentioned"],
  "management_tone": one of ["cautious", "neutral", "confident", "aggressive"],
  "year_over_year_signals": "any explicit YoY improvement or decline statements"
}`;
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatSections(sections) {
  if (!sections || sections.length === 0) return 'No sections available.';
  
  return sections.map(s => 
    `=== ${s.name} (Pages ${s.start_page}–${s.end_page}) ===\n${s.text.slice(0, 6000)}`
  ).join('\n\n');
}

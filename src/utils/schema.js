// src/utils/schema.js
// Zod schemas for input validation and output structure enforcement

import { z } from 'zod';

// ─── Evidence Item ────────────────────────────────────────────────────────────
export const EvidenceSchema = z.object({
  text: z.string().describe('Exact or paraphrased excerpt from the filing'),
  page: z.number().int().min(1).describe('Page number in the original document'),
  section: z.string().optional().describe('Section/heading context (e.g. "MD&A", "Risk Factors")'),
  confidence: z.number().min(0).max(1).describe('Confidence score 0–1'),
  signal_type: z.enum([
    'capex_commitment',
    'digital_initiative',
    'investment_intent',
    'strategic_priority',
    'risk_disclosure',
    'technology_spend',
    'ma_signal',
    'workforce_signal',
    'sustainability_capex',
    'forward_guidance'
  ])
});

// ─── Investment Area ──────────────────────────────────────────────────────────
export const InvestmentAreaSchema = z.object({
  area: z.string().describe('Investment domain (e.g. "AI Infrastructure", "Supply Chain")'),
  magnitude: z.enum(['mentioned', 'moderate', 'significant', 'major']),
  amount_usd: z.string().optional().describe('Dollar figure if mentioned (e.g. "$2.4B")'),
  timeframe: z.string().optional().describe('Investment timeframe (e.g. "FY2025", "next 3 years")'),
  evidence_pages: z.array(z.number()).describe('Page references')
});

// ─── Risk Mention ─────────────────────────────────────────────────────────────
export const RiskMentionSchema = z.object({
  risk_category: z.enum([
    'macroeconomic', 'geopolitical', 'regulatory', 'competitive',
    'technology', 'cybersecurity', 'supply_chain', 'climate',
    'labor', 'financial', 'operational', 'legal', 'other'
  ]),
  description: z.string().describe('Specific risk description (not generic)'),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  pages: z.array(z.number()),
  actionability: z.string().optional().describe('What the company says it will do about this risk')
});

// ─── Main Output Schema ───────────────────────────────────────────────────────
export const FilingOutputSchema = z.object({
  // Identity
  company_name: z.string(),
  ticker: z.string().optional(),
  cik: z.string().optional().describe('SEC CIK number'),
  report_year: z.number().int(),
  filing_type: z.string().describe('10-K, 20-F, Annual Report, etc.'),
  filing_date: z.string().optional(),
  source_url: z.string().url().optional(),
  total_pages: z.number().int().optional(),

  // Core Extraction Fields
  capex_focus: z.array(z.string()).describe('Primary capital expenditure categories mentioned'),
  capex_total_mentioned: z.string().optional().describe('Total capex figure if stated'),
  
  investment_areas: z.array(InvestmentAreaSchema).describe('Specific investment domains with magnitude'),
  
  digital_spend_indicator: z.enum([
    'none_mentioned',
    'low_digital_focus',
    'moderate_digital_investment',
    'high_digital_priority',
    'digital_transformation_core'
  ]).describe('Digital investment signal level'),
  
  digital_initiatives: z.array(z.string()).describe('Specific digital programs named in the filing'),
  
  strategic_priorities: z.array(z.string()).describe('Top stated strategic priorities (actionable, specific)'),
  
  risk_mentions: z.array(RiskMentionSchema).describe('Key risk factors with page references'),
  
  intent_signal: z.enum([
    'expansion',
    'consolidation',
    'transformation',
    'optimization',
    'defense',
    'acquisition_mode',
    'divestiture_mode',
    'innovation_push',
    'mixed'
  ]).describe('Overall strategic intent inferred from the filing'),
  
  intent_reasoning: z.string().describe('Why this intent signal was assigned'),
  
  evidence: z.array(EvidenceSchema).describe('Page-referenced evidence for all extractions'),

  // Quality Metadata
  metadata: z.object({
    extraction_timestamp: z.string(),
    extraction_method: z.enum(['ai_groq', 'heuristic_fallback']),
    pages_processed: z.number().int(),
    total_evidence_items: z.number().int(),
    avg_confidence: z.number().min(0).max(1),
    processing_time_ms: z.number().int(),
    warnings: z.array(z.string()).optional()
  })
});

export const InputSchema = z.object({
  input_mode: z.enum(['pdf_urls', 'company_names', 'mixed']).default('company_names'),
  pdf_urls: z.array(z.string().url()).optional().default([]),
  company_name_list: z.array(z.string()).optional().default([]),
  report_year: z.number().int().optional(),
  filing_types: z.array(z.string()).default(['10-K', '20-F']),
  extraction_focus: z.array(z.string()).default([
    'capex_focus', 'digital_initiatives', 'investment_areas',
    'strategic_priorities', 'risk_mentions', 'intent_signals'
  ]),
  min_evidence_confidence: z.number().min(0).max(1).default(0.65),
  max_pages_per_doc: z.number().int().default(200),
  groq_api_key: z.string().optional(),
  output_format: z.enum(['full', 'compact', 'signals_only']).default('full'),
  notify_webhook_url: z.string().url().optional()
});

export function validateInput(raw) {
  return InputSchema.parse(raw);
}

export function validateOutput(raw) {
  return FilingOutputSchema.parse(raw);
}

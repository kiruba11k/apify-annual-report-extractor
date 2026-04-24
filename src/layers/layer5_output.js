// src/layers/layer5_output.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 5 — OUTPUT FORMATTING & DELIVERY
// Responsibilities:
//   • Normalize and validate final extraction output
//   • Apply output_format filter (full / compact / signals_only)
//   • Push to Apify Dataset
//   • POST to webhook if configured
//   • Generate human-readable summary log
// ══════════════════════════════════════════════════════════════════════════════

import { Dataset } from 'apify';
import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Layer5:Output');

// ── Format Output by Mode ────────────────────────────────────────────────────
export function formatOutput(rawResult, format = 'full') {
  switch (format) {
    case 'signals_only':
      return formatSignalsOnly(rawResult);
    case 'compact':
      return formatCompact(rawResult);
    case 'full':
    default:
      return formatFull(rawResult);
  }
}

function formatFull(r) {
  return {
    // Identity
    company_name: r.company_name,
    ticker: r.ticker || null,
    cik: r.cik || null,
    report_year: r.report_year,
    filing_type: r.filing_type,
    filing_date: r.filing_date || null,
    source_url: r.source_url || null,

    // Core extraction
    capex_focus: (r.capex_focus || []).slice(0, 10),
    capex_total_mentioned: r.capex_total_mentioned || null,
    investment_areas: (r.investment_areas || []).map(ia => ({
      area: ia.area,
      magnitude: ia.magnitude,
      amount_usd: ia.amount_usd || null,
      timeframe: ia.timeframe || null,
      evidence_pages: ia.evidence_pages || []
    })),
    digital_spend_indicator: r.digital_spend_indicator,
    digital_initiatives: (r.digital_initiatives || []).slice(0, 10),
    strategic_priorities: (r.strategic_priorities || []).slice(0, 8),
    risk_mentions: (r.risk_mentions || []).slice(0, 10).map(rm => ({
      risk_category: rm.risk_category,
      description: rm.description?.slice(0, 300),
      severity: rm.severity,
      pages: rm.pages || [],
      actionability: rm.actionability || null
    })),
    intent_signal: r.intent_signal,
    intent_reasoning: r.intent_reasoning,
    evidence: (r.evidence || []).slice(0, 30).map(ev => ({
      text: ev.text?.slice(0, 400),
      page: ev.page,
      section: ev.section || null,
      confidence: Math.round((ev.confidence || 0) * 100) / 100,
      signal_type: ev.signal_type
    })),

    // Bonus fields
    competitor_mentions: r._competitor_mentions || [],
    ma_signals: r._ma_signals || [],
    management_tone: r._management_tone || 'neutral',

    // Metadata
    metadata: r.metadata
  };
}

function formatCompact(r) {
  return {
    company_name: r.company_name,
    ticker: r.ticker || null,
    report_year: r.report_year,
    filing_type: r.filing_type,
    capex_focus: (r.capex_focus || []).slice(0, 5),
    digital_spend_indicator: r.digital_spend_indicator,
    strategic_priorities: (r.strategic_priorities || []).slice(0, 5),
    intent_signal: r.intent_signal,
    risk_count: (r.risk_mentions || []).length,
    evidence_count: (r.evidence || []).length,
    top_evidence: (r.evidence || []).slice(0, 5),
    metadata: {
      extraction_method: r.metadata?.extraction_method,
      avg_confidence: r.metadata?.avg_confidence,
      processing_time_ms: r.metadata?.processing_time_ms
    }
  };
}

function formatSignalsOnly(r) {
  return {
    company_name: r.company_name,
    ticker: r.ticker || null,
    report_year: r.report_year,
    intent_signal: r.intent_signal,
    digital_spend_indicator: r.digital_spend_indicator,
    top_capex: (r.capex_focus || []).slice(0, 3),
    top_priorities: (r.strategic_priorities || []).slice(0, 3),
    critical_risks: (r.risk_mentions || []).filter(r => r.severity === 'critical' || r.severity === 'high').slice(0, 3).map(r => r.risk_category),
    top_investment: (r.investment_areas || []).filter(i => i.magnitude === 'major' || i.magnitude === 'significant').slice(0, 3).map(i => i.area),
    actionable_evidence: (r.evidence || [])
      .filter(e => e.confidence >= 0.75)
      .slice(0, 3)
      .map(e => ({ text: e.text?.slice(0, 200), page: e.page, signal: e.signal_type }))
  };
}

// ── Save to Apify Dataset ────────────────────────────────────────────────────
export async function saveToDataset(formattedResult) {
  const dataset = await Dataset.open();
  await dataset.pushData(formattedResult);
  const yearLabel = formattedResult.report_year ?? 'n/a';
  log.info(`Saved to dataset: ${formattedResult.company_name} ${yearLabel}`);
}

// ── Webhook Delivery ─────────────────────────────────────────────────────────
export async function notifyWebhook(webhookUrl, result) {
  if (!webhookUrl) return;
  
  try {
    const payload = {
      event: 'extraction_complete',
      timestamp: new Date().toISOString(),
      company: result.company_name,
      year: result.report_year,
      intent_signal: result.intent_signal,
      data: result
    };
    
    await axios.post(webhookUrl, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AnnualReportExtractor/2.0' }
    });
    
    log.info(`Webhook delivered to: ${webhookUrl}`);
  } catch (err) {
    log.warn(`Webhook delivery failed: ${err.message}`);
  }
}

// ── Human-Readable Summary Logger ─────────────────────────────────────────
export function logSummary(result) {
  const r = result;
  
  log.info('═'.repeat(70));
  log.info(`📊 EXTRACTION COMPLETE: ${r.company_name} (${r.report_year})`);
  log.info('═'.repeat(70));
  log.info(`  Filing Type:        ${r.filing_type}`);
  log.info(`  Intent Signal:      ${r.intent_signal?.toUpperCase()}`);
  log.info(`  Digital Indicator:  ${r.digital_spend_indicator}`);
  log.info(`  CapEx Themes:       ${(r.capex_focus || []).slice(0, 3).join(', ')}`);
  log.info(`  Top Priorities:     ${(r.strategic_priorities || []).slice(0, 2).join(' | ').slice(0, 100)}`);
  log.info(`  Risk Count:         ${(r.risk_mentions || []).length}`);
  log.info(`  Evidence Items:     ${(r.evidence || []).length}`);
  log.info(`  Extraction Method:  ${r.metadata?.extraction_method}`);
  log.info(`  Avg Confidence:     ${((r.metadata?.avg_confidence || 0) * 100).toFixed(0)}%`);
  log.info(`  Processing Time:    ${((r.metadata?.processing_time_ms || 0) / 1000).toFixed(1)}s`);
  log.info('─'.repeat(70));
  
  if (r.evidence?.length > 0) {
    const topEvidence = r.evidence[0];
    log.info(`  Top Evidence (p.${topEvidence.page}): "${(topEvidence.text || '').slice(0, 120)}..."`);
  }
  log.info('═'.repeat(70));
}

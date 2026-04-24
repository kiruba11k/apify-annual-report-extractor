// src/layers/layer3_extraction.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 3 — AI-POWERED EXTRACTION ENGINE
// Architecture:
//   Primary  → Anthropic Claude (claude-3-haiku-20240307 for cost, sonnet for quality)
//   Fallback1 → OpenAI GPT-4o-mini
//   Fallback2 → Google Gemini Flash (free tier)
//   Fallback3 → Heuristic regex/NLP extraction (always free)
//
// Each extraction is run in parallel chunks with rate limiting
// ══════════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { createLogger } from '../utils/logger.js';
import {
  SYSTEM_PROMPT,
  buildCapexPrompt,
  buildDigitalPrompt,
  buildStrategyPrompt,
  buildRiskPrompt,
  buildSynthesisPrompt
} from '../prompts/extraction_prompts.js';

const log = createLogger('Layer3:Extraction');

// Rate limiters
const claudeLimit = pLimit(3);
const openaiLimit = pLimit(5);
const geminiLimit = pLimit(10);

// ── Provider Router ─────────────────────────────────────────────────────────
export async function extractWithAI(prompt, options = {}) {
  const { anthropic_api_key, openai_api_key, provider_order } = options;
  
  const providers = provider_order || buildProviderOrder(anthropic_api_key, openai_api_key);
  
  for (const provider of providers) {
    try {
      log.debug(`Trying provider: ${provider}`);
      const result = await callProvider(provider, prompt, options);
      if (result) return { result, provider };
    } catch (err) {
      log.warn(`Provider ${provider} failed: ${err.message}`);
      continue;
    }
  }
  
  // Final fallback: return empty structure
  log.error('All AI providers failed');
  return { result: null, provider: 'none' };
}

function buildProviderOrder(anthropicKey, openaiKey) {
  const order = [];
  if (anthropicKey) order.push('claude_paid');
  if (openaiKey) order.push('openai_paid');
  order.push('gemini_free');  // Free tier
  order.push('heuristic');    // Always available
  return order;
}

// ── Provider Implementations ─────────────────────────────────────────────────
async function callProvider(provider, prompt, options) {
  switch (provider) {
    case 'claude_paid':
      return claudeLimit(() => callClaude(prompt, options.anthropic_api_key));
    case 'openai_paid':
      return openaiLimit(() => callOpenAI(prompt, options.openai_api_key));
    case 'gemini_free':
      return geminiLimit(() => callGemini(prompt));
    case 'heuristic':
      return null; // Handled separately in layer4
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Anthropic Claude ────────────────────────────────────────────────────────
async function callClaude(prompt, apiKey) {
  const response = await pRetry(
    () => axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5',  // Cost-efficient for bulk; swap to sonnet-4 for quality
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: 90000
      }
    ),
    { retries: 2, minTimeout: 3000, factor: 2 }
  );

  const text = response.data?.content?.[0]?.text || '';
  return parseJSONResponse(text);
}

// ── OpenAI ───────────────────────────────────────────────────────────────────
async function callOpenAI(prompt, apiKey) {
  const response = await pRetry(
    () => axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',  // Cost-efficient
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    ),
    { retries: 2, minTimeout: 2000 }
  );

  const text = response.data?.choices?.[0]?.message?.content || '';
  return parseJSONResponse(text);
}

// ── Google Gemini Flash (FREE tier) ─────────────────────────────────────────
async function callGemini(prompt) {
  // Gemini 1.5 Flash has a free tier (15 RPM, 1M TPD as of 2024)
  const GEMINI_FREE_KEY = process.env.GEMINI_API_KEY || '';
  if (!GEMINI_FREE_KEY) throw new Error('No Gemini API key');

  const response = await pRetry(
    () => axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_FREE_KEY}`,
      {
        contents: [{
          parts: [{
            text: `${SYSTEM_PROMPT}\n\n${prompt}\n\nRespond ONLY with valid JSON, no markdown.`
          }]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 4096,
          temperature: 0.1
        }
      },
      { timeout: 60000 }
    ),
    { retries: 2, minTimeout: 4000 }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseJSONResponse(text);
}

// ── Main Extraction Orchestrator ─────────────────────────────────────────────
export async function runFullExtraction(parsedDoc, focusedContent, filingMeta, options = {}) {
  const { company_name, report_year } = filingMeta;
  const { extraction_focus = [], min_evidence_confidence = 0.65 } = options;
  
  log.info(`Running extraction for ${company_name} ${report_year}`);
  const startTime = Date.now();
  
  const { sections, financial_figures, top_pages_text } = focusedContent;
  
  // Enrich sections with top page context
  const enrichedSections = [
    { name: 'Executive Summary / Top Pages', text: top_pages_text, start_page: 1, end_page: 10 },
    ...sections
  ];

  // ── Run extraction tasks in parallel ──────────────────────────────────────
  const tasks = [];
  
  if (extraction_focus.includes('capex_focus') || extraction_focus.includes('investment_areas')) {
    tasks.push({ 
      key: 'capex', 
      prompt: buildCapexPrompt(enrichedSections, company_name, report_year) 
    });
  }
  if (extraction_focus.includes('digital_initiatives')) {
    tasks.push({ 
      key: 'digital', 
      prompt: buildDigitalPrompt(enrichedSections, company_name, report_year) 
    });
  }
  if (extraction_focus.includes('strategic_priorities') || extraction_focus.includes('intent_signals')) {
    tasks.push({ 
      key: 'strategy', 
      prompt: buildStrategyPrompt(enrichedSections, company_name, report_year) 
    });
  }
  if (extraction_focus.includes('risk_mentions')) {
    tasks.push({ 
      key: 'risks', 
      prompt: buildRiskPrompt(enrichedSections, company_name, report_year) 
    });
  }

  // Execute all tasks concurrently
  const taskResults = await Promise.allSettled(
    tasks.map(async (task) => {
      const { result, provider } = await extractWithAI(task.prompt, options);
      log.info(`Task '${task.key}' completed via ${provider}`);
      return { key: task.key, data: result, provider };
    })
  );

  const partialResults = {};
  let primaryProvider = 'heuristic_fallback';
  
  for (const outcome of taskResults) {
    if (outcome.status === 'fulfilled' && outcome.value.data) {
      partialResults[outcome.value.key] = outcome.value.data;
      primaryProvider = outcome.value.provider;
    } else if (outcome.status === 'rejected') {
      log.warn(`Task failed: ${outcome.reason?.message}`);
    }
  }

  // ── Synthesis pass ────────────────────────────────────────────────────────
  let synthesis = {};
  if (Object.keys(partialResults).length > 0) {
    try {
      const { result } = await extractWithAI(
        buildSynthesisPrompt(partialResults, company_name, report_year, financial_figures),
        options
      );
      synthesis = result || {};
    } catch (err) {
      log.warn(`Synthesis pass failed: ${err.message}`);
    }
  }

  // ── Merge and normalize results ──────────────────────────────────────────
  const merged = mergeExtractionResults(partialResults, synthesis, financial_figures, filingMeta);
  
  // ── Filter by confidence ─────────────────────────────────────────────────
  if (merged.evidence) {
    merged.evidence = merged.evidence.filter(e => e.confidence >= min_evidence_confidence);
  }

  const processingTime = Date.now() - startTime;
  
  return {
    ...merged,
    metadata: {
      extraction_timestamp: new Date().toISOString(),
      extraction_method: mapProviderToMethod(primaryProvider),
      pages_processed: parsedDoc.pages_processed,
      total_evidence_items: merged.evidence?.length || 0,
      avg_confidence: computeAvgConfidence(merged.evidence || []),
      processing_time_ms: processingTime,
      warnings: merged._warnings || []
    }
  };
}

// ── Result Merging ───────────────────────────────────────────────────────────
function mergeExtractionResults(parts, synthesis, financialFigures, filingMeta) {
  const capex = parts.capex || {};
  const digital = parts.digital || {};
  const strategy = parts.strategy || {};
  const risks = parts.risks || {};

  // Collect all evidence
  const allEvidence = [
    ...(capex.evidence || []),
    ...(digital.evidence || []),
    ...(strategy.evidence || []),
    ...(risks.evidence || [])
  ];

  // Build investment areas from strategy + capex + financial figures
  const investmentAreas = [
    ...(strategy.investment_areas || []),
    // Add financial figures as investment areas if not already covered
    ...financialFigures
      .filter(f => f.label === 'investment' || f.label === 'capex')
      .map(f => ({
        area: f.label === 'capex' ? 'Capital Expenditure' : 'Investment',
        magnitude: f.amount_usd > 1e9 ? 'major' : f.amount_usd > 1e8 ? 'significant' : 'moderate',
        amount_usd: f.formatted,
        timeframe: null,
        evidence_pages: []
      }))
  ];

  return {
    // Identity
    company_name: filingMeta.company_name,
    ticker: filingMeta.ticker || null,
    cik: filingMeta.cik || null,
    report_year: filingMeta.report_year,
    filing_type: filingMeta.filing_type,
    filing_date: filingMeta.filing_date || null,
    source_url: filingMeta.source_url || filingMeta.document_url || null,
    total_pages: filingMeta.total_pages || null,

    // Core fields
    capex_focus: capex.capex_focus || synthesis.top_capex_themes || [],
    capex_total_mentioned: capex.capex_total_mentioned || null,
    investment_areas: deduplicateInvestmentAreas(investmentAreas),
    digital_spend_indicator: digital.digital_spend_indicator || synthesis.digital_spend_indicator || 'none_mentioned',
    digital_initiatives: (digital.digital_initiatives || []).map(d => 
      typeof d === 'string' ? d : `${d.initiative_name}: ${d.description}`
    ),
    strategic_priorities: (strategy.strategic_priorities || []).map(p =>
      typeof p === 'string' ? p : p.priority
    ),
    risk_mentions: (risks.risk_mentions || []).map(r => ({
      risk_category: r.risk_category || 'other',
      description: r.description,
      severity: r.severity || 'medium',
      pages: r.pages || [],
      actionability: r.actionability || null
    })),
    intent_signal: synthesis.intent_signal || strategy.intent_signal || 'mixed',
    intent_reasoning: synthesis.intent_reasoning || strategy.intent_reasoning || '',
    evidence: deduplicateEvidence(allEvidence),

    // Bonus intelligence
    _synthesis: synthesis,
    _ma_signals: strategy.m_and_a_signals || [],
    _competitor_mentions: synthesis.competitor_intelligence || [],
    _management_tone: synthesis.management_tone || 'neutral'
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseJSONResponse(text) {
  if (!text) return null;
  // Strip markdown fences if present
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from response
    const match = cleaned.match(/\{[\s\S]+\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

function computeAvgConfidence(evidence) {
  if (!evidence.length) return 0;
  return evidence.reduce((sum, e) => sum + (e.confidence || 0.5), 0) / evidence.length;
}

function mapProviderToMethod(provider) {
  const map = {
    claude_paid: 'ai_claude',
    openai_paid: 'ai_openai',
    gemini_free: 'ai_free_tier',
    heuristic: 'heuristic_fallback'
  };
  return map[provider] || 'heuristic_fallback';
}

function deduplicateEvidence(evidence) {
  const seen = new Set();
  return evidence.filter(e => {
    const key = `${e.page}_${e.signal_type}_${(e.text || '').slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

function deduplicateInvestmentAreas(areas) {
  const seen = new Set();
  return areas.filter(a => {
    if (!a.area) return false;
    const key = a.area.toLowerCase().slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

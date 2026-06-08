// src/layers/layer3_extraction.js
// ══════════════════════════════════════════════════════════════════════════════
// LAYER 3 — AI-POWERED EXTRACTION ENGINE
//
// Provider cascade (free-first ordering):
//   1. Google Gemini Flash    — free tier: 15 RPM / 1M TPD
//   2. Groq (Llama 3.3 70B)  — free tier: 30 RPM
//   3. Together AI            — free $1 credit / Llama 3.3 70B
//   4. OpenRouter             — free models (Llama 3.3 70B, Mistral, etc.)
//   5. Mistral                — free tier (mistral-small-latest)
//   6. HuggingFace Inference  — free with token
//   7. Heuristic fallback     — always free, no key needed
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

const groqLimit = pLimit(6);
const geminiLimit = pLimit(10);
const togetherLimit = pLimit(4);
const openrouterLimit = pLimit(4);
const mistralLimit = pLimit(4);
const hfLimit = pLimit(3);

// ── Provider Router ────────────────────────────────────────────────────────────
export async function extractWithAI(prompt, options = {}) {
  const providers = options.provider_order || buildProviderOrder(options);

  for (const provider of providers) {
    try {
      log.debug(`Trying provider: ${provider}`);
      const result = await callProvider(provider, prompt, options);
      if (result) return { result, provider };
    } catch (err) {
      log.warn(`Provider ${provider} failed: ${err.message}`);
    }
  }

  log.error('All AI providers failed — heuristic fallback will be used');
  return { result: null, provider: 'none' };
}

function buildProviderOrder(options) {
  const order = [];
  if (options.gemini_api_key) order.push('gemini');
  if (options.groq_api_key) order.push('groq');
  if (options.together_api_key) order.push('together');
  if (options.openrouter_api_key) order.push('openrouter');
  if (options.mistral_api_key) order.push('mistral');
  if (options.huggingface_api_token) order.push('huggingface');
  order.push('heuristic');
  return order;
}

// ── Provider Dispatch ──────────────────────────────────────────────────────────
async function callProvider(provider, prompt, options) {
  switch (provider) {
    case 'gemini':
      return geminiLimit(() => callGemini(prompt, options.gemini_api_key));
    case 'groq':
      return groqLimit(() => callGroq(prompt, options.groq_api_key));
    case 'together':
      return togetherLimit(() => callTogetherAI(prompt, options.together_api_key));
    case 'openrouter':
      return openrouterLimit(() => callOpenRouter(prompt, options.openrouter_api_key));
    case 'mistral':
      return mistralLimit(() => callMistral(prompt, options.mistral_api_key));
    case 'huggingface':
      return hfLimit(() => callHuggingFace(prompt, options.huggingface_api_token));
    case 'heuristic':
      return null; // handled in layer4
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Google Gemini Flash ────────────────────────────────────────────────────────
// Free tier: 15 requests/min, 1 million tokens/day
async function callGemini(prompt, apiKey) {
  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await pRetry(
    () => axios.post(url, {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 90000
    }),
    {
      retries: 3,
      minTimeout: 4000,
      factor: 2,
      shouldRetry: (err) => {
        const status = err.response?.status;
        // Retry on rate limit (429) and server errors (5xx)
        return status === 429 || (status >= 500 && status < 600);
      },
      onFailedAttempt: (err) => {
        if (err.response?.status === 429) log.warn('Gemini rate limited, backing off...');
      }
    }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseJSONResponse(text);
}

// ── Groq (Llama 3.3 70B) ──────────────────────────────────────────────────────
// Free tier: 30 requests/min, 6000 tokens/min
async function callGroq(prompt, apiKey) {
  const response = await pRetry(
    () => axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 4096,
        temperature: 0.1,
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
    {
      retries: 3,
      minTimeout: 3000,
      factor: 2,
      shouldRetry: (err) => {
        const status = err.response?.status;
        return status === 429 || (status >= 500 && status < 600);
      }
    }
  );

  const text = response.data?.choices?.[0]?.message?.content || '';
  return parseJSONResponse(text);
}

// ── Together AI (Llama 3.3 70B Turbo) ─────────────────────────────────────────
// Free $1 credit on signup, ~$0.18/1M tokens after
async function callTogetherAI(prompt, apiKey) {
  const response = await pRetry(
    () => axios.post(
      'https://api.together.xyz/v1/chat/completions',
      {
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        max_tokens: 4096,
        temperature: 0.1,
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
        timeout: 90000
      }
    ),
    { retries: 2, minTimeout: 3000, factor: 2 }
  );

  const text = response.data?.choices?.[0]?.message?.content || '';
  return parseJSONResponse(text);
}

// ── OpenRouter (free model tier) ───────────────────────────────────────────────
// Free models: meta-llama/llama-3.3-70b-instruct:free, mistralai/mistral-7b-instruct:free
async function callOpenRouter(prompt, apiKey) {
  // Try free models first, then fall to paid
  const models = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'google/gemma-2-9b-it:free',
    'meta-llama/llama-3.1-8b-instruct:free'
  ];

  for (const model of models) {
    try {
      const response = await pRetry(
        () => axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model,
            max_tokens: 4096,
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: prompt }
            ]
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://annualreportextractor.com',
              'X-Title': 'Annual Report Extractor'
            },
            timeout: 90000
          }
        ),
        { retries: 2, minTimeout: 2000 }
      );

      const text = response.data?.choices?.[0]?.message?.content || '';
      const parsed = parseJSONResponse(text);
      if (parsed) return parsed;
    } catch (err) {
      log.debug(`OpenRouter model ${model} failed: ${err.message}`);
    }
  }

  throw new Error('All OpenRouter models failed');
}

// ── Mistral AI (free tier) ─────────────────────────────────────────────────────
// Free tier available at console.mistral.ai
async function callMistral(prompt, apiKey) {
  const response = await pRetry(
    () => axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-small-latest',
        max_tokens: 4096,
        temperature: 0.1,
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
        timeout: 90000
      }
    ),
    { retries: 2, minTimeout: 3000, factor: 2 }
  );

  const text = response.data?.choices?.[0]?.message?.content || '';
  return parseJSONResponse(text);
}

// ── HuggingFace Inference API ──────────────────────────────────────────────────
// Free with HF token for public models
async function callHuggingFace(prompt, apiToken) {
  const model = 'mistralai/Mistral-7B-Instruct-v0.3';
  const url = `https://api-inference.huggingface.co/models/${model}`;

  const fullPrompt = `<s>[INST] ${SYSTEM_PROMPT}\n\n${prompt} [/INST]`;

  const response = await pRetry(
    () => axios.post(url,
      {
        inputs: fullPrompt,
        parameters: {
          max_new_tokens: 2048,
          temperature: 0.1,
          return_full_text: false
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    ),
    {
      retries: 3,
      minTimeout: 5000,
      factor: 2,
      shouldRetry: (err) => {
        // HF returns 503 when model is loading
        return err.response?.status === 503 || err.response?.status === 429;
      }
    }
  );

  const text = response.data?.[0]?.generated_text || '';
  return parseJSONResponse(text);
}

// ── Main Extraction Orchestrator ───────────────────────────────────────────────
export async function runFullExtraction(parsedDoc, focusedContent, filingMeta, options = {}) {
  const { company_name, report_year } = filingMeta;
  const { extraction_focus = [], min_evidence_confidence = 0.65 } = options;

  log.info(`Running AI extraction for ${company_name} ${report_year}`);
  const startTime = Date.now();

  const { sections, financial_figures, top_pages_text } = focusedContent;

  const enrichedSections = [
    { name: 'Executive Summary / Top Pages', text: top_pages_text, start_page: 1, end_page: 10 },
    ...sections
  ];

  const tasks = [];

  if (!extraction_focus.length || extraction_focus.includes('capex_focus') || extraction_focus.includes('investment_areas')) {
    tasks.push({ key: 'capex', prompt: buildCapexPrompt(enrichedSections, company_name, report_year) });
  }
  if (!extraction_focus.length || extraction_focus.includes('digital_initiatives')) {
    tasks.push({ key: 'digital', prompt: buildDigitalPrompt(enrichedSections, company_name, report_year) });
  }
  if (!extraction_focus.length || extraction_focus.includes('strategic_priorities') || extraction_focus.includes('intent_signals')) {
    tasks.push({ key: 'strategy', prompt: buildStrategyPrompt(enrichedSections, company_name, report_year) });
  }
  if (!extraction_focus.length || extraction_focus.includes('risk_mentions')) {
    tasks.push({ key: 'risks', prompt: buildRiskPrompt(enrichedSections, company_name, report_year) });
  }

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

  // Synthesis pass
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

  const merged = mergeExtractionResults(partialResults, synthesis, financial_figures, filingMeta);

  if (merged.evidence) {
    merged.evidence = merged.evidence.filter(e => e.confidence >= min_evidence_confidence);
  }

  const processingTime = Date.now() - startTime;

  return {
    ...merged,
    metadata: {
      extraction_timestamp: new Date().toISOString(),
      extraction_method: mapProviderToMethod(primaryProvider),
      ai_provider: primaryProvider,
      pages_processed: parsedDoc.pages_processed,
      total_evidence_items: merged.evidence?.length || 0,
      avg_confidence: computeAvgConfidence(merged.evidence || []),
      processing_time_ms: processingTime,
      warnings: merged._warnings || []
    }
  };
}

// ── Result Merging ─────────────────────────────────────────────────────────────
function mergeExtractionResults(parts, synthesis, financialFigures, filingMeta) {
  const capex = parts.capex || {};
  const digital = parts.digital || {};
  const strategy = parts.strategy || {};
  const risks = parts.risks || {};

  const allEvidence = [
    ...(capex.evidence || []),
    ...(digital.evidence || []),
    ...(strategy.evidence || []),
    ...(risks.evidence || [])
  ];

  const investmentAreas = [
    ...(strategy.investment_areas || []),
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
    company_name: filingMeta.company_name,
    ticker: filingMeta.ticker || null,
    cik: filingMeta.cik || null,
    report_year: filingMeta.report_year,
    filing_type: filingMeta.filing_type,
    filing_date: filingMeta.filing_date || null,
    source_url: filingMeta.source_url || filingMeta.document_url || null,
    total_pages: filingMeta.total_pages || null,

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

    _synthesis: synthesis,
    _ma_signals: strategy.m_and_a_signals || [],
    _competitor_mentions: synthesis.competitor_intelligence || [],
    _management_tone: synthesis.management_tone || 'neutral'
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseJSONResponse(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
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
    gemini: 'ai_gemini',
    groq: 'ai_groq',
    together: 'ai_together',
    openrouter: 'ai_openrouter',
    mistral: 'ai_mistral',
    huggingface: 'ai_huggingface',
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

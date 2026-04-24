// src/main.js
// ══════════════════════════════════════════════════════════════════════════════
// ANNUAL REPORT / FILINGS STRATEGIC EXTRACTOR — APIFY ACTOR v2.0
//
// Architecture: 5-Layer Pipeline
// ┌─────────────────────────────────────────────────────────────────────┐
// │  Layer 1: Document Acquisition                                      │
// │    SEC EDGAR company→CIK resolution + filing index + PDF download  │
// │                                                                     │
// │  Layer 2: Document Parsing                                          │
// │    PDF/HTML text extraction + page mapping + section segmentation   │
// │                                                                     │
// │  Layer 3: AI Extraction                                             │
// │    Groq (paid/free by account tier) → heuristic fallback           │
// │                                                                     │
// │  Layer 4: Heuristic Extraction                                      │
// │    Regex + NLP pattern matching (always-free baseline)              │
// │                                                                     │
// │  Layer 5: Output Formatting & Delivery                              │
// │    Dataset push + webhook + summary logging                         │
// └─────────────────────────────────────────────────────────────────────┘
// ══════════════════════════════════════════════════════════════════════════════

import { Actor } from 'apify';
import pLimit from 'p-limit';
import logger, { createLogger } from './utils/logger.js';
import { validateInput } from './utils/schema.js';
import { acquireFromCompanyName, acquireFromURL } from './layers/layer1_acquisition.js';
import { parseDocument, getFocusedContent } from './layers/layer2_parsing.js';
import { runFullExtraction } from './layers/layer3_extraction.js';
import { heuristicExtract } from './layers/layer4_heuristic.js';
import { formatOutput, saveToDataset, notifyWebhook, logSummary } from './layers/layer5_output.js';

const log = createLogger('Main');

// ── Actor Initialization ─────────────────────────────────────────────────────
await Actor.init();

try {
  const rawInput = await Actor.getInput();
  
  // ── Validate input ──────────────────────────────────────────────────────
  let input;
  try {
    input = validateInput(rawInput || {});
  } catch (err) {
    log.error(`Invalid input: ${err.message}`);
    await Actor.fail(`Input validation failed: ${err.message}`);
    process.exit(1);
  }

  log.info('Actor started', {
    mode: input.input_mode,
    companies: input.company_name_list?.length || 0,
    urls: input.pdf_urls?.length || 0,
    has_groq_key: !!input.groq_api_key
  });

  // ── Build document job list ──────────────────────────────────────────────
  const jobs = [];

  if (input.input_mode === 'pdf_urls' || input.input_mode === 'mixed') {
    for (const url of (input.pdf_urls || [])) {
      jobs.push({ type: 'url', value: url });
    }
  }

  if (input.input_mode === 'company_names' || input.input_mode === 'mixed') {
    for (const company of (input.company_name_list || [])) {
      jobs.push({ type: 'company', value: company });
    }
  }

  if (jobs.length === 0) {
    log.warn('No input documents or companies provided. Please provide pdf_urls or company_name_list.');
    await Actor.exit('No jobs to process');
    process.exit(0);
  }

  log.info(`Processing ${jobs.length} document job(s)`);

  // ── Concurrency control: max 3 parallel docs ────────────────────────────
  const concurrencyLimit = pLimit(3);
  let successCount = 0;
  let failureCount = 0;

  const jobPromises = jobs.map(job =>
    concurrencyLimit(async () => {
      const jobLabel = job.type === 'company' ? job.value : new URL(job.value).hostname;
      
      try {
        log.info(`▶ Starting job: [${job.type}] ${jobLabel}`);
        
        // ── LAYER 1: Acquire document ──────────────────────────────────────
        let filingMeta;
        if (job.type === 'company') {
          filingMeta = await acquireFromCompanyName(job.value, {
            report_year: input.report_year,
            filing_types: input.filing_types,
            proxy_configuration: input.proxy_configuration
          });
        } else {
          filingMeta = await acquireFromURL(job.value, {
            proxy_configuration: input.proxy_configuration
          });
        }

        log.info(`✓ Acquired: ${filingMeta.company_name} ${filingMeta.report_year} (${filingMeta.document_type.toUpperCase()})`);

        // ── LAYER 2: Parse document ────────────────────────────────────────
        const parsedDoc = await parseDocument(filingMeta.document_key, {
          max_pages: input.max_pages_per_doc
        });

        // Get focused content slices for extraction
        const focusedContent = getFocusedContent(parsedDoc, input.extraction_focus);
        
        log.info(`✓ Parsed: ${parsedDoc.total_pages} pages, ${parsedDoc.sections?.length || 0} sections`);

        // ── LAYER 3 + 4: Extract intelligence ─────────────────────────────
        let extractionResult;
        const hasAIProvider = input.groq_api_key;

        if (hasAIProvider) {
          // AI extraction (primary path)
          extractionResult = await runFullExtraction(
            parsedDoc,
            focusedContent,
            { ...filingMeta, total_pages: parsedDoc.total_pages },
            {
              extraction_focus: input.extraction_focus,
              min_evidence_confidence: input.min_evidence_confidence,
              groq_api_key: input.groq_api_key
            }
          );
        } else {
          // Heuristic fallback (always free)
          log.info('No Groq API key provided — using heuristic extraction');
          const heuristicResult = await heuristicExtract(
            parsedDoc,
            focusedContent,
            { ...filingMeta, total_pages: parsedDoc.total_pages },
            { min_evidence_confidence: input.min_evidence_confidence }
          );

          extractionResult = {
            ...heuristicResult,
            company_name: filingMeta.company_name,
            ticker: filingMeta.ticker || null,
            cik: filingMeta.cik || null,
            report_year: filingMeta.report_year,
            filing_type: filingMeta.filing_type,
            filing_date: filingMeta.filing_date || null,
            source_url: filingMeta.source_url || filingMeta.document_url || null,
            metadata: {
              extraction_timestamp: new Date().toISOString(),
              extraction_method: 'heuristic_fallback',
              pages_processed: parsedDoc.pages_processed,
              total_evidence_items: heuristicResult.evidence?.length || 0,
              avg_confidence: computeAvg(heuristicResult.evidence?.map(e => e.confidence) || []),
              processing_time_ms: 0,
              warnings: ['No Groq API key provided. Results are heuristic-based.']
            }
          };
        }

        // ── LAYER 5: Format and save output ───────────────────────────────
        const formatted = formatOutput(extractionResult, input.output_format);
        await saveToDataset(formatted);
        logSummary(formatted);

        if (input.notify_webhook_url) {
          await notifyWebhook(input.notify_webhook_url, formatted);
        }

        successCount++;
        log.info(`✅ Completed: ${filingMeta.company_name} ${filingMeta.report_year}`);
        
        return formatted;

      } catch (err) {
        failureCount++;
        log.error(`❌ Failed job [${jobLabel}]: ${err.message}`);
        
        // Save error record to dataset
        await saveToDataset({
          company_name: job.value,
          error: err.message,
          job_type: job.type,
          timestamp: new Date().toISOString(),
          _is_error: true
        });
        
        // Don't throw — continue processing other jobs
        return null;
      }
    })
  );

  await Promise.all(jobPromises);

  // ── Final summary ───────────────────────────────────────────────────────
  log.info(`
╔══════════════════════════════════════════╗
║         ACTOR RUN COMPLETE               ║
╠══════════════════════════════════════════╣
║  Total Jobs:    ${String(jobs.length).padEnd(24)}║
║  Succeeded:     ${String(successCount).padEnd(24)}║
║  Failed:        ${String(failureCount).padEnd(24)}║
╚══════════════════════════════════════════╝`);

} catch (err) {
  log.error(`Fatal actor error: ${err.message}`, { stack: err.stack });
  await Actor.fail(err.message);
} finally {
  await Actor.exit();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function computeAvg(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

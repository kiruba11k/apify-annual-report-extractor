# 📊 Annual Report / Filings Strategic Extractor

> Extract **actionable intelligence** — capex focus, digital investment signals, strategic priorities, and risk mentions — from annual reports and SEC 10-K filings, with **page-level evidence** on every claim.

---

## 🏗️ Architecture: 5-Layer Pipeline

```
INPUT
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: DOCUMENT ACQUISITION                               │
│  • Company name → SEC EDGAR CIK resolution (free)          │
│  • Filing index fetch + best-document selection            │
│  • PDF/HTML download → Apify KeyValueStore cache           │
│  • Direct URL support for any public PDF                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: DOCUMENT PARSING                                   │
│  • PDF → page-indexed text (pdf-parse)                     │
│  • HTML/HTM → structured text (cheerio)                    │
│  • Section segmentation (MD&A, Risk Factors, Strategy...)  │
│  • Financial figure extraction (regex + pattern)           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: AI EXTRACTION (Provider Cascade)                   │
│  Primary  → Claude Haiku (cheapest, fast)                  │
│  Fallback1 → OpenAI GPT-4o-mini                            │
│  Fallback2 → Google Gemini Flash (FREE tier)               │
│  Each task runs in parallel: capex | digital | strategy    │
│  + risk → synthesis pass                                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 4: HEURISTIC FALLBACK (always free)                   │
│  • Keyword dictionaries per extraction category            │
│  • Intent scoring (expansion/consolidation/innovation...)  │
│  • Used when no API keys, or to cross-validate AI output   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 5: OUTPUT & DELIVERY                                  │
│  • Format: full / compact / signals_only                   │
│  • Apify Dataset push with structured schema               │
│  • Optional webhook POST on completion                     │
│  • Human-readable run summary log                          │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
                   OUTPUT
```

---

## 🚀 Quick Start

### Option A: Company Name (Auto-Discovers SEC Filing)
```json
{
  "input_mode": "company_names",
  "company_name_list": ["Apple", "Microsoft", "NVDA"],
  "report_year": 2024,
  "extraction_focus": ["capex_focus", "digital_initiatives", "strategic_priorities", "risk_mentions"],
  "output_format": "full"
}
```

### Option B: Direct PDF URLs
```json
{
  "input_mode": "pdf_urls",
  "pdf_urls": [
    "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
    "https://example.com/annual-report-2024.pdf"
  ],
  "output_format": "full"
}
```

### Option C: Mixed with AI Key (Best Quality)
```json
{
  "input_mode": "mixed",
  "company_name_list": ["Tesla", "Ford"],
  "pdf_urls": ["https://example.com/manual-report.pdf"],
  "anthropic_api_key": "sk-ant-...",
  "report_year": 2024,
  "extraction_focus": ["capex_focus", "digital_initiatives", "investment_areas", "strategic_priorities", "risk_mentions", "intent_signals"],
  "min_evidence_confidence": 0.70,
  "output_format": "full"
}
```

---

## 📤 Output Schema

```json
{
  "company_name": "Apple Inc.",
  "ticker": "AAPL",
  "cik": "0000320193",
  "report_year": 2024,
  "filing_type": "10-K",
  "filing_date": "2024-11-01",
  "source_url": "https://www.sec.gov/...",

  "capex_focus": [
    "Data Center / Cloud Infrastructure",
    "R&D / Innovation",
    "Manufacturing / Production"
  ],
  "capex_total_mentioned": "$9.4 billion",

  "investment_areas": [
    {
      "area": "Apple Intelligence AI Infrastructure",
      "magnitude": "major",
      "amount_usd": null,
      "timeframe": "FY2025",
      "evidence_pages": [42, 87, 103]
    }
  ],

  "digital_spend_indicator": "digital_transformation_core",
  "digital_initiatives": [
    "Apple Intelligence: on-device generative AI across iOS/macOS",
    "Private Cloud Compute for privacy-preserving server AI"
  ],

  "strategic_priorities": [
    "Expand AI capabilities across the product ecosystem via Apple Intelligence",
    "Grow Services segment revenue to reduce hardware dependency",
    "Increase manufacturing diversification beyond China (India, Vietnam)"
  ],

  "risk_mentions": [
    {
      "risk_category": "geopolitical",
      "description": "Significant portion of manufacturing concentrated in China; US-China trade tensions and potential export restrictions on advanced chips could disrupt supply chain",
      "severity": "high",
      "pages": [21, 22, 48],
      "actionability": "Company has begun diversifying manufacturing to India and Vietnam"
    }
  ],

  "intent_signal": "innovation_push",
  "intent_reasoning": "Filing shows 23 references to AI investment and product integration, alongside geographic manufacturing diversification and services monetization — indicating aggressive innovation with risk mitigation.",

  "evidence": [
    {
      "text": "We plan to invest significantly in data center capacity to support Apple Intelligence...",
      "page": 42,
      "section": "MD&A",
      "confidence": 0.91,
      "signal_type": "capex_commitment"
    }
  ],

  "metadata": {
    "extraction_timestamp": "2025-01-15T10:23:41Z",
    "extraction_method": "ai_claude",
    "pages_processed": 187,
    "total_evidence_items": 28,
    "avg_confidence": 0.82,
    "processing_time_ms": 14320
  }
}
```

---

## ⚡ Intent Signal Values

| Signal | Meaning |
|--------|---------|
| `expansion` | Active geographic/market expansion signals |
| `consolidation` | Merger, integration, or portfolio simplification |
| `transformation` | Business model pivot or major restructuring |
| `optimization` | Margin/efficiency focus, cost reduction |
| `acquisition_mode` | Active M&A language and target-seeking signals |
| `divestiture_mode` | Portfolio shedding, non-core asset sales |
| `innovation_push` | Heavy R&D, new tech, patent/IP investment |
| `defense` | Competitive response, market share protection |
| `mixed` | Multiple strong signals, no single dominant theme |

---

## 💡 Digital Spend Indicator Scale

| Value | Meaning |
|-------|---------|
| `none_mentioned` | No digital investment language found |
| `low_digital_focus` | Incidental mentions of IT/software |
| `moderate_digital_investment` | Dedicated digital programs |
| `high_digital_priority` | Digital as a strategic lever |
| `digital_transformation_core` | Digital is the core of business strategy |

---

## 🔑 API Keys & Cost

| Provider | Key Required | Cost | Quality |
|----------|-------------|------|---------|
| Anthropic Claude | `anthropic_api_key` | ~$0.01–0.05/doc | ⭐⭐⭐⭐⭐ |
| OpenAI GPT-4o-mini | `openai_api_key` | ~$0.02–0.08/doc | ⭐⭐⭐⭐ |
| Google Gemini Flash | `GEMINI_API_KEY` env | **Free tier** (15 RPM) | ⭐⭐⭐ |
| Heuristic (built-in) | None | **Free** | ⭐⭐ |

The actor automatically cascades: Claude → OpenAI → Gemini → Heuristic.

---

## 🚢 Deployment to Apify

```bash
# Install Apify CLI
npm install -g apify-cli

# Authenticate
apify login

# Deploy
apify push

# Run via CLI
apify call annual-report-filings-extractor --input='{"input_mode":"company_names","company_name_list":["Apple"]}'
```

---

## 🔧 Environment Variables

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google Gemini free tier key |
| `LOG_LEVEL` | `DEBUG`, `INFO`, `WARN`, `ERROR` |

---

## 📋 Extraction Focus Options

- `capex_focus` — Capital expenditure categories and amounts
- `digital_initiatives` — Named digital transformation programs
- `investment_areas` — Specific investment domains with magnitude
- `strategic_priorities` — Top stated objectives from MD&A/Strategy sections
- `risk_mentions` — Risk factors with severity and actionability
- `intent_signals` — Overall strategic direction inference
- `technology_spend` — IT/tech budget signals
- `m_and_a_signals` — Acquisition/divestiture language
- `workforce_signals` — Hiring, layoff, talent investment signals
- `sustainability_capex` — Green/ESG investment commitments

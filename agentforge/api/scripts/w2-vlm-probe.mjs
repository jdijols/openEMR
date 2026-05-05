// One-off probe: validates Anthropic PDF + Vision capability against our W2 sample documents.
// Run: node scripts/w2-vlm-probe.mjs <pdf|png>
// Sources LLM_API_KEY from docker/agentforge/secrets.dev.env.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd(), '../..');
const SECRETS_PATH = resolve(REPO_ROOT, 'docker/agentforge/secrets.dev.env');
const LAB_PDF = resolve(REPO_ROOT, 'Documentation/AgentForge/assets/W2-documents/lab-results/p01-chen-lipid-panel.pdf');
const INTAKE_PNG = resolve(REPO_ROOT, 'Documentation/AgentForge/assets/W2-documents/intake-forms/p03-reyes-intake.png');
const LAB_PNG = resolve(REPO_ROOT, 'Documentation/AgentForge/assets/W2-documents/lab-results/p03-reyes-hba1c.png');

const MODEL = 'claude-haiku-4-5';

function loadApiKey() {
  const raw = readFileSync(SECRETS_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^LLM_API_KEY=(.+)$/);
    if (m) return m[1].trim();
  }
  throw new Error('LLM_API_KEY not found in secrets.dev.env');
}

const LAB_PROMPT = `You are extracting structured data from a clinical lab report.

Return ONLY valid JSON (no prose, no markdown fences) matching this schema:
{
  "performing_lab": string,
  "patient_name": string,
  "collection_date": string,
  "results": [
    {
      "test_name": string,
      "value": number | string,
      "unit": string | null,
      "reference_range_text": string,
      "abnormal_flag": "normal" | "low" | "high" | "abnormal" | "unknown",
      "citation": {
        "page_or_section": string,
        "quote_or_value": string
      }
    }
  ],
  "extraction_metadata": {
    "overall_confidence": "high" | "medium" | "low",
    "fields_uncertain": [string]
  }
}

Rules:
- Do not invent any data. If unreadable, mark uncertain.
- citation.quote_or_value must be verbatim text from the source.
- JSON only, nothing else.`;

const INTAKE_PROMPT = `You are extracting structured data from a patient intake form.

Return ONLY valid JSON matching this schema:
{
  "patient_name": string | null,
  "dob": string | null,
  "chief_concern": { "text": string, "citation": { "page_or_section": string, "quote_or_value": string } },
  "current_medications": [{ "name": string, "dose": string | null, "frequency": string | null, "citation": { "page_or_section": string, "quote_or_value": string } }],
  "allergies": [{ "substance": string, "reaction": string | null, "citation": { "page_or_section": string, "quote_or_value": string } }],
  "family_history": [{ "relation": string, "condition": string, "citation": { "page_or_section": string, "quote_or_value": string } }],
  "extraction_metadata": { "overall_confidence": "high" | "medium" | "low", "fields_uncertain": [string], "fields_unsupported": [string] }
}

Rules:
- Do not invent any data. Mark uncertain or unsupported as appropriate.
- citation.quote_or_value must be verbatim text from the source.
- JSON only.`;

async function callClaude({ apiKey, model, contentBlocks, label }) {
  const startTime = Date.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
  });
  const latencyMs = Date.now() - startTime;
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API ${response.status} for ${label}: ${errBody}`);
  }
  const body = await response.json();
  const text = body.content?.[0]?.text ?? '';
  return {
    label,
    latencyMs,
    inputTokens: body.usage?.input_tokens,
    outputTokens: body.usage?.output_tokens,
    stopReason: body.stop_reason,
    rawText: text,
  };
}

function summarize(result) {
  const { label, latencyMs, inputTokens, outputTokens, stopReason, rawText } = result;
  const inputCostUsd = (inputTokens / 1_000_000) * 1.0;
  const outputCostUsd = (outputTokens / 1_000_000) * 5.0;
  const totalCostUsd = inputCostUsd + outputCostUsd;
  console.log(`\n=== ${label} ===`);
  console.log(`latency:  ${latencyMs}ms`);
  console.log(`tokens:   in=${inputTokens}  out=${outputTokens}  stop=${stopReason}`);
  console.log(`cost:     $${totalCostUsd.toFixed(4)} (in $${inputCostUsd.toFixed(4)} + out $${outputCostUsd.toFixed(4)})`);
  let parsed;
  try {
    const jsonText = rawText.trim().replace(/^```json\s*|\s*```$/g, '');
    parsed = JSON.parse(jsonText);
    console.log(`json:     PARSED OK`);
  } catch (e) {
    console.log(`json:     PARSE FAILED — ${e.message}`);
  }
  console.log(`raw:\n${rawText}`);
  return { ...result, parsed, totalCostUsd };
}

async function main() {
  const apiKey = loadApiKey();
  const which = process.argv[2] ?? 'all';

  const tasks = [];
  if (which === 'pdf' || which === 'all') {
    const pdfBytes = readFileSync(LAB_PDF);
    const pdfBase64 = pdfBytes.toString('base64');
    tasks.push({
      label: 'LAB PDF (chen-lipid-panel.pdf)',
      contentBlocks: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: LAB_PROMPT },
      ],
    });
  }
  if (which === 'png' || which === 'all') {
    const pngBytes = readFileSync(INTAKE_PNG);
    const pngBase64 = pngBytes.toString('base64');
    tasks.push({
      label: 'INTAKE PNG (p03-reyes-intake.png)',
      contentBlocks: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
        { type: 'text', text: INTAKE_PROMPT },
      ],
    });
  }
  if (which === 'lab-png' || which === 'all') {
    const pngBytes = readFileSync(LAB_PNG);
    const pngBase64 = pngBytes.toString('base64');
    tasks.push({
      label: 'LAB PNG (p03-reyes-hba1c.png)',
      contentBlocks: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
        { type: 'text', text: LAB_PROMPT },
      ],
    });
  }

  let totalCost = 0;
  for (const task of tasks) {
    const result = await callClaude({ apiKey, model: MODEL, ...task });
    const summarized = summarize(result);
    totalCost += summarized.totalCostUsd;
  }
  console.log(`\n--- TOTAL COST: $${totalCost.toFixed(4)} across ${tasks.length} call(s) ---`);
}

main().catch((e) => { console.error(e); process.exit(1); });

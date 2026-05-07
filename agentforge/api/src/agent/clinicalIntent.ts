/**
 * Deterministic clinical-intent classifier — runs before the LLM call.
 *
 * Why this exists:
 *   The system prompt used to *nudge* the model to call evidence_retrieve when
 *   it sensed a treatment-decision question. The nudge is probabilistic; the
 *   model would sometimes skip retrieval and recite training data, fabricating
 *   guideline names that aren't in our corpus. For a clinical product that's
 *   a safety bug, not a UX bug.
 *
 *   This module moves the decision from the model to the orchestrator. Any
 *   message classified as `isClinical: true` gets a deterministic
 *   evidence_retrieve call before the LLM is invoked, with the chunks
 *   pre-injected into the prompt. The model can still call evidence_retrieve
 *   again for follow-ups, but it never starts empty-handed on a clinical
 *   question.
 *
 * Classifier policy:
 *   - Bias toward retrieval. Cost is one DB round-trip + a Cohere rerank;
 *     correctness payoff is a citation-grounded answer instead of a
 *     hallucinated one. Favor false positives over false negatives.
 *   - Conservative on dictation. Declarative physician dictation
 *     ("BP is 140/90", "started on lisinopril yesterday") is NOT a clinical
 *     question — it routes to propose_clinical_note_write, not retrieval.
 *   - Conservative on chart-only retrieval ("what is her LDL?"). These are
 *     answered by W1 chart tools; firing the guideline retriever adds noise.
 */

const TREATMENT_DECISION_KEYWORDS = [
  // Direct decision phrasing
  /\bshould (?:i|we|she|he|they)\b/i,
  /\b(?:do|does|did) (?:i|we|she|he|they) need\b/i,
  /\bis it (?:time|appropriate|safe)\b/i,
  /\bwhen (?:to|do|should)\b.*\b(?:start|stop|switch|escalate|intensify|titrate|adjust|change)\b/i,

  // Therapy-change verbs
  /\b(?:intensify|escalate|titrate|de-?escalate|taper|switch|stop|discontinue|start|initiate|add|hold|resume)\b.*\b(?:therapy|medication|med|treatment|dose|drug|regimen|statin|insulin|antihypertensive|ace|arb|metformin)\b/i,
  /\b(?:therapy|medication|med|treatment|dose|drug|regimen|statin|insulin|antihypertensive|metformin)\b.*\b(?:intensif|escalat|titrat|de-?escalat|taper|switch|adjust)/i,

  // Evidence / guideline phrasing
  /\b(?:guideline|guidelines|recommend|recommendation|recommended|evidence|literature|trial|trials|consensus)\b/i,
  /\bwhat does the (?:guideline|literature|evidence|data)\b/i,
  /\b(?:according to|per) (?:the )?(?:guideline|guidelines|literature|evidence|recommendations?)\b/i,
  /\b(?:ada|aha|acc|ahas?|jnc-?\s*8|uspstf|nice|esc|easd)\b/i,

  // Risk / target / threshold language
  /\b(?:target|goal|threshold)\b.*\b(?:ldl|a1c|hba1c|bp|blood pressure|systolic|diastolic|cholesterol)\b/i,
  /\b(?:ldl|a1c|hba1c|bp|cholesterol)\b.*\b(?:target|goal|threshold)\b/i,
  /\b(?:cardiovascular|cv|ascvd|stroke) risk\b/i,
  /\b(?:risk|benefit|trade-?off)s?\b.*\b(?:treatment|therapy|medication|surgery|procedure|screening)\b/i,

  // Screening / preventive
  /\b(?:screen|screening|preventive|prevention)\b/i,

  // Dose adjustment / management — order-agnostic on "dose" + qualifier.
  /\b(?:dose|dosing|dosage)\b.*\b(?:appropriate|right|correct|increase|decrease|adjust|safe)\b/i,
  /\b(?:appropriate|right|correct|safe|optimal)\s+(?:dose|dosing|dosage)\b/i,
  /\bhow (?:should|do|to) (?:i|we) (?:treat|manage|approach|handle)\b/i,

  // Differential / workup
  /\bdifferential\b/i,
  /\bwork-?up\b/i,
  /\bwhat (?:tests?|labs?|imaging|workup)\b.*\bshould\b/i,
];

/**
 * Phrases that LOOK clinical but are pure chart-record retrieval.
 * If the message ONLY matches these and not a treatment-decision keyword,
 * we skip mandatory retrieval. The chart tools are the right path.
 */
const CHART_ONLY_PATTERNS = [
  /^\s*what(?:'s| is| are)\s+(?:her|his|the patient'?s?|the)\s+(?:current\s+)?(?:ldl|hdl|a1c|hba1c|bp|blood pressure|weight|height|temp|temperature|pulse|labs?|meds?|medications?|allergies|problems?|encounters?|notes?|vitals?)\b/i,
  // Imperative retrieval: "show me her vitals", "pull up her labs", "list her meds".
  // The optional `(?:up|out|on|over)` slot accepts particle verbs ("pull up", "look up").
  /^\s*(?:show|pull|get|find|list|display|open|look)\s+(?:up\s+|out\s+|on\s+|over\s+)?(?:me\s+)?(?:her|his|the patient'?s?|the)\s+(?:last\s+|recent\s+|prior\s+)?(?:ldl|hdl|a1c|hba1c|bp|blood pressure|weight|height|temp|temperature|pulse|labs?|meds?|medications?|allergies|problems?|encounters?|notes?|vitals?)\b/i,
  /^\s*when (?:was|did)\s+(?:her|his|the patient'?s?|the) last\b/i,
];

/**
 * Heuristic: declarative dictation rather than a question.
 * Physician dictation routes to propose_clinical_note_write — never trigger
 * mandatory guideline retrieval on dictation, even if the words happen to
 * mention "statin" or "BP".
 */
function looksLikeDictation(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed === '') return true;
  // Ends with sentence punctuation but not a question mark.
  const lastChar = trimmed.slice(-1);
  if (lastChar === '?') return false;
  // Starts with imperative or declarative form (not a wh-question or aux-inversion).
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  const questionStarts = new Set([
    'what', 'why', 'how', 'when', 'where', 'who', 'which',
    'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could',
    'should', 'would', 'will', 'may', 'might', 'has', 'have', 'had',
  ]);
  if (questionStarts.has(firstWord)) return false;
  // No question mark and doesn't start with a question word → likely dictation.
  return true;
}

export type ClinicalIntentResult = Readonly<{
  isClinical: boolean;
  /** Short tag for telemetry: "treatment_decision" | "evidence_phrase" | "chart_only" | "dictation" | "other" */
  reason: string;
}>;

/**
 * Classify whether a user message warrants a deterministic evidence_retrieve
 * call before the LLM. Pure function — no side effects, fully testable.
 *
 * Order matters: treatment-decision keywords win over chart-only retrieval
 * imperatives (so a message containing both still triggers retrieval).
 * Chart-only and treatment-decision checks run BEFORE the dictation
 * heuristic — imperatives like "show me her labs" should classify as
 * chart_only, not dictation.
 */
export function classifyClinicalIntent(message: string): ClinicalIntentResult {
  const normalized = message.trim();

  if (normalized === '') {
    return { isClinical: false, reason: 'empty' };
  }

  // Treatment-decision keywords win over everything else — better to
  // over-retrieve than miss a real clinical question.
  if (TREATMENT_DECISION_KEYWORDS.some((p) => p.test(normalized))) {
    return { isClinical: true, reason: 'treatment_decision' };
  }

  // Chart-only retrieval imperatives ("show me her vitals", "list meds").
  // These are unambiguously retrieval — chart tools handle them, no
  // guideline retrieval needed.
  if (CHART_ONLY_PATTERNS.some((p) => p.test(normalized))) {
    return { isClinical: false, reason: 'chart_only' };
  }

  // Declarative dictation (no question mark, doesn't start with a
  // question/aux word). Routes to propose_clinical_note_write — never
  // triggers mandatory guideline retrieval.
  if (looksLikeDictation(normalized)) {
    return { isClinical: false, reason: 'dictation' };
  }

  // Default: questions get retrieval. Cost is low; the alternative is
  // training-data hallucination, which is the bug we're fixing.
  if (normalized.endsWith('?')) {
    return { isClinical: true, reason: 'open_question' };
  }

  return { isClinical: false, reason: 'other' };
}

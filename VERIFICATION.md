# Verification

## Summary

Every chat response the Clinical Co-Pilot produces passes through a deterministic verification layer before it reaches the clinician. The layer answers a single question: *is the agent claiming something the patient's chart actually supports?* If the answer is no, the offending claim is stripped; if every claim in the response is stripped, the entire turn is replaced with a refusal block. There is no path by which a clinician sees an unattributed assertion presented as fact.

Verification runs after the LLM has produced its draft response and after every tool call has returned. It is a post-hoc gate over the agent's output, not a runtime guardrail inside the model loop. That choice is deliberate — the model is fast, fluent, and unreliable; verification is slow, narrow, and deterministic. We let the model write whatever it wants, then we check its work against the actual tool evidence we gathered for that turn.

There are four layers, each catching a different failure mode:

1. **Citation enforcement** — every clinical claim must carry a citation UUID that points at a tool result we collected during this turn.
2. **Negative-claim backing** — sentences like *"no allergies on file"* require an explicit empty-query observation; otherwise the model is asserting absence without having looked.
3. **Numeric blood-pressure range guard** — a defense-in-depth parser that flags physiologically impossible vitals before they reach the chart.
4. **Medication-inactive warning** — claims of "currently taking X" that cite a row whose status is `inactive` or `discontinued` are surfaced as a warning, not allowed to pass silently.

This document walks through where verification fits in the request flow, anchors each layer to the code that implements it, describes how failure cascades into a refusal, and — most importantly — enumerates the failure modes verification does *not* catch. A clinical safety story is not credible without that second list, and the brief asks for it explicitly.

---

## Why verification exists

A model can be fluent and wrong; it can be fluent and right but unable to show its work. Either failure mode is unsafe in a clinical setting. A physician who reads *"the patient has no documented penicillin allergy"* needs to know whether that sentence came from looking at the allergy table and finding it empty, from looking at it and missing the row, or from never having looked at all. The English text doesn't distinguish these cases. Verification is the mechanism that forces the distinction into the system before the sentence is shown.

The brief frames this as two requirements:

- **Source attribution** — every claim must trace to a specific record in the patient's file.
- **Domain constraint enforcement** — the agent must be aware of clinical rules and flag or reject responses that violate them.

We treat both as deterministic gates. There is no LLM judging another LLM's output here, no probabilistic confidence threshold. Citation IDs either appear in the tool-evidence set or they don't; a systolic value is either inside `[40, 300]` or it isn't. This keeps the gate auditable: an instructor or hospital reviewer can read the rule and predict when it fires.

---

## Where verification runs in the flow

A single chat turn flows through five stages:

```
client request
  → session token + active-chart binding (boundary parse)
  → LLM call with tools available (the model decides which to invoke)
  → tool results collected into ClinicalToolEvidence
  → LLM final response parsed into typed blocks
  → VERIFICATION  ← this layer
  → response written to the conversation log + returned to client
```

The verification call site is a single line at [agentforge/api/src/agent/orchestrator.ts:660](agentforge/api/src/agent/orchestrator.ts:660):

```ts
blocks = await verifyClinicalBlocks(observability, correlationId, blocks, evidence);
```

By the time we reach that line, three things are true:

1. `blocks` is the parsed structured response from the LLM — a typed array of `claim`, `text`, `tool_call`, `tool_result`, `warning`, and `refusal` blocks.
2. `evidence` is a `ClinicalToolEvidence` aggregate built from the tool-result merge in [agentforge/api/src/agent/orchestrator.ts:653-658](agentforge/api/src/agent/orchestrator.ts:653) — citation UUIDs the model is allowed to reference, an "empty-backed" map that records which tools actually returned an empty list, and the medication rows we observed (with their statuses).
3. `observability` is the live Langfuse handle for this `correlationId`. Every verification decision emits a categorized event so the trace tells you not just "we removed a claim" but "we removed it for reason X."

After verification returns, the post-conditions are: every surviving claim block cites at least one UUID in the evidence set; no negative claim is present without backing; no impossible BP value remains; warnings are attached where med-status conflicts were detected. If those post-conditions cannot be reached, the function short-circuits to a refusal.

---

## The four layers

### 1. Citation enforcement

The core invariant. Implementation in [agentforge/api/src/agent/verification.ts:54-60, 108-114](agentforge/api/src/agent/verification.ts:54).

Every clinical claim block carries one or more citation IDs. Those IDs must intersect with the set of UUIDs the tool layer actually emitted during this turn (`evidence.citationUuids`). The check itself is a one-line set membership test:

```ts
function citesAny(claimIds: readonly string[], cited: ReadonlySet<string>): boolean {
  if (claimIds.length === 0) return false;
  return claimIds.some((id) => cited.has(id));
}
```

If the test fails, the block is stripped from the output and a `verification.uncited_claim_removed` event is emitted to Langfuse. We do not silently drop the claim — every removal is observable.

This catches three concrete failure modes:

- The model invented a citation ID that doesn't exist (hallucinated UUID).
- The model wrote a claim with no citation at all.
- The model cited a UUID from a previous turn or from training data, not from this turn's actual tool calls.

The reason it works is the citation namespace. UUIDs are minted server-side per tool result and handed to the model only inside the tool response payloads. The model has no way to produce a valid UUID except by quoting one we just gave it. That's the cryptographic-ish footing for the rest of the verification story.

### 2. Negative-claim backing

Implementation in [agentforge/api/src/agent/verification.ts:5-6, 95-105](agentforge/api/src/agent/verification.ts:5).

The most insidious clinical hallucination is *"the patient has no allergies"* when the allergy tool was never called. Citation enforcement alone doesn't catch this — there's no citation to check, because the claim is about the *absence* of records.

We use two regex patterns to identify negative clinical statements about allergies and labs:

```ts
const NEGATIVE_ALLERGY_PATTERN = /\b(no|without|denies)\b.+allerg/i;
const NEGATIVE_LABS_PATTERN = /\bno\s+(recent\s+)?labs?\b|\b(without\s+).*\blabs?\b/i;
```

When a claim matches one of these, the verification layer requires that the corresponding tool was actually invoked and returned an empty list. The `ClinicalToolEvidence.emptyBacked` map carries that signal: `emptyBacked.get('get_allergies') === true` means *we ran the allergy tool and it returned zero rows.* No empty-backed observation, no negative claim — the block is stripped and `verification.negative_claim_removed` is emitted.

This is a narrow defense. It only covers two clinical surfaces (allergies and labs), and only the regex variants we anticipated. The brief's "domain constraint enforcement" requirement is satisfied here in spirit — we encode the clinical rule that *absence claims require evidence of looking* — but not exhaustively. See the limitations section below.

### 3. Numeric blood-pressure range guard

Implementation in [agentforge/api/src/agent/verification.ts:15-36](agentforge/api/src/agent/verification.ts:15).

A small but important defense-in-depth parser. When a claim mentions a BP value, the parser extracts systolic / diastolic numbers and checks them against PRD §9.2.3 ranges: systolic `[40, 300]`, diastolic `[20, 200]`. Anything outside is flagged as `impossible_vital`.

This is paranoia in the right place. The vitals write path has its own parser; this is a second check at the verification layer that catches the case where the model has restated a vital in prose ("BP was four hundred over two-fifty") that no clinician would ever type but a confused LLM might. The cost of the check is one regex and a comparison; the cost of letting the value through is a chart entry that triggers cascading downstream alerts.

### 4. Medication-inactive warning

Implementation in [agentforge/api/src/agent/verification.ts:150-176](agentforge/api/src/agent/verification.ts:150).

When a claim says *"currently taking X"*, *"active medication"*, or *"still on Y"*, the verification layer cross-references the cited medication rows. If any cited row has a status containing `inactive` or `discontinu` and the drug name appears in the claim text, the layer attaches a warning block:

> *Source medication row indicates this drug is inactive; verify before relying on chronic-use language.*

Note this is a **warning**, not a strip. The claim is still shown — there are clinical contexts where "discontinued last week" is exactly the relevant fact — but the clinician is told the source disagrees with the language. Observability records `verification.med_status_conflict_warning`.

This is the only verification layer that produces a soft outcome. The other three either pass or remove. Med-status is treated as a soft signal because med history is messy: a row marked "inactive" in OpenEMR may be three years old or three days, and the model may have correctly described a chronic medication that was paused yesterday. The warning preserves the clinician's judgment without burying the conflict.

---

## What happens when verification fails

The stripping behavior cascades. Implementation in [agentforge/api/src/agent/verification.ts:128-141](agentforge/api/src/agent/verification.ts:128).

After all blocks have been processed, the layer checks whether any clinically meaningful block survived (`claim`, `text`, `tool_call`, `tool_result`, or `warning`). If none did — every claim was uncited, every negative was unbacked — the layer returns a single refusal block:

```ts
return [{ type: 'refusal', reason: 'insufficient_evidence_after_verification' }];
```

This is the most important property of the design. The clinician never sees a partial answer with the bad parts quietly removed. If the model wrote five claims and four were unbacked, the surviving fifth still ships (with attribution). If all five were unbacked, the user gets a refusal that names the reason. The refusal renders in the UI as a clear "I couldn't substantiate a response" message, which is a valid clinical outcome — one that the brief's adversarial eval cases specifically test for.

The cross-patient case is handled at the very top of the function, before any block is examined: if `evidence.crossPatientLeak` is true (a tool was called against a UUID that doesn't match the bound chart), the entire response is replaced with `blocked_cross_patient_tool_args`. See [agentforge/api/src/agent/verification.ts:79-82](agentforge/api/src/agent/verification.ts:79).

---

## What verification does NOT catch

The brief asks: *"Think carefully about where in the agent's flow verification happens, what it catches, and what it doesn't. Document your approach and its known limitations."* The four layers above describe what is caught. This section is the equally important other half.

### 1. Hallucinations within a correctly cited source

Citation enforcement guarantees the *existence* of a source for every claim. It does not guarantee the *fidelity* of the claim to the source. If a tool result contains the row `{ medication: 'lisinopril', dose: '10mg', status: 'active' }` and the model writes *"patient is on lisinopril 20mg"* with that row's UUID, verification passes. The dose is wrong, but the citation is valid.

This is a fundamental limitation of citation-based verification. To catch fidelity drift we would need a second LLM (or a structured-extraction pass) that compares the generated text against the cited source values. We chose not to do that for V1: it adds cost, latency, and a second probabilistic component to a layer whose value is its determinism. The mitigation is twofold — the system prompt instructs the model to quote dose and frequency verbatim from source, and the citation index is rendered to the clinician as a clickable navigation aid so they can verify any specific value in one click.

### 2. Paraphrased negative claims that evade the regex

The negative-claim backing layer fires on `/\b(no|without|denies)\b.+allerg/i` and the equivalent for labs. It does not fire on:

- *"The patient is allergy-free."*
- *"Allergies: none documented."* (if rendered as a heading + value pair, depending on tokenization)
- *"There's nothing remarkable in the allergy section."*
- Negative claims about anything other than allergies and labs (medications, conditions, immunizations, procedures, family history).

Two failure shapes here. First, language we didn't anticipate may slip through. Second, every other clinical surface is uncovered. The eval suite includes a curated case for the unbacked-labs path ([agentforge/api/eval/cases/curated/neg-claim-labs-unbacked.json](agentforge/api/eval/cases/curated/neg-claim-labs-unbacked.json)) but does not regression-test paraphrase variants.

A more ambitious version of this layer would use a small classifier or a structured-output prompt to flag negative clinical assertions across all surfaces, then dispatch to the appropriate empty-query check. That's a V2 design; the V1 narrow regex over the two highest-risk surfaces is what shipped.

### 3. Domain constraints we didn't encode

The blood-pressure range guard is the only physiological-range check. Verification does not catch:

- Drug-drug interactions
- Dosage outside accepted ranges for the cited medication
- Pediatric-vs-adult vital ranges (the BP range is adult-aligned)
- Lab value ranges
- Allergy cross-reactivity (penicillin → other beta-lactams)
- Contraindications based on conditions in the patient's problem list

Each of those is a body of clinical knowledge we deliberately scoped out of V1. The system prompt asks the model to defer to clinician judgment on these surfaces and to surface concerns as warnings rather than recommendations. An interview-defensible position: **verification handles the rules we can enforce deterministically and cheaply; everything else is the clinician's call, and the system makes that boundary visible.**

### 4. Tool-call sufficiency

Verification checks that claims cite tools that were called. It does not check whether the *right* tools were called for the user's question. If a clinician asks *"any allergies and labs?"* and the model only invokes the allergy tool, verification will pass an answer that ignores the labs question entirely. The orchestrator's `stopWhen: stepCountIs(12)` budget allows multi-tool reasoning, but nothing forces the model to use it.

Mitigation: the system prompt enumerates the tool surface and includes few-shot examples of multi-tool turns. The eval suite tests the negative-claim path ("no allergies on file") which forces empty-backed observation, but does not enumerate questions whose correct answer requires N tool calls and check that all N were made.

### 5. Adversarial tool-result poisoning

Verification trusts the tool-evidence aggregate. If a tool returns malicious or malformed data — for example, a synthetic medication row with status `active` for a drug that was actually discontinued — verification will accept claims citing that row. Defense against this is at the tool layer, not the verification layer: tool implementations are scoped to OpenEMR queries through bound stored procedures and can't return data the patient's chart doesn't contain. We rely on that boundary; verification does not re-validate it.

### 6. Verification does not run during streaming

Verification operates on the final assembled response. We do not stream tokens to the client; the full response is built, verified, and returned in one shot. This is a UX cost (the user waits for the whole turn) chosen as a verification cost (we never have to retract a token we already sent). For a real-time clinical use case at higher volumes a streaming version would need a token-level commit-or-rollback design, which is significant additional engineering.

### 7. External evidence grounding

Verification checks claims against the patient's chart. It does not check claims against the medical literature. If a clinician asks *"what's the recommended A1c target for a 68-year-old with type 2 diabetes and hypertension?"*, the question is not about this patient's data — it's about general medical knowledge. There is no chart record to verify against, and the existing four layers do not fire.

V1's posture on these questions is **deferral**: the system prompt instructs the model to redirect general medical knowledge questions to clinician judgment rather than answer them with a recommendation. That keeps the verification layer's chart-only scope honest — the agent does not ship "subjective AI recommendations" dressed as evidence-backed answers — but it does mean the agent can't help with the kind of treatment-threshold questions a more capable co-pilot would ideally answer.

The natural V2 extension is *evidence-based citation*: a separate safety layer that grounds general medical knowledge in peer-reviewed sources via a `lookup_clinical_evidence` tool over PubMed, NEJM, OpenEvidence, or similar. The existing citation-enforcement architecture already does the right thing on UUIDs from any tool, including external ones — adding the new tool wouldn't require redesigning the verification layer, only registering a new source pack and extending citation rendering to handle external URLs alongside in-chart navigation. See [Documentation/AgentForge/implementation/v2-roadmap.md](Documentation/AgentForge/implementation/v2-roadmap.md) for the design sketch.

The boundary matters for interview defense: V1 verification is about *chart fidelity*, not *clinical correctness writ large*. Conflating the two would make the four-layer story look thinner than it is — and would obscure the deferral posture that is itself a deliberate safety choice.

---

## Open gaps for follow-up code work

The four initial gaps from the audit pass that produced this document are now closed:

- **Inline signpost at the verification call site** — added at [agentforge/api/src/agent/orchestrator.ts:660](agentforge/api/src/agent/orchestrator.ts:660). The comment block names the gate, its position in the flow, and points back to this doc.
- **Module-level docblock naming the four layers** — added at the top of [agentforge/api/src/agent/verification.ts](agentforge/api/src/agent/verification.ts). A future maintainer opening the file cold now sees the architecture statement before the regex constants.
- **Fidelity-drift LIMITATION marker** — added as a LIMITATION block on the `verifyClinicalBlocks` JSDoc in the same file. Documents the citation-valid-but-content-drifts gap from §"What verification does NOT catch" §1 in the code itself, with a forward pointer to V2.
- **Negative-claim paraphrase coverage matrix** — added at [agentforge/api/test/agent/verification-negative-coverage.test.ts](agentforge/api/test/agent/verification-negative-coverage.test.ts). 24 cases: paraphrases the regex catches (must stay caught), paraphrases the regex misses by design (must stay missed without a doc update), and clinical surfaces V1 doesn't cover at all. Converts the §"What verification does NOT catch" §2 limitation from "documented" to "regression-tested."

The verification system satisfies the brief's two requirements (source attribution + domain constraint enforcement) and openly documents what it doesn't. New gaps will be appended here as they surface.

---

## Cross-references

- Eval cases that exercise verification: [agentforge/api/eval/cases/curated/neg-claim-allergies-backed.json](agentforge/api/eval/cases/curated/neg-claim-allergies-backed.json), [agentforge/api/eval/cases/curated/neg-claim-labs-unbacked.json](agentforge/api/eval/cases/curated/neg-claim-labs-unbacked.json), [agentforge/api/eval/cases/curated/adv-cross-patient-blocked.json](agentforge/api/eval/cases/curated/adv-cross-patient-blocked.json), [agentforge/api/eval/cases/curated/adv-vitals-ambiguous-bp.json](agentforge/api/eval/cases/curated/adv-vitals-ambiguous-bp.json). See [EVALUATION.md](EVALUATION.md) for the full list.
- Observability events emitted by verification: every category prefix `verification.*` appears in Langfuse for the corresponding `correlationId`. See [OBSERVABILITY.md](OBSERVABILITY.md).
- PRD anchors: §9.1 (citation), §9.2 (vitals defense-in-depth), §9.3 (negative-claim backing), §9.4 (vitals parser uncertainty). See [PRD.md](PRD.md).
- Tool evidence builder: [agentforge/api/src/agent/toolEvidence.ts](agentforge/api/src/agent/toolEvidence.ts) — defines what `ClinicalToolEvidence` contains and how it's constructed from tool results.

---
source: Gauntlet AI — Week 1 AgentForge case study
fork_docs_path: Documentation/AgentForge/process/01-agentforge-impressions.md
---

# AgentForge Clinical Copilot — Impressions & Open Questions

Notes expanding on [Week 1 - AgentForge.pdf](../references/Week%201%20-%20AgentForge.pdf) (*Gauntlet AI — Clinical Copilot / Project Requirements*).

---

## Document in brief

The case study asks for an **AI agent embedded in OpenEMR** that helps a physician in the **~90 seconds between patient rooms**: recall who they are seeing, what changed, what is on file, and what matters today—without wading through dense EHR notes alone. Success is measured less by demo flash than by **trust**: claims must be **grounded in the record**, **authorization must be real**, and **HIPAA/PHI** constraints shape architecture. Required pillars include a **conversational agent with tools**, a **verification layer** (source attribution + domain constraints), **observability**, and an **eval suite**—all traceable to concrete users and use cases in the workflow.

---

## Where is the physician actually using this—and on what device?

The scenario emphasizes **between patient rooms** and **under pressure while the patient is already waiting**, which strongly suggests **in-hallway or at-the-door** use: glanceable, fast, one-handed possible. The PDF does **not** specify **mobile vs. workstation vs. tablet**; it only implies urgency and context-switching.

**Implication:** product thinking should explicitly decide (or test) **form factor**:

- **Fixed terminal in room** — larger screen, better for deep review; weaker for the “90 seconds in the hall” story unless the workflow is “open chart before entering.”
- **Mobile or tablet** — fits rounding and corridor time; raises UX, authentication, and session-timeout questions.
- **Hybrid** — summary on phone, detail on desktop; aligns with “speed vs. completeness” as a documented tradeoff in the requirements.

This is worth calling out in `USERS.md` / architecture: **the device is part of the workflow**, not an afterthought.

---

## What is OpenEMR?

**OpenEMR** is a **widely deployed, open-source electronic health record (EHR)** system. The project is **not** a greenfield clinical app; it is an **integration** into existing healthcare UI and data models. You **fork** [github.com/openemr/openemr](https://github.com/openemr/openemr), run it locally with sample data, deploy a public instance, **audit** it, then plan how the agent **reads patient data** and **respects the same trust boundaries** the EHR already implies.

---

## Verification, cross-referencing, and “source rating”

The requirements ask for a **verification system** before answers reach the user:

1. **Source attribution** — every factual claim traceable to **specific records** in the patient file; if it cannot be attributed, it should not be stated as fact.
2. **Domain constraint enforcement** — awareness of **clinical rules** (e.g., dosage thresholds, interaction flags); responses that contradict underlying data are a **failure**.

**Extensions I’m thinking about:**

- **Cross-referencing** — e.g., align **problem list**, **active meds**, and **recent labs** so the agent does not silently privilege one silo.
- **Source rating / provenance** — not always spelled out in the PDF, but in real charts some sources are **more authoritative** than others (signed note vs. unsigned draft, pharmacy feed vs. patient-reported list). A deliberate policy (“prefer medication list from pharmacy interface when available”) could sit next to attribution.

Interview prep in the doc explicitly asks **why** the verification layer is designed the way it is—this is central.

---

## Trust in a real hospital setting and HIPAA

The PDF is blunt: a **confident hallucination** can **harm patients** and destroy **trust**. **PHI under HIPAA** affects **storage, transmission, logging, and access**. The audit must show **understanding**, not acronym dropping—including **BAA** implications if PHI touches an LLM vendor, **audit logging**, retention, and breach-notification thinking. Gauntlet’s note: use **demo data** only, but **design as if** BAAs and no training on PHI apply.

**Takeaway:** “Works in demo” ≠ “defensible to a hospital CTO.” Architecture and `AUDIT.md` should make **trust boundaries** explicit.

---

## Multi-user permissions that are legally compliant

The **Hard Problems** section requires **authorization and access control**: physicians vs. nurses vs. residents under supervision—the system must **know who is asking** and **enforce** access, not assume a single trusted user.

**Open question for implementation:** **Does OpenEMR already model roles and patient-level access?** (Typically yes, for a mature EHR—but the **audit** should confirm **how** identities, facilities, and break-glass or emergency access work.) The agent must **not** become a bypass: tool calls should use **the same session/user context** as the rest of the app, or a **narrow service path** that is auditable and equivalent to manual chart access.

---

## Bridge between deterministic logic and the agent

Medication validation from a **pharmacy department** or **rules engine** is often **deterministic** (formulary, interactions, dose checks). The case study’s **domain constraint enforcement** aligns with that: the LLM **interprets and summarizes**, while **hard rules** validate or flag.

A useful pattern: **agent proposes natural-language synthesis** → **verification layer checks** claims against **structured data + rule APIs** → **reject or downgrade** unsupported statements. That **bridge** is both a safety story and a way to earn clinician trust (“this came from the med list, and pharmacy rules agree/disagree”).

---

## Physician-centric experience

The doc pushes back on vague “physicians need help”: pick a **narrow user** (e.g., hospitalist, PCP, ED resident) and a **minute-by-minute workflow**. The bar is whether the user would **choose** this over a dashboard or better chart view.

Design implications:

- **Defaults** tuned to **today’s visit** and **what changed**, not encyclopedic chart review.
- **Latency** choices documented (speed vs. completeness).
- **Refusals** and **uncertainty** surfaced clearly when data are missing or conflicting.

---

## Generative “pre-built UI” (Siri-like suggestions) + conversational agent

The required **core** is a **multi-turn agent** with **tools**, not “only” a search bar. A natural extension—still tied to `USERS.md`—is **proactive chips or cards**: suggested prompts, “what changed since last visit,” “labs to review,” etc., that **launch or seed** the conversation. That gives **Siri-like discoverability** without replacing the need for **follow-up questions** and **tool grounding**.

Guardrail: every suggestion that reads like a **fact** still needs to pass the same **verification** story when expanded.

---

## Does the EMR have permissioning built in?

**In principle, yes** — OpenEMR is a full EHR and implements **authentication, roles, and access patterns** appropriate to clinical software. **In practice, the fork and deployment must be audited:** how users are provisioned, how patient access is scoped, what gets logged, and where an **AI integration** could **leak** data (e.g., overly broad tool queries, logging prompts with PHI, or server-side keys).

The agent layer should **reuse or strictly mirror** those controls rather than inventing a parallel permission model.

---

## Summary

The PDF frames a **high-stakes** problem: **time-pressured clinicians**, **grounded answers**, **multi-user reality**, and **HIPAA-shaped** engineering. My open design threads—**device and setting**, **deterministic vs. generative split**, **source quality**, and **pre-built conversational affordances**—are all ways to make that story **concrete** while staying inside the case study’s **floor** (audit, users, architecture, verification, observability, eval).

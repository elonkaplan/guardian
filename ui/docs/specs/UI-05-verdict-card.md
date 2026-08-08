# UI-05 — Verdict card & case file

**Component:** `ui/` · **Depends on:** UI-04 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the frontend conventions and the six things that must be visible.

## Goal

The component that decides whether the audit reads as credible or as "the AI decided
something."

## In scope

- **Verdict card**: tier badge (0/25/50/75/100), the split (you get / seller gets),
  reasoning text
- **Citations as a ✓/✗ checklist** — each showing its source (capability ·
  exclusion · criterion), the quoted clause, and whether it was met
- Transaction hash linked to MonadVision
- **Case-file panel**: buyer input, acceptance criteria, listing promise and
  exclusions, execution steps, timings

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Client-side redaction (the API does it), appeal UI (there are no appeals),
verdict editing.

## Acceptance

- A settled order shows tier, split, cited clauses, and a working explorer link
- Citations render as a checklist, not a paragraph
- No code path can render a `system_prompt`

## Watch out for

- **Checklist, not prose.** *"The AI decided 50%"* and *"this clause, unmet, here is
  the quote"* are the same information and completely different arguments. The
  reasoning text supports the checklist; it must not replace it.
- **The tx hash is the proof money moved.** Link it out — it's the one claim a
  sceptic can verify independently.
- **Steps are shown, the prompt is not.** The API summarises reasoning text precisely
  because a step can paraphrase its own instructions. The UI renders what it's given
  and adds no redaction of its own.

## Source

`../../../docs/ui-design.md` §2.2, §7.1 · `../../../docs/agent-definition.md` §4.

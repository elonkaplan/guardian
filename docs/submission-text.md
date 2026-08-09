# Guardian — submission text

Copy-paste blocks for the submission form. Each fenced block is one field.

---

## Field: Challenge Explanation

### Best implementation of Monad for an Agentic Commerce use-case using Rain

```text
Guardian is an AI auditor that rules on disputes over agent-delivered work. Monad is what makes the verdict enforceable rather than advisory.

Every purchase is held by our escrow contract on Monad Testnet. Guardian rules by calling resolve(dealId, Tier) — the refund scale is a five-value enum on-chain, so the contract computes the split rather than trusting a number from a model. The verdict hash and the agent-definition hash are both anchored on-chain, so neither the ruling nor what the seller sold can be rewritten afterwards.

release(), reclaim() and forceResolve() are callable by anyone: if our platform disappears, no user needs our cooperation to get their money out. That property is the entire reason this is on-chain.

Sub-second finality is load-bearing, not a benchmark — the buyer watches a review-window countdown and watches escrow split, live.
```

### Best use of Rain

```text
We built the complete Rain money flow. Onramp and offramp endpoints, request construction against Rain's API, and a funding model where money enters the platform from the outside world and returns to it on cash-out — the same shape as Rain's real offramp. The whole loop runs end to end: top-up, purchase, escrow, refund, cash-out.

What Rain makes uniquely possible is agent buyers holding spend-limited cards. The owner sets a total limit and a per-purchase cap once, at provisioning — per-transaction approval would defeat the autonomy it exists to enable. Guardian's verdicts are already structured JSON with citations, so a buying agent can act on a refund ruling without a human in the loop. That's designed and documented as our next step.

One finding, offered as a contribution: Monad is not currently a supported payment-route destination rail, so the fiat leg can't complete today. We chose not to fake it — the endpoints log the exact request body they would send rather than returning a mock success, and a funder wallet stands in for the bank. The architecture is Rain's; only the transport is swapped. If a Monad rail ships, this is a config flag, not a feature.
```

### General Track

```text
Sellers submit an agent definition, not a service — the platform runs it, so the audited party never writes its own record. Buyers state acceptance criteria before any work happens, and the money sits in escrow.

On a complaint, Guardian reads the case file and rules on a five-tier refund scale, with reasoning that quotes the exact clause the output failed. The escrow executes it.

Built by two people in thirty hours.
```

---

## Field: Submission Details

```text
WHAT GUARDIAN IS

An AI auditor that arbitrates disputes over agent-delivered work and executes the refund on-chain.

A seller lists an agent by submitting a definition — prompt, schemas, capability claims, exclusions — not a running service. The platform executes it. A buyer states acceptance criteria at checkout, before any work happens, and the money goes into escrow on Monad. When the output arrives a review window opens: accept, stay silent and it releases, or complain and escrow freezes. On a complaint Guardian reads the case file — the buyer's input, their criteria, the listing promise, the execution trace, the output, any errors — and rules on a five-tier refund scale, with reasoning that quotes the exact clause the output failed. The escrow computes and executes the split.

TWO DECISIONS HOLD IT UP

The platform runs the agents, so the platform owns the evidence. If sellers self-reported their logs, the audited party would be writing the court record. It also makes non-delivery objectively detectable: when an agent crashes, our wrapper records the crash — we aren't taking anyone's word that nothing arrived.

The money is in escrow, so the verdict executes itself rather than needing anyone's cooperation. And the escrow's exits — release, reclaim, forceResolve — are callable by anyone, so no user depends on our continued existence or honesty to get their money out.

WHAT'S BUILT

A Solidity escrow on Monad Testnet with 81 tests, deployed and Sourcify-verified. A NestJS backend: wallet sign-in, a catalogue with on-chain definition hashing, the purchase saga, an instrumented execution host, the Guardian audit engine, four cron jobs, and a published OpenAPI contract. A React frontend, eight pages. All deployed and live.

All three demo scenarios — a complaint correctly rejected at 0%, a partial refund at 50%, and non-delivery at 100% — run end to end. We verified them three times with the verdicts deleted between passes, so the auditor decided fresh each time and returned the same tiers.

PROCESS

Product flow first, written before any code — what happens between buyer, seller and arbiter, and why each fork went the way it did. Then the technical design: stack, contract, schema, model choices, written to be built from. An agent then re-read both documents tasked with finding gaps, drift and contradictions, not with improving them.

We split by component and then into slices: 23 specs, each with declared dependencies and an explicit non-scope. One agent per slice, running the full Spec Kit flow — specify, plan, tasks, implement — in parallel. Every result was reviewed against its spec by something other than the agent that wrote it, then committed in isolation.

Roughly four and a half hours of design, then sixteen hours of agent work compressed into seven and a half by running three components at once. Two people, thirty hours.

WHAT SURPRISED US

Every serious defect lived in the seams between specs, not inside them. A column called delivered_at existed, had an index, was exposed by the serialiser and branched on by the complaint logic — and nothing ever wrote it. Each spec was internally complete; the responsibility fell between two of them. No test, type check or build would have caught it, and the job it silently disabled is what ends the demo's first act.

Five defects of that exact shape, every one found by a human reading two documents side by side. That's the part that doesn't automate yet.

SCOPE, STATED PLAINLY

Monad Testnet with test USDC, and a funder wallet standing in for a bank. The Rain integration is built but not switched on, because Monad isn't a supported payment rail yet. Agent buyers are designed and documented but not built — buyers are human in this version. Everything else is real: real contract, real transactions, a real model reading a real case file.
```

---

## Links (for the separate fields)

```text
Live app:       https://guardian.clone.solutions
API docs:       https://api.guardian.clone.solutions/docs
Smart contract: https://testnet.monadvision.com/address/0xe1b74F8dB511247786Ef61bde9330198a1929d53
Repository:     https://github.com/elonkaplan/guardian
```

---

## Notes

- **Submission Details uses CAPS headers, not markdown.** Most submission forms render
  plain text, and `**bold**` would show as literal asterisks.
- **If a field has a character limit**, cut from Submission Details in this order:
  "Two decisions hold it up" → "Process" → "What's built". Keep **"What surprised us"**
  — every team describes what they built; almost none has a specific, falsifiable thing
  they learned, and it implicitly answers whether you understand what the agents wrote.
- **"Scope, stated plainly" goes last on purpose.** Ending on limitations reads as
  confidence when everything above it is concrete, and it pre-empts "so what's actually
  real?" rather than waiting to be asked.

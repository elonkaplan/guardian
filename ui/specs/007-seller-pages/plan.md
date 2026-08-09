# Implementation Plan: Seller pages — joining the marketplace, and the other side of a dispute

**Branch**: `007-seller-pages` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-seller-pages/spec.md`

## Summary

Replace the two `/sell` placeholders and add one route. A seller's home listing their own agents and their sales, an availability switch per agent, a nine-field create form whose two schema fields are raw JSON textareas, and — at `/sell/sales/:id` — the seller's view of a dispute: the full case file, the verdict, and nowhere to argue.

**The approach is mostly reuse, and the one interesting problem is who the reader is.** The seller's dispute screen shows the same two artefacts the buyer's does, and four sentences inside them are written from the buyer's chair — "You get back", "Your criterion", "What you submitted". So `VerdictCard`, `CitationChecklist`, and `CaseFilePanel` take a required `perspective` prop that selects between two strings in seven places and changes nothing else (R2). The alternative — a parallel family of seller components — would duplicate the split arithmetic, the citation counting, and two independent failure surfaces, and the copy that drifted would be the seller's, on the screen whose whole job is to make adjudication look even-handed.

Four decisions carry the rest. **The dispute screen follows the order through `useOrder`** — the same hook, cadence, and dead-end handling the buyer's screen uses, so this feature adds no order-following machinery of its own (R7). **The seller's home polls at 5s**, which contradicts the root UI doc's polling table, because this list is the *entire* notification mechanism in a product whose §7.5 is titled "the seller is notified" (R6). **The availability toggle is not optimistic**, because the list polls underneath it and an optimistic switch would visibly flip three times for one click (R8). **`PATCH /agents/:id/active` is idempotent by construction**, so the app's non-idempotency doctrine explicitly does not extend to it — written down, because two files already warn against copying that rule without re-deriving it (R9). And **`parseUsd` gains a `ceilingMessage`**, so a mistyped price is not refused with a sentence about the demo treasury (R14).

Twelve new files, thirteen edited, two placeholders replaced. The spec needed one correction during planning, in the seller's favour: its model-field assumption was sharpened rather than kept (R15).

> **Revised 2026-08-09, after api-design §3.3 and §3.4 were amended.** The two rules this plan was most exposed to are now written contract — `GET /agents?owner=me` includes inactive agents, and the order read, case file, and verdict authorise the buyer *or* the agent's owner. The third row moved with them and is a genuine simplification rather than a confirmation: `GET /orders/:id` being open to the seller means the dispute screen reads the order directly instead of polling the sales list to find one row. **R3 is withdrawn** and **R7 rewritten** accordingly; `OrderSummaryHeader` leaves the edit list entirely, `api/types.ts`'s edit shrinks, and one hook is deleted before it was written.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 19.2.8. Unchanged strict settings.

**Primary Dependencies**: **None added.** Existing: `@tanstack/react-query@5.101.4` (through `usePolling` and `useMutation`, both unchanged), `react-router-dom@7.18.2`. No wagmi, no viem, on any screen in this feature — nothing here touches a chain or a signature.

**Storage**: None. No `localStorage`, no context, no persisted keys. Twelve `useState` and two `useRef`, all of them in the create form and the agent list; the seller's dispute screen holds no state at all ([data-model.md §5](./data-model.md)).

**Testing**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`), restated as FR-043. Acceptance is by hand via [quickstart.md](./quickstart.md): Part A is the whole create form with no backend at all, Part F is twelve boundary greps, Part E is the half of the feature that needs a seller-authorised case file.

**Target Platform**: Desktop Chrome on a demo laptop at ~1280×800, and a projector.

**Performance Goals**: Two requests every five seconds while `/sell` is open, and two while a live dispute screen is open. Both stop being interesting the moment the screen is closed; neither is on stage during the three acts.

**Constraints**: No wallet signature and no transaction from the browser (FR-040) — `registerAgent` is the backend's. Money is integer cents; the price field's only arithmetic is `parseUsd`'s. No screen may render an execution-spec value (FR-037), enforced by four types having nowhere to put one. No control to reply to a verdict, in any state (FR-032).

**Scale/Scope**: 12 new files, 13 edited, 2 placeholders replaced. Four backend endpoints to be built and three to be widened to a second reader — all seven now specified in api-design §3.3 and §3.4, and every column they serialise is already a mapped entity ([contracts §11](./contracts/internal-api.md)). One developer, a day and a half.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: NOT EVALUATED — no ratified constitution exists.**

`.specify/memory/constitution.md` is still the unmodified Spec Kit template. Seventh consecutive feature to record it. The substitute is unchanged and works: [quickstart.md](./quickstart.md) Part F turns this feature's structural rules — no reply affordance, no execution spec rendered anywhere, no buyer-scoped order read from the seller's screen, no version-history surface, no defaulted perspective, one envelope unwrap, both placeholders actually deleted — into twelve commands a reviewer runs in under a minute.

**Post-Phase 1 re-check**: unchanged. No constitution was added during planning, and no decision below would violate one if it existed.

## Key Decisions

Full reasoning in [research.md](./research.md). The five worth arguing about:

| Decision | Why | Reversibility |
| --- | --- | --- |
| **A required `perspective` prop on three shipped components** (R2) | The seller's screen needs the same verdict card and case file with four sentences rewritten. A second family of components would duplicate `splitFor`, the unreadable-citation counting, the `<details>` disclosure behaviour, and two independent failure surfaces — every one of which UI-05 argued into shape and none of which is about who is reading. Required rather than defaulted because `= 'buyer'` is a component that silently addresses a seller as the buyer whenever someone forgets: wrong, plausible, and invisible in review. | One union type and seven string branches. Deleting it means deleting the seller's screen. |
| **The dispute screen reads the order through `useOrder`** (R7) | api-design §3.4 authorises `GET /orders/:id` for the seller, so the order is the seller's own resource rather than something to reconstruct. The hook already gives four behaviours the substitute could not: 1s while live and stopped on terminal, 404/403 as a dead end instead of a request every interval forever, the monotonic guard that stops a ruling dropping back to an earlier state, and `stale` versus a hard failure. The screen it serves is exactly the screen where a verdict lands while somebody watches. | One function call. It replaced a `useSale` that polled the whole sales list to select one row. |
| **`/sell` polls at 5s, against `docs/ui-design.md` §5's "load only"** (R6) | This list is the entire notification mechanism. There is no email, no push, no bell — product-workflow §7.5 is titled *"the seller is notified, but has no right of reply"*, and the notification half is what makes the no-appeal half read as a scope decision rather than a black box. Load-only means notified *if they refresh*, which is not notification. | One `intervalMs`. The deviation is recorded below so whoever reconciles the docs finds the argument. |
| **The availability toggle holds no optimistic value** (R8) | FR-027 requires a failure to leave the switch showing the *true* state. Optimism satisfies that only with a rollback — and the list is polling underneath, so a poll landing between the click and the response repaints the old value and flips the switch back before the mutation resolves. The seller would watch it move three times for one click, and two of those movements would be lies. | One mutation's `onSettled`. |
| **`PATCH /agents/:id/active` is exempt from the non-idempotency doctrine** (R9) | `api/orders.ts` warns in writing against copying its rule onto neighbouring calls, and `api/wallet.ts` re-derived it once already. Re-derived again: those rules exist because each call commits a *movement* and answers afterwards. This one sets a boolean to a client-supplied absolute value — applying it twice leaves the world as applying it once did. So silence needs no locked control and no ambiguous branch; the poll resolves it within one cycle. | A paragraph in `api/agents.ts`. The in-flight ref stays for a smaller reason: two `PATCH`es racing to opposite values, and gas paid twice for one intent. |
| **`parseUsd` gains `ceilingMessage`** (R14) | The price field must reuse the money parser — a second definition of a dollar amount is what `AmountField`'s own comment exists to prevent — but above the ceiling that parser says *"more than this demo's treasury holds"*, which is meaningless about a listing price. A seller typing `50000` for `500.00` would be corrected with a sentence about someone else's wallet. The number stays shared; both ceilings guard the same slipped decimal at the same magnitude. | One optional parameter, additive, every existing call site untouched. |

**One spec assumption was sharpened, not kept.** The spec assumed the model field would be free text "because no allowlist is exposed to this application". Still true — but `docs/tech-stack.md` §2.2 names exactly two seller-agent models with a reason for each, so the field became a datalist: free text, backend still the authority, both documented ids one click away, and `claude-haiku-4-5` pre-filled so the common path needs no decision (R15). The other assumptions survived planning; two were upgraded from guesses to facts by reading `api/src/entities/` — `agents.active` really does default to `true`, and `agent_versions.timeout_seconds` really does default to 120.

## Project Structure

### Documentation (this feature)

```text
specs/007-seller-pages/
├── plan.md              # This file
├── spec.md              # Feature specification (FR-029a/b added at clarification)
├── research.md          # Phase 0 — 18 resolved decisions
├── data-model.md        # Phase 1 — payload types, the perspective table, query keys, local state
├── quickstart.md        # Phase 1 — the manual acceptance run (Parts A–G)
├── contracts/
│   └── internal-api.md  # Phase 1 — module surface + the backend handoff (§11)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
ui/src/
├── api/
│   ├── types.ts                    EDIT — + Sale, OwnedAgent, CreateAgentRequest, SetAgentActiveRequest (Order untouched)
│   ├── agents.ts                   EDIT — + fetchOwnedAgents, createAgent, setAgentActive; two doctrines, stated apart
│   ├── sales.ts                    NEW  — fetchSales, on api/verdicts.ts's precedent
│   └── wallet.ts                   EDIT — its private unwrap becomes a call to lib/listEnvelope
├── lib/
│   ├── listEnvelope.ts             NEW  — the shared unwrap, at its third and fourth call sites
│   ├── agentDraft.ts               NEW  — schema parsing, term cleaning, request assembly; all failures at once
│   ├── perspective.ts              NEW  — the buyer/seller union, shared by three components
│   └── money.ts                    EDIT — parseUsd gains an optional ceiling message
├── hooks/
│   ├── useOwnedAgents.ts           NEW  — ['agents','mine'] at 5s, never terminal
│   └── useSales.ts                 NEW  — ['sales'] at 5s, never terminal; the list page's, and only its
├── components/
│   ├── OwnedAgentList.tsx          NEW  — the listings, their own empty and error states
│   ├── AvailabilityToggle.tsx      NEW  — one row's PATCH, no optimistic value
│   ├── SalesList.tsx               NEW  — the sales, each row a link into the dispute screen
│   ├── TermListField.tsx           NEW  — repeatable contract terms, with the hint that earns the feature its keep
│   ├── SchemaTextArea.tsx          NEW  — a raw JSON field and its refusal; no parsing of its own
│   ├── VerdictCard.tsx             EDIT — + perspective; two split labels
│   ├── CitationChecklist.tsx       EDIT — + perspective; the note and one source label
│   └── CaseFilePanel.tsx           EDIT — + perspective; the summary and two headings
├── pages/
│   ├── MyAgentsPage.tsx            EDIT — placeholder replaced; two lists and the way to list one
│   ├── CreateAgentPage.tsx         EDIT — placeholder replaced; the nine-field form
│   ├── SellerSalePage.tsx          NEW  — the case file, the verdict, and the sentence about no appeal
│   └── OrderDetailPage.tsx         EDIT — perspective="buyer" at four call sites
├── routes/
│   ├── paths.ts                    EDIT — + sellerSale pattern and builder
│   └── AppRoutes.tsx               EDIT — + the guarded /sell/sales/:id route
└── index.css                       EDIT — seller lists, term fields, schema textareas, the dispute screen
```

**Structure Decision**: still no new directories, and `src/components/` reaches thirty-three files. UI-05's plan recommended reorganising once after UI-08, when the full set is visible; UI-06 called itself the evidence for that recommendation rather than a reason to act early, and this feature is the same. A move done mid-series is a move done twice — and this is the second-to-last feature.

`src/lib/` gains three modules and each earns it on the standing grounds — pure data transformation, no React, and callers that must not disagree. `agentDraft.ts` is the one that matters: it is the entire create form's judgement, and it is why quickstart Part A can be run with the API stopped.

`hooks/useOrder.ts`, `hooks/useVerdict.ts`, `hooks/useCaseFile.ts`, and `components/OrderSummaryHeader.tsx` are **used and not edited** — the strongest evidence that R2's perspective prop is the right size of change. All four already take an order or an order id, and none has any idea who is reading. `src/chain/` is untouched; so are `client.ts`, `errors.ts`, `usePolling.ts`, `queryClient.ts`, `RequireAuth.tsx`, and `AppShell.tsx`, whose nav already links to `/sell`.

## Implementation Order

Dependency-ordered, matching the spec's story priorities. Each step is verifiable against the named part of [quickstart.md](./quickstart.md).

| # | Step | Story | Verify |
| --- | --- | --- | --- |
| 0 | **Point whoever builds the catalogue module at api-design §3.3 and §3.4** — the two rules that used to live here are in the doc now. [Contracts §11.3](./contracts/internal-api.md) is what remains: seven shapes and defaults | — | A link, not a conversation. §11.4 names the one still worth interrupting someone for. |
| 1 | `lib/agentDraft.ts` + `lib/money.ts` ceiling message | US1 | **Part A.1–A.3** — the whole parser, no backend, no API |
| 2 | `api/types.ts`, `lib/listEnvelope.ts`, `api/agents.ts`, `api/sales.ts`, `api/wallet.ts` refactor | — | `npm run typecheck`; **F8**, **F9** |
| 3 | `TermListField`, `SchemaTextArea`, `CreateAgentPage` — placeholder deleted | US1 | **Part A** end to end, **F6**, **F7** |
| 4 | `hooks/useOwnedAgents.ts`, `useSales.ts`; `OwnedAgentList`, `SalesList`, `MyAgentsPage` — placeholder deleted | US2 | **Part C**, especially **C6** and **C8** |
| 5 | `AvailabilityToggle` | US4 | **Part D** — **D4** and **D8** are the two that fail quietly |
| 6 | `lib/perspective.ts`; the three component edits; `OrderDetailPage` call sites | US3 | `npm run typecheck`, then **re-run UI-04 and UI-05's own acceptance on the buyer's order screen** — nothing there may have changed |
| 7 | `routes/paths.ts`, `AppRoutes.tsx`, `SellerSalePage` | US3 | **Part E**, **F1**, **F3** |
| 8 | `index.css` | — | **F11**, **F12** (greyscale) |
| 9 | Boundary sweep, then the rehearsal | — | **Part F**, then **Part G** |

Steps 1–3 land before the catalogue module exists: Part A is a complete acceptance run needing nothing but the dev server, and the create form's validation is the part nobody returns to once agents are listing successfully.

**Step 6 is the one to schedule when rested.** It touches the demo's most persuasive artefact, in a feature that is not itself demo-critical.

## Risks

| Risk | Impact | Response |
| --- | --- | --- |
| **The three seller-authorised reads are implemented buyer-only anyway.** The narrow check is still the natural one to write, and until this feature exists there is no second reader to catch it. | **Half the feature** — the dispute screen becomes three error panels, and the failure looks like a frontend bug. | **No longer a handoff assumption**: api-design §3.4 marks all three "Buyer *or* seller" and carries the reasoning in its own paragraph, so API-06/07 read it in the endpoint table rather than in this directory. Part E cannot pass without it, so it still fails loudly and early. |
| **`GET /agents?owner=me` filters to active agents.** Filtering is what the endpoint's public sibling does. | The toggle becomes one-way: switching an agent off removes it from the only screen that could switch it back on. | **No longer an assumption either**: api-design §3.3 gives the owner query its own row and states the consequence. Quickstart **D8** stays — the doc records the intent, the check catches the implementation. |
| **Editing `VerdictCard`, `CitationChecklist`, and `CaseFilePanel`**, which shipped two features ago and carry the demo's closing beat. | The verdict card is the single most persuasive thing in the product. A regression here costs more than this whole feature is worth. | Props only, no logic touched, no layout touched; `splitFor`, `tierDisplay`, `normaliseVerdict`, and all three hooks are untouched — and since R3's withdrawal, `Order` and `OrderSummaryHeader` are not touched either. Step 6 re-runs UI-05's own acceptance on the buyer's screen before the seller's screen is built on top. |
| **The four new endpoints do not exist.** Their payload shapes are still assumptions. | Parts B–E cannot run; field names may be wrong on first contact. | Deliberate (R1), and the shortest such guess yet: every field is read off a committed entity. Blast radius is `api/types.ts` plus two small API files. |
| **A create form submitted twice.** | Two listings and two on-chain `registerAgent` calls for one intent — visible in a marketplace of four agents. | Ref written synchronously (R10), the pattern `OrderActions` measured and `WalletActions` restated. **A20** is the deliberate double-click. |
| **Silence on `POST /agents`.** We do not know whether the listing exists. | A seller lists the same agent twice. | No retry button on that branch; the copy points at `/sell`, which is where the answer is and where success would have sent them. The real fix is an idempotency key upstream, noted as assumption 10. |
| **`/sell` polls where the root doc says it should not** (R6). | Two extra requests per 5s on a supporting screen, and a doc that disagrees with the code. | Accepted and recorded below. If the cadence ever has to go, the thing that dies with it is the claim in product-workflow §7.5 — say so before removing it. |
| **The seller's case file arrives carrying a system prompt.** The seller is entitled to their own prompt, so a serialiser may well include it. | A rule from `ui/docs/CONTEXT.md` §2 broken on the one screen where it looked defensible. | Structural: `normaliseCaseFile` copies named fields onto types with nowhere to put one, unchanged by this feature. **F2** greps for it. |
| **Thirty-three files in `src/components/`.** | Navigability, not correctness. | Accepted. Reorganise once after UI-08, as UI-05 recommended and UI-06 reaffirmed. |
| **No constitution**, seventh feature running. | Structural rules enforced by review only. | Part F converts the ten that matter into greps. |

## Complexity Tracking

No constitution exists, so there are no violations to justify. Nothing here adds a dependency, a directory, an environment variable, or a persisted key. It adds one route.

Four things depart from something already written down, and each is argued rather than assumed:

| Departure | Where | Justification |
| --- | --- | --- |
| **A screen polls where `docs/ui-design.md` §5 says "Load only"** | `/sell`, both lists | R6. The sales list is the whole of the seller's notification mechanism, and product-workflow §7.5 is a paragraph about the seller being notified. The table predates the requirement; the requirement is the sharper statement. |
| **Extracting the envelope unwrap**, where two files say it is deliberately not generalised | `lib/listEnvelope.ts` | R16. Both comments argue specifically against putting it in `client.ts`, where a future endpoint inherits it by accident, and that argument survives intact — this is a named function each fetcher opts into with its own keys. Four copies is the moment; a shared *key list* would have been the actual mistake, and is not done. |
| **Editing shared machinery** — three verdict/case-file components, `lib/money.ts` | four files | All additive: a required prop that changes only strings, and one optional parameter. No behaviour, arithmetic, or layout is touched, and `usePolling`, `useOrder`, `useVerdict`, `useCaseFile`, `OrderSummaryHeader`, `Order`, `queryClient`, `client.ts`, and `errors.ts` are untouched. |
| **Exempting one write from the non-idempotency doctrine** two files state emphatically | `setAgentActive` | R9. The doctrine is about calls that commit a movement and answer afterwards. A `PATCH` setting a boolean to a client-supplied absolute value is idempotent in the literal sense, and treating it otherwise would tell a seller not to retry something that is completely safe to retry. Written into `api/agents.ts` beside the opposite paragraph, so the two are read together. |

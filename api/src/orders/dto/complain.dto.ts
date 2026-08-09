import { z } from 'zod';

/**
 * The body of `POST /orders/:id/complain` — the buyer disputes
 * (`specs/007-orders-purchase-saga/contracts/internal-api.md` §6).
 *
 * **One field, and the client already agrees.** `ui/src/api/types.ts` declares
 * `ComplainRequest` as `{ reason: string }` and describes it as the contract
 * does — *"a reason and nothing else"*. The string is literal on both sides.
 *
 * **Why there is no accept DTO next to this one.** `POST /orders/:id/accept`
 * has no request body at all (§5): the id in the path and the session are the
 * whole request, so there is nothing to parse and no schema to write. An empty
 * `z.object({})` for symmetry would be a file that validates nothing, and a
 * pipe wired to it would advertise a body the route does not read. The
 * asymmetry between the two routes is real — one carries testimony, the other
 * carries only intent — and it is left visible rather than papered over.
 *
 * ⚠️ **Passing this schema does not mean the complaint is allowed.** Everything
 * that actually decides is state, checked in the service: the caller must be
 * the buyer (`404` for the seller and for strangers alike), the order must be
 * `delivered` and inside its review window (`409` past it, at the same instant
 * the escrow contract refuses), and `complaints.order_id UNIQUE` — storage, not
 * a check — is what makes a second complaint a `409` (FR-031). A blank `reason`
 * is the one failure this file owns, and it is a `400` naming the field.
 */
export const complainSchema = z.object({
  /**
   * The buyer's testimony: what is wrong with what they were delivered.
   *
   * This is not a formality collected to unlock a button. It is one of the
   * three documents the auditor weighs — the buyer's `reason`, the buyer's
   * `acceptanceCriteria` from the purchase, and the seller's listing promise on
   * the pinned version — against what the agent actually did and returned. The
   * verdict is reasoned over these, so an empty `reason` is a complaint with no
   * testimony in it: a dispute has been opened, escrow is frozen, an audit will
   * run, and the buyer has said nothing for it to weigh.
   *
   * ⚠️ `.trim().min(1)`, in that order and not `.min(1)` alone. A reason of
   * three spaces satisfies `.min(1)`, is stored `NOT NULL` and non-empty, and
   * then presents the auditor with silence at the one moment it is load-bearing.
   * Trimming first turns whitespace-only into the `400` carrying
   * `fieldErrors.reason` that §6's failure table specifies. Same rule and same
   * reasoning as `acceptanceCriteria` on the purchase, which is the field this
   * one is read beside.
   *
   * ⚠️ **Committing this row on an unknown chain outcome is deliberate** and is
   * the opposite of what accept does — because the reason is not reproducible.
   * The buyer typed it once; a rollback would ask them to type it again into a
   * dispute the chain may already believe they filed (§6). That the string
   * survives a `502` is another reason it must be non-blank when it arrives:
   * there is no second chance to collect it.
   */
  reason: z.string().trim().min(1),
});

/**
 * ⚠️ **What this object does NOT contain is the design, not an oversight.**
 *
 *  - **No `tier`, and no verdict input of any kind.** The buyer states what is
 *    wrong; they do not propose how much of the money should come back. The
 *    tier is the auditor's conclusion, and a client-supplied one would be a
 *    second authority over the same fact — the field a disputing buyer would
 *    always set to the maximum.
 *  - **No evidence upload.** The platform assembles the case file itself, from
 *    the buyer's input, the acceptance criteria, the pinned definition's promise
 *    and exclusions, what the agent did, what it returned, its errors and its
 *    timings (FR-040). That is the whole point of the platform being the one
 *    that runs the agents: the evidence is a *record*, taken from execution the
 *    platform observed, not an *exhibit* a party hands in. Accepting uploaded
 *    evidence would let the more motivated side out-document the other, and
 *    would turn a reproducible case file into a contested one.
 *  - **No seller reply field, and no route that would carry one.** The seller
 *    is notified that a complaint was filed and can open the order and its
 *    (redacted) case file, but has no right of reply and cannot accept or
 *    complain either — FR-036, product §7.5. Notification without right of
 *    reply is a deliberate product decision, made because the evidence is the
 *    platform's own record and a rebuttal would have nothing to rebut but that
 *    record. It is not a missing feature; do not add one here.
 */
export type ComplainDto = z.infer<typeof complainSchema>;

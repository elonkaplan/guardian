# Contract — `DealReconciler`

The second internal seam: the one place that decides what a failed chain write *meant*, by reading
the deal rather than by parsing a revert string.

Consumers: `SweeperJob`, `ReclaimerJob`. The reaper makes no chain call and never uses this.

Argued in [research.md R6](../research.md). The short version: `release` reverts `"not delivered"`
for both "somebody already released it" and "the buyer disputed it" — one string, two states,
opposite correct responses.

---

## The interface

```ts
// src/jobs/deal-reconciler.ts

/** What a job should do about an order after a chain write did not succeed. */
export type Reconciliation =
  /** The chain already reflects the intended outcome. Write the order's new state. */
  | { kind: 'done'; dealState: DealState }
  /** The precondition has not been met yet — usually our clock ahead of block time. Do nothing. */
  | { kind: 'not-yet'; dealState: DealState }
  /** The deal moved somewhere this job does not own. Do not write; log and move on. */
  | { kind: 'leave-alone'; dealState: DealState; why: string }
  /** No conclusion is safe. Do not write. Log at error. */
  | { kind: 'unknown'; why: string };

@Injectable()
export class DealReconciler {
  /**
   * Called ONLY from a catch block, never on the success path.
   *
   * `expected` is the DealState the job was trying to leave the deal in —
   * always `Settled` for both callers, since release and reclaim both settle.
   */
  async reconcile(
    err: unknown,
    dealId: bigint,
    job: 'sweeper' | 'reclaimer',
  ): Promise<Reconciliation>;
}
```

## The decision procedure

```
err is ChainOutcomeUnknownError  → { unknown }         // never read, never write (see below)
err is not a ChainError          → rethrow             // a defect, not a chain outcome
otherwise:
  read the deal via EscrowReadService.getDeal(dealId)
    DealNotFoundError            → { unknown }
    read itself throws           → { unknown }
  map (job, deal.state) per the table below
```

| Job | Deal state | Result | Job then writes |
| --- | --- | --- | --- |
| sweeper | `Settled` | `done` | `state = 'released'` |
| sweeper | `Delivered` | `not-yet` | nothing — the window has not closed in block time |
| sweeper | `Disputed` | `leave-alone` — *"the buyer disputed inside the window"* | nothing |
| sweeper | `Open` / `None` | `unknown` | nothing |
| reclaimer | `Settled` | `done` | `state = 'settled'`, `settled_at = now()` |
| reclaimer | `Open` | `not-yet` | nothing — `openedAt + 24h` has not passed in block time |
| reclaimer | `Delivered` / `Disputed` | `leave-alone` — *"delivery landed after all"* | nothing |
| reclaimer | `None` | `unknown` | nothing |

## Why `ChainOutcomeUnknownError` short-circuits before the read

It is tempting to read the deal anyway — the transaction might have confirmed between the timeout
and the read, and the answer would be free. It is declined for the reason its own docblock gives:
that class *"does NOT extend any 'this operation failed' type, so a narrower catch cannot
accidentally lump 'unknown' in with 'failed' and retry when it should instead reconcile."* Reading
here would produce `Settled` on a lucky race and `Open` on an unlucky one, and the second is
indistinguishable from "the transaction was dropped" — which is precisely the guess that must not
be turned into a state write.

The order is left as it was, the hash is logged, and the next pass tries the write again. If the
transaction did confirm, that attempt reverts and reconciles to `done` through the ordinary path,
which is the same answer arriving one cadence later with certainty instead of a guess.

## Cost

**Zero reads on the success path.** `reconcile` is only reachable from a catch.

**One `eth_call` per failed attempt**, and the failure itself is free: `executeWrite` runs
`simulateContract` before broadcasting, so a premature or already-settled call reverts without ever
reaching the mempool — no gas charged, on a chain that bills the full limit. The reconciliation
path is affordable precisely because the adapter refuses to pay for a doomed transaction.

## What it must never do

- **Never write.** It returns a decision; the calling job performs the write. Keeping the write in
  the job is what keeps every `UPDATE` in `JobsRepository` and every state literal greppable.
- **Never branch on `ContractRevertError.reason`.** The four possible strings are recorded in
  research R6 for the reader's benefit and are deliberately not in the code. `state == expected`
  after a read is exactly equivalent and stays correct if the contract's wording changes.
- **Never treat `leave-alone` as an error.** A buyer disputing in the last second of the window is
  the system working. It is logged at warn — once, naming the order — because it is interesting, not
  because it is wrong.

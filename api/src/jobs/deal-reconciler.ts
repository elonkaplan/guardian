import { Injectable } from '@nestjs/common';

import {
  ChainError,
  ChainOutcomeUnknownError,
  DealNotFoundError,
} from '../chain/errors';
import { EscrowReadService } from '../chain/escrow-read.service';
import { DealState } from '../chain/types';
import type { OnChainDeal } from '../chain/types';

/**
 * What a job should do about an order after a chain write did not succeed.
 *
 * Four outcomes, and the split between them is the whole point of this file:
 * only `done` authorises a state write, and the other three are all "do not
 * write" for three different reasons that a job logs differently.
 */
export type Reconciliation =
  /** The chain already reflects the intended outcome. Write the order's new state. */
  | { kind: 'done'; dealState: DealState }
  /** The precondition has not been met yet — usually our clock ahead of block time. Do nothing. */
  | { kind: 'not-yet'; dealState: DealState }
  /** The deal moved somewhere this job does not own. Do not write; log at warn and move on. */
  | { kind: 'leave-alone'; dealState: DealState; why: string }
  /** No conclusion is safe. Do not write. Log at error. */
  | { kind: 'unknown'; why: string };

/**
 * The one place that decides what a failed chain write *meant* — by reading the
 * deal, never by parsing a revert string.
 *
 * Consumers: `SweeperJob` (`release`) and `ReclaimerJob` (`reclaim`). The reaper
 * makes no chain call at all and never reaches this class.
 *
 * ## ⚠️ NEVER branch on `ContractRevertError.reason`
 *
 * The deployed contract (`sc/src/GuardianEscrow.sol`) can only revert these two
 * calls four ways, and those four strings partition the outcomes **wrongly** for
 * our purposes:
 *
 * | call | `reason` | what actually happened |
 * | --- | --- | --- |
 * | `release` | `"window open"` | our clock ran ahead of block time |
 * | `release` | `"not delivered"` | **either** somebody already released it **or** the buyer disputed it |
 * | `reclaim` | `"too early"` | our clock ran ahead |
 * | `reclaim` | `"not open"` | already settled, or it was delivered after all |
 *
 * The `"not delivered"` row is the one that forces this design. `Settled` means
 * the sweeper's work is done and the order should be marked `released`;
 * `Disputed` means the buyer won the race inside the window and the order
 * belongs to Guardian now. **One string, two states, opposite correct
 * responses.** A job that matched on the string would either mark a disputed
 * order released — settling a live dispute in our database while the money sits
 * frozen on-chain — or leave a settled deal being retried forever.
 *
 * The two "our clock ran ahead" strings *are* individually unambiguous, and this
 * class still does not match them, for the smaller reason that it does not have
 * to: once the deal has been read, `state` answers those cases too, and a table
 * of `require` strings is a copy of the contract's wording that goes stale
 * silently the day someone rephrases one.
 *
 * ## ⚠️ Why `ChainOutcomeUnknownError` short-circuits BEFORE the read
 *
 * It is tempting to read the deal anyway — the transaction may well have
 * confirmed between the receipt timeout and this line, and the read is free.
 * Declined, for the reason that class's own docblock in `chain/errors.ts` gives:
 * it deliberately sits outside the failure branch of the hierarchy so that
 * "unknown" can never be lumped in with "failed" and retried.
 *
 * Reading here yields `Settled` on a lucky race and `Open` on an unlucky one,
 * and the unlucky answer is **indistinguishable from "the transaction was
 * dropped"** — which is precisely the guess that must not be turned into a state
 * write. So the order is left exactly as it was, the hash is logged by the
 * caller (it is carried on the error for no other purpose), and the next pass
 * retries the write. If the transaction did confirm, that attempt reverts and
 * reconciles to `done` through the ordinary path below — the same answer,
 * arriving one cadence later, with certainty instead of a guess.
 *
 * ## Cost
 *
 * **Zero reads on the success path**: {@link reconcile} is only reachable from a
 * catch block. **One `eth_call` per failed attempt**, and the failure itself is
 * free — `executeWrite` runs `simulateContract` before broadcasting, so a
 * premature or already-settled call reverts without ever reaching the mempool
 * and no gas is charged, on a chain that bills the full declared limit. The
 * reconciliation path is affordable precisely because the adapter refuses to pay
 * for a doomed transaction.
 *
 * ## ⚠️ It must never write
 *
 * It returns a decision; the calling job performs the write. Keeping the write
 * in the job is what keeps every `UPDATE` inside `JobsRepository` and every
 * order-state literal greppable — a reconciler that wrote would put money-moving
 * SQL in a class whose entire job is interpreting errors.
 *
 * And `leave-alone` is **not an error**. A buyer disputing in the last second of
 * the review window is the system working exactly as designed; it is logged at
 * warn, once, naming the order, because it is interesting — not because
 * something went wrong.
 */
@Injectable()
export class DealReconciler {
  constructor(private readonly escrow: EscrowReadService) {}

  /**
   * Called **ONLY from a catch block**, never on the success path.
   *
   * @param err whatever the failed `release`/`reclaim` threw.
   * @param dealId the on-chain deal the job was acting on.
   * @param job which caller — the same `DealState` means different things to the
   * two of them, which is why this cannot be derived from the deal alone.
   *
   * @throws the original `err` when it is not a {@link ChainError} at all. That
   * is a defect in our code — a `TypeError`, a bad `dealId`, a repository blowing
   * up — not a chain outcome, and returning `unknown` for it would bury a bug
   * under a log line that says "we could not tell what the chain did".
   */
  async reconcile(
    err: unknown,
    dealId: bigint,
    job: 'sweeper' | 'reclaimer',
  ): Promise<Reconciliation> {
    // ⚠️ ORDER IS LOAD-BEARING. This test comes first, and specifically before
    // the read, for the reason argued in the class header: a read here answers
    // `Open` both when the transaction was dropped and when it simply has not
    // landed yet, and nothing downstream can tell those apart.
    if (err instanceof ChainOutcomeUnknownError) {
      return {
        kind: 'unknown',
        why:
          `the ${job}'s transaction for deal ${dealId} was broadcast but no receipt ` +
          `arrived (tx=${err.hash}); the deal is deliberately NOT read, because a ` +
          `read cannot distinguish "not mined yet" from "dropped". The order is ` +
          `left as it was and the next pass retries the write.`,
      };
    }

    // Anything outside the adapter's own hierarchy never described a chain
    // outcome, so there is nothing here to reconcile against. Rethrow.
    if (!(err instanceof ChainError)) {
      throw err;
    }

    // The read is wrapped separately from anything above: a failure to READ is a
    // different fact from a failure to WRITE, and collapsing them would let an
    // unreachable RPC be reported as a mysterious deal state.
    let deal: OnChainDeal;
    try {
      deal = await this.escrow.getDeal(dealId);
    } catch (readErr: unknown) {
      if (readErr instanceof DealNotFoundError) {
        return {
          kind: 'unknown',
          why:
            `deal ${dealId} does not exist on the escrow at the configured ` +
            `address, so the ${job}'s failure cannot be interpreted. Either ` +
            `ESCROW_CONTRACT_ADDRESS points at the wrong contract, or the escrow ` +
            `was redeployed and the ids stored on our orders belong to the old one.`,
        };
      }

      return {
        kind: 'unknown',
        why:
          `the ${job} could not read deal ${dealId} back after its write failed ` +
          `(${labelOf(readErr)}), so nothing about the on-chain state is known. ` +
          `No order state is written; the next pass tries again.`,
      };
    }

    return job === 'sweeper'
      ? sweeperVerdict(deal.state)
      : reclaimerVerdict(deal.state);
  }
}

/**
 * The sweeper called `release`, which moves `Delivered → Settled` once the
 * review window has elapsed in **block** time.
 *
 * ⚠️ Written as a `switch` with a `never` binding in the default arm rather than
 * an `if` chain, which is this codebase's idiom (`verdict.controller.ts`,
 * `tier.ts`): a sixth `DealState` — the contract growing, say, a `Cancelled` —
 * fails to compile *here*, at the line that decides whether money is recorded as
 * paid out, instead of silently falling through to whatever the last branch was.
 */
function sweeperVerdict(state: DealState): Reconciliation {
  switch (state) {
    // Somebody got there first — us on an earlier pass whose database write
    // failed, the buyer accepting early, or Guardian resolving a dispute. The
    // chain agrees with where we were trying to get it, so the order may be
    // marked released.
    case DealState.Settled:
      return { kind: 'done', dealState: state };

    // The deal is exactly where the sweeper expects it; `deliveredAt +
    // reviewWindow` simply has not passed in block time yet. Our clock ran
    // ahead. Nothing is wrong and nothing is written.
    case DealState.Delivered:
      return { kind: 'not-yet', dealState: state };

    // The buyer objected inside the window. This order now belongs to Guardian
    // and the sweeper must never touch it again — this is the branch that
    // matching on `"not delivered"` would have gotten catastrophically wrong.
    case DealState.Disputed:
      return {
        kind: 'leave-alone',
        dealState: state,
        why: 'the buyer disputed inside the window',
      };

    // `Open` means nothing was ever delivered on-chain, and `None` means the id
    // is not a deal at all — yet our database picked this order as sweepable, so
    // the two records disagree. Neither is a state the sweeper may act on.
    case DealState.Open:
    case DealState.None:
      return {
        kind: 'unknown',
        why:
          `the sweeper tried to release a deal the chain reports as ` +
          `${DealState[state]}, which it can never have reached from a state ` +
          `worth sweeping; our order row and the escrow disagree about this deal.`,
      };

    default: {
      const unreachable: never = state;
      throw new Error(`unhandled DealState in sweeperVerdict: ${unreachable}`);
    }
  }
}

/**
 * The reclaimer called `reclaim`, which returns an undelivered deal's money to
 * the buyer once `openedAt + DELIVERY_DEADLINE` has passed in block time.
 *
 * Same exhaustiveness argument as {@link sweeperVerdict}; the table differs
 * because the same `DealState` means the opposite thing to this caller —
 * `Delivered` is "not yet" for the sweeper and "stop, the seller came through"
 * for the reclaimer.
 */
function reclaimerVerdict(state: DealState): Reconciliation {
  switch (state) {
    // The money is already out of escrow — our own earlier attempt, or a
    // release, or a Guardian resolution. Either way the reclaimer's goal holds
    // and the order may be recorded as settled.
    case DealState.Settled:
      return { kind: 'done', dealState: state };

    // Still open and still undelivered, but the 24-hour deadline has not passed
    // in block time. Our clock ran ahead; the contract refused for free at
    // simulation. Retry next pass.
    case DealState.Open:
      return { kind: 'not-yet', dealState: state };

    // The seller delivered (or the buyer then disputed) between our SELECT and
    // our broadcast. The buyer's money is no longer abandoned, so it is not the
    // reclaimer's to pull back — the sweeper or Guardian owns it from here.
    case DealState.Delivered:
    case DealState.Disputed:
      return {
        kind: 'leave-alone',
        dealState: state,
        why: 'delivery landed after all',
      };

    // The escrow has never issued this id. As above: a disagreement between our
    // stored `onchain_deal_id` and the contract we are pointed at, not something
    // a retry can resolve.
    case DealState.None:
      return {
        kind: 'unknown',
        why:
          `the reclaimer tried to reclaim a deal the chain reports as ` +
          `${DealState[state]} — the escrow has never issued this id, so our ` +
          `order's onchain_deal_id does not belong to the contract this ` +
          `deployment is configured against.`,
      };

    default: {
      const unreachable: never = state;
      throw new Error(
        `unhandled DealState in reclaimerVerdict: ${unreachable}`,
      );
    }
  }
}

/**
 * A log-safe label for an unknown error, mirroring `guardian.service.ts`.
 *
 * ⚠️ Deliberately the class name only. `err.message` on a viem or RPC error can
 * echo back the request payload, and a `why` string here is written straight
 * into a log line, which goes around every serialiser this codebase has.
 */
function labelOf(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

import { randomBytes } from 'node:crypto';

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { getAddress, type Address } from 'viem';

import { NONCE_SWEEP_INTERVAL_MS, NONCE_TTL_MS } from './auth.constants';

/** A challenge that has been issued and not yet spent. */
export interface StoredNonce {
  /** 32 random bytes, hex. */
  readonly nonce: string;
  /** The checksummed address this challenge was issued for. */
  readonly address: Address;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/**
 * What `consume` found.
 *
 * Three outcomes rather than `StoredNonce | null`, because "there was never a
 * challenge here" and "there was one and it lapsed" are different facts and the
 * log wants both. They are still indistinguishable *externally* — the caller
 * maps them to two error classes that produce one identical 401. The
 * distinction exists for whoever is debugging at 3am, not for the caller.
 */
export type ConsumeResult =
  | { readonly outcome: 'ok'; readonly stored: StoredNonce }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'expired' };

/**
 * The sign-in challenge store: a `Map` in process memory, holding at most one
 * outstanding challenge per address.
 *
 * **Not a table, deliberately.** Persisting a challenge buys survival across a
 * restart, and what that preserves is one click — the user asks for another and
 * signs again. Against that it would cost a migration, an entity, a cleanup
 * job, and a concurrent-consumption problem this version does not have.
 *
 * That last point is the real reason. Node runs `consume` on one thread with no
 * `await` inside it, so nothing can observe an entry between the read and the
 * delete. Single-use — the property that makes a captured signature worthless —
 * is therefore free here: no row lock, no `SELECT … FOR UPDATE`, no transaction
 * to get subtly wrong.
 *
 * ⚠️ A stateless alternative (HMAC of address + timestamp, verified without
 * storing anything) looks cleaner and is unsafe: with no server-side record
 * there is nothing to mark as spent, so every challenge is replayable until it
 * expires. Do not "simplify" this into that.
 *
 * The map is keyed by the LOWERCASED address so that a user who asks with one
 * casing and verifies with another still finds their challenge.
 */
@Injectable()
export class NonceStore implements OnModuleDestroy {
  private readonly entries = new Map<string, StoredNonce>();

  /**
   * Periodic eviction of lapsed challenges.
   *
   * This is for bounding memory, **not** for correctness — `consume()` already
   * refuses anything past its expiry, so a challenge the sweep has not reached
   * yet is still unusable. The sweep exists because a map that only ever grows
   * is trivial to bound now and awkward to retrofit once something depends on
   * the leak.
   *
   * `unref()` so a pending timer cannot hold the process open; Nest's shutdown
   * hook clears it properly, and this is the belt to that pair of braces.
   */
  private readonly sweeper = setInterval(() => {
    this.sweep();
  }, NONCE_SWEEP_INTERVAL_MS).unref();

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  private sweep(): void {
    const now = Date.now();

    for (const [key, stored] of this.entries) {
      if (now >= stored.expiresAt) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Issue a challenge for an address, replacing any earlier one.
   *
   * Replacement rather than accumulation is what makes "at most one outstanding
   * challenge per address" a property of the data structure instead of a rule
   * someone has to remember. It also makes the awkward case deterministic: if a
   * user requests twice and then signs the older message, the older nonce is
   * simply gone and the attempt is refused.
   */
  issue(address: Address): StoredNonce {
    const canonical = getAddress(address);

    const stored: StoredNonce = {
      nonce: randomBytes(32).toString('hex'),
      address: canonical,
      expiresAt: Date.now() + NONCE_TTL_MS,
    };

    this.entries.set(canonical.toLowerCase(), stored);

    return stored;
  }

  /**
   * Take the challenge for an address — reading and deleting it in one step.
   *
   * ⚠️ **Consuming is unconditional.** The entry is gone whether the signature
   * that follows turns out to be valid or not, and the caller must not put it
   * back. That is what makes each challenge worth exactly one attempt; if a
   * failed verification left it in place, someone holding a captured message
   * could grind signatures against a live challenge for its full five-minute
   * life. The cost is that a user who fumbles must request a new challenge,
   * which the client does anyway immediately before asking for a signature.
   *
   * Expiry is checked here rather than relying on the sweep — the sweep bounds
   * memory, this bounds trust. The comparison is `>=`, so an entry at exactly
   * its expiry instant is expired: on a clock-skew boundary, refuse.
   */
  consume(address: Address): ConsumeResult {
    const key = getAddress(address).toLowerCase();

    const stored = this.entries.get(key);
    if (stored === undefined) {
      return { outcome: 'missing' };
    }

    this.entries.delete(key);

    if (Date.now() >= stored.expiresAt) {
      return { outcome: 'expired' };
    }

    return { outcome: 'ok', stored };
  }
}

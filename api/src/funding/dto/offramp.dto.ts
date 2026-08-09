import { z } from 'zod';

import { amountMinorSchema } from '../../common/amount.schema';

/**
 * `POST /offramp` request body — the amount of unspent platform balance to send
 * back out to the funder wallet
 * (`specs/005-accounts-ledger-funding/contracts/internal-api.md` §5).
 *
 * Structurally identical to `topUpRequestSchema`, and deliberately a separate
 * declaration rather than a shared `amountBodySchema` the two routes both point
 * at. The shared thing is `amountMinorSchema` — the rule about what a valid
 * amount *is* — and that is already shared. What is not shared is what the
 * amount **means**: this one is bounded by the account's ledger balance and
 * moves money out of the platform, the other is bounded by the funder wallet
 * and moves money in. Two bodies that happen to have the same shape today are
 * not one body, and the first field either route grows would have to un-merge
 * them.
 *
 * **Partial cash-out is supported**: this is an amount, not a "withdraw
 * everything" trigger — which answers the open question in
 * `ui/specs/006-wallet-page/` R7, where the amount field stays editable with
 * `availableBalanceMinor` as its ceiling.
 *
 * ⚠️ **Escrowed money cannot leave through here**, and nothing in this schema
 * has to enforce that. The ceiling is `SUM(ledger_entries.amount_minor)`, and
 * money sitting in escrow against an open order is not in that sum — the
 * exclusion is structural rather than a check somebody has to remember.
 */
export const offrampRequestSchema = z.object({
  amountMinor: amountMinorSchema,
});

/** The parsed body. Inferred from the schema, so the two cannot drift. */
export type OfframpRequest = z.infer<typeof offrampRequestSchema>;

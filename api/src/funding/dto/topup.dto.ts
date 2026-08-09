import { z } from 'zod';

import { amountMinorSchema } from '../../common/amount.schema';

/**
 * `POST /topup` request body — one field, and it is money
 * (`specs/005-accounts-ledger-funding/contracts/internal-api.md` §3).
 *
 * The whole rule lives in `amountMinorSchema`: a positive, whole, safe-integer
 * number of **US cents**. Restating any part of it here would be a second
 * definition of "valid amount" in a backend that already has one, and the copy
 * that drifts is always the one guarding money — the same argument
 * `auth/dto/nonce.dto.ts` makes for sharing `addressSchema` rather than
 * re-typing the regex.
 *
 * ⚠️ Cents, never dollars. `12.34` here is not "twelve dollars thirty-four", it
 * is a non-integer and it is refused with a `400` before the handler is entered
 * — before the funder's balance is read and long before a transfer is signed
 * (invariant #2, research R14).
 *
 * ⚠️ **No destination and no source field, and their absence is the security
 * control.** The money moves funder → operator pool and the credit lands on the
 * session's account; both ends are fixed by the flow, not by the caller. A body
 * that could name either would let someone credit an account that is not theirs.
 */
export const topUpRequestSchema = z.object({
  amountMinor: amountMinorSchema,
});

/**
 * The parsed body. Inferred rather than declared, so the type cannot disagree
 * with the schema that produced it — there is no second place to update.
 */
export type TopUpRequest = z.infer<typeof topUpRequestSchema>;

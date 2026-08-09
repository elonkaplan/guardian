import { z } from 'zod';

/**
 * The body of `PATCH /agents/:id/active`.
 *
 * ⚠️ **An absolute value, never a toggle instruction**, and that is the whole
 * design of this one-field schema.
 *
 * A `POST /agents/:id/toggle` with no body would be shorter to write and would
 * make the call non-idempotent: two clicks land as two flips, and the result
 * depends on how many of them arrived rather than on what the seller meant.
 * `ui/specs/007-seller-pages` R9 depends on the idempotence in writing — it is
 * the stated reason this call is exempt from that app's rule that mutations
 * must not be retried blind — and the seller's list polls underneath the switch
 * at 5 s, so a lost or duplicated request must converge to the value the seller
 * chose rather than to a parity of requests.
 *
 * It also removes a read-then-decide race on the server: with an absolute
 * value, the handler never has to learn the current state in order to compute
 * the next one.
 *
 * ⚠️ **`z.boolean()`, deliberately not coerced.** `z.coerce.boolean()` accepts
 * the string `"false"` and yields `true`, because every non-empty string is
 * truthy — so a client sending `{"active": "false"}` would switch an agent
 * *on* while believing it had switched it off, and would see the poll confirm
 * the opposite of its intent. This is a JSON body, so a real boolean is what
 * the wire format offers and anything else is a client bug worth a `400`.
 */
export const setActiveSchema = z.object({
  active: z.boolean(),
});

export type SetActiveDto = z.infer<typeof setActiveSchema>;

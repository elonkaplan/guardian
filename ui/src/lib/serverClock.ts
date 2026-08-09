/**
 * The offset between this device's clock and the API's, so the countdown is the
 * server's answer rather than the laptop's.
 *
 * The review countdown on the order screen is the one number the audience is invited
 * to trust, and it is computed entirely client-side from `deliveredAt +
 * reviewWindowSeconds`. Nothing on the wire tells the page how much time is left; the
 * page works it out. So a laptop whose clock runs two minutes fast will draw a window
 * that expired before the delivery it is measuring from, and the demo machine's clock
 * is not something anyone will think to check while the room is watching.
 *
 * The correction comes from the `Date` header, which rides on every response the page
 * already makes. The order screen polls once a second, so the offset is re-measured
 * once a second and can never go stale — and it costs no extra request, no new
 * endpoint, and no change to any call signature. A dedicated `/time` route would be a
 * new backend surface for a number that is already in the reply.
 *
 * A skew under two seconds is stored as zero. Below that we are not measuring a wrong
 * clock, we are measuring the round trip: the header is stamped when the server writes
 * the response and read after it has crossed the network, so every sample carries the
 * latency with it. Honouring those small readings would shift the anchor by a couple
 * of hundred milliseconds on every poll, and a countdown that jitters by half a second
 * each tick — occasionally counting the same second twice — looks broken in exactly
 * the way this module exists to prevent.
 *
 * The CORS gotcha, stated plainly here because it will otherwise be debugged twice:
 * `Date` is NOT a CORS-safelisted response header. Cross-origin — which is the normal
 * arrangement, UI on :5173 and API on :3000 — the browser hides it from JavaScript
 * entirely, `response.headers.get('Date')` returns null, and `noteServerDate` is
 * handed null on every single response. The fix is one header on the API's CORS
 * config, `Access-Control-Expose-Headers: Date`, requested in
 * specs/004-order-detail/contracts/internal-api.md §7. As of this writing the Guardian
 * API sends no CORS headers at all, so the fallback is what is running today. That
 * fallback is a skew of zero, which is to say the device clock, which is precisely the
 * behaviour the app had before this module existed — nothing regresses while the
 * header is missing, and the countdown quietly gets more trustworthy the day it lands.
 * That is the property that makes reading an optional header worth doing at all.
 *
 * The module-level mutable `skewMs` is unusual in this codebase, and it is why this is
 * a file rather than three lines inside `client.ts`. The offset is observable
 * behaviour that shapes what the user sees, not a request-handling detail; it deserves
 * a name and a comment block rather than a variable buried in a fetch wrapper where
 * the next reader would have to reconstruct all of the above from an assignment.
 */

/** Milliseconds to add to `Date.now()` to land on the server's clock. */
let skewMs = 0;

/**
 * Below this, a reading is round-trip latency rather than a genuinely wrong clock.
 */
const DEADBAND_MS = 2000;

/**
 * Record the `Date` header from an API response. Safe to call with anything, on every
 * response including failures.
 *
 * A null, empty, or unparseable header leaves the previous measurement in place. It is
 * deliberately not a reset: one unreadable response should not throw away a good
 * offset and snap the countdown back to the device clock mid-tick.
 */
export function noteServerDate(header: string | null): void {
  if (header === null || header.trim() === '') {
    return;
  }

  const serverMs = Date.parse(header);

  if (!Number.isFinite(serverMs)) {
    return;
  }

  const measured = serverMs - Date.now();

  skewMs = Math.abs(measured) < DEADBAND_MS ? 0 : measured;
}

/**
 * The current time on the server's clock, as far as this page can tell.
 *
 * Every deadline and elapsed calculation on the order screen goes through here rather
 * than calling `Date.now()` directly.
 */
export function serverNow(): number {
  return Date.now() + skewMs;
}

/**
 * The offset currently in force. Diagnostics only — this is here so a developer can
 * tell "the header is being exposed and the clocks agree" apart from "the header is
 * invisible and we are on the device clock", since both read as zero on screen.
 * Nothing rendered to the buyer should depend on it.
 */
export function clockSkewMs(): number {
  return skewMs;
}

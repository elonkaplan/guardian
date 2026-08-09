/**
 * Acceptance run for specs/011-demo-seed-fixtures/quickstart.md §10 and §11 —
 * reset clears the rehearsal and leaves the ledger whole.
 *
 *   node scripts/verify-011-reset.mjs
 *
 * ⚠️ DESTRUCTIVE, by design and by name. It deletes every order, run, complaint
 * and verdict in the database — not only the ones this feature created. Run it
 * against a rehearsal database, never against anything whose order history is
 * evidence you still need.
 *
 * ★ The load-bearing assertion is the one that does NOT change: every ledger
 * entry survives and every balance is identical afterwards. A balance that rose
 * means purchase entries were deleted or reversed, crediting back money that has
 * already left for an escrow or a settlement (FR-031, SC-012, research R4).
 *
 * Covers T045 ★, T046, T047.
 */
import {
  api,
  awaitTerminal,
  buyFixture,
  h,
  note,
  ok,
  psql,
  reset,
  signIn,
  sleep,
  summary,
  topUp,
} from './verify-011-lib.mjs';
import { readFileSync } from 'node:fs';

const seedDoc = JSON.parse(readFileSync(new URL('./.011-seed.json', import.meta.url), 'utf8'));
const fixture = (act) => seedDoc.fixtures.find((f) => f.act === act);
const sellerId = seedDoc.seller.accountId;

const count = (table, where = '') => psql(`SELECT count(*) FROM ${table}${where ? ` WHERE ${where}` : ''}`);
const ledgerSumFor = (accountId) =>
  psql(`SELECT coalesce(sum(amount_minor),0) FROM ledger_entries WHERE account_id='${accountId}'`);

// ---------- before ----------
h('§10 ★ — reset keeps the ledger whole (T045 · FR-031 · SC-012)');

const before = {
  orders: count('orders'),
  runs: count('runs'),
  complaints: count('complaints'),
  verdicts: count('verdicts'),
  agents: count('agents'),
  accounts: count('accounts'),
  ledger: count('ledger_entries'),
  ledgerSum: psql('SELECT coalesce(sum(amount_minor),0) FROM ledger_entries'),
};
note(`before — orders ${before.orders}, runs ${before.runs}, complaints ${before.complaints}, verdicts ${before.verdicts}`);
note(`before — agents ${before.agents}, accounts ${before.accounts}, ledger_entries ${before.ledger} (sum ${before.ledgerSum})`);

ok(Number(before.orders) > 0, 'there is a populated rehearsal to clear — otherwise this proves nothing', `orders=${before.orders}`);

// Per-account balances, so the check is "every balance", not "the total".
const balancesBefore = psql(
  `SELECT account_id || '=' || coalesce(sum(amount_minor),0) FROM ledger_entries GROUP BY account_id ORDER BY account_id`,
);

const res = await reset();
ok(res.status === 200, 'POST /demo/reset → 200', `got ${res.status} ${String(res.text).slice(0, 300)}`);
note(`cleared: ${JSON.stringify(res.body?.cleared)}`);
note(`kept:    ${JSON.stringify(res.body?.kept)}`);
ok(typeof res.body?.note === 'string' && res.body.note.length > 0, 'the response carries the note about spent money not returning');

// ---------- after: what must be gone ----------
h('§10 — what reset clears');
for (const t of ['orders', 'runs', 'complaints', 'verdicts']) {
  ok(count(t) === '0', `${t} is empty`, `count=${count(t)}`);
}

// ---------- after: what must remain ----------
h('§10 ★ — what reset must NOT touch');
ok(count('agents') === before.agents, `agents unchanged (${before.agents})`, `now ${count('agents')}`);
ok(count('accounts') === before.accounts, `accounts unchanged (${before.accounts})`, `now ${count('accounts')}`);
ok(count('ledger_entries') === before.ledger, `★ ledger_entries unchanged (${before.ledger})`, `now ${count('ledger_entries')}`);
ok(
  psql('SELECT coalesce(sum(amount_minor),0) FROM ledger_entries') === before.ledgerSum,
  `★ the total ledger sum is IDENTICAL (${before.ledgerSum})`,
  `now ${psql('SELECT coalesce(sum(amount_minor),0) FROM ledger_entries')}`,
);

const balancesAfter = psql(
  `SELECT account_id || '=' || coalesce(sum(amount_minor),0) FROM ledger_entries GROUP BY account_id ORDER BY account_id`,
);
ok(balancesAfter === balancesBefore, '★ EVERY per-account balance is identical before and after (SC-012)');

ok(count('agents', `owner_account_id='${sellerId}'`) === '3', 'the demo seller still owns its three listings — no re-seed needed');

// The pointer goes, the row and its amount stay (research R4).
ok(
  count('ledger_entries', "kind='purchase' AND order_id IS NOT NULL") === '0',
  '★ no ledger entry still points at a deleted order',
  `count=${count('ledger_entries', "kind='purchase' AND order_id IS NOT NULL")}`,
);
ok(
  Number(count('ledger_entries', "kind='purchase'")) > 0,
  'the purchase entries THEMSELVES survive — only their order pointer was cleared',
  `count=${count('ledger_entries', "kind='purchase'")}`,
);

// ---------- §10 repetition ----------
h('§10 — repetition (T046 · FR-033)');
const second = await reset();
ok(second.status === 200, 'a second reset → 200', `got ${second.status}`);
const clearedTwice = second.body?.cleared ?? {};
ok(
  Object.values(clearedTwice).every((v) => v === 0),
  'the second reset clears nothing and still succeeds',
  JSON.stringify(clearedTwice),
);
ok(
  count('ledger_entries') === before.ledger,
  'the ledger is still untouched after the second reset',
);

// ---------- §11 reset mid-act ----------
h('§11 — reset while the execution poller is claiming (T047 · FR-034 · SC-013)');

const logsSince = new Date().toISOString();
const buyer = await signIn();
const top = await topUp(buyer.token, 400);
ok(top.status === 200, 'top-up for the mid-act buyer → 200', `got ${top.status}`);

const inFlight = await buyFixture(buyer.token, fixture(3));
ok(inFlight.status === 201, 'bought act 3 to leave an order in flight', `got ${inFlight.status}`);

// Reset immediately — the poller claims on its own interval and the race is the
// point. No sleep: waiting would test the settled case, which §10 already did.
const midReset = await reset();
ok(midReset.status === 200, 'reset mid-act → 200, not a 500', `got ${midReset.status} ${String(midReset.text).slice(0, 200)}`);
note(`cleared mid-act: ${JSON.stringify(midReset.body?.cleared)}`);
ok(
  Number(midReset.body?.cleared?.ordersInFlight ?? 0) >= 1,
  'ordersInFlight ≥ 1 — the in-flight order was counted before it was deleted (FR-032)',
  `got ${midReset.body?.cleared?.ordersInFlight}`,
);

// Give the poller a moment to hit the deleted order and fail against the
// foreign key rather than write an orphan.
await sleep(8000);

ok(count('runs') === '0', 'no orphan run row — the constraint refused the write', `count=${count('runs')}`);
ok(count('orders') === '0', 'orders is still empty');

const { execFileSync } = await import('node:child_process');
const logs = execFileSync('docker', ['logs', 'api-api-1', '--since', logsSince], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const crashed = /FATAL|unhandled rejection|Nest application.*shutting down/i.test(logs);
ok(!crashed, 'the process did not crash', 'found a fatal in the logs');

const fkErrors = (logs.match(/foreign key|violates foreign key constraint/gi) ?? []).length;
note(`foreign-key complaints in the log since the reset: ${fkErrors}`);
ok(fkErrors <= 2, 'at most a foreign-key error or two, recognisably about the deleted order', `saw ${fkErrors}`);

// ---------- the next purchase works ----------
h('§11 — the next purchase works normally (SC-013)');
const after = await buyFixture(buyer.token, fixture(2));
ok(after.status === 201, 'a fresh purchase after the mid-act reset → 201', `got ${after.status} ${String(after.text).slice(0, 200)}`);
if (after.status === 201) {
  const { order } = await awaitTerminal(buyer.token, after.body.id);
  ok(order?.state === 'delivered', 'and it delivers', `got ${order?.state}`);
  ok(
    (order?.run?.output?.lineItems ?? []).length === 3,
    'and the fixture still fires — three line items',
    `got ${(order?.run?.output?.lineItems ?? []).length}`,
  );
}

// Leave the database clean for the next rehearsal pass.
await reset();
note('reset once more, so the next rehearsal starts from an empty history');

process.exit(summary() === 0 ? 0 : 1);

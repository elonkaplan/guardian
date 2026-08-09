/**
 * Acceptance run for specs/011-demo-seed-fixtures/quickstart.md §5, §6 and §7 —
 * the three acts, end to end, each to a settled ruling.
 *
 *   npm run build                               # this script reads the escrow ABI from dist/
 *   node scripts/verify-011-acts.mjs            # one rehearsal
 *   node scripts/verify-011-acts.mjs --pass 2   # label the output for §12
 *
 * ⚠️ SPENDS, and is the most expensive script here. Three purchases, three
 * complaints, three Guardian audits (each a real model call) and three on-chain
 * resolutions. Nothing is replayed: reset deletes verdicts, so a second pass
 * makes the auditor decide all three again from scratch.
 *
 * ★ The split is confirmed ON-CHAIN — `balances()` on the escrow, not the
 * ledger table. The database agreeing with itself is not evidence that money
 * moved (quickstart §6).
 *
 * Covers T049 ★, T050 ★, and one pass of T051 ★.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';

import {
  api,
  awaitTerminal,
  awaitVerdict,
  buyFixture,
  h,
  note,
  ok,
  psql,
  signIn,
  summary,
  topUp,
} from './verify-011-lib.mjs';
import { escrowAbi } from '../dist/chain/abi/escrow.abi.js';

const passLabel = (() => {
  const i = process.argv.indexOf('--pass');
  return i === -1 ? '1' : process.argv[i + 1];
})();

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const chain = createPublicClient({ transport: http(env.MONAD_RPC_URL) });
const ESCROW = env.ESCROW_CONTRACT_ADDRESS;
const SELLER = env.DEMO_SELLER_ADDRESS;

/**
 * Escrow balance in CENTS.
 *
 * ⚠️ `balances()` returns the settlement token's base units, and USDC has 6
 * decimals against a cent's 2 — so the raw number is 10,000× the cent figure
 * (`src/chain/units.ts`, `CENTS_TO_BASE_SCALE`). Comparing the raw value to a
 * price in cents is a factor-of-10,000 error in real money, which is why the
 * conversion is named here rather than done inline at each call site.
 */
const escrowBalance = async (address) =>
  Number(
    await chain.readContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: 'balances',
      args: [address],
    }),
  ) / 10_000;

const seedDoc = JSON.parse(readFileSync(new URL('./.011-seed.json', import.meta.url), 'utf8'));
const fixture = (act) => seedDoc.fixtures.find((f) => f.act === act);

// What each act is supposed to prove. `expectedTier` travels in the seed
// response as documentation; asserting against it here is the demo checking
// its own promise, not runtime code branching on it.
const EXPECT = {
  1: { tier: 'none', refundMinor: 0, price: 100, citationSource: 'criterion' },
  2: { tier: 'half', refundMinor: 100, price: 200, citationSource: 'exclusion' },
  3: { tier: 'full', refundMinor: 150, price: 150, citationSource: null },
};

h(`=== rehearsal pass ${passLabel} — three acts, three tiers ===`);

const buyer = await signIn();
note(`buyer ${buyer.acct.address}`);

const FUND = 600;
const top = await topUp(buyer.token, FUND);
ok(top.status === 200, `top-up ${FUND}¢ → 200`, `got ${top.status} ${String(top.text).slice(0, 200)}`);

const sellerBefore = await escrowBalance(SELLER);
const buyerBefore = await escrowBalance(buyer.acct.address);
note(`escrow balances before — seller ${sellerBefore}¢, buyer ${buyerBefore}¢`);

const results = {};

for (const act of [1, 2, 3]) {
  const exp = EXPECT[act];
  h(`§${act + 4} ★ — Act ${act}: expecting tier "${exp.tier}", refund ${exp.refundMinor}¢ of ${exp.price}¢`);

  const f = fixture(act);
  const bought = await buyFixture(buyer.token, f);
  if (!ok(bought.status === 201, `act ${act}: purchased`, `got ${bought.status} ${String(bought.text).slice(0, 240)}`)) continue;
  const orderId = bought.body.id;

  const { order, timedOut } = await awaitTerminal(buyer.token, orderId);
  ok(!timedOut, `act ${act}: reached a terminal state`);
  const expectedState = act === 3 ? 'failed' : 'delivered';
  ok(order?.state === expectedState, `act ${act}: state is ${expectedState}`, `got ${order?.state}`);

  // Act 3's evidence is the ABSENCE — asserted here again because this is the
  // pass that goes on to a ruling, and the ruling is reasoned over this row.
  if (act === 3) {
    const outNull = psql(`SELECT output IS NULL FROM runs WHERE order_id='${orderId}'`);
    ok(outNull === 't', 'act 3: runs.output is SQL NULL going into the audit', `= ${outNull}`);
  }

  // The complaint, verbatim from the seed response. Retyping it is the listed
  // cause of a tier landing one step off (quickstart, "what a failed run looks like").
  const complained = await api(`/orders/${orderId}/complain`, {
    method: 'POST',
    token: buyer.token,
    body: { reason: f.complaint },
  });
  // 202, not 200: the complaint is recorded and the audit happens on Guardian's
  // own poller. The verdict is fetched below rather than read from this body.
  ok(complained.status === 202, `act ${act}: complaint accepted (202)`, `got ${complained.status} ${String(complained.text).slice(0, 200)}`);

  const { verdict, timedOut: vTimeout } = await awaitVerdict(buyer.token, orderId);
  if (!ok(!vTimeout && verdict !== null, `act ${act}: a verdict was reached`, 'timed out waiting for the Guardian poller')) continue;

  ok(verdict.tier === exp.tier, `act ${act}: tier is "${exp.tier}"`, `got "${verdict.tier}"`);
  ok(verdict.refundMinor === exp.refundMinor, `act ${act}: refundMinor is ${exp.refundMinor}`, `got ${verdict.refundMinor}`);

  const citations = verdict.citations ?? [];
  ok(citations.length > 0, `act ${act}: the ruling cites something`, `got ${citations.length} citations`);

  if (exp.citationSource) {
    const hit = citations.find((c) => c.source === exp.citationSource);
    ok(
      hit !== undefined,
      `act ${act} ★: at least one citation with source "${exp.citationSource}"`,
      `sources present: ${citations.map((c) => c.source).join(', ')}`,
    );
    if (hit) note(`cited ${hit.source} (met=${hit.met}): "${String(hit.quote ?? '').slice(0, 120)}…"`);
  }

  // ★ SC-007: Act 2's second grievance is the currency one, and it must be
  // rejected by name. An exclusion the demo claims and never shows is exactly
  // what FR-020 exists for.
  if (act === 2) {
    const exclusion = citations.find((c) => c.source === 'exclusion');
    ok(
      exclusion !== undefined && /currenc/i.test(String(exclusion.quote ?? '')),
      'act 2 ★: the cited exclusion is the CURRENCY clause (SC-007)',
      `quote: ${String(exclusion?.quote ?? '(none)').slice(0, 160)}`,
    );
    // ⚠️ `met: true` is the REJECTION, not an upheld grievance. `met` reads
    // "the delivery met this clause" (verdict-response.dto.ts): the seller
    // stated it does not convert currencies, the delivery honoured that, so the
    // buyer's currency complaint fails while the missing-line-items one still
    // carries the tier. Asserting `false` here would be asserting that the demo
    // misfires.
    ok(
      exclusion !== undefined && exclusion.met === true,
      'act 2: the exclusion is MET — the currency grievance is rejected on its own terms',
      `met=${exclusion?.met}`,
    );
  }

  results[act] = { orderId, tier: verdict.tier, refundMinor: verdict.refundMinor, price: exp.price };
}

// ---------- §6 the split, confirmed on-chain ----------
h('§6 ★ — the split confirmed ON-CHAIN, not in the database');

// Settlement is a transaction; give the chain a moment to land all three.
await new Promise((r) => setTimeout(r, 8000));

const sellerAfter = await escrowBalance(SELLER);
const buyerAfter = await escrowBalance(buyer.acct.address);

const expectedRefundTotal = Object.values(results).reduce((s, r) => s + r.refundMinor, 0);
const expectedSellerTotal = Object.values(results).reduce((s, r) => s + (r.price - r.refundMinor), 0);

note(`escrow balances after — seller ${sellerAfter}¢ (+${sellerAfter - sellerBefore}), buyer ${buyerAfter}¢ (+${buyerAfter - buyerBefore})`);

ok(
  sellerAfter - sellerBefore === expectedSellerTotal,
  `the demo seller was credited ${expectedSellerTotal}¢ on-chain across the three acts`,
  `got +${sellerAfter - sellerBefore}`,
);
ok(
  buyerAfter - buyerBefore === expectedRefundTotal,
  `the buyer was refunded ${expectedRefundTotal}¢ on-chain across the three acts`,
  `got +${buyerAfter - buyerBefore}`,
);

if (results[2]) {
  note(`act 2's split: $1.00 to the buyer, $1.00 to the seller — of a ${results[2].price}¢ order`);
  ok(results[2].refundMinor === 100 && results[2].price - results[2].refundMinor === 100, 'act 2 is a clean $1.00/$1.00 split');
}

h(`=== pass ${passLabel} tiers: ${[1, 2, 3].map((a) => `act${a}=${results[a]?.tier ?? 'MISSING'}`).join(' ')} ===`);

process.exit(summary() === 0 ? 0 : 1);

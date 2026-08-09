/**
 * Acceptance run for specs/011-demo-seed-fixtures/quickstart.md §2, §3, §4, §7
 * (the run-record half) and §9 — do the seeded agents actually run, are the
 * fixtures deterministic, and does a stranger's input still get a live model?
 *
 *   node scripts/verify-011-seed.mjs && node scripts/verify-011-fixtures.mjs
 *
 * ⚠️ SPENDS. Nine purchases: eight fixture hits (free of model calls, which is
 * the point of them) and three deliberate MISSES that each burn a real
 * Anthropic call — the misses are the check, not a side effect (FR-024, SC-008).
 * Every purchase is a real `openDeal` on Monad and a real top-up transfer.
 *
 * Covers T019 ★, T028, T029 ★, T033, T036, T037.
 */
import { readFileSync } from 'node:fs';
import {
  api,
  awaitTerminal,
  buyFixture,
  h,
  note,
  ok,
  psql,
  signIn,
  summary,
  topUp,
} from './verify-011-lib.mjs';

const seedDoc = JSON.parse(readFileSync(new URL('./.011-seed.json', import.meta.url), 'utf8'));
const fixture = (act) => seedDoc.fixtures.find((f) => f.act === act);
const agentIdOf = (key) => seedDoc.agents.find((a) => a.key === key).agentId;

const buyer = await signIn();
note(`buyer ${buyer.acct.address}`);

// One transfer rather than nine: 8 fixture buys + 3 live misses, with headroom.
const FUND = 2600;
const top = await topUp(buyer.token, FUND);
ok(top.status === 200, `top-up ${FUND}¢ → 200`, `got ${top.status} ${String(top.text).slice(0, 200)}`);

const runRow = (orderId, cols) => psql(`SELECT ${cols} FROM runs WHERE order_id='${orderId}'`);

// ---------- §2 every seeded agent actually runs ----------
h('§2 ★ — every seeded agent actually runs (T019 · FR-036) — the check the previous feature FAILED');

const firstOrders = {};
for (const act of [1, 2, 3]) {
  const f = fixture(act);
  const res = await buyFixture(buyer.token, f);
  ok(res.status === 201, `act ${act}: POST /orders → 201`, `got ${res.status} ${String(res.text).slice(0, 240)}`);
  firstOrders[act] = res.body?.id;
}

const finals = {};
for (const act of [1, 2, 3]) {
  const { order, timedOut } = await awaitTerminal(buyer.token, firstOrders[act]);
  finals[act] = order;
  ok(!timedOut, `act ${act}: reached a terminal state`, 'timed out — is the execution poller running?');
  note(`act ${act} → ${order?.state}`);
}

ok(finals[1]?.state === 'delivered', 'act 1 delivered', `got ${finals[1]?.state}`);
ok(finals[2]?.state === 'delivered', 'act 2 delivered', `got ${finals[2]?.state}`);
ok(finals[3]?.state === 'failed', 'act 3 failed (by design)', `got ${finals[3]?.state}`);

// The whole reason T007 exists. A seeded schema missing `additionalProperties:
// false` passes Ajv and is refused by the model service at run time.
const logs = (await import('node:child_process')).execFileSync(
  'docker',
  ['logs', 'api-api-1', '--since', '30m'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
ok(
  !logs.includes("'additionalProperties' must be explicitly set to false"),
  'NO "additionalProperties must be explicitly set to false" anywhere in the logs',
  'a seeded outputSchema is missing the flag — check lineItems.items first',
);
ok(!/DefinitionUnusableError/.test(logs), 'no DefinitionUnusableError in the logs');

// ---------- §3 Act 2 is countable, and deterministic ----------
h('§3 ★ — Act 2 returns three of five, every time (T028 · FR-017, FR-019 · SC-003)');

const EXPECTED = ['Ergonomic keyboard', 'USB-C dock', 'Monitor stand'];
const DROPPED = ['Desk lamp', 'Cable kit'];

const act2Receipt = fixture(2).input.receiptText;
for (const d of DROPPED) {
  ok(act2Receipt.includes(d), `the receipt visibly prints "${d}" — the drop is nameable from the input`);
}
ok(act2Receipt.includes('362'), 'the receipt prints a total of 362.00 against the fixture\'s 300.00');

const act2Runs = [finals[2]];
for (let i = 0; i < 4; i++) {
  const res = await buyFixture(buyer.token, fixture(2));
  if (!ok(res.status === 201, `act 2 repeat ${i + 2}: POST /orders → 201`, `got ${res.status}`)) continue;
  const { order } = await awaitTerminal(buyer.token, res.body.id);
  act2Runs.push(order);
}

let identical = 0;
for (const [i, o] of act2Runs.entries()) {
  const items = o?.run?.output?.lineItems ?? [];
  const names = items.map((x) => x.description);
  const same = JSON.stringify(names) === JSON.stringify(EXPECTED);
  if (same) identical++;
  ok(items.length === 3, `run ${i + 1}: exactly 3 line items (not 5)`, `got ${items.length}: ${names.join(', ')}`);
  ok(same, `run ${i + 1}: the same three, in order`, `got ${names.join(', ')}`);
  ok(Number(o?.run?.output?.total) === 300, `run ${i + 1}: total is 300.00`, `got ${o?.run?.output?.total}`);
  for (const d of DROPPED) {
    ok(!names.includes(d), `run ${i + 1}: "${d}" is absent — it is one of the two dropped`);
  }
}
ok(identical === 5, 'all five purchases returned an IDENTICAL three items (SC-003)', `${identical}/5`);

// ---------- §4 Act 1's output ----------
h('§4 ⚠️ — Act 1: the declared count must agree with the text (T033 · SC-004)');

const summaryText = finals[1]?.run?.output?.summary ?? '';
const declared = finals[1]?.run?.output?.wordCount;
const actual = summaryText.trim().split(/\s+/).filter(Boolean).length;
ok(declared === 85, 'declared wordCount is 85', `got ${declared}`);
ok(actual === 85, 'the ACTUAL word count of the delivered summary is 85', `counted ${actual}`);
ok(declared === actual, 'declared and actual agree — no grievance handed to the buyer');
ok(actual < fixture(1).input.wordCap, `${actual} is under the buyer's cap of ${fixture(1).input.wordCap}`);
ok(/price|pricing|per cent|percent|%/i.test(summaryText), 'the summary mentions the pricing change (structural check only — T032 is a human read)');
note(`summary: ${summaryText.slice(0, 160)}…`);

// ---------- §7 Act 3's run record ----------
h('§7 ★ — Act 3: the absence is on the record (T036 · FR-021, FR-022 · SC-005)');

const a3 = firstOrders[3];
const [outNull, outIsEmptyObj, errSet, validNull] = runRow(
  a3,
  `output IS NULL, output = '{}'::jsonb, error IS NOT NULL, output_valid IS NULL`,
).split('|');

ok(outNull === 't', 'runs.output is SQL NULL', `output IS NULL = ${outNull}`);
ok(outIsEmptyObj !== 't', "runs.output is NOT '{}' — an empty object is a delivery of nothing", `= ${outIsEmptyObj}`);
ok(errSet === 't', 'runs.error is set — the crash is recorded, not silent', `error IS NOT NULL = ${errSet}`);
ok(validNull === 't', 'runs.output_valid is NULL (nothing to validate)', `= ${validNull}`);
note(`error: ${runRow(a3, 'error')}`);

const runCount3 = runRow(a3, 'count(*)');
ok(runCount3 === '1', 'exactly one runs row for the failed order — it travelled the ordinary path');

// ---------- §9 a stranger's input gets a real run ----------
h('§9 ★ — the fixture fires on ITS input and nothing else (T029, T037 · FR-024 · SC-008)');

const liveBuys = [
  {
    label: "a stranger's receipt → live extraction",
    body: {
      agentId: agentIdOf('ledgerbot'),
      input: { receiptText: 'Coffee 3.50\nBagel 2.25\nTOTAL 5.75' },
      acceptanceCriteria: 'Extract all line items.',
    },
    check: (o) => {
      const items = o?.run?.output?.lineItems ?? [];
      const names = items.map((x) => x.description).join(', ');
      ok(
        JSON.stringify(items.map((x) => x.description)) !== JSON.stringify(EXPECTED),
        'a stranger\'s receipt did NOT return the scripted three',
        `got ${names}`,
      );
      ok(items.length === 2, 'it genuinely extracted the two items it was given', `got ${items.length}: ${names}`);
    },
  },
  {
    label: 'the fixture receipt with ONE character changed → live extraction',
    body: {
      agentId: agentIdOf('ledgerbot'),
      input: { receiptText: act2Receipt.replace('362.00', '362.01') },
      acceptanceCriteria: fixture(2).acceptanceCriteria,
    },
    check: (o) => {
      const items = o?.run?.output?.lineItems ?? [];
      ok(items.length !== 3 || JSON.stringify(items.map((x) => x.description)) !== JSON.stringify(EXPECTED),
        'one changed character misses the fixture — the key is exact',
        `got ${items.length} items: ${items.map((x) => x.description).join(', ')}`);
    },
  },
  {
    label: 'preserveTerms REVERSED → live run (array order is part of identity)',
    body: {
      agentId: agentIdOf('polyglot'),
      input: {
        ...fixture(3).input,
        preserveTerms: [...fixture(3).input.preserveTerms].reverse(),
      },
      acceptanceCriteria: fixture(3).acceptanceCriteria,
    },
    check: (o, state) => {
      ok(state !== 'failed', 'the reversed input did NOT hit the crash fixture — it ran live', `state=${state}`);
    },
  },
];

for (const lb of liveBuys) {
  const res = await api('/orders', { method: 'POST', token: buyer.token, body: lb.body });
  if (!ok(res.status === 201, `${lb.label}: purchased`, `got ${res.status} ${String(res.text).slice(0, 200)}`)) continue;
  const { order } = await awaitTerminal(buyer.token, res.body.id);
  note(`${lb.label} → ${order?.state}`);
  lb.check(order, order?.state);
}

process.exit(summary() === 0 ? 0 : 1);

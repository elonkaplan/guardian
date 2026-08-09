/**
 * Acceptance run for specs/008-execution-engine/quickstart.md §2, §3 and §3a —
 * the execution engine's HAPPY PATH: a purchased order is claimed by the
 * poller, run against a real model, and delivered.
 *
 *   node scripts/verify-008.mjs
 *
 * ⚠️ This SPENDS A REAL MODEL CALL (`ANTHROPIC_API_KEY`) and writes a genuine
 * `runs` row. `runs` has `UNIQUE (order_id)` (contracts/run-record.md,
 * "what consumers may rely on" §1) — once a row exists for an order, that
 * order can never be run again, by design, so THIS SCRIPT BUYS A FRESH ORDER
 * EVERY TIME IT IS INVOKED rather than reusing one. Re-running the whole
 * script is always safe; there is no order id you can hand it a second time.
 *
 * It is read-mostly: it places one order and asserts against it. It never
 * deletes a row, never UPDATEs `runs`, and never resets any state — the state
 * resets that quickstart.md §4 (forced failure), §6 (the re-run guard) and
 * §10 (demo mode) need are deliberately not this script's job. Reuses
 * `verify-007.mjs`'s auth/purchase plumbing verbatim rather than reinventing
 * it, the same way `verify-007-seller.mjs` and `verify-007-settlement.mjs` do.
 *
 * NOT covered here, and deliberately:
 *   - §3a's full test — publishing a competing agent version WHILE the run is
 *     in flight and confirming the pinned one still wins. That needs the
 *     seller's key mid-run, which this happy-path buyer script does not hold.
 *     What IS covered is the same invariant §3a is protecting: every step
 *     label this script finds must be the PINNED `agent_versions.model`
 *     (read straight from the row the order actually joins to) or one of the
 *     four platform literals — never today's listing, never a sentence.
 *   - §4, §4a, §4b, §5, §6, §6a, §7, §8, §9, §10 — every one of them needs a
 *     forced crash, a hand-edited row, a second process, or a log grep. They
 *     are rehearsal steps, not a script that runs unattended.
 *
 * Requires the API on :3000, the Postgres container up, the execution poller
 * running (`npm run start:dev`), and a working `ANTHROPIC_API_KEY` in .env.
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('../.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const API = 'http://localhost:3000';

// ---------- DB access: same as verify-007-seller.mjs / verify-007-settlement.mjs ----------
// The order response deliberately carries none of `runs.output_valid`,
// `finished_at`, `duration_ms` or `steps` (order-serialiser.ts, case-file.dto.ts) —
// that is the disclosure boundary working as designed, not a gap in the API —
// so the run-record assertions below have no route but straight into Postgres.
const psql = (sql) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'guardian', '-tAc', sql], {
    encoding: 'utf8',
  }).trim();

let pass = 0,
  fail = 0;
const ok = (c, label, extra = '') =>
  c
    ? (pass++, console.log(`  ✅ ${label}${extra && ' — ' + extra}`))
    : (fail++, console.log(`  ❌ ${label}${extra && ' — ' + extra}`));
const note = (s) => console.log(`  ℹ️  ${s}`);
const h = (s) => console.log(`\n${s}`);

const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, body: j };
};

const signIn = async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const nonce = await api('/auth/nonce', { method: 'POST', body: { address: acct.address } });
  const signature = await acct.signMessage({ message: nonce.body.message });
  const verify = await api('/auth/verify', {
    method: 'POST',
    body: { address: acct.address, signature },
  });
  return { acct, token: verify.body.token };
};

// ---------- the buyer, and the agent to buy (verify-007.mjs §3 setup) ----------
const buyer = await signIn();
console.log(`buyer    ${buyer.acct.address}`);

const agents = await api('/agents');
const agent = agents.body?.[0];
if (!agent) {
  console.log('\nNo agents listed. Seed the catalogue first (006 quickstart §1).');
  process.exit(1);
}
console.log(`agent    ${agent.name} (${agent.id}) at ${agent.priceMinor}¢`);

const detail = await api(`/agents/${agent.id}`);
const inputSchema = detail.body?.inputSchema ?? {};
// Build a minimal document satisfying the seller's declared schema.
const sampleInput = Object.fromEntries(
  (inputSchema.required ?? Object.keys(inputSchema.properties ?? {})).map((k) => [
    k,
    inputSchema.properties?.[k]?.type === 'number' ? 1 : 'verification run',
  ]),
);

// ---------- §3 the purchase — a FRESH order, always ----------
h('§3 setup — a fresh purchase (007 quickstart §3, so this run gets its own untouched runs row)');
const top = await api('/topup', { method: 'POST', body: { amountMinor: agent.priceMinor }, token: buyer.token });
ok(top.status === 200, `top-up ${agent.priceMinor}¢ → 200`, `got ${top.status} ${JSON.stringify(top.body).slice(0, 200)}`);

const order = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: { agentId: agent.id, input: sampleInput, acceptanceCriteria: 'Correct, and nothing invented.' },
});
ok(order.status === 201, 'POST /orders → 201', `got ${order.status} ${JSON.stringify(order.body).slice(0, 240)}`);
const ORDER = order.body?.id;
if (typeof ORDER !== 'string') {
  console.log('\nNo order id — cannot continue. Aborting.');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`order    ${ORDER}`);

// ---------- §2 the poller claims it, and only it, within one interval ----------
h('§2 — the order is claimed and runs to a terminal state (US1 1, 4, 9)');
const POLL_INTERVAL_MS = 500;
// Generous headroom over the default agent timeout_seconds (120s) plus the
// poller's own claim latency (EXECUTION_POLL_INTERVAL_MS, default 1000ms) —
// a real model call is the slow part here, not the poller.
const POLL_TIMEOUT_MS = 150_000;

let observedRunning = false;
let finalState = null;
const pollStart = Date.now();
while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
  const got = await api(`/orders/${ORDER}`, { token: buyer.token });
  const state = got.body?.state;
  if (state === 'running') {
    observedRunning = true;
  }
  if (state && state !== 'purchased') {
    finalState = state;
    break;
  }
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}
const elapsedMs = Date.now() - pollStart;

if (finalState === null) {
  ok(
    false,
    `order left 'purchased' within ${POLL_TIMEOUT_MS}ms`,
    `still purchased after ${elapsedMs}ms — is the API running with the poller enabled (npm run start:dev), and is ANTHROPIC_API_KEY valid?`,
  );
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`order reached '${finalState}' after ${elapsedMs}ms`);

// Assertion 1: reached `running` at some point — or went straight through.
// A one-second-or-less round trip can genuinely never observe the
// intermediate state, so a miss here is reported, not failed.
if (observedRunning) {
  ok(true, 'US1: the order was observed in running before it finished');
} else {
  note("never observed the order in 'running' — either it moved through faster than the poll interval, or the poller claimed it between two polls. Not a failure by itself.");
}

// ---------- §3 a successful run delivers ----------
h('§3 — a successful run delivers ★ load-bearing (US2 1–4 · SC-002 · SC-004)');
ok(finalState === 'delivered', 'US2 the order reached delivered', `got '${finalState}'`);

const runCount = psql(`SELECT count(*) FROM runs WHERE order_id='${ORDER}'`);
ok(runCount === '1', 'exactly ONE runs row exists for the order', `count=${runCount}`);

const runRow = psql(
  `SELECT output IS NULL, output_valid, finished_at IS NOT NULL, duration_ms, jsonb_array_length(steps) ` +
    `FROM runs WHERE order_id='${ORDER}'`,
);
const [outputIsNull, outputValidRaw, finishedNotNull, durationMsRaw, stepsCountRaw] = runRow.split('|');

ok(outputIsNull === 'f', 'runs.output is non-null', `output IS NULL = ${outputIsNull}`);
ok(
  outputValidRaw === 't' || outputValidRaw === 'f',
  'runs.output_valid is populated (true or false, never NULL, on a closed row)',
  `output_valid = ${outputValidRaw === 't' ? 'true' : outputValidRaw === 'f' ? 'false' : 'NULL'}`,
);
ok(finishedNotNull === 't', 'runs.finished_at is non-null');
const durationMs = Number(durationMsRaw);
ok(Number.isFinite(durationMs) && durationMs > 0, 'runs.duration_ms > 0', `duration_ms=${durationMsRaw}`);
const stepsCount = Number(stepsCountRaw);
ok(stepsCount >= 2, 'runs.steps has at least 2 elements', `steps=${stepsCountRaw}`);

const inputCopied = psql(
  `SELECT (r.input = o.input) FROM runs r JOIN orders o ON o.id = r.order_id WHERE r.order_id='${ORDER}'`,
);
ok(inputCopied === 't', 'runs.input equals orders.input (invariant #7)', `equal=${inputCopied}`);

// ---------- §3a the PINNED definition, not the current one ----------
h("§3a — no step label is a sentence; each is the PINNED model id or a platform literal (US1 2–3 · SC-007, FR-015 boundary)");
const pinnedModel = psql(
  `SELECT v.model FROM orders o JOIN agent_versions v ON v.id = o.agent_version_id WHERE o.id='${ORDER}'`,
);
ok(typeof pinnedModel === 'string' && pinnedModel.length > 0, 'resolved the pinned agent_versions.model', pinnedModel);

const labelsRaw = psql(`SELECT jsonb_array_elements(steps)->>'label' FROM runs WHERE order_id='${ORDER}'`);
const labels = labelsRaw.length ? labelsRaw.split('\n') : [];
const PLATFORM_LITERALS = new Set(['output', 'model_error', 'timeout', 'definition_unusable']);
const unexpected = labels.filter((l) => l !== pinnedModel && !PLATFORM_LITERALS.has(l));

ok(labels.length === stepsCount, 'one label per step', `${labels.length} labels vs ${stepsCountRaw} steps`);
ok(
  unexpected.length === 0,
  'every step label is either the pinned model id or one of output/model_error/timeout/definition_unusable — never a sentence',
  `pinned model=${pinnedModel}; labels=${JSON.stringify(labels)}${unexpected.length ? `; UNEXPECTED=${JSON.stringify(unexpected)}` : ''}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

/**
 * quickstart.md §4 and §4a — the execution engine's non-delivery path, which
 * `quickstart.md` itself names as load-bearing and un-reachable by using the
 * product normally: *"they have to be forced"*. A live model call almost
 * never fails or overruns a sane timeout on its own, so this script forces
 * one of the two routes quickstart §4 names — a starved deadline, or a model
 * string no provider serves — buys against it, and reads the evidence
 * straight out of Postgres and the chain.
 *
 *   node scripts/verify-008-failure.mjs              # --timeout (default, safest)
 *   node scripts/verify-008-failure.mjs --timeout    # agent_versions.timeout_seconds → 1
 *   node scripts/verify-008-failure.mjs --bad-model  # agent_versions.model → an unservable string
 *
 * ⚠️ This creates a PERMANENT `runs` row with `output IS NULL`. That row IS
 * the non-delivery evidence — `docs/CONTEXT.md` invariant #7: *"never retry
 * over it, never clean it up"*. This script therefore never deletes anything
 * and buys a brand-new order on every invocation rather than reusing one; it
 * only ever reads `runs` and only ever writes (and restores) one row of
 * `agent_versions`.
 *
 * Both forcing modes edit the target agent's CURRENT version directly — the
 * same version `POST /orders` is about to pin — and restore the original
 * value in a `finally`, printing exactly what changed and exactly what it
 * was restored to, even when an assertion above fails.
 *
 * Requires the API on :3000, Postgres reachable via `docker compose exec
 * postgres` (matching `verify-007-settlement.mjs`), at least one agent
 * listed (006 quickstart §1), and a working `ANTHROPIC_API_KEY` for the
 * process under test — the run genuinely calls the model before it fails.
 */
import { createPublicClient, http } from 'viem';
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
const chain = {
  id: Number(env.MONAD_CHAIN_ID),
  name: 'monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [env.MONAD_RPC_URL] } },
};
const pub = createPublicClient({ chain, transport: http(env.MONAD_RPC_URL) });

// ---------- the chain-read helper, carried over from verify-007-settlement.mjs ----------
const escrowAbi = [
  {
    type: 'function',
    name: 'deals',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'buyer', type: 'address' },
      { name: 'seller', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'defHash', type: 'bytes32' },
      { name: 'defVersion', type: 'uint32' },
      { name: 'openedAt', type: 'uint64' },
      { name: 'deliveredAt', type: 'uint64' },
      { name: 'disputedAt', type: 'uint64' },
      { name: 'reviewWindow', type: 'uint32' },
      { name: 'state', type: 'uint8' },
    ],
  },
];
const DEAL_STATE = ['None', 'Open', 'Delivered', 'Disputed', 'Settled'];
const dealState = async (id) => {
  const d = await pub.readContract({
    address: env.ESCROW_CONTRACT_ADDRESS,
    abi: escrowAbi,
    functionName: 'deals',
    args: [BigInt(id)],
  });
  return DEAL_STATE[Number(d[10])];
};

// ---------- the DB-access approach, unchanged from verify-007-settlement.mjs ----------
const psql = (sql) =>
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'guardian', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();

let pass = 0,
  fail = 0;
const ok = (c, label, extra = '') =>
  c
    ? (pass++, console.log(`  ✅ ${label}${extra && ' — ' + extra}`))
    : (fail++, console.log(`  ❌ ${label}${extra && ' — ' + extra}`));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- pick the forcing mode ----------
const mode = process.argv.includes('--bad-model') ? 'bad-model' : 'timeout';
console.log(`forcing mode: ${mode}`);

// ---------- the agent whose CURRENT version is about to be pinned ----------
const agents = await api('/agents');
const agent = agents.body?.[0];
if (!agent) {
  console.log('\nNo agents listed. Seed the catalogue first (006 quickstart §1).');
  process.exit(1);
}
console.log(`agent    ${agent.name} (${agent.id}) at ${agent.priceMinor}¢`);

// Agent has deliberately no `current_version` column — it is MAX(version)
// (agent.entity.ts), the same version purchase.service.ts pins.
const [versionId, originalModel, originalTimeoutRaw] = psql(
  `SELECT id, model, timeout_seconds FROM agent_versions WHERE agent_id='${agent.id}' ORDER BY version DESC LIMIT 1`,
).split('|');
const originalTimeout = Number(originalTimeoutRaw);
console.log(`version  ${versionId} (model=${originalModel} timeout_seconds=${originalTimeout})`);

let applied = false;

try {
  // ---------- force it ----------
  if (mode === 'timeout') {
    psql(`UPDATE agent_versions SET timeout_seconds=1 WHERE id='${versionId}'`);
    applied = true;
    console.log(`forced:   agent_versions(${versionId}).timeout_seconds ${originalTimeout} → 1`);
  } else {
    const badModel = 'no-such-model-guardian-008-verify';
    psql(`UPDATE agent_versions SET model='${badModel}' WHERE id='${versionId}'`);
    applied = true;
    console.log(`forced:   agent_versions(${versionId}).model '${originalModel}' → '${badModel}'`);
  }

  // ---------- buy against the poisoned version ----------
  const buyer = await signIn();
  const top = await api('/topup', {
    method: 'POST',
    body: { amountMinor: agent.priceMinor * 2 },
    token: buyer.token,
  });
  if (top.status !== 200) {
    console.error('top-up failed', top);
    process.exit(1);
  }

  const detail = await api(`/agents/${agent.id}`);
  const schema = detail.body?.inputSchema ?? {};
  const sampleInput = Object.fromEntries(
    (schema.required ?? Object.keys(schema.properties ?? {})).map((k) => [
      k,
      schema.properties?.[k]?.type === 'number' ? 1 : 'forced non-delivery run',
    ]),
  );

  const order = await api('/orders', {
    method: 'POST',
    token: buyer.token,
    body: {
      agentId: agent.id,
      input: sampleInput,
      acceptanceCriteria: 'this run must never deliver — forced by verify-008-failure.mjs',
    },
  });
  if (order.status !== 201) {
    console.error('purchase failed', order);
    process.exit(1);
  }
  const ORDER = order.body.id;
  console.log(`order    ${ORDER}`);

  // ---------- wait for the poller to claim it and the runner to give up ----------
  const pollIntervalMs = Number(env.EXECUTION_POLL_INTERVAL_MS) || 1000;
  const deadline = Date.now() + Math.max(30_000, pollIntervalMs * 5 + 15_000);
  let state = 'purchased';
  while (Date.now() < deadline) {
    state = psql(`SELECT state FROM orders WHERE id='${ORDER}'`);
    if (state === 'failed' || state === 'delivered') break;
    await sleep(400);
  }

  h('§4/§4a — a forced crash lands as non-delivery, not a swallowed error');

  // 1. the order reaches failed
  ok(state === 'failed', 'order reaches state=failed', `got ${state}`);

  // 2. output IS NULL — raw SQL NULL, not '{}' and not a JSON string
  const [outputIsNull, outputText] = psql(
    `SELECT output IS NULL, output::text FROM runs WHERE order_id='${ORDER}'`,
  ).split('|');
  ok(
    outputIsNull === 't',
    'runs.output IS NULL (SQL NULL, not JSON null)',
    `output IS NULL → ${outputIsNull}, output::text → ${JSON.stringify(outputText)}`,
  );
  ok(outputText === '', 'output::text is empty — not \'{}\', not a JSON string', `got ${JSON.stringify(outputText)}`);

  // 3. output_valid IS NULL, never false
  const [outputValidIsNull, outputValidRaw] = psql(
    `SELECT output_valid IS NULL, output_valid FROM runs WHERE order_id='${ORDER}'`,
  ).split('|');
  ok(
    outputValidIsNull === 't' && outputValidRaw === '',
    'output_valid IS NULL — there was no output to check',
    `IS NULL → ${outputValidIsNull}, raw → ${JSON.stringify(outputValidRaw)}`,
  );

  // 4. error is non-null and non-empty
  const errorText = psql(`SELECT error FROM runs WHERE order_id='${ORDER}'`);
  ok(errorText.trim().length > 0, 'error is set and non-empty', `${JSON.stringify(errorText).slice(0, 160)}`);

  // 5. finished_at is set and duration_ms is a number
  const [finishedIsSet, durationRaw] = psql(
    `SELECT finished_at IS NOT NULL, duration_ms FROM runs WHERE order_id='${ORDER}'`,
  ).split('|');
  ok(finishedIsSet === 't', 'finished_at is set');
  ok(Number.isFinite(Number(durationRaw)), 'duration_ms is a number', `got ${JSON.stringify(durationRaw)}`);

  // 6. steps has at least 2 elements and the LAST one is kind=error
  const stepsLen = Number(psql(`SELECT jsonb_array_length(steps) FROM runs WHERE order_id='${ORDER}'`));
  const lastKind = psql(
    `SELECT steps->(jsonb_array_length(steps)-1)->>'kind' FROM runs WHERE order_id='${ORDER}'`,
  );
  ok(stepsLen >= 2, 'steps has at least 2 elements', `got ${stepsLen}`);
  ok(lastKind === 'error', 'the LAST step has kind=error', `got ${JSON.stringify(lastKind)}`);

  // 7. onchain_deal_id is still set — the failure must not clear it
  const [orderState, dealId] = psql(`SELECT state, onchain_deal_id FROM orders WHERE id='${ORDER}'`).split('|');
  ok(
    dealId !== '' && dealId !== null,
    'onchain_deal_id is still set on the failed order (escrow-exposure.repository.ts relies on this)',
    `state=${orderState} onchain_deal_id=${dealId}`,
  );

  // 8. the escrow deal was NEVER marked delivered on-chain
  if (dealId) {
    const chainState = await dealState(dealId);
    ok(
      chainState === 'Open',
      'the escrow deal is still Open on-chain — markDelivered was never called',
      `got ${chainState}`,
    );
    console.log(
      `  MANUAL CHECK: cast call ${env.ESCROW_CONTRACT_ADDRESS} "deals(uint256)" ${dealId} --rpc-url ${env.MONAD_RPC_URL}`,
    );
  } else {
    fail++;
    console.log('  ❌ cannot read chain state — no onchain_deal_id to check');
  }
} finally {
  // ---------- restore what was changed, no matter what happened above ----------
  if (applied) {
    if (mode === 'timeout') {
      psql(`UPDATE agent_versions SET timeout_seconds=${originalTimeout} WHERE id='${versionId}'`);
      console.log(`restored: agent_versions(${versionId}).timeout_seconds → ${originalTimeout}`);
    } else {
      psql(`UPDATE agent_versions SET model='${originalModel}' WHERE id='${versionId}'`);
      console.log(`restored: agent_versions(${versionId}).model → '${originalModel}'`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

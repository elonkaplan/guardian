/**
 * quickstart.md §4 — the forced chain failure, which `verify-007.mjs` cannot
 * cover because it needs the API restarted against a dead RPC host.
 *
 *   # 1. fund a wallet while the chain still works
 *   node scripts/verify-007-failure.mjs fund
 *
 *   # 2. restart the API pointed at a dead port
 *   MONAD_RPC_URL=http://127.0.0.1:9 POSTGRES_HOST_PORT=5433 docker compose up -d api
 *
 *   # 3. buy, and check the buyer is left whole
 *   node scripts/verify-007-failure.mjs check <token> <agentId> <priceMinor>
 *
 *   # 4. restore
 *   POSTGRES_HOST_PORT=5433 docker compose up -d api
 *
 * This is the branch that cannot be reached by using the product normally, and
 * it is the one the source brief names as an acceptance criterion: *"a forced
 * chain failure leaves the buyer's balance whole."*
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const API = 'http://localhost:3000';

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

let pass = 0,
  fail = 0;
const ok = (c, label, extra = '') =>
  c
    ? (pass++, console.log(`  ✅ ${label}${extra && ' — ' + extra}`))
    : (fail++, console.log(`  ❌ ${label}${extra && ' — ' + extra}`));

const [mode, ...rest] = process.argv.slice(2);

if (mode === 'fund') {
  const acct = privateKeyToAccount(generatePrivateKey());
  const nonce = await api('/auth/nonce', { method: 'POST', body: { address: acct.address } });
  const signature = await acct.signMessage({ message: nonce.body.message });
  const { body } = await api('/auth/verify', {
    method: 'POST',
    body: { address: acct.address, signature },
  });

  const agents = await api('/agents');
  const agent = agents.body[0];

  const top = await api('/topup', {
    method: 'POST',
    body: { amountMinor: agent.priceMinor * 2 },
    token: body.token,
  });
  if (top.status !== 200) {
    console.error('top-up failed', top);
    process.exit(1);
  }

  console.log(`${body.token} ${agent.id} ${agent.priceMinor}`);
  process.exit(0);
}

if (mode !== 'check') {
  console.error('usage: fund | check <token> <agentId> <priceMinor>');
  process.exit(1);
}

const [token, agentId, priceRaw] = rest;
const price = Number(priceRaw);

const detail = await api(`/agents/${agentId}`);
const schema = detail.body?.inputSchema ?? {};
const sampleInput = Object.fromEntries(
  (schema.required ?? Object.keys(schema.properties ?? {})).map((k) => [
    k,
    schema.properties?.[k]?.type === 'number' ? 1 : 'forced failure run',
  ]),
);

console.log('\n§4 — a forced chain failure leaves the buyer whole');

const before = await api('/me', { token });
const ledgerBefore = (await api('/me/ledger', { token })).body;
console.log(
  `  before: available=${before.body.availableBalanceMinor} inEscrow=${before.body.inEscrowMinor} entries=${ledgerBefore.length}`,
);

const attempt = await api('/orders', {
  method: 'POST',
  token,
  body: { agentId, input: sampleInput, acceptanceCriteria: 'this purchase must fail' },
});

// F1 — the caller is told it did not complete.
ok(
  attempt.status === 502,
  'F1 POST /orders → 502, saying the purchase did not complete',
  `got ${attempt.status} ${JSON.stringify(attempt.body).slice(0, 200)}`,
);

const after = await api('/me', { token });

// F2 — SC-002, the headline criterion.
ok(
  after.body.availableBalanceMinor === before.body.availableBalanceMinor,
  'F2 availableBalanceMinor is byte-identical to before (SC-002)',
  `${before.body.availableBalanceMinor} → ${after.body.availableBalanceMinor}`,
);

// F3 — the check most likely to fail on a first implementation.
ok(
  after.body.inEscrowMinor === before.body.inEscrowMinor,
  'F3 inEscrowMinor unchanged — the failed order contributes nothing (FR-020)',
  `${before.body.inEscrowMinor} → ${after.body.inEscrowMinor}`,
);

const ledgerAfter = (await api('/me/ledger', { token })).body;
const added = ledgerAfter.slice(0, ledgerAfter.length - ledgerBefore.length);

ok(added.length === 2, 'F4 exactly two new ledger entries', `got ${added.length}`);
ok(
  added.some((e) => e.kind === 'purchase' && e.amountMinor === -price),
  'F5 the original debit is still there (append-only, never rewritten)',
);
ok(
  added.some((e) => e.kind === 'adjustment' && e.amountMinor === price),
  'F4 a compensating adjustment of exactly the price',
);
ok(
  added.every((e) => typeof e.orderId === 'string'),
  'F4 both entries carry the order id',
);

const orders = (await api('/orders', { token })).body;
const failed = orders.find((o) => o.state === 'failed');
ok(Boolean(failed), 'F6/F7 the failed order exists and IS listed to the buyer');

if (failed) {
  const acc = await api(`/orders/${failed.id}/accept`, { method: 'POST', token });
  ok(acc.status === 409, 'F8 accept on it → 409 (nothing escrowed to settle)', `got ${acc.status}`);
  const comp = await api(`/orders/${failed.id}/complain`, {
    method: 'POST',
    token,
    body: { reason: 'nothing happened' },
  });
  ok(
    comp.status === 409,
    'F8/T5 complain on it → 409 — no deal id, nothing to dispute',
    `got ${comp.status}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

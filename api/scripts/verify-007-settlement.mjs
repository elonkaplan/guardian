/**
 * quickstart.md §6, §9 and §10 — accept, complain, and Act 3.
 *
 *   node scripts/verify-007-settlement.mjs
 *
 * ⚠️ SPENDS REAL TESTNET FUNDS: one agent registration and three deals.
 *
 * All three need a `delivered` order, and execution (API-08) does not exist —
 * so this script stands in for it, exactly as far as it must and no further:
 *
 *   - it calls `markDelivered` **on-chain with the operator key**, which is what
 *     API-08 will do when a run succeeds;
 *   - it sets `orders.state` and `delivered_at` **in Postgres** via psql.
 *
 * ⚠️ It does NOT write a `runs` row. `runs.output IS NULL` is the non-delivery
 * evidence (invariant #7), and inventing a run here would put a fake one in the
 * evidence table for every rehearsal.
 *
 * ## The one that matters most
 *
 * §10 is Act 3 — the demo's closing act. A crashed agent leaves the order
 * `failed` and its deal still `Open` on-chain, and the escrow refuses `dispute`
 * against a deal never marked delivered. The complaint path must therefore mark
 * it delivered and dispute it as one action. This script sets up that exact
 * state by moving ONLY the database row and leaving the chain alone — which is
 * precisely what a crash produces.
 */
import { createPublicClient, createWalletClient, http } from 'viem';
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
const operator = createWalletClient({
  account: privateKeyToAccount(env.OPERATOR_PRIVATE_KEY),
  chain,
  transport: http(env.MONAD_RPC_URL),
});

const abi = [
  { type: 'function', name: 'markDelivered', stateMutability: 'nonpayable', inputs: [{ name: 'dealId', type: 'uint256' }], outputs: [] },
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
  const d = await pub.readContract({ address: env.ESCROW_CONTRACT_ADDRESS, abi, functionName: 'deals', args: [BigInt(id)] });
  return DEAL_STATE[Number(d[10])];
};

const markDeliveredOnChain = async (id) => {
  const hash = await operator.writeContract({
    address: env.ESCROW_CONTRACT_ADDRESS,
    abi,
    functionName: 'markDelivered',
    args: [BigInt(id)],
    gas: 200_000n,
  });
  await pub.waitForTransactionReceipt({ hash });
};

const psql = (sql) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'guardian', '-tAc', sql], {
    encoding: 'utf8',
  }).trim();

let pass = 0,
  fail = 0;
const ok = (c, label, extra = '') =>
  c ? (pass++, console.log(`  ✅ ${label}${extra && ' — ' + extra}`)) : (fail++, console.log(`  ❌ ${label}${extra && ' — ' + extra}`));
const h = (s) => console.log(`\n${s}`);

const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
  const verify = await api('/auth/verify', { method: 'POST', body: { address: acct.address, signature } });
  return { acct, token: verify.body.token };
};

const seller = await signIn();
const buyer = await signIn();

const agent = await api('/agents', {
  method: 'POST',
  token: seller.token,
  body: {
    name: 'SettleBot 007',
    description: 'Exists to verify accept, complain and Act 3.',
    capabilities: ['Echoes text.'],
    exclusions: ['No images.'],
    priceMinor: 100,
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    outputSchema: { type: 'object', properties: { echoed: { type: 'string' } }, required: ['echoed'] },
    systemPrompt: 'You echo text.',
    model: 'claude-haiku-4-5',
    timeoutSeconds: 60,
  },
});
const AGENT = agent.body?.id;
console.log(`agent ${AGENT} on-chain #${agent.body?.onchainAgentId}`);

await api('/topup', { method: 'POST', body: { amountMinor: 400 }, token: buyer.token });

const buy = async (criteria) => {
  const r = await api('/orders', { method: 'POST', token: buyer.token, body: { agentId: AGENT, input: { text: 'hi' }, acceptanceCriteria: criteria } });
  if (r.status !== 201) throw new Error(`purchase failed: ${r.status} ${JSON.stringify(r.body)}`);
  const dealId = psql(`SELECT onchain_deal_id FROM orders WHERE id='${r.body.id}'`);
  return { id: r.body.id, dealId };
};

const A = await buy('accept me');
const B = await buy('complain about me');
const C = await buy('crash on me');
console.log(`orders A=${A.id.slice(0, 8)} (deal ${A.dealId})  B=${B.id.slice(0, 8)} (deal ${B.dealId})  C=${C.id.slice(0, 8)} (deal ${C.dealId})`);

// ---------- §6 accept ----------
h('§6 — the buyer accepts early (A1-A6)');
await markDeliveredOnChain(A.dealId);
psql(`UPDATE orders SET state='delivered', delivered_at=now() WHERE id='${A.id}'`);

const ledgerBefore = Number(psql(`SELECT count(*) FROM ledger_entries WHERE account_id=(SELECT buyer_account_id FROM orders WHERE id='${A.id}')`));
const meBefore = await api('/me', { token: buyer.token });

const acc = await api(`/orders/${A.id}/accept`, { method: 'POST', token: buyer.token });
ok(acc.status === 202, 'A1 POST accept → 202', `got ${acc.status} ${JSON.stringify(acc.body).slice(0, 160)}`);
ok(psql(`SELECT state FROM orders WHERE id='${A.id}'`) === 'released', 'A2 order state is released', psql(`SELECT state FROM orders WHERE id='${A.id}'`));
ok(psql(`SELECT settled_at IS NOT NULL FROM orders WHERE id='${A.id}'`) === 't', 'A2 settled_at is set');
ok((await dealState(A.dealId)) === 'Settled', 'A2 the escrow deal is Settled on-chain');

const ledgerAfter = Number(psql(`SELECT count(*) FROM ledger_entries WHERE account_id=(SELECT buyer_account_id FROM orders WHERE id='${A.id}')`));
ok(ledgerAfter === ledgerBefore, 'A3 NO ledger entry was written (invariant #5)', `${ledgerBefore} → ${ledgerAfter}`);

const meAfter = await api('/me', { token: buyer.token });
ok(meBefore.body.inEscrowMinor - meAfter.body.inEscrowMinor === 100, 'A5 inEscrowMinor fell by the price', `${meBefore.body.inEscrowMinor} → ${meAfter.body.inEscrowMinor}`);

const accAgain = await api(`/orders/${A.id}/accept`, { method: 'POST', token: buyer.token });
ok(accAgain.status === 409, 'A6 accepting again → 409', `got ${accAgain.status}`);

// ---------- §9 complain ----------
h('§9 — the buyer complains inside the window (D1-D5, D8)');
await markDeliveredOnChain(B.dealId);
psql(`UPDATE orders SET state='delivered', delivered_at=now() WHERE id='${B.id}'`);

const comp = await api(`/orders/${B.id}/complain`, { method: 'POST', token: buyer.token, body: { reason: 'The total is wrong and two line items are missing.' } });
ok(comp.status === 202, 'D1 POST complain → 202', `got ${comp.status} ${JSON.stringify(comp.body).slice(0, 160)}`);
ok(psql(`SELECT state FROM orders WHERE id='${B.id}'`) === 'disputed', 'D2 order state is disputed');
ok(psql(`SELECT disputed_at IS NOT NULL FROM orders WHERE id='${B.id}'`) === 't', 'D2 disputed_at is set');
ok(psql(`SELECT count(*) FROM complaints WHERE order_id='${B.id}'`) === '1', 'D3 exactly one complaint row');
ok(psql(`SELECT reason FROM complaints WHERE order_id='${B.id}'`).includes('two line items'), 'D3 the reason is stored verbatim');
ok((await dealState(B.dealId)) === 'Disputed', 'D4 the escrow deal is Disputed on-chain');

const compAgain = await api(`/orders/${B.id}/complain`, { method: 'POST', token: buyer.token, body: { reason: 'actually something else' } });
ok(compAgain.status === 409, 'D5 complaining again → 409', `got ${compAgain.status}`);
ok(psql(`SELECT count(*) FROM complaints WHERE order_id='${B.id}'`) === '1', 'D5 still exactly one complaint');

const sales = await api('/sales', { token: seller.token });
const saleB = sales.body.find((s) => s.id === B.id);
ok(saleB?.state === 'disputed' && saleB?.disputedAt !== null, 'D8 the seller sees it as disputed in GET /sales — their only notification');

// ---------- §10 Act 3 ----------
h('§10 — ACT 3: complaining about an order that produced nothing (T1-T5)');
// A crash moves ONLY the database row. The deal stays Open on-chain, because
// nothing ever called markDelivered — which is exactly why the escrow would
// refuse a plain `dispute` against it.
psql(`UPDATE orders SET state='failed' WHERE id='${C.id}'`);
ok((await dealState(C.dealId)) === 'Open', 'setup: the crashed order\'s deal is still Open on-chain');
ok(psql(`SELECT onchain_deal_id IS NOT NULL FROM orders WHERE id='${C.id}'`) === 't', 'setup: it HAS a deal id (unlike a compensated purchase)');

const act3 = await api(`/orders/${C.id}/complain`, { method: 'POST', token: buyer.token, body: { reason: 'The agent returned nothing at all.' } });
ok(act3.status === 202, 'T1 complain on a failed order → 202, NOT 409', `got ${act3.status} ${JSON.stringify(act3.body).slice(0, 200)}`);
ok((await dealState(C.dealId)) === 'Disputed', 'T2 the deal reached Disputed on-chain (markDelivered then dispute)');
ok(psql(`SELECT state FROM orders WHERE id='${C.id}'`) === 'disputed', 'T4 order state is disputed');
ok(psql(`SELECT count(*) FROM complaints WHERE order_id='${C.id}'`) === '1', 'T4 the complaint was recorded');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

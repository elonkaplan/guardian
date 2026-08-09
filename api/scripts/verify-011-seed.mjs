/**
 * Acceptance run for specs/011-demo-seed-fixtures/quickstart.md §1 and §13 —
 * seeding, idempotency, the public catalogue, and the disclosure boundary.
 *
 *   node scripts/verify-011-seed.mjs
 *
 * ⚠️ THE FIRST RUN AGAINST AN UNSEEDED DATABASE MINTS THREE ON-CHAIN AGENTS
 * from the operator key. That is irreversible — `registerAgent` mints a new id
 * on every call and there is no unregister. Re-running afterwards is free: the
 * seed is idempotent by name within the demo seller's own listings, which is
 * what the second half of this script asserts.
 *
 * Writes the seed response to scripts/.011-seed.json for the other 011 scripts
 * to read, so every act posts back the SAME `input` object that was published
 * rather than a retyped one. Retyping is the single most likely way to break
 * fixture determinism (quickstart §0).
 *
 * Covers T019 (partly — the purchases are in verify-011-fixtures.mjs), T020 and
 * the structural + live halves of T052.
 */
import { writeFileSync } from 'node:fs';
import { api, h, note, ok, psql, seed, summary } from './verify-011-lib.mjs';

// The seller's operating instructions, as three distinctive substrings. If any
// of these reaches a response body, FR-010 is broken.
const PROMPT_FRAGMENTS = [
  'You extract line items',
  'You summarise documents',
  'You translate text',
];

const agentsBefore = psql('SELECT count(*) FROM agents');
note(`agents before: ${agentsBefore}`);

// ---------- §1 the seed itself ----------
h('§1 — seeding (FR-005, FR-006, FR-007 · SC-010)');

const first = await seed();
ok(first.status === 200, 'POST /demo/seed → 200 (not 201: usually creates nothing)', `got ${first.status} ${String(first.text).slice(0, 300)}`);

if (first.status !== 200) {
  summary();
  process.exit(1);
}

const body = first.body;
writeFileSync(new URL('./.011-seed.json', import.meta.url), JSON.stringify(body, null, 2));

ok(Array.isArray(body.agents) && body.agents.length === 3, 'three agents in the response', `got ${body.agents?.length}`);
ok(typeof body.seller?.walletAddress === 'string', 'the response names the demo seller', JSON.stringify(body.seller));

for (const a of body.agents ?? []) {
  ok(
    typeof a.onchainAgentId === 'number' && Number.isFinite(a.onchainAgentId),
    `${a.name}: onchainAgentId is a number, never null`,
    `got ${JSON.stringify(a.onchainAgentId)}`,
  );
}
note(`seeded: ${(body.agents ?? []).map((a) => `${a.name}#${a.onchainAgentId}${a.created ? ' (created)' : ''}`).join(', ')}`);

ok(Array.isArray(body.fixtures) && body.fixtures.length === 3, 'three fixtures in the response (FR-028)', `got ${body.fixtures?.length}`);
for (const f of body.fixtures ?? []) {
  ok(typeof f.agentId === 'string' && f.agentId.length > 0, `act ${f.act}: fixture carries a resolved agentId`);
  ok(f.input && typeof f.input === 'object', `act ${f.act}: fixture carries its input verbatim`);
  ok(typeof f.acceptanceCriteria === 'string' && f.acceptanceCriteria.length > 0, `act ${f.act}: fixture carries its acceptance criteria`);
  ok(typeof f.complaint === 'string' && f.complaint.length > 0, `act ${f.act}: fixture carries its complaint`);
}

// ---------- §1 the public catalogue is the real check ----------
h('§1 — the PUBLIC catalogue, which is the real check (a NULL on-chain id hides the row)');

const cat = await api('/agents');
const byName = Object.fromEntries((cat.body ?? []).map((a) => [a.name, a]));

for (const [name, price] of [['LedgerBot', 200], ['TLDR Agent', 100], ['PolyglotAI', 150]]) {
  const seeded = (body.agents ?? []).find((a) => a.name === name);
  const listed = (cat.body ?? []).find((a) => a.id === seeded?.agentId);
  ok(listed !== undefined, `${name} is visible in GET /agents`, 'absent means its onchain_agent_id is NULL');
  ok(listed?.priceMinor === price, `${name} is priced ${price}`, `got ${listed?.priceMinor}`);
}
void byName;

// ---------- §1 idempotency ----------
h('§1 — idempotency (FR-007 · SC-010)');

const second = await seed();
ok(second.status === 200, 're-seed → 200', `got ${second.status}`);
ok(
  (second.body?.agents ?? []).every((a) => a.created === false),
  're-seed reports created: false for all three',
  JSON.stringify((second.body?.agents ?? []).map((a) => a.created)),
);
ok(second.body?.agents?.length === 3, 're-seed still reports exactly 3 agents', `got ${second.body?.agents?.length}`);

const sellerId = body.seller.accountId;
const ownedAgents = psql(`SELECT count(*) FROM agents WHERE owner_account_id='${sellerId}'`);
ok(ownedAgents === '3', 'the demo seller owns exactly 3 agents, not 6', `count=${ownedAgents}`);

const ownedVersions = psql(
  `SELECT count(*) FROM agent_versions av JOIN agents a ON a.id=av.agent_id WHERE a.owner_account_id='${sellerId}'`,
);
ok(ownedVersions === '3', 'exactly 3 agent_versions for the seeded agents', `count=${ownedVersions}`);

const sameIds =
  JSON.stringify((body.agents ?? []).map((a) => a.agentId).sort()) ===
  JSON.stringify((second.body?.agents ?? []).map((a) => a.agentId).sort());
ok(sameIds, 're-seed returns the SAME agent ids (no second listing)');

// ---------- §13 the disclosure boundary ----------
h('§13 — the disclosure boundary (FR-010 · SC-011)');

const seedText = JSON.stringify(first.body) + JSON.stringify(second.body);
for (const frag of PROMPT_FRAGMENTS) {
  ok(!seedText.includes(frag), `seed response does not leak "${frag.slice(0, 24)}…"`);
}
ok(!/systemPrompt/i.test(seedText), 'seed response has no systemPrompt field at all');

for (const a of body.agents ?? []) {
  const detail = await api(`/agents/${a.agentId}`);
  ok(
    detail.body !== null && !Object.prototype.hasOwnProperty.call(detail.body, 'systemPrompt'),
    `GET /agents/${a.name} has no systemPrompt key`,
  );
  const text = JSON.stringify(detail.body);
  ok(
    !PROMPT_FRAGMENTS.some((f) => text.includes(f)),
    `GET /agents/${a.name} leaks no prompt text`,
  );
}

// The stored definition MUST still hold the prompt — the boundary is the
// response shape, not the data. A missing prompt here would mean the agents
// were published without operating instructions at all.
const promptsStored = psql(
  `SELECT count(*) FROM agent_versions av JOIN agents a ON a.id=av.agent_id ` +
    `WHERE a.owner_account_id='${sellerId}' AND av.system_prompt IS NOT NULL AND av.system_prompt <> ''`,
);
ok(promptsStored === '3', 'all three prompts ARE stored — the boundary is the response, not the data', `count=${promptsStored}`);

process.exit(summary() === 0 ? 0 : 1);

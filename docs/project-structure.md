# Guardian — Project Structure & Toolchain

> **DRAFT for review.** Nothing scaffolded yet.

**Last updated**: 2026-08-08
**Companion docs**: [api-design.md](./api-design.md) · [ui-design.md](./ui-design.md) ·
[smart-contract.md](./smart-contract.md) · [tech-stack.md](./tech-stack.md)

---

## Contents

- [1. Four things from the Monad docs that change the setup](#1-four-things-from-the-monad-docs-that-change-the-setup)
- [2. Repository layout](#2-repository-layout)
- [3. Docker Compose](#3-docker-compose)
  - [3.3 Migrations are a separate step](#33-migrations-are-a-separate-step)
- [4. `sc/` — Foundry and deployment](#4-sc--foundry-and-deployment)
- [5. viem](#5-viem)
- [6. Bootstrap order](#6-bootstrap-order)
- [7. Decisions](#7-decisions)

---

## 1. Four things from the Monad docs that change the setup

Read before scaffolding — each one is cheaper to get right now than to discover.

### 1.1 ⚠️ Gas: you are charged the **limit**, not the usage

> *"the gas limit is what is charged. Total tokens deducted = `value + gas_price * gas_limit`"*

This is the biggest departure from Ethereum, and it silently punishes the default
tooling behaviour: most libraries estimate gas and then add a safety buffer — on
Monad that buffer is **money spent**, not headroom.

**What we do:** set explicit gas limits on the operator's repeated calls
(`openDeal`, `markDelivered`, `release`) once we've measured them, rather than
letting viem estimate-and-pad on every transaction. It matters because the sweeper
and the operator fire constantly during a demo, and the funder's MON is finite.

### 1.2 Use the **Monad Foundry fork**, not upstream Foundry

The docs specify a fork that "incorporates Monad gas pricing and precompiles."
Upstream Foundry will mis-price gas locally — which, given §1.1, is exactly the
thing we can't afford to guess at.

**Now measured, on the real escrow deploy.** The fork submits the simulated gas as the
transaction's limit **with no padding**: limit 2,406,060 against gas used 2,406,060,
identical to the unit, and the deployer's balance fell by exactly `gas × price`
(0.2594 MON at 107.8 gwei). Upstream's `--gas-estimate-multiplier` defaults to 130, and
under §1.1 that 30% is spent rather than reserved — so the wrong toolchain is a standing
~30% tax on every transaction, silently, with no error to notice. That is the concrete
cost of the trap in the next paragraph.

**How to tell which one you have:** the fork installs to `~/.foundry/bin` — the *same*
path as upstream, with the same binary names and no `forge-monad`. Nothing announces the
swap. `forge --version` must contain `-monad-` (e.g. `1.7.1-monad-v1.0.0`); that string
is the only reliable discriminator.

One residual: the `Estimated amount required` figure printed before broadcasting is
quoted at a conservative gas price and runs roughly double the actual charge. It's a
funding check, not a bill.

Hardhat isn't mentioned in Monad's tooling docs at all. **Foundry it is**, even
though the rest of the stack is TypeScript.

### 1.3 ✅ viem must be **≥ 2.40.0**

Monad's docs name this version floor explicitly. Pin it in both `api/` and `ui/`.
Good news for the choice of viem — it's the client library Monad calls out.

### 1.4 ℹ️ Contract verification — noted, not doing it

Monad's docs reference a verification guide and a MonadVision verification tool,
which doesn't match what we were told in person. **Decided: not needed for the MVP.**

Recorded only so the trade-off is a choice rather than an oversight — an unverified
contract means a judge clicking the verdict card's transaction hash sees that money
moved, but can't read the escrow code that moved it. Mitigation is already in the
plan: the Solidity is in `sc/`, and the UI can show the relevant function next to the
hash.

**Other Monad facts, none of which constrain us:** 300ms blocks (matches the
sub-second finality we were told), 128 KB max contract size (we're nowhere near),
minimum base fee 100 MON-gwei, EIP-4844 blob transactions unsupported (we don't use
them), higher cold-access costs (irrelevant at our scale).

---

## 2. Repository layout

```
guardian/
├── api/                        NestJS + TypeORM
│   ├── src/
│   │   ├── auth/  accounts/  catalog/  orders/
│   │   ├── execution/          runs seller agents (Claude)
│   │   ├── guardian/           the audit engine (Claude)
│   │   ├── chain/              viem adapter — the ONLY cents↔base-units boundary
│   │   ├── funding/            funder wallet ↔ operator pool
│   │   ├── rain/               stubbed: logs the calls it would make
│   │   └── jobs/               sweeper · reclaimer · reaper
│   ├── docker-compose.yml      api + postgres
│   ├── Dockerfile
│   └── package.json
│
├── ui/                         React + TypeScript + Vite
│   ├── src/
│   │   ├── pages/              connect · marketplace · agent · order · wallet · sell
│   │   ├── components/         verdict card · countdown · case file
│   │   ├── api/                typed client
│   │   └── chain/              viem + wagmi — wallet connect only
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── package.json
│
├── sc/                         Foundry (Monad fork)
│   ├── src/GuardianEscrow.sol
│   ├── script/Deploy.s.sol
│   ├── test/
│   ├── foundry.toml
│   └── README.md               ← deploy runbook
│
├── docs/                       everything designed so far
├── .env  .env.example  .gitignore
└── README.md
```

**Why `sc/` carries its own README.** It's the only part of the stack that isn't
TypeScript, it's the part you touch least often, and it's the part where a forgotten
step costs the most (redeploy → new address → update `.env` → restart the API).
A runbook beats remembering.

---

## 3. Docker Compose

Two independent stacks, as requested.

### 3.1 `api/docker-compose.yml` — API + Postgres

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: guardian
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 3s
      retries: 10

  migrate:
    build: .
    env_file: ../.env
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/guardian
    command: ["npm", "run", "migration:run"]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    build: .
    env_file: ../.env
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/guardian
    ports: ["3000:3000"]
    depends_on:
      postgres: { condition: service_healthy }
      migrate:  { condition: service_completed_successfully }
    volumes: ["./src:/app/src"]        # hot reload

volumes:
  pgdata:
```

Two deliberate details:

**`env_file: ../.env`** — one env file at the repo root, shared by everything. Keys
and chain config live in exactly one place, and `.gitignore` already covers it.

**`DATABASE_URL` is overridden in-compose** — inside the network the host is
`postgres`, not `localhost`. The root `.env` value is for running the API outside
Docker. This is the single most common "works on my machine" trap with this setup.

**The healthcheck matters more than it looks.** Without it the API starts before
Postgres accepts connections, the first query fails, and the container exits — a
confusing failure that looks like a code bug.

### 3.3 Migrations are a separate step

TypeORM migrations, run by a one-shot `migrate` service that exits; the API waits on
`service_completed_successfully`. So `docker compose up` is still one command, but
schema changes are an explicit, reviewable artifact rather than something that
happens invisibly at boot.

**`synchronize: false` in the TypeORM config is what makes this real.** Left `true`,
TypeORM silently reshapes the schema to match the entities and the migrations become
decoration — you'd have both mechanisms fighting, and the one that wins is the one
you didn't write.

```jsonc
// api/package.json
"scripts": {
  "migration:generate": "typeorm-ts-node-commonjs migration:generate -d src/data-source.ts",
  "migration:run":      "typeorm-ts-node-commonjs migration:run      -d src/data-source.ts",
  "migration:revert":   "typeorm-ts-node-commonjs migration:revert   -d src/data-source.ts"
}
```

Generate the first migration from the DDL in
[database-schema.md](./database-schema.md) §8 rather than from entity inference — the
enums, partial constraints, and `lower(wallet_address)` unique index are all easier
to write directly than to coax out of decorators.

### 3.2 `ui/docker-compose.yml` — frontend

```yaml
services:
  ui:
    build: .
    env_file: ../.env
    environment:
      VITE_API_URL: http://localhost:3000
    ports: ["5173:5173"]
    volumes: ["./src:/app/src"]
```

**Worth knowing:** for day-to-day iteration `npm run dev` in `ui/` is faster than
the container — Vite's hot reload through a Docker volume mount is noticeably
laggier, especially on macOS. The compose file is there for a clean one-command
start; don't feel obliged to develop inside it.

**Only `VITE_`-prefixed vars reach the browser.** That's a Vite rule and it's a
useful one: it means a stray `OPERATOR_PRIVATE_KEY` in the root `.env` *cannot*
leak into the bundle by accident.

---

## 4. `sc/` — Foundry and deployment

### 4.1 `foundry.toml`

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
monad_testnet = "${MONAD_RPC_URL}"
```

### 4.2 `script/Deploy.s.sol`

Deploys the escrow and wires the two roles from env:

```solidity
contract Deploy is Script {
    function run() external {
        uint256 pk       = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address token    = vm.envOr("USDC_ADDRESS",     address(0));
        address operator = vm.envOr("OPERATOR_ADDRESS", address(0));
        address guardian = vm.envOr("GUARDIAN_ADDRESS", address(0));
        _requireAllSet(pk, token, operator, guardian);  // names every bad one at once

        vm.startBroadcast(pk);
        GuardianEscrow escrow = new GuardianEscrow(
            IERC20(token), vm.addr(pk), operator, guardian
        );
        vm.stopBroadcast();

        console2.log(string.concat(
            "ESCROW_CONTRACT_ADDRESS=", vm.toString(address(escrow))
        ));
    }
}
```

**Why `vm.envOr` and not `vm.envUint` / `vm.envAddress`:** the direct accessors abort
on the *first* bad value and say nothing about the rest, so a reader with three blank
fields discovers them one deploy attempt at a time. `vm.envOr` doesn't abort — it
returns the default for both missing *and* malformed values, which is the only way the
script gets to see all four before deciding to stop. The tradeoff is that it can't tell
"absent" from "malformed", so the revert message says *missing or malformed*; that costs
the reader nothing, since either way the fix is the same line of `.env`.

Printing the address in `.env` format is deliberate — deploy, copy one line, paste.
At 3am that's one less transcription error. The `string.concat` is load-bearing:
`console2.log` joins its arguments with a space, so the comma form emits a space after
the `=`, which is not a format `.env` parses and defeats the whole point of the step.

```
  A_COMMA_STYLE= 0x534b2f3A21130d7a60830c2Df862319e593943A3
  B_CONCAT_STYLE=0x534b2f3A21130d7a60830c2Df862319e593943A3
```

(`forge` indents script logs by two spaces. Select from the `E` of `ESCROW`, not from
column zero — though every dotenv reader in the stack tolerates leading whitespace, so
a sloppy grab still works.)

### 4.3 The deploy runbook

```bash
# 1. Install the Monad Foundry fork (NOT upstream — see §1.2)
#    per docs.monad.xyz

# 2. Fund the deployer with MON from faucet.monad.xyz

# 3. Export the shared .env into this shell — run from sc/, and stay in this shell
set -a; . ../.env; set +a

# 4. Deploy
forge script script/Deploy.s.sol \
  --rpc-url $MONAD_RPC_URL \
  --broadcast

# 5. Paste ESCROW_CONTRACT_ADDRESS into ../.env, then re-run step 3 so the
#    new address is in the shell for step 6

# 6. Approve the escrow to pull from the operator pool  ← easy to forget
cast send $USDC_ADDRESS \
  "approve(address,uint256)" $ESCROW_CONTRACT_ADDRESS <large> \
  --rpc-url $MONAD_RPC_URL --private-key $OPERATOR_PRIVATE_KEY
```

**Step 3 is not optional, and it is the one everybody skips.** Foundry loads `.env`
from the Foundry project root — that's `sc/` — and does *not* walk up to parent
directories. Guardian's `.env` lives at the repository root, shared by `api/`, `ui/`
and `sc/`. So the obvious way to run this, `cd sc && forge script …`, reads **none** of
the configuration and dies on the first `vm.env*` call. There is no `--env-file` flag on
`forge script`. Sourcing into the shell fixes both tools at once — `cast send` in step 6
needs the same values, and a `sc/.env → ../.env` symlink (the other obvious fix) does
nothing for `cast`.

**Private keys need the `0x` prefix** for `vm.envUint`, which rejects bare hex with
`missing hex prefix ("0x")`. `cast --private-key` accepts bare hex quite happily, so the
same key can pass step 6 and fail step 4 — which reads as a broken deploy script rather
than a formatting problem. See `.env.example`.

**Step 6 is the one that bites.** `openDeal` pulls tokens from the operator via
`transferFrom`, which fails without an allowance — and the failure surfaces as a
revert on the *first purchase*, long after deployment appeared to succeed.

### 4.4 Wallets to fund before anything works

| Wallet | Needs | Why |
| --- | --- | --- |
| **Deployer** | MON | One-off contract deployment. **Separate key** — discard after deploy; nothing running needs it. |
| **Funder** | MON + **test USDC** | The source of all money in the system |
| **Operator** | MON | Every `openDeal` / `markDelivered` / `release` |
| **Guardian** | MON | Every `resolve` — **forgotten until the first verdict fails** |

The guardian wallet is the one that gets missed: everything works right up until the
first dispute, then silently fails at settlement.

---

## 5. viem

One library, two very different uses.

### 5.1 Shared chain definition

```ts
import { defineChain } from 'viem'

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' },
  },
})
```

viem ≥ 2.40 may export `monadTestnet` from `viem/chains` — use it if present.
Defining it locally is harmless either way and removes a version dependency.

### 5.2 `api/src/chain/` — server-side signing

Three clients, because there are three keys:

| Client | Key | Used for |
| --- | --- | --- |
| `publicClient` | — | Reads, receipts, `totalEscrowed` |
| `operatorClient` | `OPERATOR_PRIVATE_KEY` | `registerAgent`, `openDeal`, `markDelivered`, `release`, `withdrawFor` |
| `guardianClient` | `GUARDIAN_PRIVATE_KEY` | `resolve` — **nothing else** |

**Keep `guardianClient` in its own module and give it only the `resolve` ABI.** The
role separation from smart-contract §3.5 is only real if the code can't accidentally
sign an `openDeal` with the guardian key. A narrow client makes that a compile error
rather than a code-review question.

This module is also **the only place cents ↔ base units convert** (database-schema
§1.3): `amountMinor * 10n ** 4n` on the way out.

### 5.3 `ui/src/chain/` — wallet connect only

The frontend signs exactly one thing: the auth nonce. Everything else goes through
the operator.

Use **wagmi** (React hooks over viem) for connection state and signing — hand-rolling
connector logic is a poor use of hackathon hours.

**The UI never holds a private key and never calls the escrow contract.** Worth
stating because it's a natural place to over-build.

---

## 6. Bootstrap order

Roughly dependency-ordered; each step is verifiable before the next.

| # | Step | Done when |
| --- | --- | --- |
| 1 | `sc/` — Foundry init, port the draft Solidity, `forge build` | It compiles |
| 2 | Fund the four wallets (§4.4) | Balances visible on MonadVision |
| 3 | Deploy + `approve` (§4.3) | `ESCROW_CONTRACT_ADDRESS` in `.env` |
| 4 | `api/` — Nest scaffold, `migration:generate`, `compose up` | `/health` responds, `migrate` exits 0, tables exist |
| 5 | `api/src/chain/` + a throwaway `registerAgent` call | A transaction on the explorer |
| 6 | Auth → accounts → funding | Top-up moves real tokens and credits the ledger |
| 7 | Catalog → `/demo/seed` | Three agents listed |
| 8 | Orders + execution | An order runs end to end and delivers |
| 9 | Guardian + `resolve` | A verdict settles on-chain |
| 10 | Sweeper | An uncontested order auto-releases |
| 11 | `ui/` | Acts 1 and 2 clickable |
| 12 | Rehearse | Twice, minimum |

**Steps 1–3 are the real spike.** They're where the unknowns are, and everything
after is code we already have the design for. If something is going to derail this
project, it happens before step 4.

---

## 7. Decisions

All resolved — no open questions.

| Question | Decision |
| --- | --- |
| Contract verification on MonadVision | **Not needed for the MVP.** §1.4 stands as a note, not a task. |
| Deployer wallet | **Separate** from the funder — the deploy key can be discarded once the contract is up |
| Migrations | **Separate command, TypeORM migrations.** Not `synchronize`. See §3.3. |

**Separate deployer is the more careful choice**, and it costs one faucet trip. The
deploy key signs once and then has no further role — nothing in the running system
needs it, so it never has to sit in a `.env` that a laptop carries around a
conference.

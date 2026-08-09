import { resolve } from 'path';
import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { Account } from './entities/account.entity';
import { Agent } from './entities/agent.entity';
import { AgentVersion } from './entities/agent-version.entity';
import { Complaint } from './entities/complaint.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Order } from './entities/order.entity';
import { Run } from './entities/run.entity';
import { Verdict } from './entities/verdict.entity';

// The TypeORM CLI (`typeorm-ts-node-commonjs migration:run -d src/data-source.ts`)
// boots this file directly with no NestJS lifecycle to load config first. Without
// this call the CLI sees an undefined DATABASE_URL and reports what looks like a
// Docker networking fault. __dirname here is `api/src`, so `../../.env` resolves to
// the repository-root `.env` shared by api/, ui/ and sc/. Inside Docker the file is
// absent and the values already come from the environment — dotenv silently no-ops,
// which is correct.
dotenv.config({ path: resolve(__dirname, '../../.env') });

// `url` is deliberately passed through unvalidated, including when it is undefined.
//
// It is tempting to throw here if DATABASE_URL is missing, but that would be a bug:
// this module is imported by DatabaseModule, so a module-scope throw runs at import
// time — before Nest ever calls the config layer's validate(). A developer who blanked
// DATABASE_URL *and* mistyped PORT would see only this error and fix one problem per
// restart, which is precisely the behaviour the aggregated report exists to prevent.
//
// So the two entry points report it in their own way:
//   - the app: src/config/env.schema.ts, which names every offending key at once
//   - the CLI: TypeORM's own connection error, with the dotenv path above as the hint
//
// `PostgresConnectionOptions.url` is optional, so `string | undefined` type-checks.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  // NON-NEGOTIABLE: this must stay false. Left true, TypeORM reshapes the schema to
  // match entities and the hand-written migrations become decoration — two
  // mechanisms fighting to own the schema, and the winner is whichever one nobody
  // wrote.
  synchronize: false,
  // Migrations are run by a dedicated one-shot `migrate` Compose service that must
  // exit 0 before the API starts; the app must never run them itself.
  migrationsRun: false,
  // TypeORM emits `uuid_generate_v4()` (which needs the uuid-ossp extension) by
  // default, and `gen_random_uuid()` only when this flag is set. The migration
  // specifies gen_random_uuid(), so without this every entity's generated
  // default disagrees with the schema and the drift check fails on all eight
  // tables at once.
  //
  // The flag name is a leftover: NO extension is installed and none is needed.
  // gen_random_uuid() has been core Postgres since v13 — verified against this
  // project's Postgres 16, which has only plpgsql.
  uuidExtension: 'pgcrypto',
  // Explicit, not a glob. A glob is resolved at runtime against the compiled
  // directory layout, which is exactly the kind of thing that works under
  // ts-node and fails in dist/ — with a runtime EntityMetadataNotFound that
  // reads like a dependency-injection problem. Listing them makes a missing
  // entity a compile error, and makes "which entities exist" a one-file answer.
  entities: [
    Account,
    Agent,
    AgentVersion,
    Complaint,
    LedgerEntry,
    Order,
    Run,
    Verdict,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  // Query logging is deliberately excluded because it prints parameter values.
  logging: ['error', 'warn'],
};

// The TypeORM CLI requires a default-exported DataSource instance.
export default new DataSource(dataSourceOptions);

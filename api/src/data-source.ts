import { resolve } from 'path';
import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

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
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  // Query logging is deliberately excluded because it prints parameter values.
  logging: ['error', 'warn'],
};

// The TypeORM CLI requires a default-exported DataSource instance.
export default new DataSource(dataSourceOptions);

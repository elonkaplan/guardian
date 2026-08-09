import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { AccountsModule } from '../accounts/accounts.module';
import { type AppConfig } from '../config/env.schema';
import { JWT_TTL } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { NonceStore } from './nonce.store';

/**
 * `auth/` — the only way to become a user of this platform, and the only place
 * a session token can be created.
 *
 * ⚠️ **This module exports nothing, and that is the point.** `JwtService`,
 * `NonceStore` and `AuthService` all stay inside it. A module that could inject
 * `JwtService` could sign `{ sub: <any account id> }` and mint itself a token
 * for someone else's account, which would make the guard decorative — the same
 * reasoning that keeps `ChainModule` from exporting its viem clients. The
 * guard's guarantee is only real if there is exactly one place a token is born.
 *
 * `AccountRepository` arrives via `AccountsModule` rather than being provided
 * here: `auth` owns signing in, `accounts` owns the account (CONTEXT §3).
 */
@Module({
  imports: [
    AccountsModule,
    // registerAsync, not register: the secret comes from ConfigService, which
    // parsed and validated it once at boot. Reading process.env here would be a
    // second source for the one value that forges tokens for every account.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: JWT_TTL },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    NonceStore,
    // ⚠️ Global, and fail-closed: the moment this provider exists, EVERY route
    // in the application requires a credential — including `/health` and the
    // two `/auth` routes themselves — until it carries `@Public()`. Adding this
    // without marking those three makes the platform unbootable in practice:
    // there is no way to sign in, so there is no way to get a token.
    //
    // This reverses the feature spec's original FR-016, which asked for the
    // opposite default. The argument is in specs/004-wallet-auth/research.md
    // R8, and the short version is that the two defaults differ only in the
    // consequence of forgetting — and one of the endpoints in question is
    // `POST /withdraw`.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}

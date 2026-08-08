import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

/**
 * Unauthenticated by design, and it must stay that way once auth lands — a
 * health check behind a guard is a health check nothing can call.
 *
 * Deliberately shallow: one indicator, the database. The Monad RPC endpoint and
 * the Anthropic API are NOT probed. Both are third-party, and probing them would
 * make an unrelated outage look like a service failure — and would make the
 * Compose dependency graph fail for a reason the developer cannot fix.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      // `SELECT 1` over the shared DataSource — touches no domain table and
      // writes nothing. The timeout stops a hung database hanging the probe.
      () => this.db.pingCheck('database', { timeout: 1500 }),
    ]);
  }
}

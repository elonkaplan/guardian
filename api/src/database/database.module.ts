import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { dataSourceOptions } from '../data-source';

/**
 * Deliberately `forRoot(dataSourceOptions)` and not `forRootAsync` reading from
 * ConfigService.
 *
 * The TypeORM CLI cannot boot Nest, so if the app built its connection options
 * from ConfigService the CLI would have to build its own — and the two would
 * drift. The drift shows up as migrations applied to a database the API isn't
 * reading, which is a genuinely confusing afternoon. One object, two consumers.
 */
@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions)],
})
export class DatabaseModule {}

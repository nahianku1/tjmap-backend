import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { config } from '../config';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool = new Pool({
    connectionString: config.dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

  async onModuleInit(): Promise<void> {
    const { rows } = await this.pool.query<{ version: string }>('SELECT version()');
    this.logger.log(`Connected to ${rows[0]?.version?.split(' ').slice(0, 2).join(' ')}`);

    await this.pool.query(`
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS tj_type text NOT NULL DEFAULT 'box';
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS input_power_dbm double precision;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS output_cores jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS cut_data jsonb NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS pon_data jsonb NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS user_fibres jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }
}

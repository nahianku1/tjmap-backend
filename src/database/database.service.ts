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

      CREATE TABLE IF NOT EXISTS onus (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username    text NOT NULL,
        mac_address text,
        vlan_id     integer,
        fibre_id    text NOT NULL,
        cores       jsonb NOT NULL DEFAULT '[]'::jsonb,
        notes       text,
        area_id     uuid REFERENCES areas(id) ON DELETE SET NULL,
        location    geography(Point, 4326),
        created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS onus_area_idx ON onus (area_id);
      CREATE INDEX IF NOT EXISTS onus_location_gix ON onus USING GIST (location);

      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS from_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS to_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS tj_links_from_onu_idx ON tj_links (from_onu_id);
      CREATE INDEX IF NOT EXISTS tj_links_to_onu_idx ON tj_links (to_onu_id);

      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS path jsonb NOT NULL DEFAULT '[]'::jsonb;
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

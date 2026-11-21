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
      -- Sub-areas split a service area into placement zones for devices and links.
      CREATE TABLE IF NOT EXISTS sub_areas (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        area_id     uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
        code        text,
        name        text NOT NULL,
        description text,
        created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sub_areas_area_name_unique ON sub_areas (area_id, lower(name));
      CREATE INDEX IF NOT EXISTS sub_areas_area_idx ON sub_areas (area_id);

      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS tj_type text NOT NULL DEFAULT 'box';
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS input_power_dbm double precision;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS output_cores jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS cut_data jsonb NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS pon_data jsonb NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS user_fibres jsonb NOT NULL DEFAULT '[]'::jsonb;
      -- A joint can carry more than one optical splitter.
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS splitters jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE tjs ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS tjs_sub_area_idx ON tjs (sub_area_id);
      ALTER TABLE olts ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS olts_sub_area_idx ON olts (sub_area_id);
      ALTER TABLE olts ADD COLUMN IF NOT EXISTS olt_type text NOT NULL DEFAULT 'gpon';

      CREATE TABLE IF NOT EXISTS onus (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username    text NOT NULL,
        mac_address text,
        vlan_id     integer,
        fibre_id    text,
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
      -- Drop fibre IDs are filled from the connected link, so a new ONU can be
      -- saved before that cable is drawn.
      ALTER TABLE onus ALTER COLUMN fibre_id DROP NOT NULL;
      ALTER TABLE onus ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS onus_sub_area_idx ON onus (sub_area_id);

      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS from_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS to_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS tj_links_from_onu_idx ON tj_links (from_onu_id);
      CREATE INDEX IF NOT EXISTS tj_links_to_onu_idx ON tj_links (to_onu_id);

      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS path jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS tj_links_sub_area_idx ON tj_links (sub_area_id);

      -- Optical power budget inputs. Each span carries its own attenuation, splice and
      -- connector counts so the OLT → TJ → ONU budget can be recomputed on read.
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS attenuation_db_per_km double precision NOT NULL DEFAULT 0.35;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS splice_count integer NOT NULL DEFAULT 2;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS connection_loss_db double precision NOT NULL DEFAULT 1.0;
      -- Optional per-link colour drawn on the map; null keeps the default styling.
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS color text;

      ALTER TABLE onus ADD COLUMN IF NOT EXISTS pon_type text NOT NULL DEFAULT 'gpon';
      ALTER TABLE onus ADD COLUMN IF NOT EXISTS onu_class text NOT NULL DEFAULT 'B+';

      -- Two devices can be joined by several fibres, so a device pair is no
      -- longer unique; each span is identified by its own fibre ID.
      DROP INDEX IF EXISTS tj_links_pair_unique;
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

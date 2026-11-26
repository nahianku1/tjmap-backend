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
      ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
      CREATE INDEX IF NOT EXISTS users_blocked_idx ON users (blocked_at) WHERE blocked_at IS NOT NULL;

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
      -- One physical ONU exists once, so a hardware MAC belongs to one row.
      -- The trigger enforces that for every write without needing the rows
      -- saved before this rule to be clean yet.
      CREATE OR REPLACE FUNCTION onus_mac_unique_guard() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.mac_address IS NOT NULL AND EXISTS (
          SELECT 1 FROM onus o
           WHERE lower(o.mac_address) = lower(NEW.mac_address)
             AND o.id <> NEW.id
        ) THEN
          RAISE EXCEPTION 'MAC address % is already registered to another ONU', NEW.mac_address
            USING ERRCODE = '23505', CONSTRAINT = 'onus_mac_unique';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS onus_mac_unique_guard ON onus;
      CREATE TRIGGER onus_mac_unique_guard
        BEFORE INSERT OR UPDATE OF mac_address ON onus
        FOR EACH ROW EXECUTE FUNCTION onus_mac_unique_guard();

      -- Device codes share one network-wide namespace across TJs, OLTs and
      -- ONUs; the service layer checks first, this trigger is the backstop.
      CREATE OR REPLACE FUNCTION device_code_unique_guard() RETURNS trigger AS $fn$
      DECLARE
        v_code text := lower(COALESCE(to_jsonb(NEW)->>'code', to_jsonb(NEW)->>'username'));
        v_hit text;
      BEGIN
        IF v_code IS NULL OR v_code = '' THEN RETURN NEW; END IF;

        IF TG_TABLE_NAME = 'tjs' THEN
          SELECT 'OLT ' || o.code INTO v_hit FROM olts o WHERE lower(o.code) = v_code LIMIT 1;
          IF v_hit IS NULL THEN
            SELECT 'ONU ' || u.username INTO v_hit FROM onus u WHERE lower(u.username) = v_code LIMIT 1;
          END IF;
        ELSIF TG_TABLE_NAME = 'olts' THEN
          SELECT 'TJ ' || t.code INTO v_hit FROM tjs t WHERE lower(t.code) = v_code LIMIT 1;
          IF v_hit IS NULL THEN
            SELECT 'ONU ' || u.username INTO v_hit FROM onus u WHERE lower(u.username) = v_code LIMIT 1;
          END IF;
        ELSE
          SELECT 'TJ ' || t.code INTO v_hit FROM tjs t WHERE lower(t.code) = v_code LIMIT 1;
          IF v_hit IS NULL THEN
            SELECT 'OLT ' || o.code INTO v_hit FROM olts o WHERE lower(o.code) = v_code LIMIT 1;
          END IF;
          IF v_hit IS NULL THEN
            SELECT 'ONU ' || u.username INTO v_hit FROM onus u
             WHERE lower(u.username) = v_code AND u.id <> NEW.id LIMIT 1;
          END IF;
        END IF;

        IF v_hit IS NOT NULL THEN
          RAISE EXCEPTION 'Device code "%" is already used by %', v_code, v_hit
            USING ERRCODE = '23505', CONSTRAINT = 'device_code_unique';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS tjs_code_global_guard ON tjs;
      CREATE TRIGGER tjs_code_global_guard
        BEFORE INSERT OR UPDATE OF code ON tjs
        FOR EACH ROW EXECUTE FUNCTION device_code_unique_guard();
      DROP TRIGGER IF EXISTS olts_code_global_guard ON olts;
      CREATE TRIGGER olts_code_global_guard
        BEFORE INSERT OR UPDATE OF code ON olts
        FOR EACH ROW EXECUTE FUNCTION device_code_unique_guard();
      DROP TRIGGER IF EXISTS onus_username_global_guard ON onus;
      CREATE TRIGGER onus_username_global_guard
        BEFORE INSERT OR UPDATE OF username ON onus
        FOR EACH ROW EXECUTE FUNCTION device_code_unique_guard();

      -- Index once the data is clean; legacy duplicate rows skip it.
      DO $$
      BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS onus_mac_unique
          ON onus (lower(mac_address)) WHERE mac_address IS NOT NULL;
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'onus_mac_unique not created: existing duplicate MAC addresses';
      END $$;

      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS from_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS to_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS tj_links_from_onu_idx ON tj_links (from_onu_id);
      CREATE INDEX IF NOT EXISTS tj_links_to_onu_idx ON tj_links (to_onu_id);

      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS path jsonb NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS tj_links_sub_area_idx ON tj_links (sub_area_id);

      -- Optical power budget inputs. Each span carries its own attenuation, splice and
      -- connector counts so the OLT → TJ → ONU budget can be recomputed on read.
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS attenuation_db_per_km double precision NOT NULL DEFAULT 0.5;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS splice_count integer NOT NULL DEFAULT 2;
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS connection_loss_db double precision NOT NULL DEFAULT 0.2;
      ALTER TABLE tj_links ALTER COLUMN attenuation_db_per_km SET DEFAULT 0.5;
      ALTER TABLE tj_links ALTER COLUMN connection_loss_db SET DEFAULT 0.2;
      -- Optional per-link colour drawn on the map; null keeps the default styling.
      ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS color text;

      ALTER TABLE onus ADD COLUMN IF NOT EXISTS pon_type text NOT NULL DEFAULT 'gpon';
      ALTER TABLE onus ADD COLUMN IF NOT EXISTS onu_class text NOT NULL DEFAULT 'B+';

      -- Two devices can be joined by several fibres, so a device pair is no
      -- longer unique; each span is identified by its own fibre ID, which is
      -- unique across the whole network.
      DROP INDEX IF EXISTS tj_links_pair_unique;

      -- Index once the data is clean; legacy duplicate rows skip it.
      DO $$
      BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS tj_links_fibre_id_unique
          ON tj_links (lower(fibre_id)) WHERE fibre_id IS NOT NULL AND fibre_id <> '';
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'tj_links_fibre_id_unique not created: existing duplicate fibre IDs';
      END $$;
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

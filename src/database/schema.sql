-- ISP TJ monitoring schema (PostgreSQL + PostGIS)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('user', 'admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL,
  mobile        text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'user',
  blocked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  family_id  uuid NOT NULL,
  jti        text,
  replaced_by text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS districts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS districts_code_unique ON districts (lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS districts_name_unique ON districts (lower(name));

CREATE TABLE IF NOT EXISTS areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  code        text,
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS areas_district_name_unique ON areas (district_id, lower(name));
CREATE INDEX IF NOT EXISTS areas_district_idx ON areas (district_id);

-- Sub-areas split a service area into smaller placement zones (device clusters).
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

CREATE TABLE IF NOT EXISTS tjs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  name          text,
  tj_type       text NOT NULL DEFAULT 'box',
  location      geography(Point, 4326) NOT NULL,
  address       text,
  notes         text,
  fibre_id      text,
  input_power_dbm double precision,
  cores         jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_cores  jsonb NOT NULL DEFAULT '[]'::jsonb,
  splitter      jsonb NOT NULL DEFAULT '{"enabled": false, "ratio": null, "outputs": []}'::jsonb,
  is_cut        boolean NOT NULL DEFAULT false,
  cut_reason    text,
  cut_severity  text,
  cut_data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  pon_data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tjs_code_unique ON tjs (lower(code));
CREATE INDEX IF NOT EXISTS tjs_location_gix ON tjs USING GIST (location);

ALTER TABLE tjs ADD COLUMN IF NOT EXISTS tj_type text NOT NULL DEFAULT 'box';
ALTER TABLE tjs ADD COLUMN IF NOT EXISTS input_power_dbm double precision;
ALTER TABLE tjs ADD COLUMN IF NOT EXISTS output_cores jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tjs ADD COLUMN IF NOT EXISTS cut_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tjs ADD COLUMN IF NOT EXISTS pon_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tjs ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tjs_area_idx ON tjs (area_id);
ALTER TABLE tjs ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tjs_sub_area_idx ON tjs (sub_area_id);

CREATE TABLE IF NOT EXISTS olts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  pon_port    text,
  uplink_port text,
  notes       text,
  area_id     uuid REFERENCES areas(id) ON DELETE SET NULL,
  location    geography(Point, 4326),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS olts_code_unique ON olts (lower(code));
CREATE UNIQUE INDEX IF NOT EXISTS olts_name_unique ON olts (lower(name));
CREATE INDEX IF NOT EXISTS olts_area_idx ON olts (area_id);
ALTER TABLE olts ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS olts_sub_area_idx ON olts (sub_area_id);

ALTER TABLE tjs ADD COLUMN IF NOT EXISTS olt_id uuid REFERENCES olts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tjs_olt_idx ON tjs (olt_id);

ALTER TABLE olts ADD COLUMN IF NOT EXISTS pon_ports jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE olts ADD COLUMN IF NOT EXISTS ethernet_ports jsonb NOT NULL DEFAULT '[]'::jsonb;
-- PON technology this cabinet runs: GPON or EPON.
ALTER TABLE olts ADD COLUMN IF NOT EXISTS olt_type text NOT NULL DEFAULT 'gpon';
-- Feed cable patched into the cabinet; filled from the connected span when one exists.
ALTER TABLE olts ADD COLUMN IF NOT EXISTS fibre_id text;

CREATE TABLE IF NOT EXISTS tj_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_tj_id  uuid NOT NULL REFERENCES tjs(id) ON DELETE CASCADE,
  to_tj_id    uuid NOT NULL REFERENCES tjs(id) ON DELETE CASCADE,
  fibre_id    text NOT NULL,
  cable_type  text,
  core_count  integer NOT NULL DEFAULT 0,
  from_core_label text,
  to_core_label   text,
  status      text NOT NULL DEFAULT 'active',
  length_m    double precision,
  notes       text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_links_distinct_nodes CHECK (from_tj_id <> to_tj_id),
  CONSTRAINT tj_links_status_valid CHECK (status IN ('active', 'cut'))
);

-- The same two devices may be joined by several fibres (one span per fibre ID).
DROP INDEX IF EXISTS tj_links_pair_unique;
CREATE INDEX IF NOT EXISTS tj_links_from_idx ON tj_links (from_tj_id);
CREATE INDEX IF NOT EXISTS tj_links_to_idx ON tj_links (to_tj_id);

-- Links join any two devices (terminal joint or OLT), not just joint pairs.
ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS from_olt_id uuid REFERENCES olts(id) ON DELETE CASCADE;
ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS to_olt_id uuid REFERENCES olts(id) ON DELETE CASCADE;
ALTER TABLE tj_links ALTER COLUMN from_tj_id DROP NOT NULL;
ALTER TABLE tj_links ALTER COLUMN to_tj_id DROP NOT NULL;
ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS cores jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS tj_links_from_olt_idx ON tj_links (from_olt_id);
CREATE INDEX IF NOT EXISTS tj_links_to_olt_idx ON tj_links (to_olt_id);
-- Hand-drawn duct route: intermediate waypoints between the two devices.
ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS path jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Placement zone the span is filed under (purely organisational).
ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tj_links_sub_area_idx ON tj_links (sub_area_id);

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
-- A hardware MAC address belongs to a single ONU across the whole network.
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

-- Device codes share one network-wide namespace across TJs, OLTs and ONUs:
-- a TJ code, an OLT code and an ONU username may never match. The service
-- layer checks this first for a friendly error; the trigger is the backstop.
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
CREATE INDEX IF NOT EXISTS onus_location_gix ON onus USING GIST (location);
-- The ONU drop fibre is optional and copied from the connected link when drawn.
ALTER TABLE onus ALTER COLUMN fibre_id DROP NOT NULL;
ALTER TABLE onus ADD COLUMN IF NOT EXISTS sub_area_id uuid REFERENCES sub_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS onus_sub_area_idx ON onus (sub_area_id);

-- Links can terminate on any device: terminal joint, OLT or subscriber ONU.
ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS from_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
ALTER TABLE tj_links ADD COLUMN IF NOT EXISTS to_onu_id uuid REFERENCES onus(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS tj_links_from_onu_idx ON tj_links (from_onu_id);
CREATE INDEX IF NOT EXISTS tj_links_to_onu_idx ON tj_links (to_onu_id);

-- Every fibre span carries its own ID across the whole network; the service
-- layer reports conflicts first, the index enforces it for every write.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS tj_links_fibre_id_unique
    ON tj_links (lower(fibre_id)) WHERE fibre_id IS NOT NULL AND fibre_id <> '';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'tj_links_fibre_id_unique not created: existing duplicate fibre IDs';
END $$;

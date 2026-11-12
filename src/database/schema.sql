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

CREATE TABLE IF NOT EXISTS tj_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_tj_id  uuid NOT NULL REFERENCES tjs(id) ON DELETE CASCADE,
  to_tj_id    uuid NOT NULL REFERENCES tjs(id) ON DELETE CASCADE,
  fibre_id    text NOT NULL,
  cable_type  text,
  core_count  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active',
  length_m    double precision,
  notes       text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_links_distinct_nodes CHECK (from_tj_id <> to_tj_id),
  CONSTRAINT tj_links_status_valid CHECK (status IN ('active', 'cut'))
);

CREATE UNIQUE INDEX IF NOT EXISTS tj_links_pair_unique
  ON tj_links (LEAST(from_tj_id, to_tj_id), GREATEST(from_tj_id, to_tj_id));
CREATE INDEX IF NOT EXISTS tj_links_from_idx ON tj_links (from_tj_id);
CREATE INDEX IF NOT EXISTS tj_links_to_idx ON tj_links (to_tj_id);

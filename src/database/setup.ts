import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { hash } from '@node-rs/argon2';
import { config } from '../config';

const pool = new Pool({
  connectionString: config.dbUrl,
  ssl: { rejectUnauthorized: false },
});

type SeedCore = { label: string; color: string; count: number };

type SeedTj = {
  code: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  fibreId: string;
  cores: SeedCore[];
  splitter?: { enabled: boolean; ratio: string | null; outputs: SeedCore[] };
  isCut?: boolean;
  cutReason?: string;
  cutSeverity?: 'minor' | 'major' | 'outage';
};

const CYAN = '#22d3ee';
const EMERALD = '#34d399';
const VIOLET = '#a78bfa';
const AMBER = '#fbbf24';
const ROSE = '#fb7185';
const SKY = '#60a5fa';
const LIME = '#a3e635';
const ORANGE = '#fb923c';

function feCores(): SeedCore[] {
  return [
    { label: 'Core 01', color: CYAN, count: 1 },
    { label: 'Core 02', color: EMERALD, count: 1 },
    { label: 'Core 03', color: VIOLET, count: 2 },
    { label: 'Core 04', color: AMBER, count: 1 },
  ];
}

function trunkCores(): SeedCore[] {
  return [
    { label: 'Trunk 01', color: SKY, count: 4 },
    { label: 'Trunk 02', color: LIME, count: 4 },
    { label: 'Trunk 03', color: ROSE, count: 4 },
  ];
}

function splitter(ratio: string, outputs: SeedCore[]) {
  return { enabled: true, ratio, outputs };
}

const TJ_SEED: SeedTj[] = [
  {
    code: 'TJ-DHK-001',
    name: 'Gulshan 1 Core Node',
    lat: 23.7808,
    lng: 90.416,
    address: 'Gulshan Avenue, Dhaka 1212',
    fibreId: 'F-DHK-GL-01',
    cores: trunkCores(),
    splitter: splitter('1:8', [
      { label: 'Out 01', color: CYAN, count: 1 },
      { label: 'Out 02', color: EMERALD, count: 1 },
      { label: 'Out 03', color: VIOLET, count: 1 },
      { label: 'Out 04', color: AMBER, count: 1 },
    ]),
  },
  {
    code: 'TJ-DHK-002',
    name: 'Banani Distribution',
    lat: 23.7936,
    lng: 90.4043,
    address: 'Road 11, Banani, Dhaka 1213',
    fibreId: 'F-DHK-BN-02',
    cores: feCores(),
    splitter: splitter('1:4', [
      { label: 'Out 01', color: CYAN, count: 1 },
      { label: 'Out 02', color: ROSE, count: 1 },
    ]),
  },
  {
    code: 'TJ-DHK-003',
    name: 'Mohakhali Transit',
    lat: 23.7777,
    lng: 90.3995,
    address: 'Mohakhali DOHS, Dhaka 1206',
    fibreId: 'F-DHK-MH-03',
    cores: trunkCores(),
  },
  {
    code: 'TJ-DHK-004',
    name: 'Uttara Sector 7',
    lat: 23.8701,
    lng: 90.3899,
    address: 'Sector 7, Uttara, Dhaka 1230',
    fibreId: 'F-DHK-UT-04',
    cores: feCores(),
    splitter: splitter('1:8', [
      { label: 'Out 01', color: EMERALD, count: 1 },
      { label: 'Out 02', color: SKY, count: 1 },
      { label: 'Out 03', color: ORANGE, count: 1 },
    ]),
  },
  {
    code: 'TJ-DHK-005',
    name: 'Mirpur 10 Junction',
    lat: 23.8069,
    lng: 90.3687,
    address: 'Mirpur 10 Circle, Dhaka 1216',
    fibreId: 'F-DHK-MR-05',
    cores: feCores(),
    isCut: true,
    cutReason: 'Road excavation severed the 12F trunk near the flyover pier.',
    cutSeverity: 'major',
  },
  {
    code: 'TJ-DHK-006',
    name: 'Dhanmondi 27',
    lat: 23.7465,
    lng: 90.376,
    address: 'Dhanmondi 27, Dhaka 1209',
    fibreId: 'F-DHK-DM-06',
    cores: feCores(),
  },
  {
    code: 'TJ-DHK-007',
    name: 'Motijheel Metro Node',
    lat: 23.733,
    lng: 90.417,
    address: 'Motijheel C/A, Dhaka 1000',
    fibreId: 'F-DHK-MT-07',
    cores: trunkCores(),
    splitter: splitter('1:16', [
      { label: 'Out 01', color: VIOLET, count: 2 },
      { label: 'Out 02', color: LIME, count: 2 },
    ]),
  },
  {
    code: 'TJ-DHK-008',
    name: 'Savar EPZ Link',
    lat: 23.8388,
    lng: 90.2637,
    address: 'Savar EPZ, Dhaka 1340',
    fibreId: 'F-DHK-SV-08',
    cores: feCores(),
  },
  {
    code: 'TJ-CTG-001',
    name: 'Agrabad Landing Station',
    lat: 22.3268,
    lng: 91.8,
    address: 'Agrabad C/A, Chattogram 4100',
    fibreId: 'F-CTG-AG-01',
    cores: trunkCores(),
    splitter: splitter('1:8', [
      { label: 'Out 01', color: CYAN, count: 1 },
      { label: 'Out 02', color: AMBER, count: 1 },
    ]),
  },
  {
    code: 'TJ-CTG-002',
    name: 'Pahartali Ring',
    lat: 22.36,
    lng: 91.793,
    address: 'Pahartali, Chattogram 4202',
    fibreId: 'F-CTG-PH-02',
    cores: feCores(),
  },
  {
    code: 'TJ-CTG-003',
    name: 'Cumilla Kandirpar',
    lat: 23.4607,
    lng: 91.1809,
    address: 'Kandirpar, Cumilla 3500',
    fibreId: 'F-CTG-CM-03',
    cores: feCores(),
  },
  {
    code: 'TJ-CTG-004',
    name: 'Cox\u2019s Bazar Beach Node',
    lat: 21.4272,
    lng: 92.0058,
    address: 'Kolatoli, Cox\u2019s Bazar 4700',
    fibreId: 'F-CTG-CX-04',
    cores: feCores(),
    isCut: true,
    cutReason: 'Salt-water corrosion at the beach duct caused complete loss on trunk 02.',
    cutSeverity: 'outage',
  },
  {
    code: 'TJ-SYL-001',
    name: 'Zindabazar POP',
    lat: 24.8949,
    lng: 91.8687,
    address: 'Zindabazar, Sylhet 3100',
    fibreId: 'F-SYL-ZB-01',
    cores: trunkCores(),
  },
  {
    code: 'TJ-SYL-002',
    name: 'Moulvibazar Edge',
    lat: 24.4829,
    lng: 91.7774,
    address: 'Sylhet Road, Moulvibazar 3200',
    fibreId: 'F-SYL-MV-02',
    cores: feCores(),
  },
  {
    code: 'TJ-RAJ-001',
    name: 'Shaheb Bazar Node',
    lat: 24.365,
    lng: 88.601,
    address: 'Shaheb Bazar, Rajshahi 6100',
    fibreId: 'F-RAJ-SB-01',
    cores: feCores(),
  },
  {
    code: 'TJ-RAJ-002',
    name: 'Bogura North',
    lat: 24.8465,
    lng: 89.3773,
    address: 'Satmatha, Bogura 5800',
    fibreId: 'F-RAJ-BG-02',
    cores: feCores(),
    splitter: splitter('1:4', [{ label: 'Out 01', color: SKY, count: 1 }]),
  },
  {
    code: 'TJ-KHL-001',
    name: 'Sonadanga Hub',
    lat: 22.8098,
    lng: 89.547,
    address: 'Sonadanga, Khulna 9100',
    fibreId: 'F-KHL-SD-01',
    cores: trunkCores(),
  },
  {
    code: 'TJ-KHL-002',
    name: 'Jashore Central',
    lat: 23.1684,
    lng: 89.2137,
    address: 'Mujib Sarak, Jashore 7400',
    fibreId: 'F-KHL-JS-02',
    cores: feCores(),
  },
  {
    code: 'TJ-BAR-001',
    name: 'Nathullabad POP',
    lat: 22.69,
    lng: 90.36,
    address: 'Nathullabad, Barishal 8200',
    fibreId: 'F-BAR-NT-01',
    cores: feCores(),
  },
  {
    code: 'TJ-RNG-001',
    name: 'Dhopadighi Node',
    lat: 25.7449,
    lng: 89.275,
    address: 'Dhopadighi More, Rangpur 5400',
    fibreId: 'F-RNG-DP-01',
    cores: feCores(),
  },
  {
    code: 'TJ-MYM-001',
    name: 'Ganginarpar Edge',
    lat: 24.753,
    lng: 90.407,
    address: 'Ganginarpar, Mymensingh 2200',
    fibreId: 'F-MYM-GP-01',
    cores: feCores(),
  },
];

const LINK_SEED: Array<{
  from: string;
  to: string;
  fibreId: string;
  cableType: string;
  coreCount: number;
  status?: 'active' | 'cut';
}> = [
  { from: 'TJ-DHK-001', to: 'TJ-DHK-002', fibreId: 'F-DHK-GL-BN', cableType: '12F Armoured', coreCount: 12 },
  { from: 'TJ-DHK-001', to: 'TJ-DHK-003', fibreId: 'F-DHK-GL-MH', cableType: '24F Duct', coreCount: 24 },
  { from: 'TJ-DHK-003', to: 'TJ-DHK-004', fibreId: 'F-DHK-MH-UT', cableType: '24F Duct', coreCount: 24 },
  { from: 'TJ-DHK-003', to: 'TJ-DHK-005', fibreId: 'F-DHK-MH-MR', cableType: '12F Armoured', coreCount: 12, status: 'cut' },
  { from: 'TJ-DHK-005', to: 'TJ-DHK-008', fibreId: 'F-DHK-MR-SV', cableType: '12F Aerial', coreCount: 12 },
  { from: 'TJ-DHK-002', to: 'TJ-DHK-006', fibreId: 'F-DHK-BN-DM', cableType: '24F Duct', coreCount: 24 },
  { from: 'TJ-DHK-006', to: 'TJ-DHK-007', fibreId: 'F-DHK-DM-MT', cableType: '48F Duct', coreCount: 48 },
  { from: 'TJ-DHK-003', to: 'TJ-DHK-007', fibreId: 'F-DHK-MH-MT', cableType: '48F Duct', coreCount: 48 },
  { from: 'TJ-DHK-006', to: 'TJ-DHK-005', fibreId: 'F-DHK-DM-MR', cableType: '12F Aerial', coreCount: 12 },
  { from: 'TJ-DHK-007', to: 'TJ-CTG-003', fibreId: 'F-DHK-CTG-BACKBONE', cableType: '96F Backbone', coreCount: 96 },
  { from: 'TJ-CTG-003', to: 'TJ-CTG-001', fibreId: 'F-CTG-CM-AG', cableType: '48F Backbone', coreCount: 48 },
  { from: 'TJ-CTG-001', to: 'TJ-CTG-002', fibreId: 'F-CTG-AG-PH', cableType: '24F Duct', coreCount: 24 },
  { from: 'TJ-CTG-001', to: 'TJ-CTG-004', fibreId: 'F-CTG-AG-CX', cableType: '24F Submarine', coreCount: 24, status: 'cut' },
  { from: 'TJ-DHK-004', to: 'TJ-MYM-001', fibreId: 'F-DHK-MYM', cableType: '48F Backbone', coreCount: 48 },
  { from: 'TJ-MYM-001', to: 'TJ-SYL-001', fibreId: 'F-MYM-SYL', cableType: '48F Backbone', coreCount: 48 },
  { from: 'TJ-SYL-001', to: 'TJ-SYL-002', fibreId: 'F-SYL-ZB-MV', cableType: '12F Aerial', coreCount: 12 },
  { from: 'TJ-SYL-001', to: 'TJ-RNG-001', fibreId: 'F-SYL-RNG', cableType: '24F Backbone', coreCount: 24 },
  { from: 'TJ-RNG-001', to: 'TJ-RAJ-002', fibreId: 'F-RNG-RAJ', cableType: '24F Backbone', coreCount: 24 },
  { from: 'TJ-RAJ-002', to: 'TJ-RAJ-001', fibreId: 'F-BG-RJ', cableType: '12F Duct', coreCount: 12 },
  { from: 'TJ-RAJ-001', to: 'TJ-KHL-002', fibreId: 'F-RAJ-KHL', cableType: '24F Backbone', coreCount: 24 },
  { from: 'TJ-KHL-002', to: 'TJ-KHL-001', fibreId: 'F-JS-KHL', cableType: '12F Aerial', coreCount: 12 },
  { from: 'TJ-KHL-001', to: 'TJ-BAR-001', fibreId: 'F-KHL-BAR', cableType: '24F Backbone', coreCount: 24 },
  { from: 'TJ-BAR-001', to: 'TJ-DHK-007', fibreId: 'F-BAR-DHK', cableType: '48F Backbone', coreCount: 48 },
  { from: 'TJ-DHK-001', to: 'TJ-DHK-004', fibreId: 'F-DHK-GL-UT', cableType: '24F Duct', coreCount: 24 },
];

type SeedArea = { code: string; name: string; tjs: string[] };
type SeedDistrict = { code: string; name: string; areas: SeedArea[] };

const GEO_SEED: SeedDistrict[] = [
  {
    code: 'DHK',
    name: 'Dhaka',
    areas: [
      { code: 'GULSHAN', name: 'Gulshan–Banani', tjs: ['TJ-DHK-001', 'TJ-DHK-002'] },
      { code: 'MOH', name: 'Mohakhali', tjs: ['TJ-DHK-003'] },
      { code: 'UTTARA', name: 'Uttara', tjs: ['TJ-DHK-004'] },
      { code: 'MIRPUR', name: 'Mirpur–Savar', tjs: ['TJ-DHK-005', 'TJ-DHK-008'] },
      { code: 'DHANMONDI', name: 'Dhanmondi–Motijheel', tjs: ['TJ-DHK-006', 'TJ-DHK-007'] },
    ],
  },
  {
    code: 'CTG',
    name: 'Chattogram',
    areas: [
      { code: 'AGRABAD', name: 'Agrabad', tjs: ['TJ-CTG-001'] },
      { code: 'PAHARTALI', name: 'Pahartali', tjs: ['TJ-CTG-002'] },
      { code: 'CUMILLA', name: 'Cumilla', tjs: ['TJ-CTG-003'] },
      { code: 'COXBAZAR', name: "Cox's Bazar", tjs: ['TJ-CTG-004'] },
    ],
  },
  {
    code: 'SYL',
    name: 'Sylhet',
    areas: [
      { code: 'ZINDABAZAR', name: 'Zindabazar', tjs: ['TJ-SYL-001'] },
      { code: 'MOULVI', name: 'Moulvibazar', tjs: ['TJ-SYL-002'] },
    ],
  },
  {
    code: 'RAJ',
    name: 'Rajshahi',
    areas: [
      { code: 'SHAHEB', name: 'Shaheb Bazar', tjs: ['TJ-RAJ-001'] },
      { code: 'BOGURA', name: 'Bogura', tjs: ['TJ-RAJ-002'] },
    ],
  },
  {
    code: 'KHL',
    name: 'Khulna',
    areas: [
      { code: 'SONADANGA', name: 'Sonadanga', tjs: ['TJ-KHL-001'] },
      { code: 'JASHORE', name: 'Jashore', tjs: ['TJ-KHL-002'] },
    ],
  },
  {
    code: 'BAR',
    name: 'Barishal',
    areas: [{ code: 'NATHULLABAD', name: 'Nathullabad', tjs: ['TJ-BAR-001'] }],
  },
  {
    code: 'RNG',
    name: 'Rangpur',
    areas: [{ code: 'DHOPA', name: 'Dhopadighi', tjs: ['TJ-RNG-001'] }],
  },
  {
    code: 'MYM',
    name: 'Mymensingh',
    areas: [{ code: 'GANGINAR', name: 'Ganginarpar', tjs: ['TJ-MYM-001'] }],
  },
];

/** Idempotent district → area seed, and a backfill for joints created before areas existed. */
async function seedGeography(adminId?: string) {
  let areaTotal = 0;

  for (const district of GEO_SEED) {
    await pool.query(
      `INSERT INTO districts (code, name, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(code)) DO NOTHING`,
      [district.code, district.name, adminId ?? null],
    );
    const districtRows = await pool.query<{ id: string }>(
      'SELECT id FROM districts WHERE lower(code) = lower($1)',
      [district.code],
    );
    const districtId = districtRows.rows[0].id;

    for (const area of district.areas) {
      await pool.query(
        `INSERT INTO areas (district_id, code, name, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (district_id, lower(name)) DO NOTHING`,
        [districtId, area.code, area.name, adminId ?? null],
      );
      const areaRows = await pool.query<{ id: string }>(
        'SELECT id FROM areas WHERE district_id = $1 AND lower(name) = lower($2)',
        [districtId, area.name],
      );
      await pool.query(
        'UPDATE tjs SET area_id = $1 WHERE lower(code) = ANY($2::text[]) AND area_id IS NULL',
        [areaRows.rows[0].id, area.tjs.map((code) => code.toLowerCase())],
      );
      areaTotal += 1;
    }
  }

  console.log(`✓ ${GEO_SEED.length} districts and ${areaTotal} areas ready`);
}

async function main() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('✓ schema ready (PostGIS enabled)');

  const userCount = await pool.query<{ count: string }>('SELECT count(*) FROM users');
  let adminId: string | undefined;

  if (Number(userCount.rows[0].count) === 0) {
    const adminHash = await hash('Admin@12345', { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const userHash = await hash('User@12345', { memoryCost: 19456, timeCost: 2, parallelism: 1 });

    const admin = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, mobile, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
      ['Nafis Rahman', 'admin@isptj.app', '+8801700000001', adminHash],
    );
    adminId = admin.rows[0].id;

    await pool.query(
      `INSERT INTO users (name, email, mobile, password_hash, role)
       VALUES ($1, $2, $3, $4, 'user')`,
      ['Sadia Islam', 'user@isptj.app', '+8801700000002', userHash],
    );
    console.log('✓ seeded demo accounts');
  } else {
    const admin = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
    );
    adminId = admin.rows[0]?.id;
  }

  const tjCount = await pool.query<{ count: string }>('SELECT count(*) FROM tjs');
  if (Number(tjCount.rows[0].count) === 0) {
    const codeToId = new Map<string, string>();

    for (const tj of TJ_SEED) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO tjs (code, name, location, address, fibre_id, cores, splitter,
                          is_cut, cut_reason, cut_severity, created_by)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6,
                 $7::jsonb, $8::jsonb, $9, $10, $11, $12)
         RETURNING id`,
        [
          tj.code,
          tj.name,
          tj.lng,
          tj.lat,
          tj.address,
          tj.fibreId,
          JSON.stringify(tj.cores),
          JSON.stringify(tj.splitter ?? { enabled: false, ratio: null, outputs: [] }),
          tj.isCut ?? false,
          tj.cutReason ?? null,
          tj.cutSeverity ?? null,
          adminId ?? null,
        ],
      );
      codeToId.set(tj.code, inserted.rows[0].id);
    }

    for (const link of LINK_SEED) {
      const fromId = codeToId.get(link.from);
      const toId = codeToId.get(link.to);
      if (!fromId || !toId) continue;
      await pool.query(
        `INSERT INTO tj_links (from_tj_id, to_tj_id, fibre_id, cable_type, core_count, status, length_m, created_by)
         SELECT $1, $2, $3, $4, $5, $6, ST_Distance(f.location, t.location), $7
         FROM tjs f, tjs t WHERE f.id = $1 AND t.id = $2`,
        [fromId, toId, link.fibreId, link.cableType, link.coreCount, link.status ?? 'active', adminId ?? null],
      );
    }
    console.log(`✓ seeded ${TJ_SEED.length} terminal joints and ${LINK_SEED.length} fibre links`);
  } else {
    console.log(`✓ ${tjCount.rows[0].count} terminal joints already present, skipping seed`);
  }

  await seedGeography(adminId);

  console.log('\nDemo accounts');
  console.log('  admin@isptj.app / Admin@12345  (full control)');
  console.log('  user@isptj.app  / User@12345   (read-only)\n');
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Database setup failed:', error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });

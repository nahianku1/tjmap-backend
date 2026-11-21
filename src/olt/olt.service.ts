import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { linksTouching, releaseDeletedLinkCores } from '../database/link-core-release';
import { guardDuplicate } from '../database/pg-errors';
import { assertDeviceCodeAvailable } from '../database/device-codes';
import { resolvePlacement } from '../database/placement';
import { CreateOltDto, ETHERNET_SPEEDS, UpdateOltDto } from './olt.dto';
import { ponOnuCapacity, ponOnuUsage } from './pon-capacity';
import { assertPortVlansAvailable, syncOltPonVlans } from '../onu/vlan-pool';

export interface PonPort {
  label: string;
  /** Optional friendly name; the label stays the hardware port id. */
  name: string | null;
  outputDbm: number | null;
  vlanId: number | null;
}

export interface EthernetPort {
  label: string;
  speed: (typeof ETHERNET_SPEEDS)[number];
  vlanId: number | null;
}

/** A port VLAN must be a real 802.1Q id, or absent. */
function normaliseVlan(value: unknown): number | null {
  const vlan = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094 ? vlan : null;
}

interface OltRow {
  id: string;
  code: string;
  name: string;
  olt_type: string | null;
  pon_port: string | null;
  uplink_port: string | null;
  pon_ports: unknown;
  ethernet_ports: unknown;
  fibre_id: string | null;
  notes: string | null;
  area_id: string | null;
  area_name: string | null;
  sub_area_id: string | null;
  sub_area_name: string | null;
  district_id: string | null;
  district_name: string | null;
  lat: number | null;
  lng: number | null;
  tj_count: number;
  created_at: Date;
  updated_at: Date;
}

const OLT_SELECT = `
  SELECT o.id, o.code, o.name, o.olt_type, o.pon_port, o.uplink_port,
         o.pon_ports, o.ethernet_ports, o.fibre_id, o.notes,
         o.area_id, a.name AS area_name, a.district_id, d.name AS district_name,
         o.sub_area_id, sa.name AS sub_area_name,
         ST_Y(o.location::geometry) AS lat,
         ST_X(o.location::geometry) AS lng,
         (SELECT count(*) FROM tjs t WHERE t.olt_id = o.id)::int AS tj_count,
         o.created_at, o.updated_at
  FROM olts o
  LEFT JOIN areas a ON a.id = o.area_id
  LEFT JOIN districts d ON d.id = a.district_id
  LEFT JOIN sub_areas sa ON sa.id = o.sub_area_id`;

function slugCode(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 14);
  return slug.length >= 2 ? slug : fallback;
}

/** Does the uplink text name this port? `10GE 0/0/1` carries `GE 0/0/1` but not `GE 0/0/11`. */
function uplinkCarries(uplink: string, label: string): boolean {
  if (!uplink) return false;
  const normalised = uplink.replace(/\b\d+(?=ge\b)/g, '');
  const target = label.toLowerCase();
  let index = normalised.indexOf(target);
  while (index !== -1) {
    const next = normalised.charAt(index + target.length);
    if (!/[0-9]/.test(next)) return true;
    index = normalised.indexOf(target, index + 1);
  }
  return false;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalisePonPorts(value: unknown): PonPort[] {
  return asArray(value)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as { label?: unknown; name?: unknown; outputDbm?: unknown; vlanId?: unknown };
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      if (!label) return null;
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const dbm = entry.outputDbm;
      return {
        label,
        name: name || null,
        outputDbm: typeof dbm === 'number' && Number.isFinite(dbm) ? dbm : null,
        vlanId: normaliseVlan(entry.vlanId),
      };
    })
    .filter((entry): entry is PonPort => entry !== null);
}

function normaliseEthernetPorts(value: unknown): EthernetPort[] {
  return asArray(value)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as { label?: unknown; speed?: unknown; vlanId?: unknown };
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      const speed = typeof entry.speed === 'string' ? entry.speed.toUpperCase() : '';
      if (!label || !ETHERNET_SPEEDS.includes(speed as EthernetPort['speed'])) return null;
      return {
        label,
        speed: speed as EthernetPort['speed'],
        vlanId: normaliseVlan(entry.vlanId),
      };
    })
    .filter((entry): entry is EthernetPort => entry !== null);
}

function portVlanIds(ponPorts: PonPort[], ethernetPorts: EthernetPort[]): number[] {
  return [...ponPorts, ...ethernetPorts]
    .map((port) => port.vlanId)
    .filter((vlan): vlan is number => vlan !== null);
}

@Injectable()
export class OltService {
  constructor(private readonly db: DatabaseService) {}

  async list(areaId?: string | null) {
    const rows = await this.db.query<OltRow>(
      `${OLT_SELECT} WHERE ($1::uuid IS NULL OR o.area_id = $1::uuid) ORDER BY o.name ASC`,
      [areaId ?? null],
    );
    const ids = rows.map((row) => row.id);
    const [usage, onuUsage] = await Promise.all([this.portUsage(ids), ponOnuUsage(this.db, ids)]);
    return rows.map((row) => this.map(row, usage.get(row.id), onuUsage.get(row.id)));
  }

  async get(id: string) {
    const rows = await this.db.query<OltRow>(`${OLT_SELECT} WHERE o.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('OLT not found');
    const [usage, onuUsage] = await Promise.all([this.portUsage([id]), ponOnuUsage(this.db, [id])]);
    return this.map(rows[0], usage.get(id), onuUsage.get(id));
  }

  /**
   * Live PON occupancy: joints assigned to an OLT consume the PON port recorded on the joint, or the
   * OLT's primary port when the joint does not name one. Active fibre links that terminate on the OLT
   * also consume the port named on their core. Empty key '' counts inherited joints.
   */
  private async portUsage(oltIds: string[]) {
    const usage = new Map<string, Map<string, number>>();
    if (oltIds.length === 0) return usage;
    const rows = await this.db.query<{ olt_id: string; port_label: string; joints: number }>(
      `SELECT olt_id, port_label, sum(joints)::int AS joints
         FROM (
           SELECT olt_id,
                  lower(btrim(coalesce(pon_data->>'ponPort', ''))) AS port_label,
                  count(*)::int AS joints
             FROM tjs
            WHERE olt_id = ANY($1::uuid[])
            GROUP BY olt_id, 2
           UNION ALL
           SELECT hops.olt_id, lower(btrim(hops.port_label)) AS port_label, count(*)::int AS joints
             FROM tj_links l
            CROSS JOIN LATERAL (
              SELECT l.from_olt_id AS olt_id, core->>'fromCoreLabel' AS port_label
                FROM jsonb_array_elements(l.cores) AS core
               WHERE l.from_olt_id IS NOT NULL AND l.status = 'active'
              UNION ALL
              SELECT l.to_olt_id AS olt_id, core->>'toCoreLabel' AS port_label
                FROM jsonb_array_elements(l.cores) AS core
               WHERE l.to_olt_id IS NOT NULL AND l.status = 'active'
            ) AS hops
           WHERE hops.olt_id = ANY($1::uuid[])
             AND coalesce(btrim(hops.port_label), '') <> ''
           GROUP BY hops.olt_id, 2
         ) AS usage
        GROUP BY olt_id, port_label`,
      [oltIds],
    );
    for (const row of rows) {
      const bucket = usage.get(row.olt_id) ?? new Map<string, number>();
      bucket.set(row.port_label, Number(row.joints));
      usage.set(row.olt_id, bucket);
    }
    return usage;
  }

  async create(dto: CreateOltDto, userId: string) {
    const placement = await resolvePlacement(this.db, dto.areaId, dto.subAreaId);
    this.assertLocation(dto.lat, dto.lng);

    const oltType = dto.oltType?.trim() || 'gpon';
    const ponPorts = normalisePonPorts(dto.ponPorts);
    const ethernetPorts = normaliseEthernetPorts(dto.ethernetPorts);
    await assertPortVlansAvailable(this.db, portVlanIds(ponPorts, ethernetPorts));
    const oltCode = slugCode(dto.code ?? dto.name, 'OLT');
    await assertDeviceCodeAvailable(this.db, oltCode);
    const primaryPon = dto.ponPort?.trim() || ponPorts[0]?.label || null;
    const uplinkPort =
      dto.uplinkPort?.trim() ||
      (ethernetPorts[0] ? `${ethernetPorts[0].label} · ${ethernetPorts[0].speed}` : null);

    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
        `INSERT INTO olts (code, name, olt_type, pon_port, uplink_port, pon_ports, ethernet_ports, fibre_id, notes, area_id, location, created_by, sub_area_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10,
                 CASE WHEN $11::double precision IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($12, $11), 4326)::geography END,
                 $13, $14)
         RETURNING id`,
        [
          oltCode,
          dto.name.trim(),
          oltType,
          primaryPon,
          uplinkPort,
          JSON.stringify(ponPorts),
          JSON.stringify(ethernetPorts),
          dto.fibreId?.trim() || null,
          dto.notes?.trim() || null,
          placement.areaId,
          dto.lat ?? null,
          dto.lng ?? null,
          userId,
          placement.subAreaId,
        ],
      ),
      'An OLT with this name or code already exists.',
    );
    return this.get(rows[0].id);
  }

  async update(id: string, dto: UpdateOltDto) {
    const existing = await this.get(id);
    const placement = await resolvePlacement(
      this.db,
      dto.areaId !== undefined ? dto.areaId : existing.areaId,
      dto.subAreaId !== undefined ? dto.subAreaId : existing.subAreaId,
    );
    this.assertLocation(dto.lat ?? existing.lat ?? undefined, dto.lng ?? existing.lng ?? undefined);

    const lat = dto.lat ?? existing.lat;
    const lng = dto.lng ?? existing.lng;

    const oltType = dto.oltType !== undefined ? dto.oltType.trim() || 'gpon' : existing.oltType;
    const ponPorts = dto.ponPorts !== undefined ? normalisePonPorts(dto.ponPorts) : existing.ponPorts;
    const ethernetPorts =
      dto.ethernetPorts !== undefined ? normaliseEthernetPorts(dto.ethernetPorts) : existing.ethernetPorts;

    let primaryPon: string | null;
    if (dto.ponPort !== undefined) primaryPon = dto.ponPort?.trim() || null;
    else if (dto.ponPorts !== undefined) primaryPon = ponPorts[0]?.label || null;
    else primaryPon = existing.ponPort;

    let uplinkPort: string | null;
    if (dto.uplinkPort !== undefined) uplinkPort = dto.uplinkPort?.trim() || null;
    else if (dto.ethernetPorts !== undefined)
      uplinkPort = ethernetPorts[0] ? `${ethernetPorts[0].label} · ${ethernetPorts[0].speed}` : null;
    else uplinkPort = existing.uplinkPort;

    await assertPortVlansAvailable(this.db, portVlanIds(ponPorts, ethernetPorts), id);
    const oltCode = dto.code ? slugCode(dto.code, existing.code) : existing.code;
    await assertDeviceCodeAvailable(this.db, oltCode, id);

    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
        `UPDATE olts SET
           code = $2,
           name = $3,
           olt_type = $4,
           pon_port = $5,
           uplink_port = $6,
           pon_ports = $7::jsonb,
           ethernet_ports = $8::jsonb,
           fibre_id = $9,
           notes = $10,
           area_id = $11,
           location = CASE WHEN $12::double precision IS NULL THEN NULL
                           ELSE ST_SetSRID(ST_MakePoint($13, $12), 4326)::geography END,
           sub_area_id = $14,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [
          id,
          oltCode,
          dto.name?.trim() || existing.name,
          oltType,
          primaryPon,
          uplinkPort,
          JSON.stringify(ponPorts),
          JSON.stringify(ethernetPorts),
          dto.fibreId !== undefined ? dto.fibreId?.trim() || null : existing.fibreId,
          dto.notes !== undefined ? dto.notes?.trim() || null : existing.notes,
          placement.areaId,
          lat,
          lng,
          placement.subAreaId,
        ],
      ),
      'An OLT with this name or code already exists.',
    );
    // Port VLAN changes propagate to every subscriber the port serves.
    await syncOltPonVlans(this.db, id);
    return this.get(rows[0].id);
  }




  async remove(id: string) {
    const links = await linksTouching(this.db, 'olt', id);
    const rows = await this.db.query<{ id: string }>('DELETE FROM olts WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw new NotFoundException('OLT not found');
    await releaseDeletedLinkCores(this.db, links, id);
    return { ok: true, id };
  }

  private assertLocation(lat?: number, lng?: number) {
    if ((lat === undefined) !== (lng === undefined)) {
      throw new BadRequestException('Set both latitude and longitude, or neither.');
    }
  }

  private map(
    row: OltRow,
    counts?: Map<string, number>,
    onuCounts?: Map<string, number>,
  ) {
    const used = counts ?? new Map<string, number>();
    const onus = onuCounts ?? new Map<string, number>();
    const inherited = used.get('') ?? 0;
    // GPON-class ports carry 128 subscribers, EPON ports 64; a full port takes no more.
    const capacity = ponOnuCapacity(row.olt_type);
    const ponPorts = normalisePonPorts(row.pon_ports).map((port) => {
      const explicit = used.get(port.label.trim().toLowerCase()) ?? 0;
      const joints = explicit + (row.pon_port && port.label === row.pon_port ? inherited : 0);
      const onuCount = onus.get(port.label.trim().toLowerCase()) ?? 0;
      return {
        ...port,
        joints,
        onus: onuCount,
        capacity,
        full: onuCount >= capacity,
        status: joints > 0 ? 'in_use' : 'free',
      };
    });
    const uplink = row.uplink_port?.toLowerCase() ?? '';
    const ethernetPorts = normaliseEthernetPorts(row.ethernet_ports).map((port) => ({
      ...port,
      status: uplinkCarries(uplink, port.label) ? 'in_use' : 'free',
    }));
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      oltType: row.olt_type || 'gpon',
      ponPort: row.pon_port,
      uplinkPort: row.uplink_port,
      ponPorts,
      ethernetPorts,
      fibreId: row.fibre_id,
      notes: row.notes,
      areaId: row.area_id,
      areaName: row.area_name,
      subAreaId: row.sub_area_id,
      subAreaName: row.sub_area_name,
      districtId: row.district_id,
      districtName: row.district_name,
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
      tjCount: Number(row.tj_count),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

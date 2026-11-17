import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { linksTouching, releaseDeletedLinkCores } from '../database/link-core-release';
import {
  CreateOnuDto,
  ONU_CLASSES,
  ONU_CORE_STATUSES,
  PON_TYPES,
  UpdateOnuDto,
} from './onu.dto';

export interface OnuCore {
  label: string;
  color: string;
  status: (typeof ONU_CORE_STATUSES)[number];
  /** Which link is using this core, so removing that link can free it again. */
  connectedLinkId?: string | null;
}

interface OnuRow {
  id: string;
  username: string;
  mac_address: string | null;
  vlan_id: number | null;
  fibre_id: string;
  pon_type: string;
  onu_class: string;
  cores: unknown;
  notes: string | null;
  area_id: string | null;
  area_name: string | null;
  district_id: string | null;
  district_name: string | null;
  lat: number | null;
  lng: number | null;
  created_at: Date;
  updated_at: Date;
}

const ONU_SELECT = `
  SELECT o.id, o.username, o.mac_address, o.vlan_id, o.fibre_id, o.pon_type, o.onu_class,
         o.cores, o.notes,
         o.area_id, a.name AS area_name, a.district_id, d.name AS district_name,
         ST_Y(o.location::geometry) AS lat,
         ST_X(o.location::geometry) AS lng,
         o.created_at, o.updated_at
  FROM onus o
  LEFT JOIN areas a ON a.id = o.area_id
  LEFT JOIN districts d ON d.id = a.district_id`;

const FALLBACK_COLORS = [
  '#22d3ee',
  '#34d399',
  '#a78bfa',
  '#fbbf24',
  '#fb7185',
  '#60a5fa',
  '#a3e635',
  '#fb923c',
];

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

function normaliseCores(value: unknown): OnuCore[] {
  return asArray(value)
    .map((item, index): OnuCore | null => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as { label?: unknown; color?: unknown; status?: unknown };
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      if (!label) return null;
      const color =
        typeof entry.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.color)
          ? entry.color
          : FALLBACK_COLORS[index % FALLBACK_COLORS.length];
      const status =
        typeof entry.status === 'string' &&
        ONU_CORE_STATUSES.includes(entry.status as OnuCore['status'])
          ? (entry.status as OnuCore['status'])
          : 'free';
      const linked =
        typeof (entry as { connectedLinkId?: unknown }).connectedLinkId === 'string'
          ? (entry as { connectedLinkId: string }).connectedLinkId
          : null;
      return linked ? { label, color, status, connectedLinkId: linked } : { label, color, status };
    })
    .filter((entry): entry is OnuCore => entry !== null);
}

@Injectable()
export class OnuService {
  constructor(private readonly db: DatabaseService) {}

  async list(areaId?: string | null) {
    const rows = await this.db.query<OnuRow>(
      `${ONU_SELECT} WHERE ($1::uuid IS NULL OR o.area_id = $1::uuid) ORDER BY o.username ASC`,
      [areaId ?? null],
    );
    return rows.map((row) => this.map(row));
  }

  async get(id: string) {
    const rows = await this.db.query<OnuRow>(`${ONU_SELECT} WHERE o.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('ONU not found');
    return this.map(rows[0]);
  }

  async create(dto: CreateOnuDto, userId: string) {
    await this.assertArea(dto.areaId);
    this.assertLocation(dto.lat, dto.lng);
    this.assertVlan(dto.vlanId);

    const rows = await this.db.query<{ id: string }>(
      `       INSERT INTO onus (username, mac_address, vlan_id, fibre_id, pon_type, onu_class,
                         cores, notes, area_id, location, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
               CASE WHEN $10::double precision IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_MakePoint($11, $10), 4326)::geography END,
               $12)
       RETURNING id`,
      [
        dto.username.trim(),
        dto.macAddress?.trim() || null,
        dto.vlanId ?? null,
        dto.fibreId.trim(),
        dto.ponType ?? 'gpon',
        dto.onuClass ?? 'B+',
        JSON.stringify(normaliseCores(dto.cores)),
        dto.notes?.trim() || null,
        dto.areaId ?? null,
        dto.lat ?? null,
        dto.lng ?? null,
        userId,
      ],
    );
    return this.get(rows[0].id);
  }

  async update(id: string, dto: UpdateOnuDto) {
    const existing = await this.get(id);
    if (dto.areaId !== undefined) await this.assertArea(dto.areaId);
    this.assertLocation(dto.lat ?? existing.lat ?? undefined, dto.lng ?? existing.lng ?? undefined);
    if (dto.vlanId !== undefined) this.assertVlan(dto.vlanId);

    const lat = dto.lat ?? existing.lat;
    const lng = dto.lng ?? existing.lng;
    // Editing the ONU rebuilds its cores from the form; keep the link ownership
    // marker per core label so removing that link still frees the core.
    const cores =
      dto.cores !== undefined
        ? normaliseCores(dto.cores).map((core) => {
            const previous = existing.cores.find((item) => item.label === core.label);
            return previous?.connectedLinkId
              ? { ...core, connectedLinkId: previous.connectedLinkId }
              : core;
          })
        : existing.cores;

    const rows = await this.db.query<{ id: string }>(
      `UPDATE onus SET
         username = $2,
         mac_address = $3,
         vlan_id = $4,
         fibre_id = $5,
         pon_type = $6,
         onu_class = $7,
         cores = $8::jsonb,
         notes = $9,
         area_id = $10,
         location = CASE WHEN $11::double precision IS NULL THEN NULL
                         ELSE ST_SetSRID(ST_MakePoint($12, $11), 4326)::geography END,
         updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        id,
        dto.username?.trim() || existing.username,
        dto.macAddress !== undefined ? dto.macAddress?.trim() || null : existing.macAddress ?? null,
        dto.vlanId !== undefined ? dto.vlanId ?? null : existing.vlanId ?? null,
        dto.fibreId?.trim() || existing.fibreId,
        dto.ponType ?? existing.ponType ?? 'gpon',
        dto.onuClass ?? existing.onuClass ?? 'B+',
        JSON.stringify(cores),
        dto.notes !== undefined ? dto.notes?.trim() || null : existing.notes,
        dto.areaId !== undefined ? dto.areaId ?? null : existing.areaId,
        lat,
        lng,
      ],
    );
    return this.get(rows[0].id);
  }

  async remove(id: string) {
    const links = await linksTouching(this.db, 'onu', id);
    const rows = await this.db.query<{ id: string }>('DELETE FROM onus WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw new NotFoundException('ONU not found');
    await releaseDeletedLinkCores(this.db, links, id);
    return { ok: true, id };
  }

  private async assertArea(areaId?: string | null) {
    if (!areaId) return;
    const rows = await this.db.query<{ id: string }>('SELECT id FROM areas WHERE id = $1', [areaId]);
    if (rows.length === 0) throw new BadRequestException('That area no longer exists.');
  }

  private assertLocation(lat?: number, lng?: number) {
    if ((lat === undefined) !== (lng === undefined)) {
      throw new BadRequestException('Set both latitude and longitude, or neither.');
    }
  }

  private assertVlan(vlanId?: number | null) {
    if (vlanId === undefined || vlanId === null) return;
    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      throw new BadRequestException('VLAN ID must be a whole number between 1 and 4094.');
    }
  }

  private map(row: OnuRow) {
    return {
      id: row.id,
      username: row.username,
      macAddress: row.mac_address,
      vlanId: row.vlan_id === null ? null : Number(row.vlan_id),
      fibreId: row.fibre_id,
      ponType: PON_TYPES.includes(row.pon_type as (typeof PON_TYPES)[number])
        ? row.pon_type
        : 'gpon',
      onuClass: ONU_CLASSES.includes(row.onu_class as (typeof ONU_CLASSES)[number])
        ? row.onu_class
        : 'B+',
      cores: normaliseCores(row.cores),
      notes: row.notes,
      areaId: row.area_id,
      areaName: row.area_name,
      districtId: row.district_id,
      districtName: row.district_name,
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

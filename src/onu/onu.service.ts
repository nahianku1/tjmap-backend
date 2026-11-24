import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { linksTouching, releaseDeletedLinkCores } from '../database/link-core-release';
import { assertDeviceCodeAvailable } from '../database/device-codes';
import { resolvePlacement } from '../database/placement';
import { onuServingPort, ponOltFamily, ponOnuFamily } from '../olt/pon-capacity';
import { assertMacAvailable, normalizeMacAddress } from './mac-address';
import { assertVlanAvailable, syncOnuPonVlan } from './vlan-pool';
import { shiftLinkPathsForDevice } from '../tj/link.service';
import {
  CreateOnuDto,
  ONU_CLASSES,
  ONU_CORE_STATUSES,
  ONU_PORT_LABEL,
  PON_TYPES,
  UpdateOnuDto,
} from './onu.dto';

export interface OnuCore {
  /** Internal key only: an ONU port has no user-given name and no colour. */
  label: string;
  status: (typeof ONU_CORE_STATUSES)[number];
  /** Which link is using this port, so removing that link can free it again. */
  connectedLinkId?: string | null;
}

interface OnuRow {
  id: string;
  username: string;
  mac_address: string | null;
  vlan_id: number | null;
  fibre_id: string | null;
  pon_type: string;
  onu_class: string;
  cores: unknown;
  notes: string | null;
  area_id: string | null;
  area_name: string | null;
  sub_area_id: string | null;
  sub_area_name: string | null;
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
         o.sub_area_id, sa.name AS sub_area_name,
         ST_Y(o.location::geometry) AS lat,
         ST_X(o.location::geometry) AS lng,
         o.created_at, o.updated_at
  FROM onus o
  LEFT JOIN areas a ON a.id = o.area_id
  LEFT JOIN districts d ON d.id = a.district_id
  LEFT JOIN sub_areas sa ON sa.id = o.sub_area_id`;

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

/**
 * An ONU terminates one drop cable on a single PON input port, like a real ONU.
 * The port has no colour and no user-given name, so it is stored as one entry
 * under a fixed internal label. Rows saved by older builds may carry several
 * coloured cores; they collapse onto that one port, keeping whichever entry the
 * current link owns so deleting the link still frees it.
 */
export { ONU_PORT_LABEL };

export function onuPort(status: OnuCore['status'] = 'free'): OnuCore {
  return { label: ONU_PORT_LABEL, status };
}

function normaliseCores(value: unknown): OnuCore[] {
  const entries = asArray(value)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((entry) => ({
      status:
        typeof entry.status === 'string' &&
        ONU_CORE_STATUSES.includes(entry.status as OnuCore['status'])
          ? (entry.status as OnuCore['status'])
          : 'free',
      connectedLinkId:
        typeof entry.connectedLinkId === 'string' ? entry.connectedLinkId : null,
    }));
  const owned = entries.find((entry) => entry.connectedLinkId);
  const port = onuPort(owned?.status ?? entries[0]?.status ?? 'free');
  if (owned?.connectedLinkId) port.connectedLinkId = owned.connectedLinkId;
  return [port];
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
    const placement = await resolvePlacement(this.db, dto.areaId, dto.subAreaId);
    this.assertLocation(dto.lat, dto.lng);
    this.assertVlan(dto.vlanId);
    if (dto.vlanId != null) await assertVlanAvailable(this.db, dto.vlanId);
    await assertDeviceCodeAvailable(this.db, dto.username);
    const macAddress = normalizeMacAddress(dto.macAddress);
    await assertMacAvailable(this.db, macAddress);

    const rows = await this.db.query<{ id: string }>(
      `       INSERT INTO onus (username, mac_address, vlan_id, fibre_id, pon_type, onu_class,
                         cores, notes, area_id, location, created_by, sub_area_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
               CASE WHEN $10::double precision IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_MakePoint($11, $10), 4326)::geography END,
               $12, $13)
       RETURNING id`,
      [
        dto.username.trim(),
        macAddress,
        dto.vlanId ?? null,
        dto.fibreId?.trim() || null,
        dto.ponType ?? 'gpon',
        dto.onuClass ?? 'B+',
        JSON.stringify([onuPort()]),
        dto.notes?.trim() || null,
        placement.areaId,
        dto.lat ?? null,
        dto.lng ?? null,
        userId,
        placement.subAreaId,
      ],
    );
    // A registered subscriber is provisioned with a service VLAN straight away;
    // once a drop cable lands it takes the VLAN of its serving PON port instead.
    await syncOnuPonVlan(this.db, rows[0].id);
    return this.get(rows[0].id);
  }

  async update(id: string, dto: UpdateOnuDto) {
    const existing = await this.get(id);
    const placement = await resolvePlacement(
      this.db,
      dto.areaId !== undefined ? dto.areaId : existing.areaId,
      dto.subAreaId !== undefined ? dto.subAreaId : existing.subAreaId,
    );
    this.assertLocation(dto.lat ?? existing.lat ?? undefined, dto.lng ?? existing.lng ?? undefined);
    if (dto.vlanId !== undefined) this.assertVlan(dto.vlanId);
    if (dto.vlanId != null) await assertVlanAvailable(this.db, dto.vlanId, id);
    await this.assertPonTypeMatch(id, dto.ponType, existing.ponType);
    const username = dto.username?.trim() || existing.username;
    await assertDeviceCodeAvailable(this.db, username, id);
    let macAddress = existing.macAddress ?? null;
    if (dto.macAddress !== undefined) {
      if (!dto.macAddress?.trim()) {
        throw new BadRequestException('MAC address is required.');
      }
      macAddress = normalizeMacAddress(dto.macAddress);
      await assertMacAvailable(this.db, macAddress, id);
    }

    const lat = dto.lat ?? existing.lat;
    const lng = dto.lng ?? existing.lng;
    // The single PON input port belongs to whichever link is patched to it;
    // saving the ONU never renames it or changes its state. Writing the
    // normalised port back also folds legacy multi-core rows into one.
    const cores = existing.cores;

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
         sub_area_id = $13,
         updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        id,
        username,
        macAddress,
        dto.vlanId !== undefined ? dto.vlanId ?? null : existing.vlanId ?? null,
        dto.fibreId?.trim() || existing.fibreId,
        dto.ponType ?? existing.ponType ?? 'gpon',
        dto.onuClass ?? existing.onuClass ?? 'B+',
        JSON.stringify(cores),
        dto.notes !== undefined ? dto.notes?.trim() || null : existing.notes,
        placement.areaId,
        lat,
        lng,
        placement.subAreaId,
      ],
    );
    await syncOnuPonVlan(this.db, rows[0].id);
    // A moved subscriber carries its drop cable's drawn route along with it.
    if (existing.lat != null && existing.lng != null && lat != null && lng != null) {
      await shiftLinkPathsForDevice(
        this.db,
        { kind: 'onu', id },
        lat - existing.lat,
        lng - existing.lng,
      );
    }
    return this.get(rows[0].id);
  }

  async remove(id: string) {
    const links = await linksTouching(this.db, 'onu', id);
    const rows = await this.db.query<{ id: string }>('DELETE FROM onus WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw new NotFoundException('ONU not found');
    await releaseDeletedLinkCores(this.db, links, id);
    return { ok: true, id };
  }

  /**
   * PON technology is a property of the line card: a connected ONU cannot be
   * switched to a standard the OLT port it is provisioned on does not speak.
   */
  private async assertPonTypeMatch(
    id: string,
    next?: string | null,
    current?: string | null,
  ) {
    if (!next || next === current) return;
    const port = await onuServingPort(this.db, id);
    if (!port) return;
    const oltFamily = ponOltFamily(port.oltType);
    if (oltFamily === 'both' || oltFamily === ponOnuFamily(next)) return;
    const oltLabel = port.oltType.replace('_', '-').toUpperCase();
    const article = /^[aeioux]/i.test(oltLabel) ? 'an' : 'a';
    throw new BadRequestException(
      `${port.oltCode} PON ${port.portLabel} is ${article} ${oltLabel} port and only serves ` +
        `${oltLabel} ONUs — this ONU cannot be changed to ${next.toUpperCase()}.`,
    );
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
      subAreaId: row.sub_area_id,
      subAreaName: row.sub_area_name,
      districtId: row.district_id,
      districtName: row.district_name,
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

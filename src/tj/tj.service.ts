import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { guardDuplicate } from '../database/pg-errors';
import { OltService } from '../olt/olt.service';
import { OnuService } from '../onu/onu.service';
import { CreateTjDto, UpdateTjDto } from './tj.dto';

interface TjRow {
  id: string;
  code: string;
  name: string | null;
  tj_type: string | null;
  lat: number;
  lng: number;
  address: string | null;
  notes: string | null;
  fibre_id: string | null;
  input_power_dbm: number | null;
  cores: unknown;
  output_cores: unknown;
  splitter: unknown;
  is_cut: boolean;
  cut_reason: string | null;
  cut_severity: string | null;
  cut_data: unknown;
  pon_data: unknown;
  user_fibres: unknown;
  area_id: string | null;
  area_name: string | null;
  district_id: string | null;
  district_name: string | null;
  olt_id: string | null;
  olt_code: string | null;
  olt_name: string | null;
  olt_pon_port: string | null;
  olt_uplink_port: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LinkRow {
  id: string;
  from_tj_id: string | null;
  from_olt_id: string | null;
  from_onu_id: string | null;
  to_tj_id: string | null;
  to_olt_id: string | null;
  to_onu_id: string | null;
  from_code: string;
  to_code: string;
  from_name: string | null;
  to_name: string | null;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  fibre_id: string;
  cable_type: string | null;
  core_count: number;
  from_core_label: string | null;
  to_core_label: string | null;
  cores: unknown;
  path: unknown;
  status: string;
  length_m: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const TJ_SELECT = `
  SELECT t.id, t.code, t.name, t.tj_type,
         ST_Y(t.location::geometry) AS lat,
         ST_X(t.location::geometry) AS lng,
         t.address, t.notes, t.fibre_id, t.input_power_dbm,
         t.cores, t.output_cores, t.splitter,
         t.is_cut, t.cut_reason, t.cut_severity,
         t.cut_data, t.pon_data, t.user_fibres,
         t.area_id, a.name AS area_name, a.district_id, d.name AS district_name,
         t.olt_id, o.code AS olt_code, o.name AS olt_name,
         o.pon_port AS olt_pon_port, o.uplink_port AS olt_uplink_port,
         t.created_at, t.updated_at
  FROM tjs t
  LEFT JOIN areas a ON a.id = t.area_id
  LEFT JOIN districts d ON d.id = a.district_id
  LEFT JOIN olts o ON o.id = t.olt_id`;

const LINK_SELECT = `
  SELECT l.id, l.from_tj_id, l.from_olt_id, l.from_onu_id,
         l.to_tj_id, l.to_olt_id, l.to_onu_id,
         COALESCE(f.code, fo.code, fu.username) AS from_code,
         COALESCE(t.code, o.code, ou.username) AS to_code,
         COALESCE(f.name, fo.name, fu.fibre_id) AS from_name,
         COALESCE(t.name, o.name, ou.fibre_id) AS to_name,
         ST_Y(COALESCE(f.location, fo.location, fu.location)::geometry) AS from_lat,
         ST_X(COALESCE(f.location, fo.location, fu.location)::geometry) AS from_lng,
         ST_Y(COALESCE(t.location, o.location, ou.location)::geometry) AS to_lat,
         ST_X(COALESCE(t.location, o.location, ou.location)::geometry) AS to_lng,
         l.fibre_id, l.cable_type, l.core_count, l.from_core_label, l.to_core_label,
         l.cores, l.path, l.status, l.length_m, l.notes,
         l.created_at, l.updated_at
  FROM tj_links l
  LEFT JOIN tjs f ON f.id = l.from_tj_id
  LEFT JOIN olts fo ON fo.id = l.from_olt_id
  LEFT JOIN onus fu ON fu.id = l.from_onu_id
  LEFT JOIN tjs t ON t.id = l.to_tj_id
  LEFT JOIN olts o ON o.id = l.to_olt_id
  LEFT JOIN onus ou ON ou.id = l.to_onu_id`;

@Injectable()
export class TjService {
  constructor(
    private readonly db: DatabaseService,
    private readonly olts: OltService,
    private readonly onus: OnuService,
  ) {}

  async network() {
    const [tjs, links, olts, onus] = await Promise.all([
      this.db.query<TjRow>(`${TJ_SELECT} ORDER BY t.code ASC`),
      this.db.query<LinkRow>(`${LINK_SELECT} ORDER BY l.created_at ASC`),
      this.olts.list(),
      this.onus.list(),
    ]);
    return {
      tjs: tjs.map((row) => this.mapTj(row)),
      links: links.map((row) => this.mapLink(row)),
      olts,
      onus,
    };
  }

  /** Joints that belong to one area, plus every span touching them. */
  async networkForArea(areaId: string) {
    const [tjs, links, olts, onus] = await Promise.all([
      this.db.query<TjRow>(`${TJ_SELECT} WHERE t.area_id = $1 ORDER BY t.code ASC`, [areaId]),
      this.db.query<LinkRow>(
        `${LINK_SELECT}
         WHERE l.from_tj_id IN (SELECT id FROM tjs WHERE area_id = $1)
            OR l.to_tj_id IN (SELECT id FROM tjs WHERE area_id = $1)
            OR l.from_olt_id IN (SELECT id FROM olts WHERE area_id = $1)
            OR l.to_olt_id IN (SELECT id FROM olts WHERE area_id = $1)
            OR l.from_onu_id IN (SELECT id FROM onus WHERE area_id = $1)
            OR l.to_onu_id IN (SELECT id FROM onus WHERE area_id = $1)
         ORDER BY l.created_at ASC`,
        [areaId],
      ),
      this.olts.list(areaId),
      this.onus.list(areaId),
    ]);
    return {
      tjs: tjs.map((row) => this.mapTj(row)),
      links: links.map((row) => this.mapLink(row)),
      olts,
      onus,
    };
  }

  async list() {
    const rows = await this.db.query<TjRow>(`${TJ_SELECT} ORDER BY t.code ASC`);
    return rows.map((row) => this.mapTj(row));
  }

  async get(id: string) {
    const rows = await this.db.query<TjRow>(`${TJ_SELECT} WHERE t.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Terminal joint not found');
    return this.mapTj(rows[0]);
  }

  async create(dto: CreateTjDto, userId: string) {
    await this.assertArea(dto.areaId);
    await this.assertOlt(dto.oltId);
    const tjType = dto.tjType ?? (dto.isCut ? 'cut' : 'box');
    const isCut = tjType === 'cut' || dto.isCut === true;

    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
      `INSERT INTO tjs (code, name, tj_type, location, address, notes, fibre_id,
                        input_power_dbm, cores, output_cores, splitter,
                        is_cut, cut_reason, cut_severity, cut_data, pon_data, area_id, user_fibres, created_by, olt_id)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8,
               $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19::jsonb, $20, $21)
       RETURNING id`,
      [
        dto.code.trim().toUpperCase(),
        dto.name?.trim() || null,
        tjType,
        dto.lng,
        dto.lat,
        dto.address?.trim() || null,
        dto.notes?.trim() || null,
        dto.fibreId?.trim() || null,
        dto.inputPowerDbm !== undefined ? dto.inputPowerDbm : null,
        JSON.stringify(dto.cores ?? []),
        JSON.stringify(dto.outputCores ?? dto.splitter?.outputs ?? []),
        JSON.stringify(dto.splitter ?? { enabled: false, ratio: null, outputs: [] }),
        isCut,
        dto.cutReason?.trim() || null,
        dto.cutSeverity ?? null,
        JSON.stringify(dto.cutData ?? {}),
        JSON.stringify(dto.ponData ?? {}),
        dto.areaId ?? null,
        JSON.stringify(dto.userFibres ?? []),
        userId,
        dto.oltId ?? null,
      ],
    ),
      'A terminal joint with this code already exists.',
    );
    return this.get(rows[0].id);
  }

  async update(id: string, dto: UpdateTjDto) {
    const existing = await this.get(id);
    await this.assertArea(dto.areaId);
    await this.assertOlt(dto.oltId);

    const tjType = dto.tjType ?? existing.tjType ?? (dto.isCut ? 'cut' : 'box');
    const isCut = tjType === 'cut' || (dto.isCut !== undefined ? dto.isCut : existing.isCut);

    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
      `UPDATE tjs SET
         code = $2,
         name = $3,
         tj_type = $4,
         location = ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         address = $7,
         notes = $8,
         fibre_id = $9,
         input_power_dbm = $10,
         cores = $11::jsonb,
         output_cores = $12::jsonb,
         splitter = $13::jsonb,
         is_cut = $14,
         cut_reason = $15,
         cut_severity = $16,
         cut_data = $17::jsonb,
         pon_data = $18::jsonb,
         area_id = $19,
         user_fibres = $20::jsonb,
         olt_id = $21,
         updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        id,
        (dto.code ?? existing.code).toUpperCase(),
        dto.name !== undefined ? dto.name?.trim() || null : existing.name,
        tjType,
        dto.lng ?? existing.lng,
        dto.lat ?? existing.lat,
        dto.address !== undefined ? dto.address?.trim() || null : existing.address,
        dto.notes !== undefined ? dto.notes?.trim() || null : existing.notes,
        dto.fibreId !== undefined ? dto.fibreId?.trim() || null : existing.fibreId,
        dto.inputPowerDbm !== undefined ? dto.inputPowerDbm : existing.inputPowerDbm ?? null,
        JSON.stringify(dto.cores ?? existing.cores),
        JSON.stringify(dto.outputCores ?? existing.outputCores ?? existing.splitter?.outputs ?? []),
        JSON.stringify(dto.splitter ?? existing.splitter),
        isCut,
        !isCut
          ? null
          : dto.cutReason !== undefined
            ? dto.cutReason?.trim() || null
            : existing.cutReason,
        !isCut ? null : (dto.cutSeverity ?? existing.cutSeverity),
        JSON.stringify(dto.cutData ?? existing.cutData ?? {}),
        JSON.stringify(dto.ponData ?? existing.ponData ?? {}),
        dto.areaId !== undefined ? dto.areaId ?? null : existing.areaId,
        JSON.stringify(dto.userFibres ?? (existing as any).userFibres ?? []),
        dto.oltId !== undefined ? dto.oltId ?? null : existing.oltId,
      ],
    ),
      'A terminal joint with this code already exists.',
    );

    return this.get(rows[0].id);
  }

  private async assertArea(areaId?: string | null) {
    if (!areaId) return;
    const rows = await this.db.query<{ id: string }>('SELECT id FROM areas WHERE id = $1', [areaId]);
    if (rows.length === 0) throw new BadRequestException('That area no longer exists.');
  }

  private async assertOlt(oltId?: string | null) {
    if (!oltId) return;
    const rows = await this.db.query<{ id: string }>('SELECT id FROM olts WHERE id = $1', [oltId]);
    if (rows.length === 0) throw new BadRequestException('That OLT no longer exists.');
  }

  async remove(id: string) {
    const rows = await this.db.query<{ id: string }>('DELETE FROM tjs WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw new NotFoundException('Terminal joint not found');
    return { ok: true, id };
  }

  private mapTj(row: TjRow) {
    const rawSplitter = (row.splitter as any) ?? { enabled: false, ratio: null, outputs: [] };
    const rawOutputCores = (row.output_cores as any) ?? rawSplitter.outputs ?? [];

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      tjType: (row.tj_type as any) ?? (row.is_cut ? 'cut' : 'box'),
      lat: Number(row.lat),
      lng: Number(row.lng),
      address: row.address,
      notes: row.notes,
      fibreId: row.fibre_id,
      inputPowerDbm: row.input_power_dbm !== null && row.input_power_dbm !== undefined ? Number(row.input_power_dbm) : null,
      cores: (row.cores as any) ?? [],
      outputCores: rawOutputCores,
      splitter: rawSplitter,
      isCut: row.is_cut,
      cutReason: row.cut_reason,
      cutSeverity: row.cut_severity,
      cutData: (row.cut_data as any) ?? {},
      ponData: (row.pon_data as any) ?? {},
      userFibres: (row.user_fibres as any) ?? [],
      areaId: row.area_id,
      areaName: row.area_name,
      districtId: row.district_id,
      districtName: row.district_name,
      oltId: row.olt_id,
      olt: row.olt_id
        ? {
            id: row.olt_id,
            code: row.olt_code,
            name: row.olt_name,
            ponPort: row.olt_pon_port,
            uplinkPort: row.olt_uplink_port,
          }
        : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private mapLink(row: LinkRow) {
    return {
      id: row.id,
      fromKind: (row.from_olt_id ? 'olt' : row.from_onu_id ? 'onu' : 'tj') as
        | 'tj'
        | 'olt'
        | 'onu',
      toKind: (row.to_olt_id ? 'olt' : row.to_onu_id ? 'onu' : 'tj') as
        | 'tj'
        | 'olt'
        | 'onu',
      fromTjId: row.from_tj_id,
      fromOltId: row.from_olt_id,
      fromOnuId: row.from_onu_id,
      toTjId: row.to_tj_id,
      toOltId: row.to_olt_id,
      toOnuId: row.to_onu_id,
      fromCode: row.from_code,
      toCode: row.to_code,
      fromName: row.from_name,
      toName: row.to_name,
      fromLat: Number(row.from_lat),
      fromLng: Number(row.from_lng),
      toLat: Number(row.to_lat),
      toLng: Number(row.to_lng),
      fibreId: row.fibre_id,
      cableType: row.cable_type,
      coreCount: row.core_count,
      fromCoreLabel: row.from_core_label ?? null,
      toCoreLabel: row.to_core_label ?? null,
      cores: Array.isArray(row.cores) ? row.cores : [],
      path: Array.isArray(row.path) ? row.path : [],
      status: row.status,
      lengthM: row.length_m === null ? null : Number(row.length_m),
      notes: row.notes,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

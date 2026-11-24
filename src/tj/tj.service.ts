import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { linksTouching, releaseDeletedLinkCores } from '../database/link-core-release';
import { guardDuplicate } from '../database/pg-errors';
import { assertDeviceCodeAvailable } from '../database/device-codes';
import { resolvePlacement } from '../database/placement';
import { OltService } from '../olt/olt.service';
import { OnuService } from '../onu/onu.service';
import { ChangeOutputCoreDto, CreateTjDto, UpdateTjDto } from './tj.dto';
import { shiftLinkPathsForDevice } from './link.service';

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
  splitters: unknown;
  is_cut: boolean;
  cut_reason: string | null;
  cut_severity: string | null;
  cut_data: unknown;
  pon_data: unknown;
  user_fibres: unknown;
  area_id: string | null;
  area_name: string | null;
  sub_area_id: string | null;
  sub_area_name: string | null;
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
  sub_area_id: string | null;
  sub_area_name: string | null;
  status: string;
  length_m: number | null;
  attenuation_db_per_km: number;
  splice_count: number;
  connection_loss_db: number;
  color: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const TJ_SELECT = `
  SELECT t.id, t.code, t.name, t.tj_type,
         ST_Y(t.location::geometry) AS lat,
         ST_X(t.location::geometry) AS lng,
         t.address, t.notes, t.fibre_id, t.input_power_dbm,
         t.cores, t.output_cores, t.splitter, t.splitters,
         t.is_cut, t.cut_reason, t.cut_severity,
         t.cut_data, t.pon_data, t.user_fibres,
         t.area_id, a.name AS area_name, a.district_id, d.name AS district_name,
         t.sub_area_id, sa.name AS sub_area_name,
         t.olt_id, o.code AS olt_code, o.name AS olt_name,
         o.pon_port AS olt_pon_port, o.uplink_port AS olt_uplink_port,
         t.created_at, t.updated_at
  FROM tjs t
  LEFT JOIN areas a ON a.id = t.area_id
  LEFT JOIN districts d ON d.id = a.district_id
  LEFT JOIN sub_areas sa ON sa.id = t.sub_area_id
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
         l.cores, l.path, l.status, l.length_m,
         l.sub_area_id, s.name AS sub_area_name,
         l.attenuation_db_per_km, l.splice_count, l.connection_loss_db, l.color,
         l.notes, l.created_at, l.updated_at
  FROM tj_links l
  LEFT JOIN tjs f ON f.id = l.from_tj_id
  LEFT JOIN olts fo ON fo.id = l.from_olt_id
  LEFT JOIN onus fu ON fu.id = l.from_onu_id
  LEFT JOIN tjs t ON t.id = l.to_tj_id
  LEFT JOIN olts o ON o.id = l.to_olt_id
  LEFT JOIN onus ou ON ou.id = l.to_onu_id
  LEFT JOIN sub_areas s ON s.id = l.sub_area_id`;

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
    const placement = await resolvePlacement(this.db, dto.areaId, dto.subAreaId);
    await this.assertOlt(dto.oltId);
    const tjType = dto.tjType ?? (dto.isCut ? 'cut' : 'box');
    const isCut = tjType === 'cut' || dto.isCut === true;
    const code = dto.code.trim().toUpperCase();
    await assertDeviceCodeAvailable(this.db, code);

    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
      `INSERT INTO tjs (code, name, tj_type, location, address, notes, fibre_id,
                        input_power_dbm, cores, output_cores, splitter,
                        is_cut, cut_reason, cut_severity, cut_data, pon_data, area_id, user_fibres, created_by, olt_id,
                        splitters, sub_area_id)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8,
               $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19::jsonb, $20, $21,
               $22::jsonb, $23)
       RETURNING id`,
      [
        code,
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
        placement.areaId,
        JSON.stringify(dto.userFibres ?? []),
        userId,
        dto.oltId ?? null,
        JSON.stringify(dto.splitters ?? (dto.splitter ? [dto.splitter] : [])),
        placement.subAreaId,
      ],
    ),
      'A terminal joint with this code already exists.',
    );
    return this.get(rows[0].id);
  }

  async update(id: string, dto: UpdateTjDto) {
    const existing = await this.get(id);
    const placement = await resolvePlacement(
      this.db,
      dto.areaId !== undefined ? dto.areaId : existing.areaId,
      dto.subAreaId !== undefined ? dto.subAreaId : existing.subAreaId,
    );
    await this.assertOlt(dto.oltId);

    const tjType = dto.tjType ?? existing.tjType ?? (dto.isCut ? 'cut' : 'box');
    const isCut = tjType === 'cut' || (dto.isCut !== undefined ? dto.isCut : existing.isCut);
    const code = (dto.code ?? existing.code).toUpperCase();
    await assertDeviceCodeAvailable(this.db, code, id);

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
         splitters = $22::jsonb,
         sub_area_id = $23,
         updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [
        id,
        code,
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
        placement.areaId,
        JSON.stringify(dto.userFibres ?? (existing as any).userFibres ?? []),
        dto.oltId !== undefined ? dto.oltId ?? null : existing.oltId,
        JSON.stringify(
          dto.splitters ??
            (existing as any).splitters ??
            (existing.splitter ? [existing.splitter] : []),
        ),
        placement.subAreaId,
      ],
    ),
      'A terminal joint with this code already exists.',
    );

    // A moved joint carries its drawn fibre routes along with it.
    const movedLat = dto.lat ?? existing.lat;
    const movedLng = dto.lng ?? existing.lng;
    if (existing.lat != null && existing.lng != null && movedLat != null && movedLng != null) {
      await shiftLinkPathsForDevice(
        this.db,
        { kind: 'tj', id },
        movedLat - existing.lat,
        movedLng - existing.lng,
      );
    }
    return this.get(rows[0].id);
  }

  /**
   * Moves everything patched onto one output core — the cable links terminated
   * on it and the user drop cables joined to it — onto another free output core.
   * This is the field fix for a faulty splitter leg: the old core keeps its Cut
   * mark so it is never handed out again, and the power path follows the move.
   */
  async changeOutputCore(id: string, dto: ChangeOutputCoreDto) {
    const fromLabel = dto.fromLabel?.trim();
    const toLabel = dto.toLabel?.trim();
    if (!fromLabel || !toLabel) {
      throw new BadRequestException('Pick the output core to change and the free core to move onto.');
    }
    if (fromLabel === toLabel) {
      throw new BadRequestException('Pick a different output core.');
    }

    const rows = await this.db.query<{
      user_fibres: unknown;
      output_cores: unknown;
      splitter: unknown;
      splitters: unknown;
    }>('SELECT user_fibres, output_cores, splitter, splitters FROM tjs WHERE id = $1', [id]);
    if (rows.length === 0) throw new NotFoundException('Terminal joint not found');
    const row = rows[0];

    // A joint keeps its legs in the legacy `output_cores` column, the legacy
    // single `splitter` and each splitter of `splitters`; all of them mirror.
    const legacySplitter = (row.splitter ?? null) as Record<string, unknown> | null;
    const splitters = Array.isArray(row.splitters)
      ? (row.splitters as Record<string, unknown>[])
      : [];
    const outputLists: unknown[][] = [];
    if (Array.isArray(row.output_cores)) outputLists.push(row.output_cores as unknown[]);
    if (legacySplitter && Array.isArray(legacySplitter.outputs)) {
      outputLists.push(legacySplitter.outputs as unknown[]);
    }
    splitters.forEach((splitter) => {
      if (Array.isArray(splitter.outputs)) outputLists.push(splitter.outputs as unknown[]);
    });

    const findCore = (label: string): Record<string, unknown> | null => {
      for (const list of outputLists) {
        const found = list.find(
          (item) => (item as Record<string, unknown> | null)?.label === label,
        );
        if (found) return found as Record<string, unknown>;
      }
      return null;
    };

    const source = findCore(fromLabel);
    if (!source) throw new BadRequestException('That output core is not on this joint.');
    const target = findCore(toLabel);
    if (!target) throw new BadRequestException('Pick another output core of this joint.');

    if (
      String(target.status ?? 'free') !== 'free' ||
      target.connectedLinkId ||
      target.connectedUserFibreId
    ) {
      throw new BadRequestException('That output core is already in use. Pick a free one.');
    }

    const userFibres = Array.isArray(row.user_fibres)
      ? (row.user_fibres as Record<string, unknown>[])
      : [];
    const movingFibres = userFibres.filter((fibre) => fibre.outputCoreLabel === fromLabel);

    // A cable link terminates on this joint under the output core's label.
    const links = await this.db.query<{
      id: string;
      from_tj_id: string | null;
      to_tj_id: string | null;
      cores: unknown;
    }>(
      'SELECT id, from_tj_id, to_tj_id, cores FROM tj_links WHERE from_tj_id = $1 OR to_tj_id = $1',
      [id],
    );
    const movedLinks = links.flatMap((link) => {
      const key = link.from_tj_id === id ? 'fromCoreLabel' : 'toCoreLabel';
      const cores = Array.isArray(link.cores) ? (link.cores as Record<string, unknown>[]) : [];
      let changed = false;
      const next = cores.map((core) => {
        if (!core || core[key] !== fromLabel) return core;
        changed = true;
        return { ...core, [key]: toLabel };
      });
      return changed ? [{ id: link.id, cores: next }] : [];
    });

    const sourceStatus = String(source.status ?? 'free');
    if (sourceStatus === 'free' && movingFibres.length === 0 && movedLinks.length === 0) {
      throw new BadRequestException('Nothing is patched onto that output core yet.');
    }

    // Ownership follows the cables, so the old core can be handed out again once
    // it is repaired, and the new core is shown as In Use by the same link.
    const owner = Object.fromEntries(
      Object.entries({
        connectedLinkId: movedLinks.length === 1 ? movedLinks[0].id : source.connectedLinkId,
        connectedUserFibreId: source.connectedUserFibreId,
        connectedUserCoreLabel: source.connectedUserCoreLabel,
      }).filter(([, value]) => value !== undefined && value !== null),
    );
    const stripOwner = (core: Record<string, unknown>) => {
      const { connectedLinkId, connectedUserFibreId, connectedUserCoreLabel, ...rest } = core;
      return rest;
    };

    const rewrite = (list: unknown): unknown[] | null => {
      if (!Array.isArray(list)) return null;
      let changed = false;
      const next = list.map((item) => {
        const core = { ...((item ?? {}) as Record<string, unknown>) };
        if (core.label === fromLabel) {
          changed = true;
          return {
            ...stripOwner(core),
            status: sourceStatus === 'damaged' ? 'damaged' : 'free',
          };
        }
        if (core.label === toLabel) {
          changed = true;
          return { ...stripOwner(core), ...owner, status: 'in_use' };
        }
        return core;
      });
      return changed ? next : null;
    };

    const outputCores = rewrite(row.output_cores) ?? (row.output_cores ?? []);
    const nextSplitter = legacySplitter
      ? { ...legacySplitter, outputs: rewrite(legacySplitter.outputs) ?? legacySplitter.outputs ?? [] }
      : row.splitter;
    const nextSplitters = splitters.map((splitter) => {
      const outputs = rewrite(splitter.outputs);
      return outputs ? { ...splitter, outputs } : splitter;
    });

    for (const link of movedLinks) {
      const primaryFrom =
        link.cores.find((core) => core?.fromCoreLabel)?.fromCoreLabel ?? null;
      const primaryTo = link.cores.find((core) => core?.toCoreLabel)?.toCoreLabel ?? null;
      await this.db.query(
        `UPDATE tj_links SET cores = $2::jsonb, from_core_label = $3, to_core_label = $4,
                             updated_at = now()
         WHERE id = $1`,
        [link.id, JSON.stringify(link.cores), primaryFrom, primaryTo],
      );
    }

    await this.db.query(
      `UPDATE tjs SET output_cores = $2::jsonb, splitter = $3::jsonb, splitters = $4::jsonb,
                      user_fibres = $5::jsonb, updated_at = now()
       WHERE id = $1`,
      [
        id,
        JSON.stringify(outputCores),
        JSON.stringify(nextSplitter ?? { enabled: false, ratio: null, outputs: [] }),
        JSON.stringify(nextSplitters),
        JSON.stringify(
          userFibres.map((fibre) =>
            fibre.outputCoreLabel === fromLabel
              ? { ...fibre, outputCoreLabel: toLabel }
              : fibre,
          ),
        ),
      ],
    );

    return this.get(id);
  }

  private async assertOlt(oltId?: string | null) {
    if (!oltId) return;
    const rows = await this.db.query<{ id: string }>('SELECT id FROM olts WHERE id = $1', [oltId]);
    if (rows.length === 0) throw new BadRequestException('That OLT no longer exists.');
  }

  async remove(id: string) {
    const links = await linksTouching(this.db, 'tj', id);
    const rows = await this.db.query<{ id: string }>('DELETE FROM tjs WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw new NotFoundException('Terminal joint not found');
    await releaseDeletedLinkCores(this.db, links, id);
    return { ok: true, id };
  }

  private mapTj(row: TjRow) {
    const rawSplitter = (row.splitter as any) ?? { enabled: false, ratio: null, outputs: [] };
    // A joint can carry several splitters; the legacy single `splitter` column is
    // folded in so older rows still report one.
    const rawSplitters =
      Array.isArray(row.splitters) && row.splitters.length > 0
        ? (row.splitters as any[])
        : [rawSplitter];
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
      splitter: rawSplitters[0] ?? rawSplitter,
      splitters: rawSplitters,
      isCut: row.is_cut,
      cutReason: row.cut_reason,
      cutSeverity: row.cut_severity,
      cutData: (row.cut_data as any) ?? {},
      ponData: (row.pon_data as any) ?? {},
      userFibres: (row.user_fibres as any) ?? [],
      areaId: row.area_id,
      areaName: row.area_name,
      subAreaId: row.sub_area_id,
      subAreaName: row.sub_area_name,
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
      subAreaId: row.sub_area_id,
      subAreaName: row.sub_area_name,
      status: row.status,
      lengthM: row.length_m === null ? null : Number(row.length_m),
      attenuationDbPerKm:
        row.attenuation_db_per_km === null || row.attenuation_db_per_km === undefined
          ? 0.5
          : Number(row.attenuation_db_per_km),
      spliceCount:
        row.splice_count === null || row.splice_count === undefined
          ? 2
          : Number(row.splice_count),
      connectionLossDb:
        row.connection_loss_db === null || row.connection_loss_db === undefined
          ? 0.2
          : Number(row.connection_loss_db),
      color: row.color ?? null,
      notes: row.notes,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

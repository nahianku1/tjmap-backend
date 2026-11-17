import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateLinkDto, LinkCoreDto, UpdateLinkDto } from './tj.dto';

type EndpointKind = 'tj' | 'olt' | 'onu';

interface Endpoint {
  kind: EndpointKind;
  id: string;
  code: string;
  name: string | null;
  lat: number;
  lng: number;
}

export interface LinkPathPoint {
  lat: number;
  lng: number;
}

export interface LinkCore {
  index: number;
  label: string;
  color: string;
  status: 'connected' | 'free';
  fromCoreLabel: string | null;
  toCoreLabel: string | null;
  /** Extra loss carried by this strand, in dB (0 for a healthy core). */
  lossDb: number;
}

/** Clamps the per-core extra loss to a sane 0–99 dB range. */
function normaliseLoss(value: unknown): number {
  const loss = Number(value);
  if (!Number.isFinite(loss)) return 0;
  return Math.round(Math.min(Math.max(loss, 0), 99) * 100) / 100;
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
  attenuation_db_per_km: number;
  splice_count: number;
  connection_loss_db: number;
  color: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function normalisePath(raw: unknown): LinkPathPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).flatMap((item) => {
    const point = (item ?? {}) as { lat?: unknown; lng?: unknown };
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    return [{ lat, lng }];
  });
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Length of the span through its drawn waypoints, or the straight line when none were drawn. */
function routeLengthMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  path: LinkPathPoint[],
): number {
  const points = [
    { lat: fromLat, lng: fromLng },
    ...path,
    { lat: toLat, lng: toLng },
  ];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMeters(
      points[index - 1].lat,
      points[index - 1].lng,
      points[index].lat,
      points[index].lng,
    );
  }
  return total;
}

const CORE_COLORS = [
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#fbbf24',
  '#34d399',
  '#60a5fa',
  '#fb7185',
  '#c084fc',
  '#4ade80',
  '#facc15',
  '#38bdf8',
  '#f97316',
];

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
         l.attenuation_db_per_km, l.splice_count, l.connection_loss_db, l.color,
         l.notes, l.created_at, l.updated_at
  FROM tj_links l
  LEFT JOIN tjs f ON f.id = l.from_tj_id
  LEFT JOIN olts fo ON fo.id = l.from_olt_id
  LEFT JOIN onus fu ON fu.id = l.from_onu_id
  LEFT JOIN tjs t ON t.id = l.to_tj_id
  LEFT JOIN olts o ON o.id = l.to_olt_id
  LEFT JOIN onus ou ON ou.id = l.to_onu_id`;

function normaliseCores(
  raw: LinkCoreDto[] | undefined,
  count: number,
  legacyFrom?: string | null,
  legacyTo?: string | null,
): LinkCore[] {
  const source: LinkCoreDto[] =
    raw && raw.length > 0
      ? raw
      : Array.from({ length: Math.max(0, Math.min(count, 288)) }, (_value, index) => ({
          index: index + 1,
          label: `Core ${index + 1}`,
          color: CORE_COLORS[index % CORE_COLORS.length],
          fromCoreLabel: index === 0 ? legacyFrom ?? null : null,
          toCoreLabel: index === 0 ? legacyTo ?? null : null,
          lossDb: 0,
        }));

  return source.slice(0, 288).map((row, index) => {
    const fromCoreLabel = row.fromCoreLabel?.trim() || null;
    const toCoreLabel = row.toCoreLabel?.trim() || null;
    return {
      index: row.index ?? index + 1,
      label: row.label?.trim() || `Core ${index + 1}`,
      color: row.color ?? CORE_COLORS[index % CORE_COLORS.length],
      fromCoreLabel,
      toCoreLabel,
      status: fromCoreLabel && toCoreLabel ? 'connected' : 'free',
      lossDb: normaliseLoss(row.lossDb),
    };
  });
}

function parseStoredCores(value: unknown): LinkCore[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const entry = (item ?? {}) as Partial<LinkCore>;
    return {
      index: Number(entry.index ?? index + 1),
      label: entry.label ?? `Core ${index + 1}`,
      color: entry.color ?? CORE_COLORS[index % CORE_COLORS.length],
      status: entry.status === 'connected' ? 'connected' : 'free',
      fromCoreLabel: entry.fromCoreLabel ?? null,
      toCoreLabel: entry.toCoreLabel ?? null,
      lossDb: normaliseLoss(entry.lossDb),
    };
  });
}

@Injectable()
export class LinkService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const rows = await this.db.query<LinkRow>(`${LINK_SELECT} ORDER BY l.created_at ASC`);
    return rows.map((row) => this.mapLink(row));
  }

  async get(id: string) {
    const rows = await this.db.query<LinkRow>(`${LINK_SELECT} WHERE l.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Fibre link not found');
    return this.mapLink(rows[0]);
  }

  async create(dto: CreateLinkDto, userId: string) {
    const from = await this.resolveEndpoint(dto.fromTjId, dto.fromOltId, dto.fromOnuId, 'from');
    const to = await this.resolveEndpoint(dto.toTjId, dto.toOltId, dto.toOnuId, 'to');
    this.assertDistinct(from, to);

    const cores = normaliseCores(dto.cores, dto.coreCount ?? dto.cores?.length ?? 0, dto.fromCoreLabel, dto.toCoreLabel);
    const primaryFrom = cores.find((core) => core.fromCoreLabel)?.fromCoreLabel ?? null;
    const primaryTo = cores.find((core) => core.toCoreLabel)?.toCoreLabel ?? null;
    const path = normalisePath(dto.path);
    const lengthM = routeLengthMeters(from.lat, from.lng, to.lat, to.lng, path);

    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO tj_links (from_tj_id, from_olt_id, from_onu_id,
                             to_tj_id, to_olt_id, to_onu_id,
                             fibre_id, cable_type, core_count, from_core_label, to_core_label,
                             cores, status, notes, created_by, path, length_m,
                             attenuation_db_per_km, splice_count, connection_loss_db, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15,
               $16::jsonb, $17, $18, $19, $20, $21)
       RETURNING id`,
      [
        from.kind === 'tj' ? from.id : null,
        from.kind === 'olt' ? from.id : null,
        from.kind === 'onu' ? from.id : null,
        to.kind === 'tj' ? to.id : null,
        to.kind === 'olt' ? to.id : null,
        to.kind === 'onu' ? to.id : null,
        dto.fibreId.trim(),
        dto.cableType?.trim() || null,
        cores.length,
        primaryFrom,
        primaryTo,
        JSON.stringify(cores),
        dto.status ?? 'active',
        dto.notes?.trim() || null,
        userId,
        JSON.stringify(path),
        lengthM,
        dto.attenuationDbPerKm ?? 0.35,
        dto.spliceCount ?? 2,
        dto.connectionLossDb ?? 1.0,
        dto.color ?? null,
      ],
    );

    await this.syncDeviceCores(rows[0].id, from, cores.map((core) => core.fromCoreLabel));
    await this.syncDeviceCores(rows[0].id, to, cores.map((core) => core.toCoreLabel));
    await this.syncOnuCores(rows[0].id, from, cores.map((core) => core.fromCoreLabel));
    await this.syncOnuCores(rows[0].id, to, cores.map((core) => core.toCoreLabel));
    return this.get(rows[0].id);
  }

  async update(id: string, dto: UpdateLinkDto) {
    const current = await this.db.query<LinkRow>(`${LINK_SELECT} WHERE l.id = $1`, [id]);
    if (current.length === 0) throw new NotFoundException('Fibre link not found');
    const row = current[0];
    const from = await this.endpointForRow(row, 'from');
    const to = await this.endpointForRow(row, 'to');

    const cores =
      dto.cores !== undefined || dto.coreCount !== undefined
        ? normaliseCores(
            dto.cores,
            dto.coreCount ?? row.core_count,
            row.from_core_label,
            row.to_core_label,
          )
        : parseStoredCores(row.cores);

    const path = dto.path !== undefined ? normalisePath(dto.path) : normalisePath(row.path);
    const lengthM = routeLengthMeters(from.lat, from.lng, to.lat, to.lng, path);

    await this.db.query(
      `UPDATE tj_links SET
         fibre_id = $2,
         cable_type = $3,
         core_count = $4,
         from_core_label = $5,
         to_core_label = $6,
         cores = $7::jsonb,
         status = $8,
         notes = $9,
         path = $10::jsonb,
         length_m = $11,
         attenuation_db_per_km = $12,
         splice_count = $13,
         connection_loss_db = $14,
         color = $15,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        dto.fibreId?.trim() ?? row.fibre_id,
        dto.cableType !== undefined ? dto.cableType?.trim() || null : row.cable_type,
        cores.length,
        cores.find((core) => core.fromCoreLabel)?.fromCoreLabel ?? null,
        cores.find((core) => core.toCoreLabel)?.toCoreLabel ?? null,
        JSON.stringify(cores),
        dto.status ?? row.status,
        dto.notes !== undefined ? dto.notes?.trim() || null : row.notes,
        JSON.stringify(path),
        lengthM,
        dto.attenuationDbPerKm ?? row.attenuation_db_per_km ?? 0.35,
        dto.spliceCount ?? row.splice_count ?? 2,
        dto.connectionLossDb ?? row.connection_loss_db ?? 1.0,
        dto.color !== undefined ? dto.color : row.color,
      ],
    );

    await this.syncDeviceCores(id, from, cores.map((core) => core.fromCoreLabel));
    await this.syncDeviceCores(id, to, cores.map((core) => core.toCoreLabel));
    await this.syncOnuCores(id, from, cores.map((core) => core.fromCoreLabel));
    await this.syncOnuCores(id, to, cores.map((core) => core.toCoreLabel));
    return this.get(id);
  }

  async remove(id: string) {
    const rows = await this.db.query<LinkRow>(`${LINK_SELECT} WHERE l.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Fibre link not found');
    const row = rows[0];

    await this.db.query('DELETE FROM tj_links WHERE id = $1', [id]);

    const from = await this.endpointForRow(row, 'from').catch(() => null);
    const to = await this.endpointForRow(row, 'to').catch(() => null);
    if (from) await this.syncDeviceCores(id, from, []);
    if (to) await this.syncDeviceCores(id, to, []);
    if (from) await this.syncOnuCores(id, from, []);
    if (to) await this.syncOnuCores(id, to, []);
    return { ok: true, id };
  }

  private async resolveEndpoint(
    tjId: string | undefined,
    oltId: string | undefined,
    onuId: string | undefined,
    side: 'from' | 'to',
  ): Promise<Endpoint> {
    const chosen = [tjId, oltId, onuId].filter(Boolean).length;
    if (chosen !== 1) {
      throw new BadRequestException(
        `Pick one ${side} device: a terminal joint, an OLT or an ONU.`,
      );
    }
    const endpoint = tjId
      ? await this.db.query<Endpoint>(
          `SELECT 'tj'::text AS kind, id, code, name,
                  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
             FROM tjs WHERE id = $1`,
          [tjId],
        )
      : oltId
        ? await this.db.query<Endpoint>(
            `SELECT 'olt'::text AS kind, id, code, name,
                    ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
               FROM olts WHERE id = $1`,
            [oltId],
          )
        : await this.db.query<Endpoint>(
            `SELECT 'onu'::text AS kind, id, username AS code, fibre_id AS name,
                    ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
               FROM onus WHERE id = $1`,
            [onuId],
          );
    if (endpoint.length === 0) {
      throw new NotFoundException(`The ${side} device no longer exists.`);
    }
    if (endpoint[0].lat === null || endpoint[0].lng === null) {
      throw new BadRequestException(
        endpoint[0].kind === 'onu'
          ? `Place ONU ${endpoint[0].code} on the map before linking it.`
          : endpoint[0].kind === 'olt'
            ? `Place ${endpoint[0].code} on the map before linking it.`
            : `Set a map position for ${endpoint[0].code} before linking it.`,
      );
    }
    return {
      ...endpoint[0],
      lat: Number(endpoint[0].lat),
      lng: Number(endpoint[0].lng),
    };
  }

  private async endpointForRow(row: LinkRow, side: 'from' | 'to'): Promise<Endpoint> {
    if (side === 'from') {
      return this.resolveEndpoint(
        row.from_tj_id ?? undefined,
        row.from_olt_id ?? undefined,
        row.from_onu_id ?? undefined,
        'from',
      );
    }
    return this.resolveEndpoint(
      row.to_tj_id ?? undefined,
      row.to_olt_id ?? undefined,
      row.to_onu_id ?? undefined,
      'to',
    );
  }

  private assertDistinct(from: Endpoint, to: Endpoint) {
    if (from.kind === to.kind && from.id === to.id) {
      throw new BadRequestException('A device cannot be linked to itself.');
    }
  }

  /** Marks the mapped joint cores in use on this link, and frees the ones it no longer carries. */
  private async syncDeviceCores(linkId: string, endpoint: Endpoint | null, labels: (string | null)[]) {
    if (!endpoint || endpoint.kind !== 'tj') return;
    const wanted = new Set(labels.filter((label): label is string => Boolean(label)));
    const rows = await this.db.query<{ cores: unknown; output_cores: unknown }>(
      'SELECT cores, output_cores FROM tjs WHERE id = $1',
      [endpoint.id],
    );
    if (rows.length === 0) return;
    const row = rows[0];

    const apply = (value: unknown) => {
      const list = Array.isArray(value) ? value : [];
      let changed = false;
      const next = list.map((item) => {
        const core = (item ?? {}) as Record<string, unknown> & { label?: string; status?: string; connectedLinkId?: string };
        const isMapped = Boolean(core.label) && wanted.has(String(core.label));
        const ownedHere = core.connectedLinkId === linkId;
        if (isMapped && core.status !== 'in_use') {
          changed = true;
          return { ...core, status: 'in_use', connectedLinkId: linkId };
        }
        if (isMapped && ownedHere !== true) {
          changed = true;
          return { ...core, status: 'in_use', connectedLinkId: linkId };
        }
        if (!isMapped && ownedHere) {
          changed = true;
          const { connectedLinkId: _drop, ...rest } = core;
          return { ...rest, status: 'free' };
        }
        return core;
      });
      return changed ? next : null;
    };

    const cores = apply(row.cores);
    const outputCores = apply(row.output_cores);
    if (!cores && !outputCores) return;

    await this.db.query(
      `UPDATE tjs SET cores = $2::jsonb, output_cores = $3::jsonb, updated_at = now() WHERE id = $1`,
      [
        endpoint.id,
        JSON.stringify(cores ?? row.cores ?? []),
        JSON.stringify(outputCores ?? row.output_cores ?? []),
      ],
    );
  }

  /** Frees or marks this ONU's cores when a link is mapped to them. */
  private async syncOnuCores(linkId: string, endpoint: Endpoint | null, labels: (string | null)[]) {
    if (!endpoint || endpoint.kind !== 'onu') return;
    const wanted = new Set(labels.filter((label): label is string => Boolean(label)));
    const rows = await this.db.query<{ cores: unknown }>('SELECT cores FROM onus WHERE id = $1', [
      endpoint.id,
    ]);
    if (rows.length === 0) return;
    const list = Array.isArray(rows[0].cores) ? rows[0].cores : [];
    let changed = false;
    const next = list.map((item) => {
      const core = (item ?? {}) as Record<string, unknown> & {
        label?: string;
        status?: string;
        connectedLinkId?: string;
      };
      const isMapped = Boolean(core.label) && wanted.has(String(core.label));
      const ownedHere = core.connectedLinkId === linkId;
      if (isMapped && (core.status !== 'in_use' || ownedHere !== true)) {
        changed = true;
        return { ...core, status: 'in_use', connectedLinkId: linkId };
      }
      if (!isMapped && ownedHere) {
        changed = true;
        const { connectedLinkId: _drop, ...rest } = core;
        return { ...rest, status: 'free' };
      }
      return core;
    });
    if (!changed) return;
    await this.db.query('UPDATE onus SET cores = $2::jsonb, updated_at = now() WHERE id = $1', [
      endpoint.id,
      JSON.stringify(next),
    ]);
  }

  private mapLink(row: LinkRow) {
    return {
      id: row.id,
      fromKind: (row.from_olt_id ? 'olt' : row.from_onu_id ? 'onu' : 'tj') as EndpointKind,
      toKind: (row.to_olt_id ? 'olt' : row.to_onu_id ? 'onu' : 'tj') as EndpointKind,
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
      cores: parseStoredCores(row.cores),
      path: normalisePath(row.path),
      status: row.status,
      lengthM: row.length_m === null ? null : Number(row.length_m),
      attenuationDbPerKm:
        row.attenuation_db_per_km === null || row.attenuation_db_per_km === undefined
          ? 0.35
          : Number(row.attenuation_db_per_km),
      spliceCount:
        row.splice_count === null || row.splice_count === undefined
          ? 2
          : Number(row.splice_count),
      connectionLossDb:
        row.connection_loss_db === null || row.connection_loss_db === undefined
          ? 1.0
          : Number(row.connection_loss_db),
      color: row.color ?? null,
      notes: row.notes,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

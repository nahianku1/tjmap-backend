import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { guardDuplicate } from '../database/pg-errors';
import { TjService } from '../tj/tj.service';
import { CreateAreaDto, CreateDistrictDto, UpdateAreaDto, UpdateDistrictDto } from './geo.dto';

interface DistrictRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  area_count: number;
  tj_count: number;
  cut_count: number;
  link_count: number;
  min_lat: number | null;
  max_lat: number | null;
  min_lng: number | null;
  max_lng: number | null;
  created_at: Date;
  updated_at: Date;
}

interface AreaRow {
  id: string;
  district_id: string;
  district_code: string;
  district_name: string;
  code: string | null;
  name: string;
  description: string | null;
  tj_count: number;
  cut_count: number;
  link_count: number;
  min_lat: number | null;
  max_lat: number | null;
  min_lng: number | null;
  max_lng: number | null;
  created_at: Date;
  updated_at: Date;
}

const DISTRICT_SELECT = `
  SELECT d.id, d.code, d.name, d.description, d.created_at, d.updated_at,
         COALESCE(s.area_count, 0) AS area_count,
         COALESCE(s.tj_count, 0) AS tj_count,
         COALESCE(s.cut_count, 0) AS cut_count,
         COALESCE(s.link_count, 0) AS link_count,
         s.min_lat, s.max_lat, s.min_lng, s.max_lng
  FROM districts d
  LEFT JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM areas a WHERE a.district_id = d.id)::int AS area_count,
      (SELECT count(*) FROM tjs t JOIN areas a ON a.id = t.area_id WHERE a.district_id = d.id)::int AS tj_count,
      (SELECT count(*) FROM tjs t JOIN areas a ON a.id = t.area_id
        WHERE a.district_id = d.id AND t.is_cut)::int AS cut_count,
      (SELECT count(*) FROM tj_links l
         JOIN tjs f ON f.id = l.from_tj_id
         JOIN tjs t ON t.id = l.to_tj_id
         JOIN areas fa ON fa.id = f.area_id
         JOIN areas ta ON ta.id = t.area_id
        WHERE fa.district_id = d.id OR ta.district_id = d.id)::int AS link_count,
      (SELECT min(ST_Y(t.location::geometry)) FROM tjs t JOIN areas a ON a.id = t.area_id
        WHERE a.district_id = d.id) AS min_lat,
      (SELECT max(ST_Y(t.location::geometry)) FROM tjs t JOIN areas a ON a.id = t.area_id
        WHERE a.district_id = d.id) AS max_lat,
      (SELECT min(ST_X(t.location::geometry)) FROM tjs t JOIN areas a ON a.id = t.area_id
        WHERE a.district_id = d.id) AS min_lng,
      (SELECT max(ST_X(t.location::geometry)) FROM tjs t JOIN areas a ON a.id = t.area_id
        WHERE a.district_id = d.id) AS max_lng
  ) s ON true
`;

const AREA_SELECT = `
  SELECT a.id, a.district_id, a.code, a.name, a.description, a.created_at, a.updated_at,
         d.code AS district_code, d.name AS district_name,
         COALESCE(s.tj_count, 0) AS tj_count,
         COALESCE(s.cut_count, 0) AS cut_count,
         COALESCE(s.link_count, 0) AS link_count,
         s.min_lat, s.max_lat, s.min_lng, s.max_lng
  FROM areas a
  JOIN districts d ON d.id = a.district_id
  LEFT JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM tjs t WHERE t.area_id = a.id)::int AS tj_count,
      (SELECT count(*) FROM tjs t WHERE t.area_id = a.id AND t.is_cut)::int AS cut_count,
      (SELECT count(*) FROM tj_links l
         JOIN tjs f ON f.id = l.from_tj_id
         JOIN tjs t ON t.id = l.to_tj_id
        WHERE f.area_id = a.id OR t.area_id = a.id)::int AS link_count,
      (SELECT min(ST_Y(t.location::geometry)) FROM tjs t WHERE t.area_id = a.id) AS min_lat,
      (SELECT max(ST_Y(t.location::geometry)) FROM tjs t WHERE t.area_id = a.id) AS max_lat,
      (SELECT min(ST_X(t.location::geometry)) FROM tjs t WHERE t.area_id = a.id) AS min_lng,
      (SELECT max(ST_X(t.location::geometry)) FROM tjs t WHERE t.area_id = a.id) AS max_lng
  ) s ON true
`;

/** Camera fit for a bounding box: keeps the whole set inside ~60% of the viewport. */
export function boundsZoom(
  minLat: number | null,
  maxLat: number | null,
  minLng: number | null,
  maxLng: number | null,
): number | null {
  if (minLat === null || maxLat === null || minLng === null || maxLng === null) return null;
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  const spanMetres = Math.max(
    (maxLat - minLat) * 111_320,
    (maxLng - minLng) * 111_320 * cos,
    450,
  );
  const viewportMetres = 156_543 * cos * 900 * 0.62;
  const zoom = Math.log2(viewportMetres / spanMetres);
  return Math.round(Math.min(14, Math.max(6.4, zoom)) * 100) / 100;
}

function slugCode(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 12);
  return slug.length >= 2 ? slug : fallback;
}

@Injectable()
export class GeoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tjs: TjService,
  ) {}

  async listDistricts() {
    const rows = await this.db.query<DistrictRow>(`${DISTRICT_SELECT} ORDER BY d.name ASC`);
    return rows.map((row) => this.mapDistrict(row));
  }

  async getDistrict(id: string) {
    const rows = await this.db.query<DistrictRow>(`${DISTRICT_SELECT} WHERE d.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('District not found');
    const areas = await this.db.query<AreaRow>(
      `${AREA_SELECT} WHERE a.district_id = $1 ORDER BY a.name ASC`,
      [id],
    );
    return { ...this.mapDistrict(rows[0]), areas: areas.map((row) => this.mapArea(row)) };
  }

  async createDistrict(dto: CreateDistrictDto, userId: string) {
    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
        `INSERT INTO districts (code, name, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          slugCode(dto.code ?? dto.name, 'DIST'),
          dto.name.trim(),
          dto.description?.trim() || null,
          userId,
        ],
      ),
      'A district with this name or code already exists.',
    );
    return this.getDistrict(rows[0].id);
  }

  async updateDistrict(id: string, dto: UpdateDistrictDto) {
    const existing = await this.getDistrictRow(id);
    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
        `UPDATE districts SET code = $2, name = $3, description = $4, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [
          id,
          dto.code ? slugCode(dto.code, existing.code) : existing.code,
          dto.name?.trim() || existing.name,
          dto.description !== undefined ? dto.description?.trim() || null : existing.description,
        ],
      ),
      'A district with this name or code already exists.',
    );
    return this.getDistrict(rows[0].id);
  }

  async removeDistrict(id: string) {
    const rows = await this.db.query<{ id: string }>(
      'DELETE FROM districts WHERE id = $1 RETURNING id',
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('District not found');
    return { ok: true, id };
  }

  async listAreas(districtId?: string) {
    const rows = await this.db.query<AreaRow>(
      `${AREA_SELECT} WHERE ($1::uuid IS NULL OR a.district_id = $1::uuid) ORDER BY d.name ASC, a.name ASC`,
      [districtId ?? null],
    );
    return rows.map((row) => this.mapArea(row));
  }

  async getArea(id: string) {
    const rows = await this.db.query<AreaRow>(`${AREA_SELECT} WHERE a.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Area not found');

    const districtRows = await this.db.query<DistrictRow>(`${DISTRICT_SELECT} WHERE d.id = $1`, [
      rows[0].district_id,
    ]);
    const district = districtRows.length > 0 ? this.mapDistrict(districtRows[0]) : null;

    return { ...this.mapArea(rows[0]), district };
  }

  async network(areaId: string) {
    await this.getArea(areaId);
    return this.tjs.networkForArea(areaId);
  }

  async createArea(districtId: string, dto: CreateAreaDto, userId: string) {
    await this.getDistrictRow(districtId);
    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
        `INSERT INTO areas (district_id, code, name, description, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          districtId,
          dto.code ? slugCode(dto.code, 'AREA') : null,
          dto.name.trim(),
          dto.description?.trim() || null,
          userId,
        ],
      ),
      'This district already has an area with that name.',
    );
    return this.getArea(rows[0].id);
  }

  async updateArea(id: string, dto: UpdateAreaDto) {
    const existing = await this.getAreaRow(id);
    const rows = await guardDuplicate(
      this.db.query<{ id: string }>(
        `UPDATE areas SET code = $2, name = $3, description = $4, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [
          id,
          dto.code !== undefined ? (dto.code ? slugCode(dto.code, 'AREA') : null) : existing.code,
          dto.name?.trim() || existing.name,
          dto.description !== undefined ? dto.description?.trim() || null : existing.description,
        ],
      ),
      'This district already has an area with that name.',
    );
    return this.getArea(rows[0].id);
  }

  async removeArea(id: string) {
    const rows = await this.db.query<{ id: string }>(
      'DELETE FROM areas WHERE id = $1 RETURNING id',
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Area not found');
    return { ok: true, id };
  }

  private async getDistrictRow(id: string) {
    const rows = await this.db.query<DistrictRow>(`${DISTRICT_SELECT} WHERE d.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('District not found');
    return rows[0];
  }

  private async getAreaRow(id: string) {
    const rows = await this.db.query<AreaRow>(`${AREA_SELECT} WHERE a.id = $1`, [id]);
    if (rows.length === 0) throw new NotFoundException('Area not found');
    return rows[0];
  }

  private mapDistrict(row: DistrictRow) {
    const bounds = this.bounds(row);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      lat: bounds ? (bounds.minLat + bounds.maxLat) / 2 : null,
      lng: bounds ? (bounds.minLng + bounds.maxLng) / 2 : null,
      zoom: bounds ? boundsZoom(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng) : null,
      bounds,
      areaCount: Number(row.area_count),
      tjCount: Number(row.tj_count),
      cutCount: Number(row.cut_count),
      linkCount: Number(row.link_count),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private mapArea(row: AreaRow) {
    const bounds = this.bounds(row);
    return {
      id: row.id,
      districtId: row.district_id,
      districtCode: row.district_code,
      districtName: row.district_name,
      code: row.code,
      name: row.name,
      description: row.description,
      lat: bounds ? (bounds.minLat + bounds.maxLat) / 2 : null,
      lng: bounds ? (bounds.minLng + bounds.maxLng) / 2 : null,
      zoom: bounds ? boundsZoom(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng) : null,
      bounds,
      tjCount: Number(row.tj_count),
      cutCount: Number(row.cut_count),
      linkCount: Number(row.link_count),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private bounds(row: AreaRow | DistrictRow) {
    if (row.min_lat === null || row.max_lat === null || row.min_lng === null || row.max_lng === null) {
      return null;
    }
    return {
      minLat: Number(row.min_lat),
      maxLat: Number(row.max_lat),
      minLng: Number(row.min_lng),
      maxLng: Number(row.max_lng),
    };
  }
}

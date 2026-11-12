import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { guardDuplicate } from '../database/pg-errors';
import { CreateLinkDto, UpdateLinkDto } from './tj.dto';

interface LinkRow {
  id: string;
  from_tj_id: string;
  to_tj_id: string;
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
  status: string;
  length_m: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const LINK_SELECT = `
  SELECT l.id, l.from_tj_id, l.to_tj_id,
         f.code AS from_code, t.code AS to_code,
         f.name AS from_name, t.name AS to_name,
         ST_Y(f.location::geometry) AS from_lat,
         ST_X(f.location::geometry) AS from_lng,
         ST_Y(t.location::geometry) AS to_lat,
         ST_X(t.location::geometry) AS to_lng,
         l.fibre_id, l.cable_type, l.core_count, l.status, l.length_m, l.notes,
         l.created_at, l.updated_at
  FROM tj_links l
  JOIN tjs f ON f.id = l.from_tj_id
  JOIN tjs t ON t.id = l.to_tj_id`;

@Injectable()
export class LinkService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const rows = await this.db.query<LinkRow>(`${LINK_SELECT} ORDER BY l.created_at ASC`);
    return rows.map((row) => this.mapLink(row));
  }

  async create(dto: CreateLinkDto, userId: string) {
    const rows = await guardDuplicate(
      this.db.query<LinkRow>(
      `WITH inserted AS (
         INSERT INTO tj_links (from_tj_id, to_tj_id, fibre_id, cable_type, core_count, status, notes, created_by, length_m)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, ST_Distance(f.location, t.location)
         FROM tjs f, tjs t
         WHERE f.id = $1 AND t.id = $2
         RETURNING *
       )
       SELECT l.id, l.from_tj_id, l.to_tj_id,
              f.code AS from_code, t.code AS to_code,
              f.name AS from_name, t.name AS to_name,
              ST_Y(f.location::geometry) AS from_lat,
              ST_X(f.location::geometry) AS from_lng,
              ST_Y(t.location::geometry) AS to_lat,
              ST_X(t.location::geometry) AS to_lng,
              l.fibre_id, l.cable_type, l.core_count, l.status, l.length_m, l.notes,
              l.created_at, l.updated_at
       FROM inserted l
       JOIN tjs f ON f.id = l.from_tj_id
       JOIN tjs t ON t.id = l.to_tj_id`,
      [
        dto.fromTjId,
        dto.toTjId,
        dto.fibreId.trim(),
        dto.cableType?.trim() || null,
        dto.coreCount,
        dto.status ?? 'active',
        dto.notes?.trim() || null,
        userId,
      ],
    ),
      'These two joints are already linked. Edit the existing span instead.',
    );

    if (rows.length === 0) {
      throw new NotFoundException('One or both terminal joints no longer exist');
    }
    return this.mapLink(rows[0]);
  }

  async update(id: string, dto: UpdateLinkDto) {
    const current = await this.db.query<{
      fibre_id: string;
      cable_type: string | null;
      core_count: number;
      status: string;
      notes: string | null;
    }>('SELECT fibre_id, cable_type, core_count, status, notes FROM tj_links WHERE id = $1', [id]);
    if (current.length === 0) throw new NotFoundException('Fibre link not found');

    const rows = await this.db.query<LinkRow>(
      `WITH updated AS (
         UPDATE tj_links SET
           fibre_id = $2, cable_type = $3, core_count = $4, status = $5, notes = $6, updated_at = now()
         WHERE id = $1
         RETURNING *
       )
       SELECT l.id, l.from_tj_id, l.to_tj_id,
              f.code AS from_code, t.code AS to_code,
              f.name AS from_name, t.name AS to_name,
              ST_Y(f.location::geometry) AS from_lat,
              ST_X(f.location::geometry) AS from_lng,
              ST_Y(t.location::geometry) AS to_lat,
              ST_X(t.location::geometry) AS to_lng,
              l.fibre_id, l.cable_type, l.core_count, l.status, l.length_m, l.notes,
              l.created_at, l.updated_at
       FROM updated l
       JOIN tjs f ON f.id = l.from_tj_id
       JOIN tjs t ON t.id = l.to_tj_id`,
      [
        id,
        dto.fibreId?.trim() ?? current[0].fibre_id,
        dto.cableType !== undefined ? dto.cableType?.trim() || null : current[0].cable_type,
        dto.coreCount ?? current[0].core_count,
        dto.status ?? current[0].status,
        dto.notes !== undefined ? dto.notes?.trim() || null : current[0].notes,
      ],
    );
    return this.mapLink(rows[0]);
  }

  async remove(id: string) {
    const rows = await this.db.query<{ id: string }>('DELETE FROM tj_links WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw new NotFoundException('Fibre link not found');
    return { ok: true, id };
  }

  private mapLink(row: LinkRow) {
    return {
      id: row.id,
      fromTjId: row.from_tj_id,
      toTjId: row.to_tj_id,
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
      status: row.status,
      lengthM: row.length_m === null ? null : Number(row.length_m),
      notes: row.notes,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from './database.service';

/**
 * Devices live in a service area and may also be filed under one of its
 * sub-areas. Picking a sub-area pins the device to its parent area, so the two
 * assignments can never disagree.
 */
export async function resolvePlacement(
  db: DatabaseService,
  areaId: string | null | undefined,
  subAreaId: string | null | undefined,
): Promise<{ areaId: string | null; subAreaId: string | null }> {
  if (!subAreaId) {
    if (areaId) {
      const rows = await db.query<{ id: string }>('SELECT id FROM areas WHERE id = $1', [areaId]);
      if (rows.length === 0) throw new BadRequestException('That area no longer exists.');
    }
    return { areaId: areaId ?? null, subAreaId: null };
  }

  const rows = await db.query<{ area_id: string }>(
    'SELECT area_id FROM sub_areas WHERE id = $1',
    [subAreaId],
  );
  if (rows.length === 0) throw new BadRequestException('That sub-area no longer exists.');
  return { areaId: rows[0].area_id, subAreaId };
}

/** Links are filed under a sub-area without changing their endpoint devices. */
export async function assertSubArea(
  db: DatabaseService,
  subAreaId: string | null | undefined,
): Promise<string | null> {
  if (!subAreaId) return null;
  const rows = await db.query<{ id: string }>('SELECT id FROM sub_areas WHERE id = $1', [subAreaId]);
  if (rows.length === 0) throw new BadRequestException('That sub-area no longer exists.');
  return subAreaId;
}

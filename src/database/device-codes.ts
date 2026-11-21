import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from './database.service';

export type DeviceKind = 'tj' | 'olt' | 'onu';

const KIND_LABEL: Record<DeviceKind, string> = {
  tj: 'terminal joint',
  olt: 'OLT',
  onu: 'ONU',
};

export interface DeviceLocation {
  district_name?: string | null;
  area_name?: string | null;
  sub_area_name?: string | null;
}

/** " in Dhaka · Uttara, sub-area Sector 3" — empty when the device is unplaced. */
export function locationLabel(row: DeviceLocation): string {
  const place = [row.district_name, row.area_name].filter(Boolean).join(' · ');
  const parts = [place, row.sub_area_name ? `sub-area ${row.sub_area_name}` : null]
    .filter(Boolean)
    .join(', ');
  return parts ? ` in ${parts}` : '';
}

/**
 * Device codes share one network-wide namespace: a TJ code, an OLT code and an
 * ONU username may never match, case-insensitively. `excludeId` skips the row
 * being updated so re-saving an unchanged code does not conflict with itself.
 */
export async function assertDeviceCodeAvailable(
  db: DatabaseService,
  code: string,
  excludeId?: string,
): Promise<void> {
  const trimmed = code.trim();
  if (!trimmed) return;
  interface CodeHit extends DeviceLocation {
    kind: string;
    label: string;
  }
  const rows = await db.query<CodeHit>(
    `SELECT kind, label, district_name, area_name, sub_area_name FROM (
       SELECT 'tj' AS kind, t.code AS label, t.id,
              d.name AS district_name, a.name AS area_name, sa.name AS sub_area_name
         FROM tjs t
         LEFT JOIN areas a ON a.id = t.area_id
         LEFT JOIN districts d ON d.id = a.district_id
         LEFT JOIN sub_areas sa ON sa.id = t.sub_area_id
        WHERE lower(t.code) = lower($1)
       UNION ALL
       SELECT 'olt', o.code, o.id, d.name, a.name, sa.name
         FROM olts o
         LEFT JOIN areas a ON a.id = o.area_id
         LEFT JOIN districts d ON d.id = a.district_id
         LEFT JOIN sub_areas sa ON sa.id = o.sub_area_id
        WHERE lower(o.code) = lower($1)
       UNION ALL
       SELECT 'onu', u.username, u.id, d.name, a.name, sa.name
         FROM onus u
         LEFT JOIN areas a ON a.id = u.area_id
         LEFT JOIN districts d ON d.id = a.district_id
         LEFT JOIN sub_areas sa ON sa.id = u.sub_area_id
        WHERE lower(u.username) = lower($1)
     ) hits
     WHERE ($2::uuid IS NULL OR hits.id <> $2::uuid)
     LIMIT 1`,
    [trimmed, excludeId ?? null],
  );
  if (rows.length > 0) {
    const other = rows[0].kind as DeviceKind;
    throw new BadRequestException(
      `This code is already used by ${KIND_LABEL[other] ?? other} ${rows[0].label}${locationLabel(rows[0])}.`,
    );
  }
}

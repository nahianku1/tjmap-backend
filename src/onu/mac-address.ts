import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';

const TWELVE_HEX = /^[0-9a-f]{12}$/i;

/**
 * Hardware MACs arrive with colons, dashes, dots or no separators at all. They
 * are stored in one canonical form (AA:BB:CC:DD:EE:FF) so the same hardware
 * cannot be registered twice under two spellings.
 */
export function normalizeMacAddress(value: string | undefined | null): string {
  const compact = (value ?? '').trim().replace(/[\s:.-]/g, '');
  if (!compact) {
    throw new BadRequestException('MAC address is required.');
  }
  if (!TWELVE_HEX.test(compact)) {
    throw new BadRequestException(
      'MAC address must be 12 hexadecimal digits, e.g. AA:BB:CC:DD:EE:FF.',
    );
  }
  return (compact.toUpperCase().match(/.{2}/g) as string[]).join(':');
}

/** One physical ONU exists once: a MAC may not be registered to another ONU. */
export async function assertMacAvailable(
  db: DatabaseService,
  macAddress: string,
  excludeOnuId?: string,
): Promise<void> {
  const rows = await db.query<{ username: string; area_name: string | null }>(
    `SELECT o.username, a.name AS area_name
       FROM onus o
       LEFT JOIN areas a ON a.id = o.area_id
      WHERE lower(o.mac_address) = lower($1)
        AND ($2::uuid IS NULL OR o.id <> $2::uuid)
      LIMIT 1`,
    [macAddress, excludeOnuId ?? null],
  );
  if (rows.length === 0) return;
  const where = rows[0].area_name ? ` (${rows[0].area_name})` : '';
  throw new ConflictException(
    `MAC address ${macAddress} is already registered to ONU ${rows[0].username}${where}.`,
  );
}

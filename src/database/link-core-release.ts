import { DatabaseService } from './database.service';

export type DeviceKind = 'tj' | 'olt' | 'onu';

export interface DeviceLinkRow {
  id: string;
  from_tj_id: string | null;
  from_olt_id: string | null;
  from_onu_id: string | null;
  to_tj_id: string | null;
  to_olt_id: string | null;
  to_onu_id: string | null;
}

const DEVICE_COLUMNS: Record<DeviceKind, [string, string]> = {
  tj: ['from_tj_id', 'to_tj_id'],
  olt: ['from_olt_id', 'to_olt_id'],
  onu: ['from_onu_id', 'to_onu_id'],
};

/** Links that will cascade-delete together with a device. */
export async function linksTouching(
  db: DatabaseService,
  kind: DeviceKind,
  deviceId: string,
): Promise<DeviceLinkRow[]> {
  const [fromColumn, toColumn] = DEVICE_COLUMNS[kind];
  return db.query<DeviceLinkRow>(
    `SELECT id, from_tj_id, from_olt_id, from_onu_id,
            to_tj_id, to_olt_id, to_onu_id
       FROM tj_links
      WHERE ${fromColumn} = $1 OR ${toColumn} = $1`,
    [deviceId],
  );
}

/** Drops this link's ownership from a list of cores, freeing the ones it held. */
function releaseCores(value: unknown, linkIds: Set<string>): unknown[] | null {
  if (!Array.isArray(value)) return null;
  let changed = false;
  const next = value.map((item) => {
    const core = (item ?? {}) as Record<string, unknown>;
    if (typeof core.connectedLinkId === 'string' && linkIds.has(core.connectedLinkId)) {
      changed = true;
      const { connectedLinkId: _drop, ...rest } = core;
      return { ...rest, status: 'free' };
    }
    return core;
  });
  return changed ? next : null;
}

async function freeEndpointCores(
  db: DatabaseService,
  table: 'tjs' | 'onus',
  ids: string[],
  linkIds: Set<string>,
) {
  if (ids.length === 0) return;
  const rows =
    table === 'tjs'
      ? await db.query<{ id: string; cores: unknown; output_cores: unknown }>(
          'SELECT id, cores, output_cores FROM tjs WHERE id = ANY($1::uuid[])',
          [ids],
        )
      : await db.query<{ id: string; cores: unknown; output_cores: unknown }>(
          'SELECT id, cores FROM onus WHERE id = ANY($1::uuid[])',
          [ids],
        );

  for (const row of rows) {
    const cores = releaseCores(row.cores, linkIds);
    const outputCores = table === 'tjs' ? releaseCores(row.output_cores, linkIds) : null;
    if (!cores && !outputCores) continue;
    if (table === 'tjs') {
      await db.query(
        `UPDATE tjs SET cores = $2::jsonb, output_cores = $3::jsonb, updated_at = now() WHERE id = $1`,
        [
          row.id,
          JSON.stringify(cores ?? row.cores ?? []),
          JSON.stringify(outputCores ?? row.output_cores ?? []),
        ],
      );
    } else {
      await db.query(
        'UPDATE onus SET cores = $2::jsonb, updated_at = now() WHERE id = $1',
        [row.id, JSON.stringify(cores ?? row.cores ?? [])],
      );
    }
  }
}

/**
 * Frees the TJ and ONU ports held by links that are about to be deleted along
 * with a device. OLT ports are derived from the links themselves, so they need
 * no cleanup. Call after the device row is gone (cascade removed the links).
 */
export async function releaseDeletedLinkCores(
  db: DatabaseService,
  links: DeviceLinkRow[],
  deletedDeviceId: string,
) {
  if (links.length === 0) return;
  const linkIds = new Set(links.map((link) => link.id));
  const tjIds = new Set<string>();
  const onuIds = new Set<string>();
  for (const link of links) {
    for (const id of [link.from_tj_id, link.to_tj_id]) {
      if (id && id !== deletedDeviceId) tjIds.add(id);
    }
    for (const id of [link.from_onu_id, link.to_onu_id]) {
      if (id && id !== deletedDeviceId) onuIds.add(id);
    }
  }
  await freeEndpointCores(db, 'tjs', [...tjIds], linkIds);
  await freeEndpointCores(db, 'onus', [...onuIds], linkIds);
}

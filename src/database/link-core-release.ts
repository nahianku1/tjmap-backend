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

/** Splitter legs are stored per splitter; they hold links too. */
function releaseSplitterOutputs(
  value: unknown,
  linkIds: Set<string>,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const splitter = value as Record<string, unknown>;
  const outputs = releaseCores(splitter.outputs, linkIds);
  return outputs ? { ...splitter, outputs } : null;
}

async function freeEndpointCores(
  db: DatabaseService,
  table: 'tjs' | 'onus',
  ids: string[],
  linkIds: Set<string>,
) {
  if (ids.length === 0) return;
  if (table === 'tjs') {
    const rows = await db.query<{
      id: string;
      cores: unknown;
      output_cores: unknown;
      splitter: unknown;
      splitters: unknown;
    }>(
      'SELECT id, cores, output_cores, splitter, splitters FROM tjs WHERE id = ANY($1::uuid[])',
      [ids],
    );

    for (const row of rows) {
      const cores = releaseCores(row.cores, linkIds);
      const outputCores = releaseCores(row.output_cores, linkIds);
      const splitter = releaseSplitterOutputs(row.splitter, linkIds);
      let splitters: unknown[] | null = null;
      if (Array.isArray(row.splitters)) {
        let changed = false;
        splitters = row.splitters.map((item) => {
          const updated = releaseSplitterOutputs(item, linkIds);
          if (updated) changed = true;
          return updated ?? item;
        });
        if (!changed) splitters = null;
      }
      if (!cores && !outputCores && !splitter && !splitters) continue;
      await db.query(
        `UPDATE tjs SET cores = $2::jsonb, output_cores = $3::jsonb,
                        splitter = $4::jsonb, splitters = $5::jsonb, updated_at = now()
         WHERE id = $1`,
        [
          row.id,
          JSON.stringify(cores ?? row.cores ?? []),
          JSON.stringify(outputCores ?? row.output_cores ?? []),
          JSON.stringify(splitter ?? row.splitter ?? { enabled: false, ratio: null, outputs: [] }),
          JSON.stringify(splitters ?? row.splitters ?? []),
        ],
      );
    }
    return;
  }

  const rows = await db.query<{ id: string; cores: unknown }>(
    'SELECT id, cores FROM onus WHERE id = ANY($1::uuid[])',
    [ids],
  );
  for (const row of rows) {
    const cores = releaseCores(row.cores, linkIds);
    if (!cores) continue;
    await db.query('UPDATE onus SET cores = $2::jsonb, updated_at = now() WHERE id = $1', [
      row.id,
      JSON.stringify(cores),
    ]);
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
  await freeLinkCores(db, links, new Set([deletedDeviceId]));
}

/**
 * Frees every port held by links deleted independently of their endpoints,
 * e.g. when a sub-area is removed and its links go with it.
 */
export async function releaseLinkCores(db: DatabaseService, links: DeviceLinkRow[]) {
  await freeLinkCores(db, links, new Set());
}

async function freeLinkCores(
  db: DatabaseService,
  links: DeviceLinkRow[],
  skipDeviceIds: Set<string>,
) {
  if (links.length === 0) return;
  const linkIds = new Set(links.map((link) => link.id));
  const tjIds = new Set<string>();
  const onuIds = new Set<string>();
  for (const link of links) {
    for (const id of [link.from_tj_id, link.to_tj_id]) {
      if (id && !skipDeviceIds.has(id)) tjIds.add(id);
    }
    for (const id of [link.from_onu_id, link.to_onu_id]) {
      if (id && !skipDeviceIds.has(id)) onuIds.add(id);
    }
  }
  await freeEndpointCores(db, 'tjs', [...tjIds], linkIds);
  await freeEndpointCores(db, 'onus', [...onuIds], linkIds);

  // Also remove any auto-created user fibres owned by these links from every TJ.
  // Auto fibres have ids prefixed with `uf-link-<linkId>-`. We query all TJs
  // that touch these links (by id column), then filter in JS – safe and avoids
  // dynamic SQL construction.
  if (linkIds.size === 0) return;
  const allLinkPrefixes = [...linkIds].map((lid) => `uf-link-${lid}-`);
  // Build a JSONB existence check for any of the prefixes using pg's @> or just
  // scan jsonb_array_elements. For safety we pull candidate TJ rows via the
  // already-known tjIds (which are the TJ endpoints of the dying links).
  const candidateTjIds = [...tjIds];
  if (candidateTjIds.length === 0) return;
  const candidateRows = await db.query<{ id: string; user_fibres: unknown }>(
    'SELECT id, user_fibres FROM tjs WHERE id = ANY($1::uuid[])',
    [candidateTjIds],
  );
  for (const tjRow of candidateRows) {
    const list = Array.isArray(tjRow.user_fibres) ? (tjRow.user_fibres as Record<string, unknown>[]) : [];
    if (list.length === 0) continue;
    const next = list.filter((fibre) => {
      const fibreId = String(fibre.id ?? '');
      return !allLinkPrefixes.some((prefix) => fibreId.startsWith(prefix));
    });
    if (next.length === list.length) continue;
    await db.query('UPDATE tjs SET user_fibres = $2::jsonb, updated_at = now() WHERE id = $1', [
      tjRow.id,
      JSON.stringify(next),
    ]);
  }
}

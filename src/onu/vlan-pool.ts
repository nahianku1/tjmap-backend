import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';
import { locationLabel, type DeviceLocation } from '../database/device-codes';
import { onuServingPort, ponLoadsForOlt } from '../olt/pon-capacity';

/**
 * Service VLAN range handed out to subscribers. Real PON deployments keep the
 * low ids (1–99) for network services (management, uplink, voice), so the
 * subscriber pool starts at 100 and stops before the 802.1Q ceiling.
 */
export const SERVICE_VLAN_MIN = 100;
export const SERVICE_VLAN_MAX = 3999;

interface PortVlanCarrier extends DeviceLocation {
  oltId: string;
  oltCode: string;
  kind: 'PON' | 'Ethernet';
  portLabel: string;
}

const OLT_LOCATION_JOINS = `
   LEFT JOIN areas a ON a.id = o.area_id
   LEFT JOIN districts d ON d.id = a.district_id
   LEFT JOIN sub_areas sa ON sa.id = o.sub_area_id`;

/** Every VLAN id carried by an OLT PON or ethernet port, keyed by the id. */
async function oltPortVlans(db: DatabaseService): Promise<Map<number, PortVlanCarrier>> {
  const rows = await db.query<{
    vlan: number;
    olt_id: string;
    olt_code: string;
    kind: string;
    label: string | null;
    district_name: string | null;
    area_name: string | null;
    sub_area_name: string | null;
  }>(
    `SELECT (port->>'vlanId')::int AS vlan, o.id AS olt_id, o.code AS olt_code,
            'PON' AS kind, port->>'label' AS label,
            d.name AS district_name, a.name AS area_name, sa.name AS sub_area_name
       FROM olts o, jsonb_array_elements(o.pon_ports) AS port
       ${OLT_LOCATION_JOINS}
      WHERE COALESCE(port->>'vlanId', '') ~ '^[0-9]{1,4}$'
        AND (port->>'vlanId')::int BETWEEN 1 AND 4094
     UNION ALL
     SELECT (port->>'vlanId')::int, o.id, o.code, 'Ethernet', port->>'label',
            d.name, a.name, sa.name
       FROM olts o, jsonb_array_elements(o.ethernet_ports) AS port
       ${OLT_LOCATION_JOINS}
      WHERE COALESCE(port->>'vlanId', '') ~ '^[0-9]{1,4}$'
        AND (port->>'vlanId')::int BETWEEN 1 AND 4094`,
  );
  const map = new Map<number, PortVlanCarrier>();
  for (const row of rows) {
    if (!map.has(Number(row.vlan))) {
      map.set(Number(row.vlan), {
        oltId: row.olt_id,
        oltCode: row.olt_code,
        kind: row.kind === 'Ethernet' ? 'Ethernet' : 'PON',
        portLabel: row.label ?? '',
        district_name: row.district_name,
        area_name: row.area_name,
        sub_area_name: row.sub_area_name,
      });
    }
  }
  return map;
}

/**
 * Gives an ONU the lowest free service VLAN, the way the OLT's provisioning
 * system allocates one when a subscriber is registered. Nothing happens when
 * the ONU already holds a VLAN, so manual assignments are never overwritten.
 * VLANs carried by OLT PON/ethernet ports are treated as taken too.
 */
export async function assignServiceVlan(
  db: DatabaseService,
  onuId: string,
): Promise<number | null> {
  const rows = await db.query<{ vlan_id: number }>(
    `UPDATE onus target
        SET vlan_id = pool.vlan, updated_at = now()
       FROM (
         SELECT candidate.vlan
           FROM generate_series($1::int, $2::int) AS candidate(vlan)
          WHERE NOT EXISTS (SELECT 1 FROM onus taken WHERE taken.vlan_id = candidate.vlan)
            AND NOT EXISTS (
              SELECT 1
                FROM olts o, jsonb_array_elements(o.pon_ports || o.ethernet_ports) AS port
               WHERE COALESCE(port->>'vlanId', '') ~ '^[0-9]{1,4}$'
                 AND (port->>'vlanId')::int = candidate.vlan
            )
          ORDER BY candidate.vlan
          LIMIT 1
       ) AS pool
      WHERE target.id = $3
        AND target.vlan_id IS NULL
      RETURNING target.vlan_id`,
    [SERVICE_VLAN_MIN, SERVICE_VLAN_MAX, onuId],
  );
  if (rows.length > 0) return Number(rows[0].vlan_id);

  const existing = await db.query<{ vlan_id: number | null }>(
    'SELECT vlan_id FROM onus WHERE id = $1',
    [onuId],
  );
  if (existing.length === 0) return null;
  if (existing[0].vlan_id !== null) return Number(existing[0].vlan_id);
  throw new BadRequestException(
    `No free service VLAN left in ${SERVICE_VLAN_MIN}–${SERVICE_VLAN_MAX}.`,
  );
}

/**
 * Reconciles an ONU's VLAN with the PON port serving it: a port that carries a
 * VLAN hands that id to every subscriber downstream (siblings share it), a
 * stale inherited id is released back to the pool, and an ONU on a port-less
 * segment keeps or receives a unique pool VLAN.
 */
export async function syncOnuPonVlan(
  db: DatabaseService,
  onuId: string,
): Promise<number | null> {
  const port = await onuServingPort(db, onuId);
  if (port?.vlanId != null) {
    await db.query(
      `UPDATE onus SET vlan_id = $2, updated_at = now()
        WHERE id = $1 AND vlan_id IS DISTINCT FROM $2`,
      [onuId, port.vlanId],
    );
    return port.vlanId;
  }

  const rows = await db.query<{ vlan_id: number | null }>(
    'SELECT vlan_id FROM onus WHERE id = $1',
    [onuId],
  );
  if (rows.length === 0) return null;
  const current = rows[0].vlan_id === null ? null : Number(rows[0].vlan_id);
  // A VLAN id owned by an OLT port that no longer serves this ONU is stale.
  if (current !== null && (await oltPortVlans(db)).has(current)) {
    await db.query('UPDATE onus SET vlan_id = NULL, updated_at = now() WHERE id = $1', [onuId]);
  }
  return assignServiceVlan(db, onuId);
}

/** Pushes each VLAN-bearing PON port's id onto the ONUs it serves. */
export async function syncOltPonVlans(db: DatabaseService, oltId: string): Promise<void> {
  const loads = await ponLoadsForOlt(db, oltId);
  for (const load of loads) {
    if (load.vlanId == null || load.onuIds.length === 0) continue;
    await db.query(
      `UPDATE onus SET vlan_id = $2, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND vlan_id IS DISTINCT FROM $2`,
      [load.onuIds, load.vlanId],
    );
  }
}

/**
 * VLAN ids on OLT ports are globally unique: no two ports may carry the same
 * id, and no port may claim an id an ONU holds outside that port's subscriber
 * group. `excludeOltId` skips the cabinet being saved so its own ports do not
 * conflict with themselves.
 */
export async function assertPortVlansAvailable(
  db: DatabaseService,
  vlanIds: number[],
  excludeOltId?: string,
): Promise<void> {
  const wanted: number[] = [];
  const seen = new Set<number>();
  for (const vlan of vlanIds) {
    if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) continue;
    if (seen.has(vlan)) {
      throw new BadRequestException(`VLAN ${vlan} is assigned to more than one port.`);
    }
    seen.add(vlan);
    wanted.push(vlan);
  }
  if (wanted.length === 0) return;

  const carriers = await oltPortVlans(db);
  for (const vlan of wanted) {
    const carrier = carriers.get(vlan);
    if (carrier && carrier.oltId !== excludeOltId) {
      throw new BadRequestException(
        `VLAN ${vlan} is already carried by ${carrier.oltCode} ${carrier.kind} port ${carrier.portLabel}${locationLabel(carrier)}.`,
      );
    }
  }

  const taken = await db.query<{
    id: string;
    username: string;
    vlan_id: number;
    district_name: string | null;
    area_name: string | null;
    sub_area_name: string | null;
  }>(
    `SELECT u.id, u.username, u.vlan_id, d.name AS district_name, a.name AS area_name, sa.name AS sub_area_name
       FROM onus u
       LEFT JOIN areas a ON a.id = u.area_id
       LEFT JOIN districts d ON d.id = a.district_id
       LEFT JOIN sub_areas sa ON sa.id = u.sub_area_id
      WHERE u.vlan_id = ANY($1::int[])`,
    [wanted],
  );
  for (const row of taken) {
    const port = await onuServingPort(db, row.id);
    // ONUs downstream of a port carrying this id share it legitimately.
    if (port?.vlanId === Number(row.vlan_id)) continue;
    throw new BadRequestException(
      `VLAN ${row.vlan_id} is already assigned to ONU ${row.username}${locationLabel(row)}.`,
    );
  }
}

/**
 * A VLAN serves one subscriber group: refuse a second, unrelated claim on the
 * id. ONUs sharing the VLAN of the PON port that serves them are the same
 * group and do not conflict. A VLAN carried by an OLT port may only be held by
 * ONUs that port actually serves.
 */
export async function assertVlanAvailable(
  db: DatabaseService,
  vlanId: number,
  excludeOnuId?: string,
): Promise<void> {
  const rows = await db.query<{
    id: string;
    username: string;
    district_name: string | null;
    area_name: string | null;
    sub_area_name: string | null;
  }>(
    `SELECT u.id, u.username, d.name AS district_name, a.name AS area_name, sa.name AS sub_area_name
       FROM onus u
       LEFT JOIN areas a ON a.id = u.area_id
       LEFT JOIN districts d ON d.id = a.district_id
       LEFT JOIN sub_areas sa ON sa.id = u.sub_area_id
      WHERE u.vlan_id = $1
        AND ($2::uuid IS NULL OR u.id <> $2::uuid)`,
    [vlanId, excludeOnuId ?? null],
  );
  for (const row of rows) {
    const port = await onuServingPort(db, row.id);
    if (port?.vlanId === vlanId) continue;
    throw new BadRequestException(
      `VLAN ${vlanId} is already assigned to ONU ${row.username}${locationLabel(row)}.`,
    );
  }

  const carrier = (await oltPortVlans(db)).get(vlanId);
  if (carrier) {
    const targetPort = excludeOnuId ? await onuServingPort(db, excludeOnuId) : null;
    if (targetPort?.vlanId !== vlanId) {
      throw new BadRequestException(
        `VLAN ${vlanId} is the service VLAN of ${carrier.oltCode} ${carrier.kind} port ${carrier.portLabel}${locationLabel(carrier)}.`,
      );
    }
  }
}

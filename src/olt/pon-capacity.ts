import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * ONUs one PON port can serve, by the cabinet's PON technology. These are the
 * PON standards' logical reach: GPON/XG(S)-PON address 128 ONUs per port, EPON
 * 64. A cabinet of an unknown type is treated as GPON-class.
 */
const PON_ONU_LIMITS: Record<string, number> = {
  gpon: 128,
  epon: 64,
  xg_pon: 128,
  xgs_pon: 128,
  combo: 128,
};

export const DEFAULT_PON_ONU_LIMIT = 128;

/** ONU slots one port of this OLT type offers. */
export function ponOnuCapacity(oltType: string | null | undefined): number {
  return PON_ONU_LIMITS[(oltType ?? '').trim().toLowerCase()] ?? DEFAULT_PON_ONU_LIMIT;
}

type Side = 'from' | 'to';
type EndpointKind = 'tj' | 'olt' | 'onu';

interface Endpoint {
  kind: EndpointKind;
  id: string;
}

/** A fibre span in the shape the capacity walk needs. */
export interface PonLinkShape {
  id: string;
  fromTjId: string | null;
  fromOltId: string | null;
  fromOnuId: string | null;
  toTjId: string | null;
  toOltId: string | null;
  toOnuId: string | null;
  fromCoreLabel: string | null;
  toCoreLabel: string | null;
  cores: { fromCoreLabel?: string | null; toCoreLabel?: string | null }[];
}

interface PonOltShape {
  id: string;
  code: string;
  name: string;
  oltType: string;
  /** Every PON port label fitted on the cabinet. */
  ports: string[];
  /** Port used by spans that do not name one. */
  primaryPort: string | null;
}

interface PonTjShape {
  id: string;
  code: string;
  splitters: { inputCoreLabel: string | null; legs: string[] }[];
}

export interface PonPortLoad {
  oltId: string;
  oltCode: string;
  oltName: string;
  oltType: string;
  portLabel: string;
  capacity: number;
  /** ONUs provisioned downstream of this port. */
  onuIds: string[];
  /** Joints reached through this port. */
  tjIds: string[];
  full: boolean;
}

const OLT_SELECT = 'SELECT id, code, name, olt_type, pon_port, pon_ports FROM olts';
const TJ_SELECT = 'SELECT id, code, splitter, splitters FROM tjs';
const LINK_SELECT = `SELECT id, from_tj_id, from_olt_id, from_onu_id,
                            to_tj_id, to_olt_id, to_onu_id,
                            from_core_label, to_core_label, cores
                       FROM tj_links`;

interface OltDbRow {
  id: string;
  code: string;
  name: string;
  olt_type: string | null;
  pon_port: string | null;
  pon_ports: unknown;
}

interface TjDbRow {
  id: string;
  code: string;
  splitter: unknown;
  splitters: unknown;
}

interface LinkDbRow {
  id: string;
  from_tj_id: string | null;
  from_olt_id: string | null;
  from_onu_id: string | null;
  to_tj_id: string | null;
  to_olt_id: string | null;
  to_onu_id: string | null;
  from_core_label: string | null;
  to_core_label: string | null;
  cores: unknown;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normaliseLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function endpointAt(link: PonLinkShape, side: Side): Endpoint | null {
  if (side === 'from') {
    if (link.fromOltId) return { kind: 'olt', id: link.fromOltId };
    if (link.fromTjId) return { kind: 'tj', id: link.fromTjId };
    if (link.fromOnuId) return { kind: 'onu', id: link.fromOnuId };
    return null;
  }
  if (link.toOltId) return { kind: 'olt', id: link.toOltId };
  if (link.toTjId) return { kind: 'tj', id: link.toTjId };
  if (link.toOnuId) return { kind: 'onu', id: link.toOnuId };
  return null;
}

/** Strands this span terminates at one device, lower-cased for comparison. */
function localCores(link: PonLinkShape, side: Side): string[] {
  const fromRows = (link.cores ?? [])
    .map((core) => normaliseLabel(side === 'from' ? core.fromCoreLabel : core.toCoreLabel))
    .filter(Boolean);
  if (fromRows.length > 0) return [...new Set(fromRows.map((label) => label.toLowerCase()))];
  const scalar = normaliseLabel(side === 'from' ? link.fromCoreLabel : link.toCoreLabel);
  return scalar ? [scalar.toLowerCase()] : [];
}

function normaliseOlt(row: OltDbRow): PonOltShape {
  const ports = asArray(row.pon_ports)
    .map((item) => (item && typeof item === 'object' ? normaliseLabel((item as { label?: unknown }).label) : ''))
    .filter(Boolean);
  const primary = normaliseLabel(row.pon_port) || ports[0] || null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    oltType: row.olt_type || 'gpon',
    ports,
    primaryPort: primary,
  };
}

function normaliseTj(row: TjDbRow): PonTjShape {
  const raw = [...asArray(row.splitters)];
  if (row.splitter && typeof row.splitter === 'object') raw.push(row.splitter);

  const splitters = raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const splitter = item as { enabled?: unknown; inputCoreLabel?: unknown; outputs?: unknown };
    if (splitter.enabled === false) return [];
    const legs = asArray(splitter.outputs)
      .map((output) =>
        output && typeof output === 'object' ? normaliseLabel((output as { label?: unknown }).label) : '',
      )
      .filter(Boolean);
    if (legs.length === 0) return [];
    return [{ inputCoreLabel: normaliseLabel(splitter.inputCoreLabel) || null, legs }];
  });

  return { id: row.id, code: row.code, splitters };
}

/** Turns a stored link row into the walk's shape. */
export function linkShapeFromRow(row: LinkDbRow): PonLinkShape {
  return {
    id: row.id,
    fromTjId: row.from_tj_id,
    fromOltId: row.from_olt_id,
    fromOnuId: row.from_onu_id,
    toTjId: row.to_tj_id,
    toOltId: row.to_olt_id,
    toOnuId: row.to_onu_id,
    fromCoreLabel: row.from_core_label,
    toCoreLabel: row.to_core_label,
    cores: asArray(row.cores).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const core = item as { fromCoreLabel?: unknown; toCoreLabel?: unknown };
      return [
        {
          fromCoreLabel: normaliseLabel(core.fromCoreLabel) || null,
          toCoreLabel: normaliseLabel(core.toCoreLabel) || null,
        },
      ];
    }),
  };
}

/**
 * Walks downstream from one PON port: the span patched to the port feeds the
 * joint at its far end, a splitter there hands light to its legs, and every
 * joint, splitter leg and span on the way is followed until subscriber ONUs are
 * reached. Unlabelled spans are followed as spliced-through cores.
 */
function reachableFromPort(
  olt: PonOltShape,
  portLabel: string,
  links: PonLinkShape[],
  tjs: Map<string, PonTjShape>,
): { onuIds: Set<string>; tjIds: Set<string> } {
  const onuIds = new Set<string>();
  const tjIds = new Set<string>();
  const visited = new Set<string>();
  const port = portLabel.trim().toLowerCase();
  const primary = olt.primaryPort?.trim().toLowerCase() ?? '';

  const queue: { link: PonLinkShape; side: Side }[] = [];
  for (const link of links) {
    for (const side of ['from', 'to'] as Side[]) {
      const endpoint = endpointAt(link, side);
      if (!endpoint || endpoint.kind !== 'olt' || endpoint.id !== olt.id) continue;
      const labels = localCores(link, side);
      const patched = labels.length > 0 ? labels.includes(port) : port === primary;
      if (patched) queue.push({ link, side });
    }
  }

  while (queue.length > 0) {
    const { link, side } = queue.shift()!;
    const outer: Side = side === 'from' ? 'to' : 'from';
    const endpoint = endpointAt(link, outer);
    if (!endpoint) continue;
    if (endpoint.kind === 'onu') {
      onuIds.add(endpoint.id);
      continue;
    }
    if (endpoint.kind === 'olt') continue;

    const arriving = localCores(link, outer);
    const stateKey = `${endpoint.id}|${[...arriving].sort().join(',')}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);
    tjIds.add(endpoint.id);

    const tj = tjs.get(endpoint.id);
    if (!tj) continue;

    // Cores this joint can hand downstream: the incoming strand passes through,
    // and every splitter fed by it hands its legs on.
    const reachable = new Set<string>(arriving);
    for (const splitter of tj.splitters) {
      const feed = splitter.inputCoreLabel?.trim().toLowerCase() ?? '';
      const fed = !feed || arriving.length === 0 || arriving.includes(feed);
      if (!fed) continue;
      splitter.legs.forEach((leg) => reachable.add(leg.trim().toLowerCase()));
    }

    for (const next of links) {
      if (next.id === link.id) continue;
      for (const nextSide of ['from', 'to'] as Side[]) {
        const at = endpointAt(next, nextSide);
        if (!at || at.kind !== 'tj' || at.id !== endpoint.id) continue;
        const labels = localCores(next, nextSide);
        const matches = labels.length === 0 || labels.some((label) => reachable.has(label));
        if (matches) queue.push({ link: next, side: nextSide });
      }
    }
  }

  return { onuIds, tjIds };
}

/** ONU count and serving joints for every PON port of every cabinet given. */
export function computePonPortLoads(
  olts: PonOltShape[],
  tjs: PonTjShape[],
  links: PonLinkShape[],
): PonPortLoad[] {
  const tjMap = new Map(tjs.map((tj) => [tj.id, tj]));
  const loads: PonPortLoad[] = [];
  for (const olt of olts) {
    const capacity = ponOnuCapacity(olt.oltType);
    for (const portLabel of olt.ports) {
      const { onuIds, tjIds } = reachableFromPort(olt, portLabel, links, tjMap);
      loads.push({
        oltId: olt.id,
        oltCode: olt.code,
        oltName: olt.name,
        oltType: olt.oltType,
        portLabel,
        capacity,
        onuIds: [...onuIds],
        tjIds: [...tjIds],
        full: onuIds.size >= capacity,
      });
    }
  }
  return loads;
}

interface Topology {
  olts: PonOltShape[];
  tjs: PonTjShape[];
  links: PonLinkShape[];
}

async function loadTopology(db: DatabaseService): Promise<Topology> {
  const [oltRows, tjRows, linkRows] = await Promise.all([
    db.query<OltDbRow>(OLT_SELECT),
    db.query<TjDbRow>(TJ_SELECT),
    db.query<LinkDbRow>(LINK_SELECT),
  ]);
  return {
    olts: oltRows.map(normaliseOlt),
    tjs: tjRows.map(normaliseTj),
    links: linkRows.map(linkShapeFromRow),
  };
}

/**
 * ONU count per PON port, keyed by OLT id and the port label lower-cased. The
 * count walks the real OLT → joint → splitter → ONU tree, so it matches the
 * subscribers a port actually serves.
 */
export async function ponOnuUsage(
  db: DatabaseService,
  oltIds?: string[],
): Promise<Map<string, Map<string, number>>> {
  const usage = new Map<string, Map<string, number>>();
  const wanted = oltIds && oltIds.length > 0 ? new Set(oltIds) : null;
  if (wanted && wanted.size === 0) return usage;
  const topology = await loadTopology(db);
  const olts = wanted ? topology.olts.filter((olt) => wanted.has(olt.id)) : topology.olts;
  for (const load of computePonPortLoads(olts, topology.tjs, topology.links)) {
    const bucket = usage.get(load.oltId) ?? new Map<string, number>();
    bucket.set(load.portLabel.trim().toLowerCase(), load.onuIds.length);
    usage.set(load.oltId, bucket);
  }
  return usage;
}

/**
 * Refuses a link that would take a PON port past the ONU limit its OLT type
 * supports. `candidate` is the span about to be saved; it replaces the stored
 * row with the same id (or joins the tree when its id is new).
 */
export async function assertPonOnuCapacity(
  db: DatabaseService,
  onuIds: string[],
  candidate?: PonLinkShape,
): Promise<void> {
  if (onuIds.length === 0) return;
  const topology = await loadTopology(db);
  const links = candidate
    ? [...topology.links.filter((link) => link.id !== candidate.id), candidate]
    : topology.links;
  const loads = computePonPortLoads(topology.olts, topology.tjs, links);

  for (const onuId of onuIds) {
    const load = loads.find((item) => item.onuIds.includes(onuId));
    if (!load || load.onuIds.length <= load.capacity) continue;
    throw new BadRequestException(
      `${load.oltCode} PON ${load.portLabel} is full — ${load.onuIds.length}/${load.capacity} ONUs ` +
        `(${load.oltType.replace('_', '-').toUpperCase()} limit). Free a subscriber on this port, ` +
        'or patch this ONU onto another PON port.',
    );
  }
}

import type { POI, Stop, LatLng } from './types';
import { VISIT_DEFAULTS, SUBS } from './categories';

export const ROME: LatLng = { lat: 41.8986, lng: 12.4769 };

export function fmt(m: number): string {
  m = Math.round(m);
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return `${h}h ${mm}m`;
  if (h) return `${h}h`;
  return `${mm}m`;
}

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function walkMin(meters: number): number { return meters / 90; }

/** Direzione bussola (gradi 0–360, 0 = Nord) da `a` verso `b`. */
export function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => d * Math.PI / 180;
  const toDeg = (r: number) => r * 180 / Math.PI;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function isGem(p: POI | null): boolean { return !!(p?.gem); }

export function effVisit(p: POI | null): number {
  if (!p) return 0;
  if (p.visit != null) return p.visit;
  let v: number | null = null;
  (p.sub ?? []).forEach(s => {
    const d = VISIT_DEFAULTS[s];
    if (d != null) v = v == null ? d : Math.max(v, d);
  });
  return v ?? 30;
}

export function matches(p: POI, cats: string[]): boolean {
  if (p.sub?.some(s => cats.includes(s))) return true;
  return isGem(p) && cats.includes('scoperte');
}

export function iconFor(p: POI | null): string {
  if (!p) return 'ti-map-pin';
  if (isGem(p)) return 'ti-sparkles';
  const s = p.sub?.[0];
  return (s && SUBS[s]) ? SUBS[s].icon : 'ti-map-pin';
}

export function catLabel(p: POI): string {
  return (p.sub ?? []).map(s => SUBS[s]?.label ?? s).join(' · ');
}

export function countedVisit(s: Stop): number {
  return s.kind === 'stop' && s.mode !== 'visit' ? 0 : (s.visit ?? 0);
}

export interface GenerateParams {
  minutes: number;
  cats: string[];
  roundTrip: boolean;
  startId: string;
  endId: string;
  user: LatLng | null;
  allPois: POI[];
}

export function generate(p: GenerateParams): Stop[] {
  const { minutes, cats, roundTrip, startId, endId, user, allPois } = p;

  const byId = (id: string) => id ? (allPois.find(x => x.id === id) ?? null) : null;
  const startPoi = byId(startId);
  const endPoi   = byId(endId);
  const hasDest  = !!endPoi && (!startPoi || endPoi.id !== startPoi.id);
  const loop     = hasDest ? false : roundTrip;
  const start: LatLng = startPoi ?? user ?? ROME;
  const end: LatLng | null = hasDest
    ? { lat: endPoi!.lat, lng: endPoi!.lng }
    : loop ? start : null;

  const pool = allPois.filter(x => matches(x, cats) && x.id !== startId && x.id !== endId);

  const MAX = 8;
  let remaining = [...pool], chosen: POI[] = [], cur: LatLng = start;
  let used = effVisit(startPoi) + (endPoi ? effVisit(endPoi) : 0);

  while (remaining.length && chosen.length < MAX) {
    let best: POI | null = null, bestCost = Infinity;
    const baseLeg = end ? walkMin(haversine(cur, end)) : 0;

    for (const c of remaining) {
      const legIn  = walkMin(haversine(cur, c));
      const legOut = end ? walkMin(haversine(c, end)) : 0;
      if (used + legIn + effVisit(c) + legOut <= minutes) {
        // preferisci la tappa più vicina, con bonus per i luoghi più rilevanti
        const relevance = (c.score ?? 0) / 20 + (isGem(c) ? 1 : 0);
        const cost = (legIn + legOut - baseLeg) - relevance;
        if (cost < bestCost) { best = c; bestCost = cost; }
      }
    }

    if (!best) break;
    used += walkMin(haversine(cur, best)) + effVisit(best);
    chosen.push(best);
    cur = { lat: best.lat, lng: best.lng };
    remaining.splice(remaining.indexOf(best), 1);
  }

  const stops: Stop[] = [];

  stops.push({
    kind: 'start',
    name: startPoi?.name ?? 'La tua posizione',
    lat: start.lat, lng: start.lng,
    poi: startPoi, visit: effVisit(startPoi),
    mode: 'visit', gem: isGem(startPoi)
  });

  let prev: LatLng = start;
  for (const c of chosen) {
    stops.push({
      kind: 'stop', name: c.name,
      lat: c.lat, lng: c.lng, poi: c,
      visit: effVisit(c), mode: 'visit', gem: isGem(c),
      walkMin: Math.round(walkMin(haversine(prev, c)))
    });
    prev = { lat: c.lat, lng: c.lng };
  }

  if (end) {
    stops.push({
      kind: 'end',
      name: endPoi?.name ?? 'Ritorno alla partenza',
      lat: end.lat, lng: end.lng,
      poi: endPoi ?? null,
      visit: effVisit(endPoi), mode: 'visit', gem: isGem(endPoi),
      walkMin: Math.round(walkMin(haversine(prev, end)))
    });
  }

  return stops;
}

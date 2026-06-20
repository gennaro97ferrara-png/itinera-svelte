import type { POI, Stop, LatLng, NamedPoint, TravelMode } from './types';
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

// Velocità media per mezzo, in metri al minuto (stima a linea d'aria).
//  walk ~4,8 km/h · bike ~15 km/h · car ~30 km/h urbana · transit ~18 km/h effettivi
export const SPEED_MPM: Record<TravelMode, number> = {
  walk: 80, bike: 250, car: 500, transit: 300,
};

/** Minuti di spostamento per `meters` con il mezzo scelto (default: a piedi). */
export function travelMin(meters: number, mode: TravelMode = 'walk'): number {
  return meters / SPEED_MPM[mode];
}

/** Alias storico: minuti a piedi. */
export function walkMin(meters: number): number { return travelMin(meters, 'walk'); }

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
  startPoint: NamedPoint | null;
  endPoint: NamedPoint | null;
  user: LatLng | null;
  allPois: POI[];
  mode?: TravelMode;
}

export function generate(p: GenerateParams): Stop[] {
  const { minutes, cats, roundTrip, startPoint, endPoint, user, allPois, mode = 'walk' } = p;

  // minuti di spostamento tra due punti col mezzo scelto
  const leg = (a: LatLng, b: LatLng) => travelMin(haversine(a, b), mode);

  const hasDest = !!endPoint;
  const loop    = hasDest ? false : roundTrip;
  const start: LatLng = startPoint ?? user ?? ROME;
  const end: LatLng | null = hasDest
    ? { lat: endPoint!.lat, lng: endPoint!.lng }
    : loop ? start : null;

  const pool = allPois.filter(x => matches(x, cats));

  const MAX = 14;
  let remaining = [...pool], chosen: POI[] = [], cur: LatLng = start;
  let used = 0;

  while (remaining.length && chosen.length < MAX) {
    let best: POI | null = null, bestCost = Infinity;
    const baseLeg = end ? leg(cur, end) : 0;

    for (const c of remaining) {
      const legIn  = leg(cur, c);
      const legOut = end ? leg(c, end) : 0;
      if (used + legIn + effVisit(c) + legOut <= minutes) {
        // preferisci la tappa più vicina, con bonus per i luoghi più rilevanti
        const relevance = (c.score ?? 0) / 20 + (isGem(c) ? 1 : 0);
        const cost = (legIn + legOut - baseLeg) - relevance;
        if (cost < bestCost) { best = c; bestCost = cost; }
      }
    }

    if (!best) break;
    used += leg(cur, best) + effVisit(best);
    chosen.push(best);
    cur = { lat: best.lat, lng: best.lng };
    remaining.splice(remaining.indexOf(best), 1);
  }

  const stops: Stop[] = [];

  stops.push({
    kind: 'start',
    name: startPoint?.name ?? 'La tua posizione',
    lat: start.lat, lng: start.lng,
    poi: null, visit: 0,
    mode: 'visit', gem: false
  });

  let prev: LatLng = start;
  for (const c of chosen) {
    stops.push({
      kind: 'stop', name: c.name,
      lat: c.lat, lng: c.lng, poi: c,
      visit: effVisit(c), mode: 'visit', gem: isGem(c),
      walkMin: Math.round(leg(prev, c))
    });
    prev = { lat: c.lat, lng: c.lng };
  }

  if (end) {
    stops.push({
      kind: 'end',
      name: endPoint?.name ?? 'Ritorno alla partenza',
      lat: end.lat, lng: end.lng,
      poi: null,
      visit: 0, mode: 'visit', gem: false,
      walkMin: Math.round(leg(prev, end))
    });
  }

  return stops;
}

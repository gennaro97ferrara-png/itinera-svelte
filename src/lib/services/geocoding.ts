export interface GeoResult {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

let controller: AbortController | null = null;

// Reverse geocoding: coordinate → indirizzo leggibile. Cache in memoria per non
// ripetere le chiamate (Nominatim limita ~1 req/s).
const revCache = new Map<string, string | null>();

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (revCache.has(key)) return revCache.get(key) ?? null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=it&zoom=18&addressdetails=1`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Itinera-App/1.0' } });
    if (!r.ok) { revCache.set(key, null); return null; }
    const d: any = await r.json();
    const a = d.address ?? {};
    const road = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? a.neighbourhood ?? '';
    const num  = a.house_number ?? '';
    const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb ?? '';
    const line = [road && num ? `${road} ${num}` : road, city].filter(Boolean).join(', ');
    const result = line || (d.display_name ? d.display_name.split(',').slice(0, 2).join(',').trim() : null);
    revCache.set(key, result);
    return result;
  } catch {
    revCache.set(key, null);
    return null;
  }
}

export async function searchPlace(query: string): Promise<GeoResult[]> {
  if (query.trim().length < 2) return [];
  controller?.abort();
  controller = new AbortController();
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=it&addressdetails=1`;
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Itinera-App/1.0' }
    });
    if (!r.ok) return [];
    const data: any[] = await r.json();
    return data.map(d => ({
      id: String(d.place_id),
      name: d.name || d.display_name.split(',')[0].trim(),
      detail: d.display_name.split(',').slice(1, 3).join(',').trim(),
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    }));
  } catch {
    return [];
  }
}

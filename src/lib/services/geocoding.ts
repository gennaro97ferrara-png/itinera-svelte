export interface GeoResult {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

let controller: AbortController | null = null;

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

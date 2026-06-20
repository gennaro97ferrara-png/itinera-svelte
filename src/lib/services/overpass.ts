import type { POI, Bounds } from '$lib/domain/types';

// Endpoint con fallback: si prova il primo, se fallisce/è lento si passa al successivo
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',  // di solito il più veloce
  'https://overpass-api.de/api/interpreter',
];
const CLIENT_TIMEOUT_MS = 9000;  // taglio rapido: meglio i dati demo che un'attesa lunga

// Cache in memoria: stessa zona + stessi interessi → risposta immediata
const cache = new Map<string, POI[]>();
function cacheKey(lat: number, lng: number, radius: number, cats: string[]): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)},${radius},${[...cats].sort().join(',')}`;
}

const CAT_FILTERS: Record<string, { f: string; types: string[] }[]> = {
  musei:      [{ f: '["tourism"="museum"]',                          types: ['node', 'way'] }],
  monumenti:  [{ f: '["tourism"="monument"]',                        types: ['node', 'way'] },
               { f: '["historic"="monument"]',                       types: ['node', 'way'] },
               { f: '["historic"="archaeological_site"]',            types: ['node', 'way'] }],
  storico:    [{ f: '["historic"]',                                  types: ['node', 'way'] }],
  arte:       [{ f: '["tourism"="artwork"]',                         types: ['node'] }],
  chiese:     [{ f: '["amenity"="place_of_worship"]',                types: ['node', 'way'] }],
  ristoranti: [{ f: '["amenity"="restaurant"]',                      types: ['node', 'way'] }],
  pizza:      [{ f: '["amenity"="restaurant"]["cuisine"~"pizza",i]', types: ['node'] },
               { f: '["amenity"="fast_food"]["cuisine"~"pizza",i]',  types: ['node'] }],
  panini:     [{ f: '["amenity"="fast_food"]["cuisine"~"sandwich",i]', types: ['node'] },
               { f: '["shop"="sandwich"]',                           types: ['node'] }],
  gelati:     [{ f: '["amenity"="ice_cream"]',                       types: ['node'] },
               { f: '["shop"="ice_cream"]',                          types: ['node'] },
               { f: '["cuisine"~"ice_cream",i]',                     types: ['node'] }],
  street:     [{ f: '["amenity"="fast_food"]',                       types: ['node'] },
               { f: '["amenity"="food_court"]',                      types: ['node'] }],
  caffe:      [{ f: '["amenity"="cafe"]',                            types: ['node'] }],
  bar:        [{ f: '["amenity"="bar"]',                             types: ['node', 'way'] }],
  pub:        [{ f: '["amenity"="pub"]',                             types: ['node', 'way'] }],
  cocktail:   [{ f: '["amenity"="bar"]["cocktails"~"yes",i]',        types: ['node'] },
               { f: '["amenity"="bar"]["drink:cocktail"~"yes",i]',   types: ['node'] }],
  discoteche: [{ f: '["amenity"="nightclub"]',                       types: ['node', 'way'] },
               { f: '["leisure"="dance"]',                           types: ['node', 'way'] }],
  livemusic:  [{ f: '["amenity"~"nightclub|bar|pub"]["live_music"~"yes",i]', types: ['node'] }],
  teatri:     [{ f: '["amenity"="theatre"]',                         types: ['node', 'way'] }],
  piazze:     [{ f: '["place"="square"]',                            types: ['node', 'way', 'relation'] }],
  parchi:     [{ f: '["leisure"="park"]',                            types: ['way', 'relation'] },
               { f: '["leisure"="garden"]',                          types: ['way', 'relation'] }],
  panorami:   [{ f: '["tourism"="viewpoint"]',                       types: ['node'] }],
  mercati:    [{ f: '["amenity"="marketplace"]',                     types: ['node', 'way'] }],
  spiagge:    [{ f: '["natural"="beach"]',                           types: ['node', 'way'] }],
  toilets:    [{ f: '["amenity"="toilets"]',                         types: ['node', 'way'] }],
  acqua:      [{ f: '["amenity"="drinking_water"]',                  types: ['node'] }],
  farmacie:   [{ f: '["amenity"="pharmacy"]',                        types: ['node', 'way'] }],
  bancomat:   [{ f: '["amenity"="atm"]',                             types: ['node'] }],
  stazioni:   [{ f: '["railway"="station"]',                         types: ['node', 'way'] },
               { f: '["station"="subway"]',                          types: ['node'] }],
  aeroporti:  [{ f: '["aeroway"="aerodrome"]',                       types: ['node', 'way'] }],
  parcheggi:  [{ f: '["amenity"="parking"]',                         types: ['node', 'way'] }],
  scoperte:   [{ f: '["historic"]',                                  types: ['node'] },
               { f: '["tourism"="artwork"]',                         types: ['node'] }]
};

const VISIT_DEF: Record<string, number> = {
  // indoor / strutturati: tempo reale di fruizione
  musei: 120, chiese: 20, parchi: 35, teatri: 15,
  // outdoor / monumenti: osservazione breve
  monumenti: 15, storico: 10, arte: 8, piazze: 12, panorami: 10, mercati: 20, spiagge: 40,
  // cibo
  ristoranti: 70, pizza: 40, panini: 15, gelati: 12, street: 20, caffe: 18,
  // vita notturna
  bar: 30, pub: 45, cocktail: 40, discoteche: 90, livemusic: 60,
  // servizi: tappe di utilità (nessun tempo di visita)
  toilets: 0, acqua: 0, farmacie: 0, bancomat: 0
};

const MACRO_MAP: Record<string, string> = {
  musei: 'cultura', monumenti: 'cultura', storico: 'cultura', arte: 'cultura', chiese: 'cultura', teatri: 'cultura',
  ristoranti: 'cibo', pizza: 'cibo', panini: 'cibo', gelati: 'cibo', street: 'cibo', caffe: 'cibo',
  bar: 'notturna', pub: 'notturna', cocktail: 'notturna', discoteche: 'notturna', livemusic: 'notturna',
  piazze: 'luoghi', parchi: 'luoghi', panorami: 'luoghi', mercati: 'luoghi', spiagge: 'luoghi',
  toilets: 'servizi', acqua: 'servizi', farmacie: 'servizi', bancomat: 'servizi'
};

const MAINSTREAM_HISTORIC = [
  'monument', 'archaeological_site', 'castle', 'palace', 'fort',
  'city_wall', 'city_gate', 'amphitheatre', 'aqueduct'
];

function buildQuery(cats: string[], lat: number, lng: number, radius: number): string {
  // timeout breve + cap sui risultati = risposta più rapida e payload più leggero
  const lines = ['[out:json][timeout:12];', '('];
  const seen = new Set<string>();
  cats.forEach(cat => {
    (CAT_FILTERS[cat] ?? []).forEach(entry => {
      entry.types.forEach(type => {
        const line = `  ${type}${entry.f}(around:${radius},${lat.toFixed(5)},${lng.toFixed(5)});`;
        if (!seen.has(line)) { seen.add(line); lines.push(line); }
      });
    });
  });
  lines.push(');', 'out center tags 120;');
  return lines.join('\n');
}

// Variante con riquadro geografico (south,west,north,east) per la selezione di un'area.
function buildBboxQuery(cats: string[], s: number, w: number, n: number, e: number): string {
  const bbox = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  const lines = ['[out:json][timeout:18];', '('];
  const seen = new Set<string>();
  cats.forEach(cat => {
    (CAT_FILTERS[cat] ?? []).forEach(entry => {
      entry.types.forEach(type => {
        const line = `  ${type}${entry.f}(${bbox});`;
        if (!seen.has(line)) { seen.add(line); lines.push(line); }
      });
    });
  });
  lines.push(');', 'out center tags 200;');
  return lines.join('\n');
}

function getPos(el: any): { lat: number; lng: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

function detectSubs(tags: any): string[] {
  const subs: string[] = [];
  const { tourism: t, amenity: a, historic: h, leisure: l, place: p,
          shop: sh, natural: n } = tags;
  const cuisine = (tags.cuisine ?? '').toLowerCase();
  if (t === 'museum')   subs.push('musei');
  if (t === 'monument' || h === 'monument') subs.push('monumenti');
  if (h === 'archaeological_site') { if (!subs.includes('monumenti')) subs.push('monumenti'); subs.push('storico'); }
  if (h === 'castle' || h === 'palace' || h === 'fort') {
    if (!subs.includes('monumenti')) subs.push('monumenti');
    if (!subs.includes('storico'))   subs.push('storico');
  }
  if (h && !subs.includes('storico')) subs.push('storico');
  if (t === 'artwork')   subs.push('arte');
  if (a === 'place_of_worship') subs.push('chiese');
  if (a === 'restaurant') {
    subs.push('ristoranti');
    if (cuisine.includes('pizza')) subs.push('pizza');
  }
  if (a === 'fast_food' || a === 'food_court') {
    if (cuisine.includes('pizza'))    subs.push('pizza');
    else if (cuisine.includes('sandwich')) subs.push('panini');
    else subs.push('street');
  }
  if (sh === 'sandwich') subs.push('panini');
  if (a === 'ice_cream' || sh === 'ice_cream' || cuisine.includes('ice_cream')) subs.push('gelati');
  if (a === 'cafe')      subs.push('caffe');
  if (a === 'bar')       subs.push('bar');
  if (a === 'pub')       subs.push('pub');
  if (a === 'nightclub' || l === 'dance') subs.push('discoteche');
  if (a === 'bar' && /yes|true/i.test(tags.cocktails ?? tags['drink:cocktail'] ?? '')) subs.push('cocktail');
  if (/yes|true|live/i.test(tags.live_music ?? '')) subs.push('livemusic');
  if (a === 'theatre')   subs.push('teatri');
  if (p === 'square')    subs.push('piazze');
  if (l === 'park' || l === 'garden') subs.push('parchi');
  if (t === 'viewpoint') subs.push('panorami');
  if (a === 'marketplace') subs.push('mercati');
  if (n === 'beach')     subs.push('spiagge');
  if (a === 'toilets')        subs.push('toilets');
  if (a === 'drinking_water') subs.push('acqua');
  if (a === 'pharmacy')       subs.push('farmacie');
  if (a === 'atm')            subs.push('bancomat');
  return subs.length ? subs : ['storico'];
}

function detectMacro(subs: string[]): string {
  return MACRO_MAP[subs.find(s => MACRO_MAP[s]) ?? ''] ?? 'cultura';
}

function detectGem(tags: any, subs: string[]): boolean {
  if (tags.tourism === 'artwork' && !tags.wikipedia) return true;
  if (tags.historic && !tags.wikipedia && !MAINSTREAM_HISTORIC.includes(tags.historic)) return true;
  return false;
}

function calcScore(tags: any, subs: string[]): number {
  let s = 10;
  if (tags.wikipedia) s += 30;
  if (tags.wikidata)  s += 10;
  if (tags.website || tags['contact:website']) s += 5;
  if (subs.includes('musei'))    s += 15;
  if (subs.includes('panorami')) s += 10;
  if (subs.includes('piazze'))   s += 5;
  return s;
}

function parseWikiTitle(tags: any): string | null {
  const w: string | undefined = tags.wikipedia;
  if (!w) return null;
  const sep = w.indexOf(':');
  if (sep >= 0) {
    if (w.substring(0, sep) === 'it') return decodeURIComponent(w.substring(sep + 1).replace(/_/g, ' '));
    return null;
  }
  return w;
}

// Estrae un anno/secolo da tag come start_date, year, inscription_date
function extractEpoch(tags: any): string | null {
  const raw: string | undefined = tags.start_date ?? tags['year_of_construction'] ?? tags.year;
  if (raw) {
    const y = /(\d{3,4})/.exec(raw);
    if (y) {
      const n = +y[1];
      const sec = Math.floor((n - 1) / 100) + 1;
      return `del ${sec}° secolo`;
    }
  }
  return null;
}

// Descrizione specifica ancorata ai tag reali OSM (mai inventata)
function buildStory(tags: any, name: string): string {
  const { tourism: t, amenity: a, historic: h, leisure: l, building: b } = tags;
  const epoch = extractEpoch(tags);
  const epochSuffix = epoch ? ` ${epoch}` : '';
  const heritage = tags.heritage || tags['heritage:operator'] ? ' tutelato come bene storico' : '';

  if (t === 'museum') {
    const subj = tags.museum ? `dedicato a ${tags.museum.replace(/_/g, ' ')}` : 'del territorio';
    return `Museo ${subj}${heritage}.`;
  }
  if (t === 'artwork') {
    const kind = tags.artwork_type ? tags.artwork_type.replace(/_/g, ' ') : 'opera';
    const author = tags.artist_name ? ` di ${tags.artist_name}` : '';
    return `${cap(kind)}${author} nello spazio urbano.`;
  }
  if (t === 'viewpoint') return 'Punto panoramico con vista aperta sui dintorni.';
  if (a === 'place_of_worship') {
    const den = tags.denomination ? tags.denomination.replace(/_/g, ' ') : '';
    const rel = den || tags.religion || '';
    return `Luogo di culto${rel ? ` ${rel}` : ''}${epochSuffix}${heritage}.`;
  }
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') {
    const cui = tags.cuisine ? tags.cuisine.split(';')[0].replace(/_/g, ' ') : '';
    return cui ? `Cucina ${cui} — una sosta per mangiare.` : 'Una tappa per mangiare lungo il cammino.';
  }
  if (a === 'cafe')      return 'Caffè per una pausa veloce.';
  if (a === 'bar')       return 'Bar per un drink e due chiacchiere.';
  if (a === 'pub')       return 'Pub dove fermarsi per una birra.';
  if (a === 'nightclub' || l === 'dance') return 'Locale notturno per ballare fino a tardi.';
  if (a === 'theatre')   return `Teatro${epochSuffix}${heritage}.`;
  if (a === 'marketplace') return 'Mercato cittadino tra le bancarelle.';
  if (tags.natural === 'beach') return 'Spiaggia per una pausa vista mare.';
  if (a === 'toilets')        return 'Servizi igienici pubblici.';
  if (a === 'drinking_water') return 'Fontanella di acqua potabile.';
  if (a === 'pharmacy')       return 'Farmacia.';
  if (a === 'atm')            return 'Sportello bancomat.';
  if (l === 'park' || l === 'garden') return 'Spazio verde per una sosta all’aperto.';
  if (tags.place === 'square') return `Piazza${epochSuffix} nel tessuto urbano.`;
  if (h === 'castle')    return `Castello${epochSuffix}${heritage}.`;
  if (h === 'palace' || b === 'palace') return `Palazzo storico${epochSuffix}${heritage}.`;
  if (h === 'memorial')  return 'Memoriale legato alla storia del luogo.';
  if (h === 'monument')  return `Monumento${epochSuffix}${heritage}.`;
  if (h === 'ruins')     return `Resti storici${epochSuffix} da osservare.`;
  if (h === 'archaeological_site') return `Sito archeologico${epochSuffix}.`;
  if (h)                 return `Luogo storico${epochSuffix}${heritage}.`;
  if (b && b !== 'yes')  return `Edificio storico (${b.replace(/_/g, ' ')})${epochSuffix}.`;
  return 'Punto d’interesse lungo il percorso.';
}

function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// Indirizzo leggibile dai tag addr:* di OSM (se presenti)
function buildAddress(tags: any): string | undefined {
  const street = tags['addr:street'];
  const num    = tags['addr:housenumber'];
  const city   = tags['addr:city'] ?? tags['addr:suburb'] ?? tags['addr:town'];
  const line1  = street ? (num ? `${street} ${num}` : street) : '';
  const parts  = [line1, city].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function visitFor(subs: string[]): number {
  const v = subs.reduce((best, s) => Math.max(best, VISIT_DEF[s] ?? 0), 0);
  return v > 0 ? v : 10;   // nessun floor a 30: i monumenti urbani durano pochi minuti
}

// Nome di ripiego per i servizi spesso anonimi in OSM (bagni, fontanelle, bancomat…)
const FALLBACK_NAME: Record<string, string> = {
  toilets: 'Bagno pubblico', drinking_water: 'Fontanella',
  pharmacy: 'Farmacia', atm: 'Bancomat', marketplace: 'Mercato',
};

function elementToPoi(el: any): POI | null {
  const pos = getPos(el);
  if (!pos) return null;
  const tags = el.tags ?? {};
  let name = (tags['name:it'] ?? tags.name ?? '').trim();
  if (!name) name = FALLBACK_NAME[tags.amenity] ?? (tags.natural === 'beach' ? 'Spiaggia' : '');
  if (!name) return null;
  const subs = detectSubs(tags);
  const gem  = detectGem(tags, subs);
  const food = subs.some(s => ['ristoranti', 'pizza', 'panini', 'gelati', 'street', 'caffe'].includes(s));
  const website: string | undefined = tags.website ?? tags['contact:website'];

  return {
    id:    `${el.type}_${el.id}`,
    name,
    lat:   pos.lat, lng: pos.lng,
    macro: detectMacro(subs),
    sub:   subs,
    gem:   gem || undefined,
    visit: visitFor(subs),
    score: calcScore(tags, subs),
    wiki:  parseWikiTitle(tags),
    story: buildStory(tags, name),
    ticketUrl:  (!food && website) ? website : undefined,
    bookingUrl: (food && website)  ? website : undefined,
    openingHours: tags.opening_hours ?? undefined,
    address: buildAddress(tags)
  };
}

function dedupe(pois: POI[]): POI[] {
  const seenId   = new Set<string>();
  const seenName = new Set<string>();
  return pois.filter(p => {
    if (seenId.has(p.id)) return false;
    seenId.add(p.id);
    // chiave nome + coord arrotondate (~100m): fonde lo stesso luogo (node+way)
    // ma non i tanti servizi omonimi distanti (es. più "Bagno pubblico")
    const nameKey = p.name.toLowerCase().replace(/[^a-z0-9à-ü]/gi, '').substring(0, 30);
    const key = `${nameKey}@${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (seenName.has(key)) return false;
    seenName.add(key);
    return true;
  });
}

async function fetchFrom(endpoint: string, query: string): Promise<POI[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(query),
      signal:  ctrl.signal,
    });
    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
    const json = await resp.json();
    return (json.elements ?? []).map(elementToPoi).filter(Boolean) as POI[];
  } finally {
    clearTimeout(t);
  }
}

export async function fetchPois(
  lat: number, lng: number, radius: number, cats: string[]
): Promise<POI[]> {
  const key = cacheKey(lat, lng, radius, cats);
  const hit = cache.get(key);
  if (hit) return hit;

  const query = buildQuery(cats, lat, lng, radius);
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const pois = dedupe(await fetchFrom(endpoint, query));
      cache.set(key, pois);
      return pois;
    } catch (e) {
      lastErr = e;   // prova l'endpoint successivo
    }
  }
  throw lastErr ?? new Error('Overpass non raggiungibile');
}

// POI dentro un riquadro disegnato sulla mappa (selezione area).
export async function fetchPoisInArea(bounds: Bounds, cats: string[]): Promise<POI[]> {
  const { south, west, north, east } = bounds;
  const key = `bbox:${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)},${[...cats].sort().join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const query = buildBboxQuery(cats, south, west, north, east);
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const pois = dedupe(await fetchFrom(endpoint, query));
      cache.set(key, pois);
      return pois;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Overpass non raggiungibile');
}

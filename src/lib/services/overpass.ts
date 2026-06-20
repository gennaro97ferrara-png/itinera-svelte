import type { POI, Bounds, LatLng } from '$lib/domain/types';

export interface TransitStop {
  id: string;
  name: string;
  type: 'bus' | 'metro' | 'tram' | 'train';
  lat: number;
  lng: number;
}

// Endpoint con fallback: si prova il primo, se fallisce/è lento si passa al successivo
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',  // di solito il più veloce
  'https://overpass-api.de/api/interpreter',
];
const CLIENT_TIMEOUT_MS = 9000;  // taglio rapido: meglio i dati demo che un'attesa lunga

// Cache a due livelli: memoria (immediata) + localStorage (persiste tra sessioni).
const cache = new Map<string, POI[]>();
function cacheKey(lat: number, lng: number, radius: number, cats: string[]): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)},${radius},${[...cats].sort().join(',')}`;
}

const LS_PREFIX = 'itinera.op.';
const LS_TTL    = 24 * 60 * 60 * 1000;   // 24h: i POI cambiano di rado

function lsLoad(key: string): POI[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const { t, pois } = JSON.parse(raw);
    if (Date.now() - t > LS_TTL) { localStorage.removeItem(LS_PREFIX + key); return null; }
    return pois as POI[];
  } catch { return null; }
}

function lsSave(key: string, pois: POI[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ t: Date.now(), pois }));
  } catch {
    // quota piena: libera le voci più vecchie di Itinera e riprova una volta
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
      }
      localStorage.setItem(LS_PREFIX + key, JSON.stringify({ t: Date.now(), pois }));
    } catch { /* rinuncia silenziosamente */ }
  }
}

// Cerca prima in memoria, poi su disco (promuovendo in memoria).
function cacheGet(key: string): POI[] | null {
  const mem = cache.get(key);
  if (mem) return mem;
  const disk = lsLoad(key);
  if (disk) { cache.set(key, disk); return disk; }
  return null;
}

function cacheSet(key: string, pois: POI[]): void {
  cache.set(key, pois);
  lsSave(key, pois);
}

const CAT_FILTERS: Record<string, { f: string; types: string[] }[]> = {
  // ── Cultura ─────────────────────────────────────────────────
  musei:       [{ f: '["tourism"="museum"]',                              types: ['node', 'way'] }],
  gallerie:    [{ f: '["tourism"="gallery"]',                             types: ['node', 'way'] }],
  monumenti:   [{ f: '["tourism"="monument"]',                            types: ['node', 'way'] },
                { f: '["historic"="monument"]',                           types: ['node', 'way'] },
                { f: '["historic"="archaeological_site"]',                types: ['node', 'way'] }],
  rovine:      [{ f: '["historic"~"ruins|castle|palace|fort|amphitheatre|city_gate|city_wall|aqueduct"]', types: ['node', 'way'] }],
  chiese:      [{ f: '["amenity"="place_of_worship"]',                    types: ['node', 'way'] }],
  arte:        [{ f: '["tourism"="artwork"]',                             types: ['node'] }],
  teatri:      [{ f: '["amenity"="theatre"]',                             types: ['node', 'way'] }],
  cinema:      [{ f: '["amenity"="cinema"]',                              types: ['node', 'way'] }],
  biblioteche: [{ f: '["amenity"="library"]',                             types: ['node', 'way'] }],
  storico:     [{ f: '["historic"]',                                      types: ['node', 'way'] }],
  // ── Natura & Outdoor ────────────────────────────────────────
  parchi:      [{ f: '["leisure"="park"]',                                types: ['way', 'relation'] },
                { f: '["leisure"="garden"]',                              types: ['way', 'relation'] }],
  panorami:    [{ f: '["tourism"="viewpoint"]',                           types: ['node'] }],
  piazze:      [{ f: '["place"="square"]',                                types: ['node', 'way', 'relation'] }],
  fontane:     [{ f: '["amenity"="fountain"]',                            types: ['node', 'way'] }],
  spiagge:     [{ f: '["natural"="beach"]',                               types: ['node', 'way'] }],
  riserve:     [{ f: '["leisure"="nature_reserve"]',                      types: ['way', 'relation'] },
                { f: '["boundary"="protected_area"]',                     types: ['way', 'relation'] }],
  // ── Cibo & Drink ─────────────────────────────────────────────
  ristoranti:  [{ f: '["amenity"="restaurant"]',                          types: ['node', 'way'] }],
  trattorie:   [{ f: '["amenity"="restaurant"]["cuisine"~"italian|regional|traditional",i]', types: ['node'] },
                { f: '["amenity"="restaurant"]["name"~"trattoria|osteria|locanda",i]',        types: ['node'] }],
  pizza:       [{ f: '["amenity"="restaurant"]["cuisine"~"pizza",i]',     types: ['node'] },
                { f: '["amenity"="fast_food"]["cuisine"~"pizza",i]',      types: ['node'] }],
  caffe:       [{ f: '["amenity"="cafe"]',                                types: ['node'] }],
  pasticcerie: [{ f: '["shop"~"pastry|bakery|confectionery"]',            types: ['node'] },
                { f: '["amenity"="cafe"]["cuisine"~"pastry|cake|bakery",i]', types: ['node'] }],
  gelati:      [{ f: '["amenity"="ice_cream"]',                           types: ['node'] },
                { f: '["shop"="ice_cream"]',                              types: ['node'] },
                { f: '["cuisine"~"ice_cream",i]',                         types: ['node'] }],
  street:      [{ f: '["amenity"="fast_food"]',                           types: ['node'] },
                { f: '["amenity"="food_court"]',                          types: ['node'] }],
  panini:      [{ f: '["amenity"="fast_food"]["cuisine"~"sandwich",i]',   types: ['node'] },
                { f: '["shop"="sandwich"]',                               types: ['node'] }],
  enoteca:     [{ f: '["shop"="wine"]',                                   types: ['node'] },
                { f: '["amenity"="bar"]["drink:wine"~"yes",i]',           types: ['node'] },
                { f: '["amenity"~"bar|restaurant"]["name"~"enoteca|vinoteca|cantina",i]', types: ['node'] }],
  mercati:     [{ f: '["amenity"="marketplace"]',                         types: ['node', 'way'] }],
  // ── Shopping ─────────────────────────────────────────────────
  antiquariato:[{ f: '["shop"="antiques"]',                               types: ['node'] }],
  librerie:    [{ f: '["shop"="books"]',                                  types: ['node'] }],
  artigianato: [{ f: '["shop"~"craft|art|ceramics|jewelry|pottery|leather"]', types: ['node'] }],
  souvenir:    [{ f: '["shop"="souvenir"]',                               types: ['node'] }],
  moda:        [{ f: '["shop"~"clothes|fashion|shoes|accessories"]',      types: ['node'] }],
  // ── Sport & Benessere ────────────────────────────────────────
  spa:         [{ f: '["leisure"="spa"]',                                 types: ['node', 'way'] },
                { f: '["amenity"="spa"]',                                 types: ['node', 'way'] },
                { f: '["leisure"="sauna"]',                               types: ['node'] }],
  sport:       [{ f: '["leisure"~"sports_centre|stadium|arena"]',         types: ['node', 'way'] }],
  zoo:         [{ f: '["tourism"~"zoo|aquarium"]',                        types: ['node', 'way'] }],
  parchi_gioco:[{ f: '["leisure"="playground"]',                          types: ['node', 'way'] }],
  // ── Vita notturna ────────────────────────────────────────────
  bar:         [{ f: '["amenity"="bar"]',                                 types: ['node', 'way'] }],
  pub:         [{ f: '["amenity"="pub"]',                                 types: ['node', 'way'] }],
  cocktail:    [{ f: '["amenity"="bar"]["cocktails"~"yes",i]',            types: ['node'] },
                { f: '["amenity"="bar"]["drink:cocktail"~"yes",i]',       types: ['node'] }],
  rooftop:     [{ f: '["amenity"="bar"]["rooftop"~"yes|terrace",i]',      types: ['node'] }],
  discoteche:  [{ f: '["amenity"="nightclub"]',                           types: ['node', 'way'] },
                { f: '["leisure"="dance"]',                               types: ['node', 'way'] }],
  livemusic:   [{ f: '["amenity"~"nightclub|bar|pub"]["live_music"~"yes",i]', types: ['node'] }],
  // ── Servizi ──────────────────────────────────────────────────
  toilets:     [{ f: '["amenity"="toilets"]',                             types: ['node', 'way'] }],
  acqua:       [{ f: '["amenity"="drinking_water"]',                      types: ['node'] }],
  farmacie:    [{ f: '["amenity"="pharmacy"]',                            types: ['node', 'way'] }],
  bancomat:    [{ f: '["amenity"="atm"]',                                 types: ['node'] }],
  ospedali:    [{ f: '["amenity"~"hospital|clinic"]',                     types: ['node', 'way'] }],
  // ── Scoperte (gem) ───────────────────────────────────────────
  scoperte:    [{ f: '["historic"]',                                      types: ['node'] },
                { f: '["tourism"="artwork"]',                             types: ['node'] }]
};

const VISIT_DEF: Record<string, number> = {
  // Cultura
  musei: 90, gallerie: 45, monumenti: 15, rovine: 30, chiese: 20, arte: 8,
  teatri: 15, cinema: 100, biblioteche: 20, storico: 10,
  // Natura
  parchi: 30, panorami: 10, piazze: 10, fontane: 5, spiagge: 60, riserve: 45,
  // Cibo
  ristoranti: 60, trattorie: 75, pizza: 30, caffe: 15, pasticcerie: 15,
  gelati: 10, street: 15, panini: 15, enoteca: 40, mercati: 25,
  // Shopping
  antiquariato: 30, librerie: 20, artigianato: 20, souvenir: 10, moda: 25,
  // Benessere
  spa: 120, sport: 20, zoo: 90, parchi_gioco: 45,
  // Notturna
  bar: 30, pub: 45, cocktail: 40, rooftop: 50, discoteche: 90, livemusic: 60,
  // Servizi (utilità: 0 min)
  toilets: 0, acqua: 0, farmacie: 0, bancomat: 0, ospedali: 0,
};

const MACRO_MAP: Record<string, string> = {
  // cultura
  musei: 'cultura', gallerie: 'cultura', monumenti: 'cultura', rovine: 'cultura',
  chiese: 'cultura', arte: 'cultura', teatri: 'cultura', cinema: 'cultura',
  biblioteche: 'cultura', storico: 'cultura',
  // natura
  parchi: 'natura', panorami: 'natura', piazze: 'natura', fontane: 'natura',
  spiagge: 'natura', riserve: 'natura',
  // cibo
  ristoranti: 'cibo', trattorie: 'cibo', pizza: 'cibo', caffe: 'cibo',
  pasticcerie: 'cibo', gelati: 'cibo', street: 'cibo', panini: 'cibo',
  enoteca: 'cibo', mercati: 'cibo',
  // shopping
  antiquariato: 'shopping', librerie: 'shopping', artigianato: 'shopping',
  souvenir: 'shopping', moda: 'shopping',
  // benessere
  spa: 'benessere', sport: 'benessere', zoo: 'benessere', parchi_gioco: 'benessere',
  // notturna
  bar: 'notturna', pub: 'notturna', cocktail: 'notturna', rooftop: 'notturna',
  discoteche: 'notturna', livemusic: 'notturna',
  // servizi
  toilets: 'servizi', acqua: 'servizi', farmacie: 'servizi',
  bancomat: 'servizi', ospedali: 'servizi',
};

const MAINSTREAM_HISTORIC = [
  'monument', 'archaeological_site', 'castle', 'palace', 'fort',
  'city_wall', 'city_gate', 'amphitheatre', 'aqueduct', 'ruins',
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
  const cuisine  = (tags.cuisine  ?? '').toLowerCase();
  const name     = (tags.name     ?? '').toLowerCase();
  const shopStr  = (sh            ?? '').toLowerCase();

  // ── CULTURA ─────────────────────────────────────────────────
  if (t === 'museum')   subs.push('musei');
  if (t === 'gallery')  subs.push('gallerie');
  if (a === 'cinema')   subs.push('cinema');
  if (a === 'library')  subs.push('biblioteche');
  if (a === 'theatre')  subs.push('teatri');
  if (t === 'artwork')  subs.push('arte');
  if (a === 'place_of_worship') subs.push('chiese');

  if (t === 'monument' || h === 'monument') subs.push('monumenti');
  if (h === 'archaeological_site') {
    if (!subs.includes('monumenti')) subs.push('monumenti');
    subs.push('storico');
  }
  const ROVINE_TYPES = ['ruins', 'castle', 'palace', 'fort', 'amphitheatre', 'city_wall', 'city_gate', 'aqueduct'];
  if (h && ROVINE_TYPES.includes(h)) {
    subs.push('rovine');
    if (!subs.includes('storico')) subs.push('storico');
  }
  if (h && !subs.includes('storico')) subs.push('storico');

  // ── NATURA ──────────────────────────────────────────────────
  if (p === 'square')     subs.push('piazze');
  if (a === 'fountain')   subs.push('fontane');
  if (l === 'park')       subs.push('parchi');
  if (l === 'garden')     subs.push('parchi');
  if (l === 'nature_reserve') subs.push('riserve');
  if (t === 'viewpoint')  subs.push('panorami');
  if (n === 'beach')      subs.push('spiagge');

  // ── CIBO ─────────────────────────────────────────────────────
  if (a === 'restaurant') {
    const isTrattoria = /italian|regional|traditional|toscana|romana|napoletana/.test(cuisine)
      || /trattoria|osteria|locanda|taverna/.test(name);
    if (isTrattoria) subs.push('trattorie');
    else             subs.push('ristoranti');
    if (cuisine.includes('pizza')) subs.push('pizza');
  }
  if (a === 'fast_food' || a === 'food_court') {
    if (cuisine.includes('pizza'))     subs.push('pizza');
    else if (cuisine.includes('sandwich')) subs.push('panini');
    else subs.push('street');
  }
  if (sh === 'sandwich')  subs.push('panini');
  if (a === 'ice_cream' || sh === 'ice_cream' || cuisine.includes('ice_cream')) subs.push('gelati');
  if (a === 'cafe') {
    if (/pastry|cake|bakery/.test(cuisine)) subs.push('pasticcerie');
    else subs.push('caffe');
  }
  if (['pastry', 'bakery', 'confectionery'].includes(shopStr)) subs.push('pasticcerie');
  if (sh === 'wine' || /enoteca|vinoteca|cantina/.test(name)) subs.push('enoteca');
  if (a === 'marketplace') subs.push('mercati');

  // ── SHOPPING ─────────────────────────────────────────────────
  if (sh === 'antiques')      subs.push('antiquariato');
  if (sh === 'books')         subs.push('librerie');
  if (['craft', 'art', 'ceramics', 'jewelry', 'pottery', 'leather'].includes(shopStr)) subs.push('artigianato');
  if (sh === 'souvenir')      subs.push('souvenir');
  if (['clothes', 'fashion', 'shoes', 'accessories'].includes(shopStr)) subs.push('moda');

  // ── BENESSERE ────────────────────────────────────────────────
  if (l === 'spa' || a === 'spa' || l === 'sauna') subs.push('spa');
  if (['sports_centre', 'stadium', 'arena'].includes(l ?? ''))  subs.push('sport');
  if (['zoo', 'aquarium'].includes(t ?? ''))        subs.push('zoo');
  if (l === 'playground')     subs.push('parchi_gioco');

  // ── NOTTURNA ─────────────────────────────────────────────────
  if (a === 'bar') {
    subs.push('bar');
    if (/yes|true/i.test(tags.cocktails ?? tags['drink:cocktail'] ?? '')) subs.push('cocktail');
    if (/yes|terrace/i.test(tags.rooftop ?? ''))  subs.push('rooftop');
  }
  if (a === 'pub')  subs.push('pub');
  if (a === 'nightclub' || l === 'dance') subs.push('discoteche');
  if (/yes|true|live/i.test(tags.live_music ?? '') && !subs.includes('livemusic')) subs.push('livemusic');

  // ── SERVIZI ──────────────────────────────────────────────────
  if (a === 'toilets')        subs.push('toilets');
  if (a === 'drinking_water') subs.push('acqua');
  if (a === 'pharmacy')       subs.push('farmacie');
  if (a === 'atm')            subs.push('bancomat');
  if (['hospital', 'clinic'].includes(a ?? '')) subs.push('ospedali');

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
  if (t === 'gallery')   return `Galleria d'arte${epochSuffix}${heritage}.`;
  if (a === 'cinema')    return 'Cinema.';
  if (a === 'library')   return `Biblioteca${heritage}.`;
  if (a === 'fountain')  return 'Fontana decorativa — una sosta scenografica.';
  if (a === 'spa')       return 'Centro benessere e relax.';
  if (['zoo', 'aquarium'].includes(t ?? ''))
    return t === 'aquarium' ? 'Acquario.' : 'Zoo.';
  if (l === 'playground') return 'Parco giochi.';
  if (l === 'sports_centre' || l === 'stadium') return 'Impianto sportivo.';
  if (l === 'nature_reserve') return 'Area naturale protetta.';
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
    const nameL = (tags.name ?? '').toLowerCase();
    if (/trattoria|osteria|locanda|taverna/.test(nameL)) return 'Cucina tradizionale — sapori autentici del territorio.';
    return cui ? `Cucina ${cui} — una sosta per mangiare.` : 'Una tappa per mangiare lungo il cammino.';
  }
  if (a === 'cafe')      return 'Caffè per una pausa veloce.';
  if (a === 'bar')       return 'Bar per un drink e due chiacchiere.';
  if (a === 'pub')       return 'Pub dove fermarsi per una birra.';
  if (a === 'nightclub' || l === 'dance') return 'Locale notturno per ballare fino a tardi.';
  if (a === 'theatre')   return `Teatro${epochSuffix}${heritage}.`;
  if (a === 'marketplace') return 'Mercato cittadino tra le bancarelle.';
  if (tags.natural === 'beach') return 'Spiaggia per una pausa vista mare.';
  if (a === 'hospital' || a === 'clinic') return 'Struttura sanitaria.';
  if (['pastry', 'bakery', 'confectionery'].includes(tags.shop ?? '')) return 'Pasticceria — dolci e prodotti da forno artigianali.';
  if (tags.shop === 'wine')   return 'Enoteca per degustare e acquistare vini locali.';
  if (tags.shop === 'antiques') return 'Negozio di antiquariato — oggetti e curiosità d\'epoca.';
  if (tags.shop === 'books')  return 'Libreria.';
  if (tags.shop === 'souvenir') return 'Negozio di souvenir.';
  if (['craft', 'ceramics', 'jewelry', 'pottery'].includes(tags.shop ?? ''))
    return 'Bottega artigianale — produzione e vendita diretta.';
  if (['clothes', 'fashion', 'shoes'].includes(tags.shop ?? ''))
    return 'Negozio di abbigliamento.';
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

  const imageTag: string | undefined =
    (typeof tags.image === 'string' && /^https?:\/\//.test(tags.image)) ? tags.image : undefined;

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
    wikidata: /^Q\d+$/.test(tags.wikidata ?? '') ? tags.wikidata : undefined,
    image: imageTag,
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
  const hit = cacheGet(key);
  if (hit) return hit;

  const query = buildQuery(cats, lat, lng, radius);
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const pois = dedupe(await fetchFrom(endpoint, query));
      cacheSet(key, pois);
      return pois;
    } catch (e) {
      lastErr = e;   // prova l'endpoint successivo
    }
  }
  throw lastErr ?? new Error('Overpass non raggiungibile');
}

/**
 * Recupera le fermate di trasporto pubblico (bus, metro, tram, treno) nel
 * riquadro che contiene tutti i punti della rotta + un padding di ~500m.
 * Una singola query copre l'intera rotta, senza chiamate per ogni tappa.
 */
export async function fetchTransitStopsNearRoute(points: LatLng[]): Promise<TransitStop[]> {
  if (points.length === 0) return [];
  const pad = 0.006; // ~600m in gradi lat/lng
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const s = Math.min(...lats) - pad, n = Math.max(...lats) + pad;
  const w = Math.min(...lngs) - pad, e = Math.max(...lngs) + pad;
  const query = `[out:json][timeout:8];
(
  node["highway"="bus_stop"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});
  node["railway"="tram_stop"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});
  node["railway"="subway_entrance"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});
  node["station"="subway"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});
  node["railway"="station"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});
);
out tags 300;`;

  for (const endpoint of ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: ctrl.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        return (json.elements ?? []).map((el: any): TransitStop | null => {
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          if (lat == null || lng == null) return null;
          const tags = el.tags ?? {};
          const type: TransitStop['type'] =
            tags.railway === 'subway_entrance' || tags.station === 'subway' ? 'metro'
            : tags.railway === 'tram_stop' ? 'tram'
            : tags.railway === 'station' ? 'train'
            : 'bus';
          return { id: `${el.type}_${el.id}`, name: tags.name ?? (type === 'metro' ? 'Metro' : type === 'tram' ? 'Tram' : type === 'train' ? 'Stazione' : 'Fermata'), type, lat, lng };
        }).filter(Boolean) as TransitStop[];
      } finally {
        clearTimeout(t);
      }
    } catch { /* prova prossimo endpoint */ }
  }
  return [];
}

// POI dentro un riquadro disegnato sulla mappa (selezione area).
export async function fetchPoisInArea(bounds: Bounds, cats: string[]): Promise<POI[]> {
  const { south, west, north, east } = bounds;
  const key = `bbox:${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)},${[...cats].sort().join(',')}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const query = buildBboxQuery(cats, south, west, north, east);
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const pois = dedupe(await fetchFrom(endpoint, query));
      cacheSet(key, pois);
      return pois;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Overpass non raggiungibile');
}

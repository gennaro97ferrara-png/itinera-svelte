import type { POI, WikiSummary } from '$lib/domain/types';

// Cache su disco per i riassunti/immagini: evita di richiamare le API a ogni visita.
const LS_PREFIX = 'itinera.wiki.';

function lsGet(key: string): WikiSummary | null | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw === null) return undefined;
    return JSON.parse(raw) as WikiSummary | null;
  } catch { return undefined; }
}
function lsSet(key: string, val: WikiSummary | null): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch { /* quota */ }
}

function cacheKey(p: POI): string | null {
  if (p.wiki) return 'wp:' + p.wiki;
  if (p.wikidata) return 'wd:' + p.wikidata;
  return null;
}

// Immagine da Wikidata (proprietà P18) → URL su Wikimedia Commons.
async function wikidataImage(id: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${id}&property=P18&format=json&origin=*`
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const file = j?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!file) return null;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=400`;
  } catch { return null; }
}

// Risolve riassunto + immagine dalle fonti disponibili (wiki → wikidata → image OSM).
async function resolve(p: POI): Promise<WikiSummary | null> {
  if (p.wiki) {
    try {
      const r = await fetch(
        `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.wiki)}`
      );
      if (r.ok) {
        const j: any = await r.json();
        const img = j.thumbnail?.source
          ?? p.image
          ?? (p.wikidata ? await wikidataImage(p.wikidata) : null);
        return {
          img:     img ?? null,
          extract: j.extract ?? null,
          url:     j.content_urls?.desktop?.page ?? null,
        };
      }
    } catch { /* passa alle altre fonti */ }
  }

  // niente Wikipedia: prova immagine diretta OSM o Wikidata
  const img = p.image ?? (p.wikidata ? await wikidataImage(p.wikidata) : null);
  return img ? { img, extract: null, url: null } : null;
}

export async function fetchSummary(p: POI): Promise<WikiSummary | null> {
  if (p._sum !== undefined) return p._sum ?? null;
  if (p._pend) return p._pend;

  // cache su disco
  const key = cacheKey(p);
  if (key) {
    const cached = lsGet(key);
    if (cached !== undefined) { p._sum = cached; return cached; }
  }

  // nessuna fonte testuale: usa solo l'eventuale immagine diretta OSM
  if (!p.wiki && !p.wikidata) {
    p._sum = p.image ? { img: p.image, extract: null, url: null } : null;
    return p._sum ?? null;
  }

  p._pend = resolve(p)
    .then(sum => {
      p._sum = sum;
      if (key) lsSet(key, sum);
      return sum;
    })
    .catch(() => { p._sum = null; return null; });

  return p._pend;
}

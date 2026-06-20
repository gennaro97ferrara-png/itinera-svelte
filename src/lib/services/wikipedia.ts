import type { POI, WikiSummary } from '$lib/domain/types';

export async function fetchSummary(p: POI): Promise<WikiSummary | null> {
  if (p._sum !== undefined) return p._sum ?? null;
  if (p._pend) return p._pend;
  if (!p.wiki) { p._sum = null; return null; }

  p._pend = fetch(
    `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.wiki)}`
  )
    .then(r => (r.ok ? r.json() : null))
    .then((j: any) => {
      p._sum = j
        ? {
            img:     j.thumbnail?.source     ?? null,
            extract: j.extract               ?? null,
            url:     j.content_urls?.desktop?.page ?? null
          }
        : null;
      return p._sum ?? null;
    })
    .catch(() => { p._sum = null; return null; });

  return p._pend;
}

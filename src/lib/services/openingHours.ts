// Parser pragmatico di OSM opening_hours.
// Copre i casi comuni; se non riesce a interpretare con certezza → 'unknown'.
// NON indovina mai: meglio "orari non disponibili" che un falso "aperto".

export type OpenState = 'open' | 'closed' | 'unknown';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; // getDay(): 0=Su..6=Sa

interface Interval { from: number; to: number; } // minuti dalla mezzanotte

function dayIndex(tok: string): number { return DAYS.indexOf(tok); }

function parseDayRange(spec: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = /^([A-Za-z]{2})(?:-([A-Za-z]{2}))?$/.exec(part.trim());
    if (!m) return null;
    const a = dayIndex(m[1]);
    if (a < 0) return null;
    if (!m[2]) { out.add(a); continue; }
    const b = dayIndex(m[2]);
    if (b < 0) return null;
    // intervallo ciclico Mo-Su, gestisce wrap (es. Sa-Mo)
    for (let i = 0; i < 7; i++) {
      const d = (a + i) % 7;
      out.add(d);
      if (d === b) break;
    }
  }
  return out;
}

function parseTimes(spec: string): Interval[] | null {
  const out: Interval[] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!m) return null;
    const from = +m[1] * 60 + +m[2];
    let to = +m[3] * 60 + +m[4];
    if (to === 0) to = 24 * 60;           // 24:00 / 00:00 a fine giornata
    out.push({ from, to });
  }
  return out;
}

/**
 * Stato di apertura a una data/ora. Ritorna 'unknown' se la stringa non è
 * interpretabile con sicurezza (regole con festività, "PH", "sunset", ecc.).
 */
export function openStateAt(spec: string | null | undefined, now = new Date()): OpenState {
  if (!spec) return 'unknown';
  const s = spec.trim();
  if (!s) return 'unknown';
  if (/24\s*\/\s*7/.test(s)) return 'open';

  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();

  let sawApplicableRule = false;
  let parsedSomething = false;

  for (const ruleRaw of s.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule) continue;

    // salta regole basate su festività o eventi non calcolabili
    if (/\b(PH|SH|sunset|sunrise|dawn|dusk)\b/i.test(rule)) { continue; }

    // "Mo-Fr 09:00-18:00" oppure solo "09:00-18:00" (tutti i giorni)
    const m = /^([A-Za-z,\- ]+?)?\s*(\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\s*\d{1,2}:\d{2}-\d{1,2}:\d{2})*|off|closed)$/.exec(rule);
    if (!m) { return 'unknown'; }        // formato non riconosciuto → non rischiare

    const dayPart = (m[1] ?? '').trim();
    const timePart = m[2].trim();

    let days: Set<number>;
    if (!dayPart) { days = new Set([0, 1, 2, 3, 4, 5, 6]); }
    else {
      const d = parseDayRange(dayPart);
      if (!d) return 'unknown';
      days = d;
    }
    parsedSomething = true;

    if (!days.has(day)) continue;        // regola non applicabile a oggi
    sawApplicableRule = true;

    if (/^(off|closed)$/i.test(timePart)) return 'closed';

    const intervals = parseTimes(timePart);
    if (!intervals) return 'unknown';
    for (const iv of intervals) {
      if (mins >= iv.from && mins < iv.to) return 'open';
    }
  }

  if (!parsedSomething) return 'unknown';
  // c'erano regole valide ma nessuna copre adesso → chiuso
  return sawApplicableRule ? 'closed' : 'closed';
}

export function openLabel(state: OpenState): { text: string; cls: string; icon: string } {
  switch (state) {
    case 'open':   return { text: 'Aperto ora', cls: 'oh-open',    icon: 'ti-door-enter' };
    case 'closed': return { text: 'Chiuso ora', cls: 'oh-closed',  icon: 'ti-door-off' };
    default:       return { text: 'Orari non disponibili', cls: 'oh-unknown', icon: 'ti-clock-question' };
  }
}

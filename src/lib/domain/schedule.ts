import type { Stop } from './types';
import { countedVisit } from './algorithm';

/** Orario calcolato per una singola tappa dell'itinerario. */
export interface ScheduledStop {
  arrival: number;    // ms epoch — orario di arrivo
  departure: number;  // ms epoch — orario di ripartenza
  visitMin: number;   // minuti di sosta conteggiati (0 per i passaggi)
  legMin: number;     // minuti di spostamento in ingresso a questa tappa
  waitMin: number;    // minuti di attesa per rispettare un orario fisso
  conflict: boolean;  // true se un orario fisso non è rispettabile (arrivo in ritardo)
}

export interface ScheduleOptions {
  /** Tempo cuscinetto (min) aggiunto dopo ogni spostamento: margine per transfer/imprevisti. */
  bufferMin?: number;
}

/** Applica una stringa 'HH:mm' alla stessa data di `baseMs` → ms epoch, o null se invalida. */
export function fixedTimeMs(baseMs: number, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  const d = new Date(baseMs);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

/**
 * Calcola il programma orario di un itinerario a partire da un orario di partenza.
 * Rispetta gli orari fissi (`stop.fixedTime`): se l'arrivo naturale è in anticipo
 * si attende, se è in ritardo si segnala un conflitto. Aggiunge un buffer opzionale
 * dopo ogni spostamento. Funzione pura: usata sia dalla UI live sia dall'export PDF.
 */
export function computeSchedule(
  stops: Stop[],
  departureMs: number,
  opts: ScheduleOptions = {}
): ScheduledStop[] {
  const buffer = Math.max(0, opts.bufferMin ?? 0) * 60_000;
  let cursor = departureMs;
  const out: ScheduledStop[] = [];

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const legMin = i === 0 ? 0 : (s.walkMin ?? 0);
    cursor += legMin * 60_000;
    if (i > 0 && legMin > 0) cursor += buffer;

    let arrival = cursor;
    let waitMin = 0;
    let conflict = false;

    if (s.fixedTime) {
      const fixed = fixedTimeMs(departureMs, s.fixedTime);
      if (fixed != null) {
        if (fixed >= arrival) { waitMin = Math.round((fixed - arrival) / 60_000); arrival = fixed; }
        else { conflict = true; }
      }
    }

    const visitMin = countedVisit(s);
    cursor = arrival + visitMin * 60_000;
    out.push({ arrival, departure: cursor, visitMin, legMin, waitMin, conflict });
  }

  return out;
}

/** Durata totale del programma (min) dall'arrivo alla partenza dall'ultima tappa. */
export function scheduleTotalMin(sched: ScheduledStop[]): number {
  if (sched.length < 1) return 0;
  return Math.round((sched[sched.length - 1].departure - sched[0].arrival) / 60_000);
}

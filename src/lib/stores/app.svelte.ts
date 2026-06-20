import type { Screen, Stop, POI, LatLng } from '$lib/domain/types';

class AppStore {
  // navigation — si parte dal risultato (auto-generato al boot), non dal form
  screen = $state<Screen>('route');

  // time budget
  minutes = $state(210);

  // categories (array, toggled via helpers)
  cats = $state<string[]>(['musei', 'monumenti', 'storico', 'arte', 'chiese']);

  // trip options
  roundTrip = $state(true);
  startId   = $state('');
  endId     = $state('');
  loop      = $state(true);

  // geolocation
  user = $state<LatLng | null>(null);
  demo = $state(false);

  // generated itinerary
  stops = $state<Stop[]>([]);

  // selected POI for detail screen
  selectedPoi = $state<POI | null>(null);

  // focused stop index (map ↔ list link); -1 = none
  focusIdx = $state(-1);

  // in-app walking navigation: index of the current target stop
  navIdx = $state(0);

  // toast
  toastMsg     = $state('');
  toastVisible = $state(false);

  // --- category helpers ---
  hasCat(id: string)    { return this.cats.includes(id); }
  addCat(id: string)    { if (!this.cats.includes(id)) this.cats = [...this.cats, id]; }
  removeCat(id: string) { this.cats = this.cats.filter(c => c !== id); }
  toggleCat(id: string) { this.hasCat(id) ? this.removeCat(id) : this.addCat(id); }

  toggleMacro(macroId: string, subIds: string[]) {
    if (macroId === 'scoperte') { this.toggleCat('scoperte'); return; }
    const allOn = subIds.every(s => this.hasCat(s));
    if (allOn) {
      this.cats = this.cats.filter(c => !subIds.includes(c));
    } else {
      const toAdd = subIds.filter(s => !this.hasCat(s));
      this.cats = [...this.cats, ...toAdd];
    }
  }

  macroActive(macroId: string, subIds: string[]) {
    if (macroId === 'scoperte') return this.hasCat('scoperte');
    return subIds.some(s => this.hasCat(s));
  }

  // --- stops helpers ---
  moveStop(i: number, dir: -1 | 1) {
    const j = i + dir;
    const s = this.stops;
    if (!s[j] || s[j].kind !== 'stop' || s[i].kind !== 'stop') return;
    const next = [...s];
    [next[i], next[j]] = [next[j], next[i]];
    this.stops = next;
  }

  removeStop(i: number) {
    if (this.stops[i].kind !== 'stop') return;
    this.stops = this.stops.filter((_, idx) => idx !== i);
  }

  toggleMode(i: number) {
    const s = this.stops[i];
    if (!s || s.kind !== 'stop') return;
    const next = [...this.stops];
    next[i] = { ...s, mode: s.mode === 'visit' ? 'pass' : 'visit' };
    this.stops = next;
  }

  get intermediateCount() {
    return this.stops.filter(s => s.kind === 'stop').length;
  }
}

export const app = new AppStore();

let toastTimer = 0;
export function showToast(msg: string) {
  app.toastMsg     = msg;
  app.toastVisible = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { app.toastVisible = false; }, 2600) as unknown as number;
}

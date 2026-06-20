import { browser } from '$app/environment';
import type { Trip, TripDay } from '$lib/domain/trips';

const KEY = 'itinera.trips.v1';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

class TripsStore {
  trips = $state<Trip[]>([]);
  private loaded = false;

  // Caricamento da localStorage: chiamato in onMount (lato client),
  // mai durante il prerender SSR di adapter-static.
  load() {
    if (!browser || this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.trips = JSON.parse(raw) as Trip[];
    } catch { /* dati corrotti: si riparte vuoti */ }
  }

  private save() {
    if (!browser) return;
    try { localStorage.setItem(KEY, JSON.stringify(this.trips)); } catch { /* quota piena */ }
  }

  get(id: string | null): Trip | null {
    return id ? (this.trips.find(t => t.id === id) ?? null) : null;
  }

  createTrip(name: string): Trip {
    const trip: Trip = { id: uid(), name: name.trim() || 'Nuovo viaggio', days: [], createdAt: Date.now() };
    this.trips = [trip, ...this.trips];
    this.save();
    return trip;
  }

  renameTrip(id: string, name: string) {
    this.trips = this.trips.map(t => t.id === id ? { ...t, name: name.trim() || t.name } : t);
    this.save();
  }

  deleteTrip(id: string) {
    this.trips = this.trips.filter(t => t.id !== id);
    this.save();
  }

  addDay(tripId: string, day: Omit<TripDay, 'id' | 'createdAt'>): TripDay | null {
    const trip = this.get(tripId);
    if (!trip) return null;
    const full: TripDay = { ...day, id: uid(), createdAt: Date.now() };
    this.trips = this.trips.map(t => t.id === tripId ? { ...t, days: [...t.days, full] } : t);
    this.save();
    return full;
  }

  removeDay(tripId: string, dayId: string) {
    this.trips = this.trips.map(t =>
      t.id === tripId ? { ...t, days: t.days.filter(d => d.id !== dayId) } : t);
    this.save();
  }

  updateDay(tripId: string, dayId: string, data: Omit<TripDay, 'id' | 'createdAt'>) {
    this.trips = this.trips.map(t =>
      t.id === tripId
        ? { ...t, days: t.days.map(d => d.id === dayId ? { ...d, ...data } : d) }
        : t
    );
    this.save();
  }

  setDayDate(tripId: string, dayId: string, date: string) {
    this.trips = this.trips.map(t =>
      t.id === tripId
        ? { ...t, days: t.days.map(d => d.id === dayId ? { ...d, date: date || undefined } : d) }
        : t
    );
    this.save();
  }

  renameDay(tripId: string, dayId: string, label: string) {
    this.trips = this.trips.map(t =>
      t.id === tripId
        ? { ...t, days: t.days.map(d => d.id === dayId ? { ...d, label: label.trim() || d.label } : d) }
        : t);
    this.save();
  }

  moveDay(tripId: string, index: number, dir: -1 | 1) {
    const trip = this.get(tripId);
    if (!trip) return;
    const j = index + dir;
    if (j < 0 || j >= trip.days.length) return;
    const days = [...trip.days];
    [days[index], days[j]] = [days[j], days[index]];
    this.trips = this.trips.map(t => t.id === tripId ? { ...t, days } : t);
    this.save();
  }
}

export const trips = new TripsStore();

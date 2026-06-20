import type { Stop, TravelMode } from './types';

/** Un giorno salvato: lo snapshot di un itinerario con le sue impostazioni. */
export interface TripDay {
  id: string;
  label: string;          // es. "Giorno 1" o "Centro storico"
  stops: Stop[];
  minutes: number;
  mode: TravelMode;
  cats: string[];
  createdAt: number;
}

/** Un viaggio: un insieme ordinato di giorni (es. "Vacanza Roma"). */
export interface Trip {
  id: string;
  name: string;
  days: TripDay[];
  createdAt: number;
}

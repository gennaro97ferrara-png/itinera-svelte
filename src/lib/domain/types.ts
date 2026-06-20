export interface POI {
  id: string;
  name: string;
  macro: string;
  sub: string[];
  lat: number;
  lng: number;
  visit?: number;
  wiki?: string | null;
  wikidata?: string;        // Q-id da OSM → immagine via Wikidata P18
  image?: string;           // URL immagine diretto dal tag OSM `image`
  story: string;
  gem?: boolean;
  storyAiGenerated?: boolean;
  storySource?: string;
  ticketUrl?: string;
  bookingUrl?: string;
  openingHours?: string;
  address?: string;
  score?: number;
  _sum?: WikiSummary | null;
  _pend?: Promise<WikiSummary | null>;
}

export interface WikiSummary {
  img: string | null;
  extract: string | null;
  url: string | null;
}

export interface Stop {
  kind: 'start' | 'stop' | 'end';
  name: string;
  lat: number;
  lng: number;
  poi: POI | null;
  visit: number;
  mode: 'visit' | 'pass';
  gem: boolean;
  walkMin?: number;
  fixedTime?: string;   // orario fisso 'HH:mm' (es. prenotazione, apertura) — vincola il programma
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Punto di partenza/arrivo scelto liberamente (mappa, posizione, tappa). */
export interface NamedPoint {
  lat: number;
  lng: number;
  name: string;
}

/** Riquadro geografico (per la selezione di un'area sulla mappa). */
export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type TravelMode = 'walk' | 'bike' | 'car' | 'transit';

export type Screen = 'home' | 'route' | 'detail' | 'nav' | 'trips' | 'trip' | 'calendar' | 'settings';

export interface MacroCategory {
  id: string;
  label: string;
  icon: string;
  gem?: boolean;
  subs: SubCategory[];
}

export interface SubCategory {
  id: string;
  label: string;
  icon: string;
}

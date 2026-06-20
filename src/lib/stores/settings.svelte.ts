import { browser } from '$app/environment';

/** Profilo agenzia: usato per intestare e firmare i PDF degli itinerari. */
export interface AgencyProfile {
  name: string;
  logo: string;     // data URL (upload) o URL immagine
  phone: string;
  email: string;
  website: string;
  note: string;     // disclaimer / nota a piè di pagina
}

const KEY = 'itinera.settings.v1';

const EMPTY_AGENCY: AgencyProfile = {
  name: '', logo: '', phone: '', email: '', website: '', note: '',
};

class SettingsStore {
  agency = $state<AgencyProfile>({ ...EMPTY_AGENCY });
  bufferMin = $state(0);   // tempo cuscinetto tra le tappe (min)
  private loaded = false;

  load() {
    if (!browser || this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.agency) this.agency = { ...EMPTY_AGENCY, ...data.agency };
      if (typeof data.bufferMin === 'number') this.bufferMin = data.bufferMin;
    } catch { /* dati corrotti: si riparte coi default */ }
  }

  save() {
    if (!browser) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ agency: this.agency, bufferMin: this.bufferMin }));
    } catch { /* quota piena */ }
  }

  /** true se è stato configurato almeno un dato dell'agenzia (per branding PDF). */
  hasAgency(): boolean {
    const a = this.agency;
    return !!(a.name || a.email || a.phone || a.website || a.logo);
  }
}

export const settings = new SettingsStore();

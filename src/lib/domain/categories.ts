import type { MacroCategory, SubCategory } from './types';

export const MACROS: MacroCategory[] = [
  { id: 'cultura', label: 'Cultura', icon: 'ti-building-bank', subs: [
    { id: 'musei',      label: 'Musei',      icon: 'ti-building-bank' },
    { id: 'monumenti',  label: 'Monumenti',  icon: 'ti-building-monument' },
    { id: 'chiese',     label: 'Chiese',     icon: 'ti-building-church' },
    { id: 'arte',       label: 'Arte',       icon: 'ti-palette' },
    { id: 'teatri',     label: 'Teatri',     icon: 'ti-masks-theater' },
    { id: 'storico',    label: 'Siti storici', icon: 'ti-building-castle' }
  ]},
  { id: 'cibo', label: 'Cibo', icon: 'ti-tools-kitchen-2', subs: [
    { id: 'ristoranti', label: 'Ristoranti', icon: 'ti-tools-kitchen-2' },
    { id: 'pizza',      label: 'Pizza',      icon: 'ti-pizza' },
    { id: 'panini',     label: 'Panini',     icon: 'ti-bread' },
    { id: 'gelati',     label: 'Gelati',     icon: 'ti-ice-cream' },
    { id: 'street',     label: 'Street food',icon: 'ti-meat' },
    { id: 'caffe',      label: 'Caffè',      icon: 'ti-coffee' }
  ]},
  { id: 'luoghi', label: 'Luoghi', icon: 'ti-photo', subs: [
    { id: 'piazze',   label: 'Piazze',   icon: 'ti-map-pin' },
    { id: 'parchi',   label: 'Parchi',   icon: 'ti-tree' },
    { id: 'panorami', label: 'Panorami', icon: 'ti-mountain' },
    { id: 'mercati',  label: 'Mercati',  icon: 'ti-basket' },
    { id: 'spiagge',  label: 'Spiagge',  icon: 'ti-beach' }
  ]},
  { id: 'notturna', label: 'Vita notturna', icon: 'ti-moon-stars', subs: [
    { id: 'bar',        label: 'Bar',         icon: 'ti-glass' },
    { id: 'pub',        label: 'Pub',         icon: 'ti-beer' },
    { id: 'cocktail',   label: 'Cocktail',    icon: 'ti-glass-cocktail' },
    { id: 'discoteche', label: 'Discoteche',  icon: 'ti-disc' },
    { id: 'livemusic',  label: 'Musica live', icon: 'ti-music' }
  ]},
  { id: 'servizi', label: 'Servizi', icon: 'ti-toilet-paper', subs: [
    { id: 'toilets',  label: 'Bagni pubblici',  icon: 'ti-toilet-paper' },
    { id: 'acqua',    label: 'Acqua potabile',  icon: 'ti-droplet' },
    { id: 'farmacie', label: 'Farmacie',        icon: 'ti-first-aid-kit' },
    { id: 'bancomat', label: 'Bancomat',        icon: 'ti-cash' }
  ]},
  { id: 'scoperte', label: 'Scoperte', icon: 'ti-compass', gem: true, subs: [] }
];

export const SUBS: Record<string, SubCategory & { macro: string }> = {};
MACROS.forEach(m => m.subs.forEach(s => { SUBS[s.id] = { ...s, macro: m.id }; }));

export const VISIT_DEFAULTS: Record<string, number> = {
  musei: 120, monumenti: 60, storico: 45, arte: 15, chiese: 20, teatri: 15,
  ristoranti: 60, pizza: 20, panini: 15, gelati: 10, street: 15, caffe: 10,
  piazze: 15, parchi: 30, panorami: 15, mercati: 25, spiagge: 40,
  bar: 30, pub: 45, cocktail: 40, discoteche: 90, livemusic: 60,
  toilets: 0, acqua: 0, farmacie: 0, bancomat: 0
};

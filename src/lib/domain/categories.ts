import type { MacroCategory, SubCategory } from './types';

export const MACROS: MacroCategory[] = [
  { id: 'cultura', label: 'Cultura', icon: 'ti-building-bank', subs: [
    { id: 'musei',       label: 'Musei',               icon: 'ti-building-bank' },
    { id: 'gallerie',    label: 'Gallerie d\'arte',    icon: 'ti-photo' },
    { id: 'monumenti',   label: 'Monumenti',           icon: 'ti-building-monument' },
    { id: 'rovine',      label: 'Castelli & Rovine',   icon: 'ti-building-castle' },
    { id: 'chiese',      label: 'Chiese & Luoghi sacri', icon: 'ti-building-church' },
    { id: 'arte',        label: 'Arte urbana',         icon: 'ti-palette' },
    { id: 'teatri',      label: 'Teatri & Opera',      icon: 'ti-masks-theater' },
    { id: 'cinema',      label: 'Cinema',              icon: 'ti-device-tv' },
    { id: 'biblioteche', label: 'Biblioteche',         icon: 'ti-books' },
    { id: 'storico',     label: 'Siti storici',        icon: 'ti-clock-hour-5' },
  ]},
  { id: 'natura', label: 'Natura & Outdoor', icon: 'ti-tree', subs: [
    { id: 'parchi',   label: 'Parchi & Giardini',  icon: 'ti-tree' },
    { id: 'panorami', label: 'Panorami',            icon: 'ti-mountain' },
    { id: 'piazze',   label: 'Piazze',              icon: 'ti-map-pin' },
    { id: 'fontane',  label: 'Fontane',             icon: 'ti-droplet-filled' },
    { id: 'spiagge',  label: 'Spiagge & Laghi',    icon: 'ti-beach' },
    { id: 'riserve',  label: 'Riserve naturali',    icon: 'ti-leaf' },
  ]},
  { id: 'cibo', label: 'Cibo & Drink', icon: 'ti-tools-kitchen-2', subs: [
    { id: 'ristoranti',  label: 'Ristoranti',          icon: 'ti-tools-kitchen-2' },
    { id: 'trattorie',   label: 'Trattorie & Osterie', icon: 'ti-salad' },
    { id: 'pizza',       label: 'Pizzerie',            icon: 'ti-pizza' },
    { id: 'caffe',       label: 'Caffè',               icon: 'ti-coffee' },
    { id: 'pasticcerie', label: 'Pasticcerie',         icon: 'ti-bread' },
    { id: 'gelati',      label: 'Gelaterie',           icon: 'ti-ice-cream' },
    { id: 'street',      label: 'Street food',        icon: 'ti-meat' },
    { id: 'panini',      label: 'Panini & Sandwich',  icon: 'ti-sandwich' },
    { id: 'enoteca',     label: 'Enoteche & Vino',    icon: 'ti-bottle' },
    { id: 'mercati',     label: 'Mercati alimentari', icon: 'ti-basket' },
  ]},
  { id: 'shopping', label: 'Shopping', icon: 'ti-shopping-bag', subs: [
    { id: 'antiquariato', label: 'Antiquariato',    icon: 'ti-clock-hour-5' },
    { id: 'librerie',     label: 'Librerie',         icon: 'ti-book-2' },
    { id: 'artigianato',  label: 'Artigianato',      icon: 'ti-scissors' },
    { id: 'souvenir',     label: 'Souvenir',         icon: 'ti-gift' },
    { id: 'moda',         label: 'Boutique & Moda',  icon: 'ti-hanger' },
  ]},
  { id: 'benessere', label: 'Sport & Benessere', icon: 'ti-heart-rate-monitor', subs: [
    { id: 'spa',          label: 'Terme & Spa',       icon: 'ti-waves' },
    { id: 'sport',        label: 'Sport & Stadi',     icon: 'ti-trophy' },
    { id: 'zoo',          label: 'Zoo & Acquari',     icon: 'ti-paw-print' },
    { id: 'parchi_gioco', label: 'Parchi giochi',     icon: 'ti-confetti' },
  ]},
  { id: 'notturna', label: 'Vita notturna', icon: 'ti-moon-stars', subs: [
    { id: 'bar',        label: 'Bar',          icon: 'ti-glass' },
    { id: 'pub',        label: 'Pub',          icon: 'ti-beer' },
    { id: 'cocktail',   label: 'Cocktail bar', icon: 'ti-glass-cocktail' },
    { id: 'rooftop',    label: 'Rooftop bar',  icon: 'ti-building-skyscraper' },
    { id: 'discoteche', label: 'Discoteche',   icon: 'ti-disc' },
    { id: 'livemusic',  label: 'Musica live',  icon: 'ti-music' },
  ]},
  { id: 'servizi', label: 'Servizi', icon: 'ti-toilet-paper', subs: [
    { id: 'toilets',  label: 'Bagni pubblici',      icon: 'ti-toilet-paper' },
    { id: 'acqua',    label: 'Acqua potabile',       icon: 'ti-droplet' },
    { id: 'farmacie', label: 'Farmacie',             icon: 'ti-first-aid-kit' },
    { id: 'bancomat', label: 'Bancomat',             icon: 'ti-cash' },
    { id: 'ospedali', label: 'Ospedali & PS',        icon: 'ti-stethoscope' },
  ]},
  { id: 'scoperte', label: 'Scoperte', icon: 'ti-compass', gem: true, subs: [] }
];

export const SUBS: Record<string, SubCategory & { macro: string }> = {};
MACROS.forEach(m => m.subs.forEach(s => { SUBS[s.id] = { ...s, macro: m.id }; }));

export const VISIT_DEFAULTS: Record<string, number> = {
  // Cultura
  musei: 90, gallerie: 45, monumenti: 15, rovine: 30, chiese: 20, arte: 8,
  teatri: 15, cinema: 100, biblioteche: 20, storico: 10,
  // Natura
  parchi: 30, panorami: 10, piazze: 10, fontane: 5, spiagge: 60, riserve: 45,
  // Cibo
  ristoranti: 60, trattorie: 75, pizza: 30, caffe: 15, pasticcerie: 15,
  gelati: 10, street: 15, panini: 15, enoteca: 40, mercati: 25,
  // Shopping
  antiquariato: 30, librerie: 20, artigianato: 20, souvenir: 10, moda: 25,
  // Benessere
  spa: 120, sport: 20, zoo: 90, parchi_gioco: 45,
  // Notturna
  bar: 30, pub: 45, cocktail: 40, rooftop: 50, discoteche: 90, livemusic: 60,
  // Servizi
  toilets: 0, acqua: 0, farmacie: 0, bancomat: 0, ospedali: 0,
};

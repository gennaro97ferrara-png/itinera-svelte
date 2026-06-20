import type { POI } from '$lib/domain/types';

export const POIS: POI[] = [
  // --- Cultura ---
  { id: 'colosseo', name: 'Colosseo', macro: 'cultura', sub: ['monumenti', 'storico'],
    lat: 41.8902, lng: 12.4922, visit: 50, wiki: 'Colosseo',
    ticketUrl: 'https://parcocolosseo.it/',
    story: "L'anfiteatro più grande mai costruito dai romani, inaugurato nell'80 d.C." },

  { id: 'foro', name: 'Foro Romano', macro: 'cultura', sub: ['storico', 'monumenti'],
    lat: 41.8925, lng: 12.4853, visit: 40, wiki: 'Foro Romano',
    ticketUrl: 'https://parcocolosseo.it/',
    story: 'Il cuore politico e religioso dell\'antica Roma.' },

  { id: 'pantheon', name: 'Pantheon', macro: 'cultura', sub: ['monumenti', 'storico'],
    lat: 41.8986, lng: 12.4769, visit: 25, wiki: 'Pantheon (Roma)',
    story: 'Tempio di tutti gli dèi, con la più grande cupola in calcestruzzo non armato al mondo.' },

  { id: 'trevi', name: 'Fontana di Trevi', macro: 'cultura', sub: ['arte'],
    lat: 41.9009, lng: 12.4833, visit: 15, wiki: 'Fontana di Trevi',
    story: 'La più celebre fontana barocca di Roma.' },

  { id: 'borghese', name: 'Galleria Borghese', macro: 'cultura', sub: ['musei'],
    lat: 41.9142, lng: 12.4920, wiki: 'Galleria Borghese',
    ticketUrl: 'https://galleriaborghese.beniculturali.it/',
    story: 'Capolavori di Bernini e Caravaggio nella villa del cardinale Scipione.' },

  { id: 'castel', name: 'Castel Sant\'Angelo', macro: 'cultura', sub: ['monumenti', 'musei', 'storico'],
    lat: 41.9031, lng: 12.4663, visit: 45, wiki: 'Castel Sant\'Angelo',
    story: 'Mausoleo di Adriano diventato fortezza, prigione e residenza papale.' },

  // --- Luoghi ---
  { id: 'navona', name: 'Piazza Navona', macro: 'luoghi', sub: ['piazze'],
    lat: 41.8992, lng: 12.4731, visit: 15, wiki: 'Piazza Navona',
    story: 'Piazza barocca sull\'antico stadio di Domiziano, con la fontana dei Quattro Fiumi.' },

  { id: 'spagna', name: 'Piazza di Spagna', macro: 'luoghi', sub: ['piazze'],
    lat: 41.9058, lng: 12.4823, visit: 15, wiki: 'Piazza di Spagna',
    story: 'La celebre scalinata di Trinità dei Monti, salotto di Roma.' },

  { id: 'villaborghese', name: 'Villa Borghese', macro: 'luoghi', sub: ['parchi'],
    lat: 41.9120, lng: 12.4853, visit: 45, wiki: 'Villa Borghese',
    story: 'Il grande parco di Roma, perfetto per una sosta tra una visita e l\'altra.' },

  { id: 'aranci', name: 'Giardino degli Aranci', macro: 'luoghi', sub: ['panorami', 'parchi'],
    lat: 41.8843, lng: 12.4797, visit: 20, wiki: 'Giardino degli Aranci',
    story: 'Belvedere sull\'Aventino con vista su Roma e San Pietro — splendido al tramonto.' },

  // --- Cibo ---
  { id: 'roscioli', name: 'Salumeria Roscioli', macro: 'cibo', sub: ['ristoranti'],
    lat: 41.8946, lng: 12.4744, visit: 75,
    bookingUrl: 'https://www.salumeriaroscioli.com/',
    story: 'Salumeria e ristorante celebre per cacio e pepe e materie prime ricercate.' },

  { id: 'pizzarium', name: 'Pizzarium Bonci', macro: 'cibo', sub: ['pizza', 'street'],
    lat: 41.9070, lng: 12.4470,
    story: 'La pizza al taglio d\'autore di Gabriele Bonci, vicino ai Musei Vaticani.' },

  { id: 'supplizio', name: 'Supplizio', macro: 'cibo', sub: ['street'],
    lat: 41.8975, lng: 12.4717, visit: 20,
    story: 'Tempio del supplì romano, street food fatto a regola d\'arte.' },

  { id: 'santeustachio', name: 'Sant\'Eustachio Il Caffè', macro: 'cibo', sub: ['caffe'],
    lat: 41.8979, lng: 12.4759, visit: 20,
    story: 'Storico caffè dal 1938, famoso per il suo espresso cremoso.' },

  // --- Trasporti ---
  { id: 'termini', name: 'Roma Termini', macro: 'trasporti', sub: ['stazioni'],
    lat: 41.9010, lng: 12.5013, visit: 0, wiki: 'Stazione di Roma Termini',
    story: 'La principale stazione ferroviaria di Roma.' },

  { id: 'fiumicino', name: 'Aeroporto di Fiumicino', macro: 'trasporti', sub: ['aeroporti'],
    lat: 41.8003, lng: 12.2389, visit: 0, wiki: 'Aeroporto di Roma-Fiumicino',
    story: 'Il principale aeroporto di Roma, Leonardo da Vinci.' },

  // --- Scoperte (gem) ---
  { id: 'facchino', name: 'Fontana del Facchino', macro: 'cultura', sub: ['arte'], gem: true,
    lat: 41.8983, lng: 12.4760, visit: 5, wiki: 'Fontana del Facchino',
    storyAiGenerated: true,
    story: "Una delle cinque 'statue parlanti' di Roma, scolpita nel Cinquecento sul muro di Palazzo Orsini. Il facchino versa acqua da una botte: è l'unica statua parlante ancora in servizio come fontana pubblica." },

  { id: 'miranda', name: 'San Lorenzo in Miranda', macro: 'cultura', sub: ['chiese', 'storico'], gem: true,
    lat: 41.8924, lng: 12.4869, visit: 8, wiki: 'Chiesa di San Lorenzo in Miranda',
    storyAiGenerated: true,
    story: "Una chiesa costruita dentro un tempio romano del 141 d.C.: in facciata vedi ancora le colonne antiche. È una sovrapposizione perfetta di due epoche — il paganesimo sotto i piedi della cristianità." },

  { id: 'clemente', name: 'Basilica di San Clemente', macro: 'cultura', sub: ['chiese', 'storico'], gem: true,
    lat: 41.8894, lng: 12.4975, visit: 25, wiki: 'Basilica di San Clemente al Laterano',
    storyAiGenerated: true,
    story: "Tre livelli di storia in un'unica chiesa. Il primo livello è una basilica del XII secolo, il secondo contiene una chiesa paleocristiana del V secolo, il terzo è un tempio di Mitra del II secolo. Puoi scendere e toccare 2000 anni di Roma." },

  { id: 'tartarughe', name: 'Fontana delle Tartarughe', macro: 'cultura', sub: ['arte'], gem: true,
    lat: 41.8932, lng: 12.4776, visit: 6, wiki: 'Fontana delle Tartarughe',
    storyAiGenerated: true,
    story: "Capolavoro tardo-rinascimentale nascosto in una piazzetta del ghetto romano. Le quattro tartarughe di bronzo che sporgono dalla vasca furono aggiunte da Gian Lorenzo Bernini, probabilmente nel 1658. Nessuno sa perché." },

  { id: 'biscione', name: 'Passetto del Biscione', macro: 'cultura', sub: ['storico'], gem: true,
    lat: 41.8956, lng: 12.4719, visit: 5,
    storyAiGenerated: true,
    story: "Un vicolo coperto medievale con un'edicola sacra del Seicento incassata nella muratura. Per secoli è stata meta di devozione popolare, soprattutto per chi cercava guarigione." }
];

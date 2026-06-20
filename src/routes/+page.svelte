<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount }  from 'svelte';
  import { fly }        from 'svelte/transition';

  import Map        from '$lib/components/Map.svelte';
  import { app, showToast } from '$lib/stores/app.svelte';
  import { trips }          from '$lib/stores/trips.svelte';
  import { MACROS }         from '$lib/domain/categories';
  import { POIS }           from '$lib/data/pois';
  import { generate, fmt, countedVisit, effVisit, catLabel, isGem, haversine, travelMin, SPEED_MPM, bearing, ROME } from '$lib/domain/algorithm';
  import { fetchSummary }   from '$lib/services/wikipedia';
  import { fetchPois, fetchPoisInArea } from '$lib/services/overpass';
  import { openStateAt, openLabel } from '$lib/services/openingHours';
  import type { POI, Stop, Bounds, TravelMode } from '$lib/domain/types';
  import type { TripDay } from '$lib/domain/trips';

  let mapComp: Map;
  let locLabel  = $state('individuo la tua posizione…');
  let showFar   = $state(false);
  let loading   = $state(true);                  // overlay visibile dal primo paint
  let now       = $state(new Date());   // per il badge "aperto/chiuso", aggiornato ogni minuto
  let booted    = false;                          // auto-genera l'itinerario una sola volta al boot
  let watchId: number | null = null;

  // frasi a rotazione durante il caricamento
  const LOAD_TIPS = [
    'Esploro le strade intorno a te…',
    'Scelgo i posti che valgono una sosta…',
    'Calcolo i tempi a piedi, tappa per tappa…',
    'Cerco anche qualche luogo poco conosciuto…',
    'Compongo il giro perfetto per il tuo tempo…',
    'Ordino le tappe per camminare di meno…',
  ];
  let tipIdx = $state(0);
  $effect(() => {
    if (!loading) return;
    const id = setInterval(() => { tipIdx = (tipIdx + 1) % LOAD_TIPS.length; }, 1800);
    return () => clearInterval(id);
  });

  // ── Geolocalizzazione ──────────────────────────────────────
  function locate() {
    if (!browser || !navigator.geolocation) {
      locLabel = 'posizione non disponibile · uso Roma';
      app.user = ROME;
      autoGenerateOnce();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        locLabel = `posizione attuale · ±${Math.round(pos.coords.accuracy)} m`;
        app.user = c;
        showFar = haversine(c, ROME) > 100_000;
        autoGenerateOnce();
        watchId = navigator.geolocation.watchPosition(
          p => { if (!app.demo) app.user = { lat: p.coords.latitude, lng: p.coords.longitude }; },
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000 }
        );
      },
      () => {
        locLabel = 'posizione negata · uso Roma';
        app.user = ROME;
        autoGenerateOnce();
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // Show first: appena ho la posizione genero subito un itinerario sui default.
  function autoGenerateOnce() {
    if (booted) return;
    booted = true;
    onGenerate();
  }

  function setDemo() {
    app.demo = true;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    locLabel = 'demo · Roma centro';
    app.user = ROME;
    mapComp?.moveTo(ROME.lat, ROME.lng, 14);
    showFar = false;
    showToast('Posizione demo impostata su Roma');
  }

  // ── Genera itinerario ──────────────────────────────────────
  // raggio di ricerca scalato per il mezzo: in bici/auto si copre molta più distanza
  function searchRadius(): number {
    const factor = SPEED_MPM[app.mode] / SPEED_MPM.walk;   // walk=1, bike~3, car~6, transit~3.75
    return Math.min(12000, Math.max(800, Math.round(app.minutes * 6 * factor)));
  }

  async function onGenerate() {
    if (app.cats.length === 0) { loading = false; showToast('Scegli almeno una categoria'); return; }

    const center = app.startPoint ?? app.user ?? ROME;
    const radius = searchRadius();

    let allPois = POIS;
    loading = true;

    try {
      const livePois = await fetchPois(center.lat, center.lng, radius, app.cats);
      if (livePois.length > 0) {
        allPois = livePois;
      } else {
        showToast('Nessun luogo trovato in zona · uso i dati demo');
      }
    } catch {
      showToast('Dati live non disponibili · uso i dati demo');
    } finally {
      loading = false;
    }

    buildItinerary(allPois);
  }

  // selezione area: scarica i POI dentro il riquadro e genera, centrando lì
  async function onGenerateArea(bounds: Bounds) {
    if (app.cats.length === 0) { showToast('Scegli almeno una categoria'); return; }
    const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
    app.startPoint = { ...center, name: 'Centro area' };
    app.endPoint   = null;
    loading = true;
    let allPois = POIS;
    try {
      const livePois = await fetchPoisInArea(bounds, app.cats);
      if (livePois.length > 0) allPois = livePois;
      else showToast('Nessun luogo nell’area · uso i dati demo');
    } catch {
      showToast('Dati live non disponibili · uso i dati demo');
    } finally {
      loading = false;
    }
    buildItinerary(allPois);
  }

  function buildItinerary(allPois: POI[]) {
    const stops = generate({
      minutes: app.minutes,
      cats:    app.cats,
      roundTrip: app.roundTrip,
      startPoint: app.startPoint,
      endPoint:   app.endPoint,
      user:      app.user,
      allPois,
      mode:      app.mode
    });
    if (!stops.length) { showToast('Nessun luogo trovato: aumenta il tempo o cambia le categorie'); return; }
    app.stops = stops;
    app.loop  = app.roundTrip && !app.endPoint;
    app.focusIdx = -1;
    showScreen('route');
    prefetchPhotos();   // carica le foto (Wikipedia) e le mostra appena pronte
  }

  // Precarica le immagini delle tappe: se esiste una foto, sostituisce l'emoji
  function prefetchPhotos() {
    app.stops.forEach((s, i) => {
      const poi = s.poi;
      if (!poi?.wiki || poi._sum) return;
      fetchSummary(poi).then(sm => {
        if (!sm?.img) return;
        const cur = app.stops[i];
        if (cur?.poi?.id !== poi.id) return;   // la lista è cambiata nel frattempo
        const next = [...app.stops];
        next[i] = { ...cur, poi: { ...cur.poi, _sum: sm } };
        app.stops = next;
      });
    });
  }

  // ── Navigazione schermate ──────────────────────────────────
  function showScreen(name: import('$lib/domain/types').Screen) {
    app.screen = name;
  }

  // ── Categoria toggle ───────────────────────────────────────
  function toggleMacro(m: typeof MACROS[0]) {
    app.toggleMacro(m.id, m.subs.map(s => s.id));
  }

  function toggleSub(id: string) { app.toggleCat(id); }

  function toggleAllSubs(m: typeof MACROS[0]) {
    const allOn = m.subs.every(s => app.hasCat(s.id));
    m.subs.forEach(s => allOn ? app.removeCat(s.id) : app.addCat(s.id));
  }


  // ── Dettaglio POI ──────────────────────────────────────────
  function openDetail(poi: POI) {
    app.selectedPoi = poi;
    showScreen('detail');
    if (poi.wiki) {
      fetchSummary(poi).then(sm => {
        if (sm && app.selectedPoi?.id === poi.id) {
          app.selectedPoi = { ...poi, _sum: sm };
        }
      });
    }
  }

  // Primo tap: seleziona (evidenzia mappa + card). Secondo tap: apre dettaglio.
  function onCardTap(i: number, s: Stop) {
    if (app.focusIdx === i) {
      if (s.poi) openDetail(s.poi);
    } else {
      app.focusIdx = i;
    }
  }

  // Scorri la card selezionata in vista quando si tocca un marker
  $effect(() => {
    const i = app.focusIdx;
    if (i < 0 || app.screen !== 'route') return;
    const el = document.querySelector(`.card[data-i="${i}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Durante la navigazione, la mappa evidenzia e segue la tappa target
  $effect(() => {
    if (app.screen === 'nav') app.focusIdx = app.navIdx;
  });

  // ── Rimuovi/riordina tappe ─────────────────────────────────
  function removeStop(i: number) {
    if (app.intermediateCount <= 1) { showToast('Serve almeno una tappa'); return; }
    app.removeStop(i);
    app.focusIdx = -1;
    showToast('Tappa rimossa');
  }

  // ── Calcoli rotta ──────────────────────────────────────────
  let totalWalk = $derived(
    app.stops.reduce((acc, s, i) => {
      const prev = app.stops[i - 1];
      const leg = s.walkMin ?? (prev ? Math.round(travelMin(haversine(prev, s), app.mode)) : 0);
      return acc + leg;
    }, 0)
  );
  let totalVisit = $derived(app.stops.reduce((acc, s) => acc + countedVisit(s), 0));
  // distanza = minuti di spostamento × velocità del mezzo scelto
  let totalKm = $derived((totalWalk * SPEED_MPM[app.mode] / 1000).toFixed(1).replace('.', ','));

  function fmtHours(min: number): string {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function poiTags(poi: import('$lib/domain/types').POI | null): string[] {
    if (!poi) return [];
    const s = poi.sub;
    const t: string[] = [];
    if (poi.gem)                                                      t.push('Nascosto');
    if (s.includes('panorami'))                                       t.push('Vista');
    if (s.includes('arte'))                                           t.push('Arte');
    if (s.includes('musei'))                                          t.push('Museo');
    if (s.some(x => x === 'storico' || x === 'monumenti'))           t.push('Storia');
    if (s.includes('chiese'))                                         t.push('Sacro');
    if (s.includes('parchi'))                                         t.push('Verde');
    if (s.some(x => ['ristoranti','pizza','panini','gelati','street','caffe'].includes(x))) t.push('Cibo');
    return t.slice(0, 2);
  }

  // Emoji per categoria/sotto-categoria (placeholder amichevole, colorato di suo)
  const SUB_EMOJI: Record<string, string> = {
    musei: '🏛️', monumenti: '🗿', chiese: '⛪', arte: '🎨', teatri: '🎭', storico: '🏰',
    ristoranti: '🍽️', pizza: '🍕', panini: '🥪', gelati: '🍦', street: '🌭', caffe: '☕',
    bar: '🍸', pub: '🍺', cocktail: '🍹', discoteche: '🪩', livemusic: '🎶',
    piazze: '⛲', parchi: '🌳', panorami: '🏞️', mercati: '🧺', spiagge: '🏖️',
    toilets: '🚻', acqua: '🚰', farmacie: '💊', bancomat: '🏧',
  };
  const MACRO_EMOJI: Record<string, string> = {
    cultura: '🏛️', cibo: '🍽️', luoghi: '🏞️', notturna: '🌙', servizi: '🚻', scoperte: '🧭',
  };
  function poiEmoji(poi: import('$lib/domain/types').POI | null): string {
    if (!poi) return '📍';
    for (const s of poi.sub ?? []) if (SUB_EMOJI[s]) return SUB_EMOJI[s];
    if (poi.gem) return '🧭';
    return MACRO_EMOJI[poi.macro] ?? '📍';
  }

  // Un colore (leggermente diverso) per ogni categoria
  const MACRO_COLOR: Record<string, string> = {
    cultura:  '#4F6D9E',   // blu
    cibo:     '#C26A3C',   // terracotta
    luoghi:   '#5E8C57',   // verde
    notturna: '#6C5CE0',   // indaco
    servizi:  '#5C8A86',   // verde-acqua
    scoperte: '#8A6699',   // prugna
  };

  // ── Mezzi di trasporto ─────────────────────────────────────
  const MODES: { id: TravelMode; label: string; icon: string; verb: string }[] = [
    { id: 'walk',    label: 'A piedi', icon: 'ti-walk', verb: 'a piedi' },
    { id: 'bike',    label: 'Bici',    icon: 'ti-bike', verb: 'in bici' },
    { id: 'car',     label: 'Auto',    icon: 'ti-car',  verb: 'in auto' },
    { id: 'transit', label: 'Mezzi',   icon: 'ti-bus',  verb: 'coi mezzi' },
  ];
  function modeInfo(m: TravelMode = app.mode) { return MODES.find(x => x.id === m) ?? MODES[0]; }
  let modeVerb = $derived(modeInfo().verb);
  let modeIcon = $derived(modeInfo().icon);
  function catColor(poi: import('$lib/domain/types').POI | null): string {
    const m = poi?.gem ? 'scoperte' : (poi?.macro ?? 'cultura');
    return MACRO_COLOR[m] ?? '#8A8178';
  }

  // Perché questa tappa è stata selezionata
  function whySelected(poi: import('$lib/domain/types').POI | null): string {
    if (!poi) return '';
    if (poi.gem) return 'Luogo poco turistico, scelto per la modalità Esplorazione.';
    const s = poi.sub ?? [];
    if (s.includes('panorami')) return 'Selezionato per la vista panoramica lungo il percorso.';
    if (s.includes('musei'))    return 'Tappa culturale di rilievo nella tua zona.';
    if (s.includes('arte'))     return 'Opera d’arte incontrata lungo il cammino.';
    if (s.includes('chiese'))   return 'Luogo di culto storico vicino al tuo itinerario.';
    if (s.some(x => ['ristoranti','pizza','panini','gelati','street','caffe'].includes(x)))
      return 'Pausa gastronomica comoda lungo il giro.';
    if (s.includes('parchi'))   return 'Spazio verde per una sosta rilassante.';
    return 'Punto d’interesse vicino e raggiungibile a piedi.';
  }

  // tappa col punteggio più alto → "consigliata" (stellina nella timeline)
  let heroIdx = $derived(
    app.stops
      .map((s, i) => ({ i, score: (s.poi?.score ?? 0) + (s.gem ? 20 : 0), isStop: s.kind === 'stop' }))
      .filter(x => x.isStop)
      .sort((a, b) => b.score - a.score)[0]?.i ?? -1
  );

  // ── Google Maps deep-link ──────────────────────────────────
  function openMaps() {
    if (!app.stops.length) return;
    const pts = app.stops.map(s => `${s.lat},${s.lng}`).join('/');
    window.open(`https://www.google.com/maps/dir/${pts}`, '_blank', 'noopener');
  }

  // ── Condividi itinerario ───────────────────────────────────
  async function shareRoute() {
    if (!app.stops.length) return;
    const tappe = app.stops.filter(s => s.kind === 'stop').map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const text = `Il mio itinerario a piedi con Itinera (${fmtHours(app.minutes)}):\n\n${tappe}`;
    const mapsUrl = `https://www.google.com/maps/dir/${app.stops.map(s => `${s.lat},${s.lng}`).join('/')}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Itinera · itinerario', text, url: mapsUrl });
      } else {
        await navigator.clipboard.writeText(`${text}\n\n${mapsUrl}`);
        showToast('Itinerario copiato negli appunti');
      }
    } catch { /* utente ha annullato */ }
  }

  // ── Navigazione interna a piedi ────────────────────────────
  let heading = $state<number | null>(null);   // orientamento bussola del dispositivo
  let orientHandler: ((e: DeviceOrientationEvent) => void) | null = null;

  function startNav() {
    if (!app.stops.length) return;
    // prima tappa "stop" come target iniziale (salta la partenza)
    const first = app.stops.findIndex(s => s.kind === 'stop');
    app.navIdx = first >= 0 ? first : 0;
    enableCompass();
    showScreen('nav');
  }

  function enableCompass() {
    if (!browser || orientHandler) return;
    orientHandler = (e: DeviceOrientationEvent) => {
      // webkitCompassHeading su iOS, altrimenti alpha (0 = nord, in senso orario)
      const wk = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (wk != null) heading = wk;
      else if (e.alpha != null) heading = 360 - e.alpha;
    };
    // iOS richiede permesso esplicito
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then(r => {
        if (r === 'granted') window.addEventListener('deviceorientation', orientHandler!, true);
      }).catch(() => {});
    } else {
      window.addEventListener('deviceorientationabsolute', orientHandler, true);
      window.addEventListener('deviceorientation', orientHandler, true);
    }
  }

  function stopNav() {
    if (orientHandler) {
      window.removeEventListener('deviceorientation', orientHandler, true);
      window.removeEventListener('deviceorientationabsolute', orientHandler, true);
      orientHandler = null;
    }
    heading = null;
    showScreen('route');
  }

  function navNext() {
    const next = app.stops.findIndex((s, i) => i > app.navIdx && s.kind === 'stop');
    if (next >= 0) { app.navIdx = next; }
    else {
      // ultima tappa raggiunta
      const end = app.stops.length - 1;
      app.navIdx = end;
      showToast('Hai completato il percorso! 🎉');
    }
  }
  function navPrev() {
    for (let i = app.navIdx - 1; i >= 0; i--) {
      if (app.stops[i].kind === 'stop') { app.navIdx = i; return; }
    }
  }

  let navTarget = $derived(app.stops[app.navIdx] ?? null);
  let navDist = $derived(
    app.user && navTarget ? Math.round(haversine(app.user, navTarget)) : null
  );
  let navBearing = $derived(
    app.user && navTarget ? bearing(app.user, navTarget) : 0
  );
  // freccia: direzione assoluta meno orientamento del dispositivo (se disponibile)
  let navArrow = $derived(
    heading != null ? (navBearing - heading + 360) % 360 : navBearing
  );
  let navStopNum = $derived(
    app.stops.slice(0, app.navIdx + 1).filter(s => s.kind === 'stop').length
  );
  let navTotal = $derived(app.stops.filter(s => s.kind === 'stop').length);
  let navArrived = $derived(navDist != null && navDist <= 25);

  function fmtDist(m: number | null): string {
    if (m == null) return '—';
    if (m < 1000) return `${m} m`;
    return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  }
  function compassLabel(deg: number): string {
    const dirs = ['Nord','Nord-Est','Est','Sud-Est','Sud','Sud-Ovest','Ovest','Nord-Ovest'];
    return dirs[Math.round(deg / 45) % 8];
  }

  // ── Contenuti dettaglio ────────────────────────────────────
  function visitAdvice(poi: import('$lib/domain/types').POI | null): string {
    const m = effVisit(poi);
    if (!m)        return 'Tappa di passaggio, pochi istanti.';
    if (m <= 12)   return `${m} min · uno sguardo e una foto`;
    if (m <= 30)   return `${m} min · una visita tranquilla`;
    if (m <= 60)   return `${m} min · vale una sosta dedicata`;
    return `${m} min · prenditi tutto il tempo`;
  }

  function curiosityFor(poi: import('$lib/domain/types').POI | null): string | null {
    if (!poi) return null;
    const s = poi.sub ?? [];
    if (poi.gem)                return 'Pochi turisti lo conoscono: è uno dei luoghi che l’algoritmo ha pescato fuori dai percorsi battuti.';
    if (s.includes('panorami')) return 'I punti panoramici come questo sono perfetti al tramonto, con la luce radente sui tetti.';
    if (s.includes('musei'))    return 'Controlla gli orari: molti musei hanno ingresso ridotto nelle ultime ore o in giorni infrasettimanali.';
    if (s.includes('chiese'))   return 'Spesso l’ingresso è gratuito: dentro si nascondono opere d’arte che non ti aspetti.';
    if (s.includes('arte'))     return 'L’arte urbana cambia il volto di un quartiere: fermati a guardarla da angolazioni diverse.';
    if (s.some(x => ['ristoranti','pizza','panini','gelati','street','caffe'].includes(x)))
      return 'Una tappa gastronomica spezza il ritmo del cammino e ti fa scoprire i sapori del posto.';
    if (s.includes('parchi'))   return 'Uno spazio verde è il momento giusto per una pausa e ripartire con più energia.';
    return null;
  }

  // ── Drag-and-drop ─────────────────────────────────────────
  let dragIdx: number | null = null;

  function onDragStart(e: DragEvent, i: number) {
    dragIdx = i;
    e.dataTransfer!.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).classList.add('dragging');
  }
  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    if (app.stops[i]?.kind === 'stop') (e.currentTarget as HTMLElement).classList.add('drag-over');
  }
  function onDragLeave(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('drag-over');
  }
  function onDrop(e: DragEvent, i: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drag-over');
    if (dragIdx === null || dragIdx === i) { dragIdx = null; return; }
    if (app.stops[i]?.kind === 'stop' && app.stops[dragIdx]?.kind === 'stop') {
      app.moveStop(dragIdx, (i - dragIdx) as -1 | 1);
    }
    dragIdx = null;
  }
  function onDragEnd(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragIdx = null;
  }

  // ── Partenza / destinazione ───────────────────────────────
  let hasDest = $derived(!!app.endPoint);

  async function pickStart() {
    showToast('Tocca la mappa per la partenza');
    const p = await mapComp?.pickPoint();
    if (p) { app.startPoint = { ...p, name: 'Punto sulla mappa' }; showToast('Partenza impostata'); }
  }
  async function pickEnd() {
    showToast('Tocca la mappa per la destinazione');
    const p = await mapComp?.pickPoint();
    if (p) { app.endPoint = { ...p, name: 'Punto sulla mappa' }; app.roundTrip = false; showToast('Destinazione impostata'); }
  }
  function useMyLocationAsStart() { app.startPoint = null; }   // null = la mia posizione
  function clearDest() { app.endPoint = null; }

  // Imposta una tappa dell'itinerario corrente come partenza o destinazione
  function setStartFromStop(s: Stop) { app.startPoint = { lat: s.lat, lng: s.lng, name: s.name }; }
  function setEndFromStop(s: Stop)   { app.endPoint = { lat: s.lat, lng: s.lng, name: s.name }; app.roundTrip = false; }

  async function drawAreaFlow() {
    showScreen('route');
    showToast('Disegna un riquadro sulla mappa');
    const b = await mapComp?.pickArea();
    if (b) onGenerateArea(b);
    else showToast('Area annullata');
  }

  // ── Anteprima live ────────────────────────────────────────
  let previewTappe = $derived(Math.max(2, Math.min(14, Math.round(app.minutes / 45))));
  let previewKm    = $derived((previewTappe * 0.6).toFixed(1).replace('.', ','));
  let localGems    = $derived(POIS.filter(p => p.gem).length);

  // ── Organizer viaggio ─────────────────────────────────────
  let showSave    = $state(false);     // modale "salva nel viaggio"
  let saveTripId  = $state('');        // viaggio scelto ('' = nuovo)
  let newTripName = $state('');
  let dayLabel    = $state('');

  let currentTrip = $derived(trips.get(app.currentTripId));

  function openSaveSheet() {
    if (!app.stops.length) { showToast('Genera prima un itinerario'); return; }
    saveTripId  = trips.trips[0]?.id ?? '';
    newTripName = '';
    dayLabel    = `Giorno ${(trips.get(saveTripId)?.days.length ?? 0) + 1}`;
    showSave = true;
  }

  function confirmSave() {
    let tripId = saveTripId;
    if (!tripId) tripId = trips.createTrip(newTripName || 'Nuovo viaggio').id;
    const label = dayLabel.trim() || `Giorno ${(trips.get(tripId)?.days.length ?? 0) + 1}`;
    trips.addDay(tripId, {
      label,
      stops:   JSON.parse(JSON.stringify(app.stops)),   // snapshot immutabile
      minutes: app.minutes, mode: app.mode, cats: [...app.cats]
    });
    showSave = false;
    app.currentTripId = tripId;
    showToast('Salvato nel viaggio');
  }

  // Quando cambi il viaggio di destinazione, suggerisci la prossima etichetta giorno
  function onPickTrip(id: string) {
    saveTripId = id;
    if (id) dayLabel = `Giorno ${(trips.get(id)?.days.length ?? 0) + 1}`;
  }

  function openTrips() { showScreen('trips'); }
  function openTrip(id: string) { app.currentTripId = id; showScreen('trip'); }

  function loadDay(d: TripDay) {
    app.stops    = JSON.parse(JSON.stringify(d.stops));
    app.minutes  = d.minutes;
    app.mode     = d.mode;
    app.cats     = [...d.cats];
    app.loop     = !d.stops.some(s => s.kind === 'end');
    app.focusIdx = -1;
    showScreen('route');
    prefetchPhotos();
  }

  function newTripPrompt() {
    const name = prompt('Nome del viaggio (es. Vacanza Roma)');
    if (name && name.trim()) trips.createTrip(name.trim());
  }
  function renameTripPrompt(id: string, current: string) {
    const name = prompt('Rinomina viaggio', current);
    if (name != null && name.trim()) trips.renameTrip(id, name.trim());
  }
  function deleteTripConfirm(id: string, name: string) {
    if (confirm(`Eliminare "${name}" e tutti i suoi giorni?`)) {
      trips.deleteTrip(id);
      if (app.currentTripId === id) showScreen('trips');
    }
  }
  function deleteDayConfirm(tripId: string, d: TripDay) {
    if (confirm(`Eliminare "${d.label}"?`)) trips.removeDay(tripId, d.id);
  }

  // ── Mount ─────────────────────────────────────────────────
  onMount(() => {
    trips.load();
    locate();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const clock = setInterval(() => { now = new Date(); }, 60_000);
    return () => {
      clearInterval(clock);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (orientHandler) {
        window.removeEventListener('deviceorientation', orientHandler, true);
        window.removeEventListener('deviceorientationabsolute', orientHandler, true);
      }
    };
  });
</script>

<!-- ═══════════════════════════════════════════════ TEMPLATE ═══ -->
<div class="app">

  <!-- MAP (always visible) -->
  <Map bind:this={mapComp} />

  <!-- Brand pill -->
  <div class="brand-pill">
    <span class="logo"><i class="ti ti-compass"></i></span>
    <div class="brand-text">
      <strong>Itinera</strong>
      <span>{locLabel}</span>
    </div>
  </div>

  <!-- Recenter FAB -->
  <button class="fab" aria-label="centra sulla mia posizione"
          onclick={() => mapComp?.recenter()}>
    <i class="ti ti-current-location"></i>
  </button>

  <!-- ── SHEET ───────────────────────────────────────────────── -->
  <main class="sheet">
    <div class="grab" aria-hidden="true"></div>

    <!-- ══════════ EDIT (pannello modifica) ════════════════════ -->
    {#if app.screen === 'home'}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>

      <!-- Header pannello -->
      <div class="edit-head">
        <span class="edit-title">Modifica itinerario</span>
        <button class="edit-close" aria-label="chiudi"
                onclick={() => showScreen('route')} disabled={!app.stops.length}>
          <i class="ti ti-x"></i>
        </button>
      </div>

      <!-- Local discovery notice -->
      {#if showFar}
      <div class="notice notice-positive">
        <i class="ti ti-map-pin"></i>
        <div>
          Ecco cosa puoi scoprire intorno a te.
          <button class="link-accent" onclick={setDemo}>Oppure esplora Roma →</button>
        </div>
      </div>
      {/if}

      <!-- Anteprima live (riga compatta, non un blocco) -->
      <div class="preview-strip">
        <div class="preview-line">
          <span class="preview-time">{fmtHours(app.minutes)}</span>
          <span class="preview-rest">
            · {previewTappe} tappe · ~{previewKm} km{#if app.hasCat('scoperte')} · {localGems} nascosti{/if}
          </span>
        </div>
        <span class="preview-tag">anteprima</span>
      </div>

      <!-- Slider (discreto, sotto la riga) -->
      <input type="range" id="time" min="30" max="720" step="30"
             value={app.minutes}
             oninput={e => app.minutes = +(e.target as HTMLInputElement).value} />
      <div class="slider-endpoints"><span>30 min</span><span>12 ore</span></div>

      <!-- Mezzo di trasporto -->
      <div class="section">
        <div class="label-sm">Come ti sposti</div>
        <div class="modes">
          {#each MODES as m}
          <button class="mode-btn {app.mode === m.id ? 'on' : ''}"
                  onclick={() => app.mode = m.id}>
            <i class="ti {m.icon}"></i>
            <span>{m.label}</span>
          </button>
          {/each}
        </div>
      </div>

      <!-- Interessi: macro → micro -->
      <div class="section">
        <div class="label-sm">Cosa ti interessa</div>
        <div class="cats">
          {#each MACROS.filter(m => !m.gem) as m}
          {@const allOn = m.subs.length > 0 && m.subs.every(s => app.hasCat(s.id))}
          {@const someOn = m.subs.some(s => app.hasCat(s.id))}
          <div class="cat-block {someOn ? 'on' : ''}" style="--cat:{MACRO_COLOR[m.id] ?? 'var(--accent)'}">
            <button class="cat-macro" onclick={() => toggleAllSubs(m)}>
              <span class="cat-macro-name">{MACRO_EMOJI[m.id] ?? ''} {m.label}</span>
              <span class="cat-macro-all">{allOn ? 'tutti' : someOn ? 'alcuni' : 'scegli'}</span>
            </button>
            <div class="cat-micros">
              {#each m.subs as s}
              <button class="chip {app.hasCat(s.id) ? 'on' : ''}" onclick={() => toggleSub(s.id)}>
                {SUB_EMOJI[s.id] ?? ''} {s.label}
              </button>
              {/each}
            </div>
          </div>
          {/each}
        </div>
      </div>

      <!-- Modalità Esplorazione -->
      {#each MACROS.filter(m => m.gem) as m}
      {@const gemOn = app.macroActive(m.id, [])}
      <button class="gem-toggle" role="switch"
              aria-checked={String(gemOn) as 'true'|'false'}
              onclick={() => toggleMacro(m)}>
        <div class="gem-toggle-body">
          <span class="gem-toggle-icon"><i class="ti ti-compass"></i></span>
          <div>
            <div class="gem-toggle-title">Modalità Esplorazione</div>
            <div class="gem-toggle-sub">Luoghi poco conosciuti e storie nascoste</div>
          </div>
        </div>
        <div class="switch"><div class="knob"></div></div>
      </button>
      {/each}

      <!-- Partenza / destinazione (sempre visibili) -->
      <div class="section od-block">
        <div class="label-sm">Partenza e destinazione</div>

        <!-- Da -->
        <div class="od-field">
          <i class="ti ti-circle-dot start-dot"></i>
          <div class="od-info">
            <span class="od-cap">Da</span>
            <span class="od-val">{app.startPoint ? app.startPoint.name : 'La mia posizione'}</span>
          </div>
          <div class="od-actions">
            {#if app.startPoint}
            <button class="od-mini" onclick={useMyLocationAsStart} aria-label="usa la mia posizione">
              <i class="ti ti-current-location"></i>
            </button>
            {/if}
            <button class="od-mini" onclick={pickStart} aria-label="scegli sulla mappa">
              <i class="ti ti-map-pin-pin"></i>
            </button>
          </div>
        </div>

        <!-- A -->
        <div class="od-field">
          <i class="ti ti-flag end-dot"></i>
          <div class="od-info">
            <span class="od-cap">A</span>
            <span class="od-val">{app.endPoint ? app.endPoint.name : 'Nessuna destinazione'}</span>
          </div>
          <div class="od-actions">
            {#if app.endPoint}
            <button class="od-mini" onclick={clearDest} aria-label="rimuovi destinazione">
              <i class="ti ti-x"></i>
            </button>
            {/if}
            <button class="od-mini" onclick={pickEnd} aria-label="scegli sulla mappa">
              <i class="ti ti-map-pin-pin"></i>
            </button>
          </div>
        </div>

        <!-- Ritorna al punto di partenza -->
        <button class="switch-row"
                role="switch"
                aria-checked={String(app.roundTrip) as 'true'|'false'}
                class:disabled={hasDest}
                onclick={() => {
                  if (hasDest) { showToast('Hai scelto una destinazione: il giro è andata sola'); return; }
                  app.roundTrip = !app.roundTrip;
                }}>
          <span class="sw-label"><i class="ti ti-arrow-back-up"></i> Ritorna al punto di partenza</span>
          <span class="switch"><span class="knob"></span></span>
        </button>

        <!-- Disegna un'area sulla mappa -->
        <button class="ghost-row" onclick={drawAreaFlow}>
          <span><i class="ti ti-vector"></i> Disegna un'area sulla mappa</span>
          <i class="ti ti-chevron-right chev-sm"></i>
        </button>
      </div>

      <!-- Generate / Update -->
      <button class="btn btn-primary btn-block btn-sticky" onclick={onGenerate}>
        <i class="ti ti-refresh"></i>{app.stops.length ? 'Aggiorna itinerario' : 'Crea itinerario'}
      </button>
      <p class="credit">Mappa © OpenStreetMap, © CARTO · foto © Wikimedia Commons</p>
    </section>
    {/if}

    <!-- ══════════ ROUTE (timeline pulita) ══════════════════════ -->
    {#if app.screen === 'route'}
    <section class="screen result" in:fly={{ y: 10, duration: 220 }}>

      <!-- Header: una riga, niente box -->
      <header class="rhead">
        <button class="rhead-icon" aria-label="modifica" onclick={() => showScreen('home')}>
          <i class="ti ti-adjustments-horizontal"></i>
        </button>
        <div class="rhead-titles">
          <h1 class="rhead-title"><i class="ti {modeIcon}"></i> {fmtHours(app.minutes)} {modeVerb}</h1>
          {#if app.stops.length}
          <p class="rhead-meta">{app.intermediateCount} tappe · {totalKm} km · {fmt(totalVisit)} di visite</p>
          {/if}
        </div>
        <button class="rhead-icon" aria-label="i miei viaggi" onclick={openTrips}>
          <i class="ti ti-luggage"></i>
        </button>
        {#if app.stops.length}
        <button class="rhead-icon" aria-label="condividi" onclick={shareRoute}>
          <i class="ti ti-share-2"></i>
        </button>
        {/if}
      </header>

      {#if !app.stops.length}
      <!-- Empty state -->
      <div class="empty-state">
        <i class="ti ti-route-off"></i>
        <p class="empty-title">Nessun itinerario per ora</p>
        <p class="empty-sub">Allarga il tempo o cambia gli interessi e riprova.</p>
        <button class="btn btn-primary" onclick={() => showScreen('home')}>
          <i class="ti ti-adjustments-horizontal"></i> Modifica preferenze
        </button>
      </div>
      {:else}

      <!-- Timeline -->
      <div class="tl">
        {#each app.stops as s, i}
        {@const isStop = s.kind === 'stop'}
        {@const legMin = s.walkMin ?? 0}
        {@const last = i === app.stops.length - 1}
        {@const stopNo = app.stops.slice(0, i + 1).filter(x => x.kind === 'stop').length}
        {@const oh = s.poi?.openingHours ? openStateAt(s.poi.openingHours, now) : 'unknown'}

        <div class="tl-row {s.kind} {i === app.focusIdx ? 'on' : ''}"
            data-i={i}
            draggable={isStop}
            ondragstart={e => isStop && onDragStart(e, i)}
            ondragover={e => onDragOver(e, i)}
            ondragleave={onDragLeave}
            ondrop={e => onDrop(e, i)}
            ondragend={onDragEnd}
            onclick={() => isStop ? onCardTap(i, s) : (s.poi && openDetail(s.poi))}
            onkeydown={e => e.key === 'Enter' && s.poi && openDetail(s.poi)}
            role="button" tabindex="0">

          <!-- rail -->
          <div class="tl-rail">
            <span class="tl-dot {s.kind}"
                  style={isStop ? `background:${catColor(s.poi)}` : ''}>
              {#if s.kind === 'start'}<i class="ti ti-map-pin-filled"></i>
              {:else if s.kind === 'end'}<i class="ti ti-flag-filled"></i>
              {:else}{stopNo}{/if}
            </span>
            {#if !last}<span class="tl-line"></span>{/if}
          </div>

          <!-- content -->
          <div class="tl-content">
            {#if legMin > 0 && i > 0}
            <div class="tl-walk"><i class="ti {modeIcon}"></i> {legMin} min {modeVerb}</div>
            {/if}

            <div class="tl-card">
              {#if isStop}
              <div class="tl-photo {s.poi?._sum?.img ? '' : 'ph'}"
                   style={s.poi?._sum?.img ? `background-image:url(${s.poi._sum.img})` : `background:${catColor(s.poi)}1F`}>
                {#if !s.poi?._sum?.img}<span class="tl-emoji">{poiEmoji(s.poi)}</span>{/if}
              </div>
              {/if}
              <div class="tl-text">
                <div class="tl-name">
                  {s.name}
                  {#if i === heroIdx}<i class="ti ti-star-filled hero-star" title="tappa consigliata"></i>{/if}
                </div>
                <div class="tl-meta">
                  {#if isStop}
                    {s.visit} min di visita
                    {#if oh === 'closed'}<span class="tl-closed">· Chiuso ora</span>
                    {:else if oh === 'open'}<span class="tl-open">· Aperto ora</span>{/if}
                  {:else if s.kind === 'start'}
                    {s.poi ? 'partenza' : 'la tua posizione'}
                  {:else}
                    arrivo{app.loop ? ' · ritorno al via' : ''}
                  {/if}
                </div>
              </div>
              {#if isStop}
              <button class="tl-del" aria-label="rimuovi tappa"
                      onclick={e => { e.stopPropagation(); removeStop(i); }}>
                <i class="ti ti-x"></i>
              </button>
              {:else if s.poi}
              <i class="ti ti-chevron-right tl-chev"></i>
              {/if}
            </div>

            <!-- indirizzo: quando la tappa è selezionata -->
            {#if isStop && i === app.focusIdx && s.poi?.address}
            <div class="tl-addr"><i class="ti ti-map-pin"></i> {s.poi.address}</div>
            {/if}
          </div>
        </div>
        {/each}
      </div>

      <!-- Primary action -->
      <div class="rfoot">
        <button class="btn btn-primary btn-block" onclick={startNav}>
          <i class="ti ti-navigation"></i>Avvia il giro
        </button>
        <div class="rfoot-row">
          <button class="btn btn-outline btn-block" onclick={openSaveSheet}>
            <i class="ti ti-bookmark"></i> Salva nel viaggio
          </button>
          <button class="btn btn-ghost btn-block" onclick={openMaps}>
            <i class="ti ti-brand-google-maps"></i> Google Maps
          </button>
        </div>
      </div>
      {/if}
    </section>
    {/if}

    <!-- ══════════ NAV (guida a piedi) ════════════════════════════ -->
    {#if app.screen === 'nav'}
    <section class="screen nav-screen" in:fly={{ y: 10, duration: 220 }}>

      <div class="nav-topbar">
        <button class="link-btn" onclick={stopNav}>
          <i class="ti ti-x"></i> esci
        </button>
        <span class="nav-progress">Tappa {navStopNum} di {navTotal}</span>
      </div>

      {#if navTarget}
      <!-- Compass / arrow -->
      <div class="nav-compass {navArrived ? 'arrived' : ''}">
        {#if navArrived}
        <div class="nav-arrived-icon"><i class="ti ti-circle-check"></i></div>
        {:else}
        <div class="nav-arrow" style="transform: rotate({navArrow}deg)">
          <i class="ti ti-navigation"></i>
        </div>
        {/if}
      </div>

      <!-- Distance -->
      <div class="nav-dist">
        {#if navArrived}
        <span class="nav-dist-big">Sei arrivato</span>
        {:else}
        <span class="nav-dist-big">{fmtDist(navDist)}</span>
        <span class="nav-dist-sub">
          {#if app.user}verso {compassLabel(navBearing)}{:else}attivo il GPS…{/if}
          {#if heading == null && app.user} · ruota seguendo la freccia{/if}
        </span>
        {/if}
      </div>

      <!-- Target card -->
      <div class="nav-target {navTarget.gem ? 'gem' : ''}">
        <div class="nav-target-thumb" style="background:{catColor(navTarget.poi)}1F">
          <span class="tl-emoji">{poiEmoji(navTarget.poi)}</span>
        </div>
        <div class="nav-target-body">
          <div class="nav-target-name">{navTarget.name}</div>
          {#if navTarget.poi?.story}
          <div class="nav-target-story">{navTarget.poi.story}</div>
          {/if}
          {#if navTarget.gem}<span class="card-tag">✦ luogo nascosto</span>{/if}
        </div>
        {#if navTarget.poi}
        <button class="nav-info-btn" aria-label="dettagli"
                onclick={() => navTarget.poi && openDetail(navTarget.poi)}>
          <i class="ti ti-info-circle"></i>
        </button>
        {/if}
      </div>

      <!-- Controls -->
      <div class="nav-controls">
        <button class="btn btn-ghost" onclick={navPrev} disabled={navStopNum <= 1}>
          <i class="ti ti-arrow-left"></i> Precedente
        </button>
        {#if navStopNum >= navTotal}
        <button class="btn btn-primary" onclick={stopNav}>
          <i class="ti ti-flag-check"></i> Concludi
        </button>
        {:else}
        <button class="btn btn-primary" onclick={navNext}>
          Sono arrivato <i class="ti ti-arrow-right"></i>
        </button>
        {/if}
      </div>
      {/if}
    </section>
    {/if}

    <!-- ══════════ DETAIL ══════════════════════════════════════════ -->
    {#if app.screen === 'detail'}
    {@const poi = app.selectedPoi}
    {#if poi}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>

      <!-- Hero -->
      <div class="hero {poi._sum?.img ? '' : 'hero-placeholder'}"
           style={poi._sum?.img ? `background-image:url(${poi._sum.img})` : `background:${catColor(poi)}1F`}>
        {#if !poi._sum?.img}
        <span class="hero-emoji">{poiEmoji(poi)}</span>
        {/if}
        <button class="hero-back" aria-label="torna alle tappe"
                onclick={() => showScreen('route')}>
          <i class="ti ti-chevron-left"></i>
        </button>
        {#if poi.gem}
        <span class="hero-badge gem"><i class="ti ti-compass"></i> luogo nascosto</span>
        {/if}
      </div>

      <h2 class="detail-title">{poi.name}</h2>

      <div class="pills">
        <span class="pill">{catLabel(poi)}</span>
        <span class="pill"><i class="ti ti-clock"></i> {effVisit(poi) ? `~${effVisit(poi)} min` : 'transito'}</span>
        {#if poi.openingHours}
        {@const oh = openLabel(openStateAt(poi.openingHours, now))}
        <span class="pill oh-badge {oh.cls}"><i class="ti {oh.icon}"></i>{oh.text}</span>
        {/if}
        {#each poiTags(poi) as tag}<span class="pill subtle">{tag}</span>{/each}
      </div>
      {#if poi.address}
      <p class="detail-addr"><i class="ti ti-map-pin"></i> {poi.address}</p>
      {/if}
      {#if poi.openingHours}
      <p class="oh-raw"><i class="ti ti-calendar-time"></i> {poi.openingHours}</p>
      {/if}

      <!-- Sezione: Perché visitarlo -->
      <div class="dsection">
        <div class="dsection-head"><i class="ti ti-bulb"></i> Perché visitarlo</div>
        <p class="dsection-body">{whySelected(poi)}</p>
      </div>

      <!-- Sezione: La storia — solo se c'è un testo reale da Wikipedia -->
      {#if poi._sum?.extract}
      <div class="dsection">
        <div class="dsection-head"><i class="ti ti-book-2"></i> La storia</div>
        <p class="dsection-body">{poi._sum.extract}</p>
      </div>
      {/if}

      <!-- Sezione: Curiosità -->
      {#if curiosityFor(poi)}
      <div class="dsection">
        <div class="dsection-head"><i class="ti ti-bulb-filled"></i> Curiosità</div>
        <p class="dsection-body">{curiosityFor(poi)}</p>
      </div>
      {/if}

      <!-- Sezione: Tempo consigliato -->
      <div class="dsection">
        <div class="dsection-head"><i class="ti ti-clock-hour-4"></i> Tempo consigliato</div>
        <p class="dsection-body">{visitAdvice(poi)}</p>
      </div>

      <p class="src"><i class="ti ti-info-circle"></i>
        <span>fonte: {poi.wiki ? 'Wikipedia · Wikimedia Commons' : 'OpenStreetMap · racconto curato'}</span>
      </p>

      <!-- Ticket / Booking -->
      {#if poi.ticketUrl || poi.bookingUrl}
      <div class="detail-actions">
        {#if poi.ticketUrl}
        <a class="btn btn-primary" href={poi.ticketUrl} target="_blank" rel="noopener">
          <i class="ti ti-ticket"></i>Biglietti ufficiali
        </a>
        {/if}
        {#if poi.bookingUrl}
        <a class="btn btn-outline" href={poi.bookingUrl} target="_blank" rel="noopener">
          <i class="ti ti-calendar-check"></i>Prenota un tavolo
        </a>
        {/if}
      </div>
      {/if}

      {#if poi.wiki}
      <a class="btn btn-ghost btn-block"
         href={poi._sum?.url ?? `https://it.wikipedia.org/wiki/${encodeURIComponent(poi.wiki.replace(/ /g,'_'))}`}
         target="_blank" rel="noopener">
        <i class="ti ti-brand-wikipedia"></i>Leggi su Wikipedia
      </a>
      {/if}

      <button class="btn btn-ghost btn-block" style="margin-top:8px;"
              onclick={() => showScreen('route')}>
        <i class="ti ti-arrow-left"></i>Torna all'itinerario
      </button>
    </section>
    {/if}
    {/if}

    <!-- ══════════ TRIPS (i miei viaggi) ════════════════════════ -->
    {#if app.screen === 'trips'}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>
      <div class="edit-head">
        <span class="edit-title"><i class="ti ti-luggage"></i> I miei viaggi</span>
        <button class="edit-close" aria-label="chiudi" onclick={() => showScreen('route')}>
          <i class="ti ti-x"></i>
        </button>
      </div>

      {#if trips.trips.length === 0}
      <div class="empty-state">
        <i class="ti ti-luggage"></i>
        <p class="empty-title">Nessun viaggio salvato</p>
        <p class="empty-sub">Crea un viaggio e salva i tuoi itinerari giorno per giorno.</p>
      </div>
      {:else}
      <div class="trip-list">
        {#each trips.trips as t}
        <div class="trip-card">
          <button class="trip-main" onclick={() => openTrip(t.id)}>
            <span class="trip-emoji">🧳</span>
            <div class="trip-text">
              <div class="trip-name">{t.name}</div>
              <div class="trip-sub">{t.days.length} {t.days.length === 1 ? 'giorno' : 'giorni'}</div>
            </div>
            <i class="ti ti-chevron-right"></i>
          </button>
          <div class="trip-card-actions">
            <button class="od-mini" aria-label="rinomina" onclick={() => renameTripPrompt(t.id, t.name)}><i class="ti ti-pencil"></i></button>
            <button class="od-mini" aria-label="elimina" onclick={() => deleteTripConfirm(t.id, t.name)}><i class="ti ti-trash"></i></button>
          </div>
        </div>
        {/each}
      </div>
      {/if}

      <button class="btn btn-primary btn-block btn-sticky" onclick={newTripPrompt}>
        <i class="ti ti-plus"></i> Nuovo viaggio
      </button>
    </section>
    {/if}

    <!-- ══════════ TRIP (giorni del viaggio) ════════════════════ -->
    {#if app.screen === 'trip' && currentTrip}
    {@const trip = currentTrip}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>
      <div class="edit-head">
        <button class="rhead-icon" aria-label="indietro" onclick={() => showScreen('trips')}>
          <i class="ti ti-chevron-left"></i>
        </button>
        <span class="edit-title">{trip.name}</span>
        <button class="edit-close" aria-label="chiudi" onclick={() => showScreen('route')}>
          <i class="ti ti-x"></i>
        </button>
      </div>

      {#if trip.days.length === 0}
      <div class="empty-state">
        <i class="ti ti-calendar"></i>
        <p class="empty-title">Ancora nessun giorno</p>
        <p class="empty-sub">Apri un itinerario e usa "Salva nel viaggio" per aggiungere un giorno.</p>
      </div>
      {:else}
      <div class="day-list">
        {#each trip.days as d, i}
        <div class="day-card">
          <button class="day-main" onclick={() => loadDay(d)}>
            <span class="day-num">{i + 1}</span>
            <div class="day-text">
              <div class="day-label">{d.label}</div>
              <div class="day-sub">
                <i class="ti {modeInfo(d.mode).icon}"></i>
                {d.stops.filter(s => s.kind === 'stop').length} tappe · {fmtHours(d.minutes)}
              </div>
            </div>
            <i class="ti ti-chevron-right"></i>
          </button>
          <div class="day-card-actions">
            <button class="od-mini" aria-label="sposta su" disabled={i === 0}
                    onclick={() => trips.moveDay(trip.id, i, -1)}><i class="ti ti-arrow-up"></i></button>
            <button class="od-mini" aria-label="sposta giù" disabled={i === trip.days.length - 1}
                    onclick={() => trips.moveDay(trip.id, i, 1)}><i class="ti ti-arrow-down"></i></button>
            <button class="od-mini" aria-label="elimina giorno"
                    onclick={() => deleteDayConfirm(trip.id, d)}><i class="ti ti-trash"></i></button>
          </div>
        </div>
        {/each}
      </div>
      {/if}

      <button class="btn btn-primary btn-block btn-sticky"
              onclick={() => { app.currentTripId = trip.id; showScreen('home'); }}>
        <i class="ti ti-plus"></i> Nuovo itinerario per questo viaggio
      </button>
    </section>
    {/if}

  </main>

  <!-- ── Loading overlay ───────────────────────────────────── -->
  {#if loading}
  <div class="loading-overlay">
    <div class="loader-mark">
      <i class="ti ti-compass"></i>
      <span class="loader-ring"></span>
    </div>
    <p class="loading-msg">Preparo il tuo itinerario</p>
    {#key tipIdx}
    <p class="loading-sub" in:fly={{ y: 6, duration: 300 }}>{LOAD_TIPS[tipIdx]}</p>
    {/key}
  </div>
  {/if}

  <!-- ── Salva nel viaggio (modale) ────────────────────────── -->
  {#if showSave}
  <div class="modal-backdrop" role="presentation"
       onclick={e => { if (e.target === e.currentTarget) showSave = false; }}
       onkeydown={e => { if (e.key === 'Escape') showSave = false; }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="salva nel viaggio" tabindex="-1">
      <div class="modal-title"><i class="ti ti-bookmark"></i> Salva nel viaggio</div>

      <label class="modal-field">
        <span>Viaggio</span>
        <select value={saveTripId} onchange={e => onPickTrip((e.target as HTMLSelectElement).value)}>
          <option value="">➕ Nuovo viaggio…</option>
          {#each trips.trips as t}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </label>

      {#if !saveTripId}
      <label class="modal-field">
        <span>Nome viaggio</span>
        <input type="text" placeholder="Es. Vacanza Roma" bind:value={newTripName} />
      </label>
      {/if}

      <label class="modal-field">
        <span>Etichetta giorno</span>
        <input type="text" placeholder="Giorno 1" bind:value={dayLabel} />
      </label>

      <div class="modal-actions">
        <button class="btn btn-ghost" onclick={() => showSave = false}>Annulla</button>
        <button class="btn btn-primary" onclick={confirmSave}><i class="ti ti-check"></i> Salva</button>
      </div>
    </div>
  </div>
  {/if}

  <!-- ── Toast ─────────────────────────────────────────────── -->
  <div class="toast {app.toastVisible ? 'show' : ''}" role="status" aria-live="polite">
    {app.toastMsg}
  </div>

</div>

<style>
  /* Scoped styles: mapwrap children */
  :global(.mapwrap) {
    position: relative;
    height: 46vh;
    min-height: 260px;
    flex: none;
  }
  :global(#map) {
    position: absolute;
    inset: 0;
    background: var(--surface-2);
    z-index: 0;
  }
  /* Brand pill positioned over map */
  .brand-pill {
    position: absolute;
    top: 14px; left: 14px;
    z-index: 500;
  }
  .fab {
    position: absolute;
    top: 14px; right: 14px;
    z-index: 500;
  }
</style>

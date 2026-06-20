<script lang="ts">
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { onMount }  from 'svelte';
  import { fly }        from 'svelte/transition';

  import MapView    from '$lib/components/Map.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import LoadingOverlay from '$lib/components/LoadingOverlay.svelte';
  import NameDialog from '$lib/components/NameDialog.svelte';
  import { app, showToast } from '$lib/stores/app.svelte';
  import { trips }          from '$lib/stores/trips.svelte';
  import { settings }       from '$lib/stores/settings.svelte';
  import { MACROS }   from '$lib/domain/categories';
  import { POIS }           from '$lib/data/pois';
  import { generate, fmt, countedVisit, effVisit, catLabel, isGem, haversine, SPEED_MPM, bearing, ROME } from '$lib/domain/algorithm';
  import { recalcStopLegs, routeDistanceKm, routeTravelMin } from '$lib/domain/routing';
  import { fetchSummary }   from '$lib/services/wikipedia';
  import { fetchPois, fetchPoisInArea, fetchTransitStopsNearRoute } from '$lib/services/overpass';
  import type { TransitStop } from '$lib/services/overpass';
  import { openStateAt, openLabel } from '$lib/services/openingHours';
  import { searchPlace } from '$lib/services/geocoding';
  import { computeSchedule, scheduleTotalMin } from '$lib/domain/schedule';
  import type { GeoResult } from '$lib/services/geocoding';
  import type { POI, Stop, Bounds, TravelMode } from '$lib/domain/types';
  import type { TripDay } from '$lib/domain/trips';

  function focusEl(el: HTMLElement) { el.focus(); }

  let mapComp: MapView;
  let locLabel  = $state('individuo la tua posizione…');
  let showFar   = $state(false);
  let loading   = $state(true);
  let now       = $state(new Date());
  let booted    = false;
  let watchId: number | null = null;

  // ── Ricerca geocoding inline per OD ───────────────────────
  let odSearchActive = $state<'start' | 'end' | null>(null);
  let odQuery        = $state('');
  let odResults      = $state<GeoResult[]>([]);
  let odSearching    = $state(false);
  let odDebounce     = 0;

  // ── Replace stop ──────────────────────────────────────────
  let replacingIdx  = $state<number | null>(null);
  let replacePool   = $state<POI[]>([]);
  let lastAllPois   = $state<POI[]>([]);

  // ── Transit verification ───────────────────────────────────
  // legTransitAvail[i] = true  → il leg i è raggiungibile coi mezzi
  //                     false → nessuna fermata vicina, si va a piedi
  //                     undefined → non ancora controllato
  let transitStops    = $state<TransitStop[]>([]);
  let legTransitAvail = $state<(boolean | undefined)[]>([]);
  let transitChecking = $state(false);

  // ── Calendar ───────────────────────────────────────────────
  let calYear  = $state(new Date().getFullYear());
  let calMonth = $state(new Date().getMonth()); // 0-based

  // Features showcase durante il caricamento
  const LOAD_FEATURES = [
    { icon: 'ti-route', color: '#5B4EE8', title: 'Percorso ottimale', text: 'L\'algoritmo greedy calcola il giro più efficiente minimizzando le camminate e massimizzando le visite nel tuo tempo.' },
    { icon: 'ti-compass', color: '#9B59B6', title: 'Luoghi nascosti', text: 'La Modalità Esplorazione scopre posti poco conosciuti fuori dai circuiti turistici battuti.' },
    { icon: 'ti-navigation', color: '#27AE60', title: 'Navigazione live', text: 'Bussola e distanza in tempo reale: segui il percorso tappa per tappa direttamente dalla mappa.' },
    { icon: 'ti-vector', color: '#E67E22', title: 'Disegna l\'area', text: 'Traccia un riquadro sulla mappa e genera automaticamente l\'itinerario all\'interno della zona scelta.' },
    { icon: 'ti-luggage', color: '#2980B9', title: 'Organizza il viaggio', text: 'Salva ogni giorno come tappa di un viaggio. Vacanza Roma Giorno 1, 2, 3… tutto in un posto solo.' },
  ];
  let loadFeatureIdx = $state(0);
  let loadStep = $state('Individuo la tua posizione…');
  $effect(() => {
    if (!loading) return;
    const id = setInterval(() => { loadFeatureIdx = (loadFeatureIdx + 1) % LOAD_FEATURES.length; }, 2400);
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
    loading = false;
    if (!app.stops.length) showScreen('home');
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
    loadStep = 'Cerco luoghi intorno a te…';

    loadStep = 'Cerco luoghi intorno a te...';

    try {
      loadStep = 'Raccolgo punti di interesse e orari...';
      loadStep = 'Scarico i punti di interesse…';
      loadStep = 'Raccolgo punti di interesse e orari...';
      const livePois = await fetchPois(center.lat, center.lng, radius, app.cats);
      if (livePois.length > 0) {
        allPois = livePois;
        loadStep = `Trovati ${livePois.length} luoghi · calcolo il percorso…`;
        loadStep = `Trovati ${livePois.length} luoghi. Calcolo il percorso...`;
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
    loadStep = 'Cerco luoghi nell area selezionata...';
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
    app.editingDay = null;   // nuova generazione: non si è più in modifica di un giorno salvato
    lastAllPois = allPois;
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

  function setRouteStops(stops: Stop[]) {
    app.replaceStops(recalcStopLegs(stops, app.mode));
  }

  // Precarica le immagini delle tappe (Wikipedia / Wikidata / image OSM).
  function prefetchPhotos() {
    app.stops.forEach((s, i) => {
      const poi = s.poi;
      // serve almeno una fonte immagine e non già risolto
      if (!poi || poi._sum !== undefined) return;
      if (!poi.wiki && !poi.wikidata && !poi.image) return;
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
    setRouteStops(app.stops.filter((_, idx) => idx !== i));
    app.focusIdx = -1;
    showToast('Tappa rimossa');
  }

  function toggleStopMode(i: number) {
    app.toggleMode(i);
    setRouteStops(app.stops);
    showToast(app.stops[i]?.mode === 'pass' ? 'Tappa trasformata in passaggio' : 'Tappa inclusa come visita');
  }

  function useStopAsStart(s: Stop) {
    setStartFromStop(s);
    app.focusIdx = -1;
    showToast('Partenza aggiornata');
    onGenerate();
  }

  function useStopAsEnd(s: Stop) {
    setEndFromStop(s);
    app.focusIdx = -1;
    showToast('Arrivo aggiornato');
    onGenerate();
  }

  // ── Calcoli rotta ──────────────────────────────────────────
  let totalWalk = $derived(
    app.stops.reduce((acc, s, i) => {
      const prev = app.stops[i - 1];
      const leg = s.walkMin ?? (prev ? Math.round(routeTravelMin(prev, s, app.mode)) : 0);
      return acc + leg;
    }, 0)
  );
  let totalVisit = $derived(app.stops.reduce((acc, s) => acc + countedVisit(s), 0));
  // distanza = minuti di spostamento × velocità del mezzo scelto
  let totalKm = $derived(routeDistanceKm(app.stops, app.mode).toFixed(1).replace('.', ','));

  function fmtHours(min: number): string {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // ── Orario pianificato ────────────────────────────────────
  // Programma calcolato: orario di arrivo/partenza, attese e conflitti per ogni tappa.
  let schedule = $derived.by(() => {
    if (!correctedStops.length || !app.departureAt) return null;
    const base = new Date(app.departureAt).getTime();
    if (isNaN(base)) return null;
    return computeSchedule(correctedStops, base, { bufferMin: settings.bufferMin });
  });

  // Riepilogo programma per la testata del planner
  let scheduleEnd = $derived(schedule ? schedule[schedule.length - 1]?.departure ?? null : null);
  let scheduleSpan = $derived(schedule ? scheduleTotalMin(schedule) : 0);
  let scheduleConflicts = $derived(schedule ? schedule.filter(s => s.conflict).length : 0);

  function fmtClock(ms: number): string {
    return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDepLabel(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const tom = new Date(today); tom.setDate(today.getDate() + 1);
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Oggi · ${time}`;
    if (d.toDateString() === tom.toDateString()) return `Domani · ${time}`;
    return d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' }) + ' · ' + time;
  }

  // ── Helper orario di partenza (live e a lungo raggio) ──────
  function pad2(n: number): string { return String(n).padStart(2, '0'); }
  function toLocalIso(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function setDepNow() {
    const d = new Date(); d.setSeconds(0, 0);
    app.departureAt = toLocalIso(d);
  }
  function setDepAt(dayOffset: number, hour: number, minute = 0) {
    const d = new Date(); d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    app.departureAt = toLocalIso(d);
  }

  function changeStopVisit(i: number, delta: number) {
    const s = app.stops[i];
    if (!s || s.kind !== 'stop') return;
    app.setStopVisit(i, (s.visit ?? 30) + delta);
  }

  // Verifica se una tappa con orari di apertura risulta chiusa all'orario pianificato
  function closedAtScheduled(i: number): boolean {
    const s = app.stops[i];
    const oh = s?.poi?.openingHours;
    const sc = schedule?.[i];
    if (!oh || !sc) return false;
    return openStateAt(oh, new Date(sc.arrival)) === 'closed';
  }

  // ── Planner ────────────────────────────────────────────────
  function openPlanner() {
    if (!app.departureAt) setDepNow();   // entra sempre con un orario, anche "live"
    showScreen('schedule');
  }

  // ── Transit leg check ─────────────────────────────────────
  // Raggio entro cui deve trovarsi una fermata per considerare il leg "coi mezzi"
  const TRANSIT_RADIUS_M = 450;

  async function checkTransitLegs() {
    if (app.mode !== 'transit' || app.stops.length < 2) {
      legTransitAvail = [];
      transitStops = [];
      return;
    }
    transitChecking = true;
    try {
      const stops = await fetchTransitStopsNearRoute(app.stops);
      transitStops = stops;
      legTransitAvail = app.stops.map((s, i) => {
        if (i === 0) return true;  // il punto di partenza non ha un "leg in entrata"
        const from = app.stops[i - 1];
        const fromOk = stops.some(ts => haversine({ lat: ts.lat, lng: ts.lng }, from) <= TRANSIT_RADIUS_M);
        const toOk   = stops.some(ts => haversine({ lat: ts.lat, lng: ts.lng }, s  ) <= TRANSIT_RADIUS_M);
        return fromOk && toOk;
      });
    } catch {
      legTransitAvail = app.stops.map(() => undefined);
    } finally {
      transitChecking = false;
    }
  }

  // Ricalcola il walkMin dei leg senza copertura transit con velocità a piedi
  let correctedStops = $derived.by(() => {
    if (app.mode !== 'transit' || !legTransitAvail.length) return app.stops;
    return app.stops.map((s, i) => {
      if (i === 0 || legTransitAvail[i] !== false) return s;
      const prev = app.stops[i - 1];
      return { ...s, walkMin: Math.round(routeTravelMin(prev, s, 'walk')) };
    });
  });

  $effect(() => {
    // Rilancia il check ogni volta che cambiano stops o mode
    void app.stops;
    void app.mode;
    if (browser) checkTransitLegs();
  });

  // Google Maps Transit deep-link
  let googleTransitUrl = $derived(
    app.stops.length >= 2
      ? `https://www.google.com/maps/dir/${app.stops[0].lat},${app.stops[0].lng}/${app.stops[app.stops.length - 1].lat},${app.stops[app.stops.length - 1].lng}/data=!4m2!4m1!3e3`
      : 'https://www.google.com/maps'
  );
  let moovitUrl = $derived(
    app.stops.length >= 2
      ? `https://moovitapp.com/index/it/trasporto_pubblico-${encodeURIComponent(app.stops[0].name + '-' + app.stops[app.stops.length - 1].name)}`
      : 'https://moovitapp.com'
  );

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

  // Sistema visivo categorie: gradiente brandizzato + icona (quando manca la foto reale)
  const FALLBACK_IMG: Record<string, string> = {
    cultura:  'culture.webp',
    cibo:     'food.webp',
    luoghi:   'places.webp',
    notturna: 'nightlife.webp',
    servizi:  'services.webp',
    scoperte: 'discoveries.webp',
  };
  function fallbackImg(poi: import('$lib/domain/types').POI | null): string {
    const m = poi?.gem ? 'scoperte' : (poi?.macro ?? 'cultura');
    return `${base}/fallbacks/${FALLBACK_IMG[m] ?? FALLBACK_IMG.cultura}`;
  }
  function hasRealImg(poi: import('$lib/domain/types').POI | null): boolean {
    return !!(poi?._sum?.img ?? poi?.image);
  }
  // foto disponibile: riassunto Wikipedia/Wikidata già risolto, o URL diretto OSM
  function poiImg(poi: import('$lib/domain/types').POI | null): string | null {
    return poi?._sum?.img ?? poi?.image ?? fallbackImg(poi);
  }

  // Un colore (leggermente diverso) per ogni categoria
  const MACRO_COLOR: Record<string, string> = {
    cultura:  '#4F7380',
    cibo:     '#B7603B',
    luoghi:   '#4F7F61',
    notturna: '#385A78',
    servizi:  '#4B817A',
    scoperte: '#A45F3F',
  };

  // ── Mezzi di trasporto ─────────────────────────────────────
  const MODES: { id: TravelMode; label: string; icon: string; verb: string }[] = [
    { id: 'walk',    label: 'A piedi', icon: 'ti-walk', verb: 'a piedi' },
    { id: 'bike',    label: 'Bici',    icon: 'ti-bike', verb: 'in bici' },
    { id: 'car',     label: 'Auto',    icon: 'ti-car',  verb: 'in auto' },
    { id: 'transit', label: 'Mezzi',   icon: 'ti-bus',  verb: 'coi mezzi' },
  ];
  const EXPERIENCE_PRESETS = [
    { id: 'classic', label: 'Classico', icon: 'ti-building-bank', minutes: 180, cats: ['musei', 'monumenti', 'storico', 'chiese'] },
    { id: 'food', label: 'Cibo', icon: 'ti-tools-kitchen-2', minutes: 150, cats: ['ristoranti', 'pizza', 'caffe', 'gelati'] },
    { id: 'hidden', label: 'Nascosto', icon: 'ti-compass', minutes: 210, cats: ['scoperte', 'storico', 'arte', 'panorami'] },
    { id: 'relax', label: 'Relax', icon: 'ti-tree', minutes: 120, cats: ['parchi', 'piazze', 'panorami', 'caffe'] },
  ];
  function modeInfo(m: TravelMode = app.mode) { return MODES.find(x => x.id === m) ?? MODES[0]; }
  let modeVerb = $derived(modeInfo().verb);
  let modeIcon = $derived(modeInfo().icon);
  function catColor(poi: import('$lib/domain/types').POI | null): string {
    const m = poi?.gem ? 'scoperte' : (poi?.macro ?? 'cultura');
    return MACRO_COLOR[m] ?? '#8A8178';
  }

  function applyExperiencePreset(preset: typeof EXPERIENCE_PRESETS[number]) {
    app.minutes = preset.minutes;
    app.cats = [...preset.cats];
    showToast(`Preset ${preset.label} selezionato`);
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
  function shortReason(s: Stop, oh: string): string {
    const poi = s.poi;
    if (!poi) return '';
    if (oh === 'open') return 'Aperto ora e compatibile con il tuo tempo.';
    if (oh === 'closed') return 'Chiuso ora: puoi tenerlo come passaggio o sostituirlo.';
    const subs = poi.sub ?? [];
    if (poi.gem) return 'Scelto per aggiungere una scoperta meno turistica.';
    if (subs.some(x => ['ristoranti','pizza','panini','gelati','street','caffe'].includes(x))) {
      return 'Pausa cibo comoda lungo il giro.';
    }
    if (subs.includes('panorami')) return 'Vista panoramica lungo il percorso.';
    if (subs.includes('musei') || subs.includes('monumenti') || subs.includes('storico')) {
      return 'Tappa culturale rilevante e raggiungibile.';
    }
    if ((s.walkMin ?? 0) <= 8) return 'Scelto perche vicino alla tappa precedente.';
    return 'Scelto per bilanciare interesse e distanza.';
  }

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
      const next = [...app.stops];
      [next[dragIdx], next[i]] = [next[i], next[dragIdx]];
      setRouteStops(next);
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

  // ── OD inline search ──────────────────────────────────────
  function openOdSearch(which: 'start' | 'end') {
    odSearchActive = which;
    odQuery = which === 'start'
      ? (app.startPoint?.name ?? '')
      : (app.endPoint?.name ?? '');
    odResults = [];
  }

  function closeOdSearch() {
    odSearchActive = null;
    odQuery = '';
    odResults = [];
    clearTimeout(odDebounce);
  }

  function onOdQueryInput(q: string) {
    odQuery = q;
    clearTimeout(odDebounce);
    if (q.trim().length < 2) { odResults = []; return; }
    odSearching = true;
    odDebounce = setTimeout(async () => {
      odResults = await searchPlace(q);
      odSearching = false;
    }, 350) as unknown as number;
  }

  function selectGeoResult(r: GeoResult) {
    const point = { lat: r.lat, lng: r.lng, name: r.name };
    if (odSearchActive === 'start') {
      app.startPoint = point;
    } else {
      app.endPoint = point;
      app.roundTrip = false;
    }
    closeOdSearch();
    onGenerate();   // rigenera automaticamente
  }

  function selectMyLocation() {
    if (odSearchActive === 'start') app.startPoint = null;
    else { app.endPoint = null; }
    closeOdSearch();
    onGenerate();
  }

  // ── Replace stop ──────────────────────────────────────────
  function openReplaceStop(idx: number) {
    const cur = app.stops[idx];
    if (!cur || cur.kind !== 'stop') return;
    const usedIds = new Set(app.stops.map(s => s.poi?.id).filter(Boolean));
    // alternative POI vicine allo stesso slot, stessa categoria
    const near = lastAllPois
      .filter(p => !usedIds.has(p.id))
      .sort((a, b) => haversine(cur, a) - haversine(cur, b))
      .slice(0, 12);
    replacePool = near;
    replacingIdx = idx;
  }

  function confirmReplaceStop(poi: POI) {
    if (replacingIdx === null) return;
    const s = app.stops[replacingIdx];
    if (!s) return;
    const next = [...app.stops];
    next[replacingIdx] = {
      ...s,
      name: poi.name, poi, visit: effVisit(poi),
      gem: isGem(poi),
      lat: poi.lat, lng: poi.lng,
    };
    setRouteStops(next);
    replacingIdx = null;
    app.focusIdx = -1;
    prefetchPhotos();
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
  let nameDialog = $state<{
    open: boolean;
    title: string;
    label: string;
    value: string;
    placeholder: string;
    confirmText: string;
    onConfirm: (value: string) => void;
  }>({
    open: false,
    title: '',
    label: '',
    value: '',
    placeholder: '',
    confirmText: 'Salva',
    onConfirm: () => {}
  });
  let confirmDialog = $state<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Conferma',
    onConfirm: () => {}
  });

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
    const saved = trips.addDay(tripId, {
      label,
      stops:      JSON.parse(JSON.stringify(app.stops)),
      minutes:    app.minutes, mode: app.mode, cats: [...app.cats],
      departureAt: app.departureAt || undefined,
    });
    if (saved) app.editingDay = { tripId, dayId: saved.id, label: saved.label };
    showSave = false;
    app.currentTripId = tripId;
    showToast('Salvato nel viaggio ✓');
  }

  // Quando cambi il viaggio di destinazione, suggerisci la prossima etichetta giorno
  function onPickTrip(id: string) {
    saveTripId = id;
    if (id) dayLabel = `Giorno ${(trips.get(id)?.days.length ?? 0) + 1}`;
  }

  function openTrips() { showScreen('trips'); }
  function openTrip(id: string) { app.currentTripId = id; showScreen('trip'); }
  function openCalendar() {
    calYear = new Date().getFullYear();
    calMonth = new Date().getMonth();
    showScreen('calendar');
  }

  // ── Settings: upload logo agenzia (→ data URL in localStorage) ──
  function onLogoUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 400_000) { showToast('Logo troppo grande (max ~400 KB)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      settings.agency.logo = String(reader.result ?? '');
      settings.save();
    };
    reader.readAsDataURL(file);
  }

  // ── Calendar helpers ───────────────────────────────────────
  const MONTH_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const DOW_IT = ['Lu','Ma','Me','Gi','Ve','Sa','Do'];

  let calDays = $derived.by(() => {
    const first = new Date(calYear, calMonth, 1);
    // 0=Sun→6, trasformato in 0=Mon→6
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: Array<{ day: number | null; iso: string | null }> = [];
    for (let i = 0; i < startDow; i++) cells.push({ day: null, iso: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ day: d, iso });
    }
    return cells;
  });

  // Tutti i giorni salvati con una data, indicizzati per ISO
  let daysByDate = $derived.by((): Map<string, Array<{ trip: typeof trips.trips[0]; day: typeof trips.trips[0]['days'][0] }>> => {
    const m = new Map<string, Array<{ trip: typeof trips.trips[0]; day: typeof trips.trips[0]['days'][0] }>>();
    for (const t of trips.trips) {
      for (const d of t.days) {
        const iso = d.date ?? d.departureAt?.slice(0, 10);
        if (!iso) continue;
        if (!m.has(iso)) m.set(iso, []);
        m.get(iso)!.push({ trip: t, day: d });
      }
    }
    return m;
  });

  // ── PDF / Print ────────────────────────────────────────────
  function esc(s: unknown): string {
    return String(s ?? '').replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  }

  const PDF_MODE_LABEL: Record<TravelMode, string> = {
    walk: 'a piedi', bike: 'in bici', car: 'in auto', transit: 'coi mezzi',
  };

  function pdfDayDateLabel(d: TripDay): string {
    const iso = d.date ?? d.departureAt?.slice(0, 10);
    if (!iso) return '';
    return new Date(iso + 'T12:00').toLocaleDateString('it-IT',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Costruisce le righe tabella di un giorno con orari reali via motore di scheduling.
  function pdfDayTable(d: TripDay): { rows: string; meta: string } {
    const stops = d.stops;
    const baseMs = d.departureAt ? new Date(d.departureAt).getTime() : NaN;
    const sched = !isNaN(baseMs)
      ? computeSchedule(stops, baseMs, { bufferMin: settings.bufferMin })
      : null;

    let stopNo = 0;
    const rows = stops.map((s, i) => {
      const sc = sched?.[i];
      const isStop = s.kind === 'stop';
      if (isStop) stopNo++;

      const marker = s.kind === 'start' ? '●' : s.kind === 'end' ? '◆' : String(stopNo);
      const markerCls = s.kind === 'start' ? 'm-start' : s.kind === 'end' ? 'm-end' : 'm-stop';

      const time = sc
        ? (isStop
            ? `${fmtClock(sc.arrival)}<span class="t-sep">–</span>${fmtClock(sc.departure)}`
            : s.kind === 'start' ? fmtClock(sc.arrival) : `arr. ${fmtClock(sc.arrival)}`)
        : '';

      const cat = s.poi ? esc(catLabel(s.poi)) : '';
      const visitTxt = isStop ? `${s.visit} min di visita` : (s.kind === 'start' ? 'partenza' : 'arrivo');
      const addr = s.poi?.address ? `<div class="p-addr">📍 ${esc(s.poi.address)}</div>` : '';
      const oh = s.poi?.openingHours ? `<div class="p-oh">🕒 ${esc(s.poi.openingHours)}</div>` : '';
      const fixed = s.fixedTime ? `<span class="p-fixed">orario fisso ${esc(s.fixedTime)}</span>` : '';
      const conflict = sc?.conflict ? `<span class="p-conflict">⚠ conflitto orario</span>` : '';
      const wait = sc && sc.waitMin > 0 ? `<span class="p-wait">attesa ${sc.waitMin} min</span>` : '';

      const leg = (i > 0 && (s.walkMin ?? 0) > 0)
        ? `<tr class="leg-row"><td></td><td colspan="2" class="leg">↓ ${s.walkMin} min ${PDF_MODE_LABEL[d.mode]}</td></tr>`
        : '';

      return `${leg}<tr>
        <td class="t-time">${time}</td>
        <td class="t-marker"><span class="marker ${markerCls}">${marker}</span></td>
        <td class="t-body">
          <div class="p-name">${esc(s.name)} ${fixed}${conflict}${wait}</div>
          <div class="p-meta">${cat ? esc(cat) + ' · ' : ''}${visitTxt}</div>
          ${addr}${oh}
        </td>
      </tr>`;
    }).join('');

    const nStops = stops.filter(s => s.kind === 'stop').length;
    const endTxt = sched ? ` · fine ${fmtClock(sched[sched.length - 1].departure)}` : '';
    const meta = `${nStops} tappe · ${fmtHours(d.minutes)} ${PDF_MODE_LABEL[d.mode]}${d.departureAt ? ` · partenza ${fmtClock(new Date(d.departureAt).getTime())}` : ''}${endTxt}`;
    return { rows, meta };
  }

  function pdfAgencyHeader(): string {
    const a = settings.agency;
    if (!settings.hasAgency()) return '';
    const logo = a.logo ? `<img class="ag-logo" src="${esc(a.logo)}" alt="logo"/>` : '';
    const contacts = [
      a.phone   ? `☎ ${esc(a.phone)}` : '',
      a.email   ? `✉ ${esc(a.email)}` : '',
      a.website ? `🌐 ${esc(a.website)}` : '',
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    return `<div class="agency-bar">
      ${logo}
      <div class="ag-info">
        <div class="ag-name">${esc(a.name || 'Agenzia viaggi')}</div>
        ${contacts ? `<div class="ag-contacts">${contacts}</div>` : ''}
      </div>
    </div>`;
  }

  function pdfFooter(): string {
    const a = settings.agency;
    const note = a.note ? `<div class="foot-note">${esc(a.note)}</div>` : '';
    const sig = settings.hasAgency()
      ? `${esc(a.name || 'Agenzia')}${a.email ? ' · ' + esc(a.email) : ''}`
      : 'Itinera';
    return `${note}<div class="foot-line">${sig} · documento generato il ${new Date().toLocaleDateString('it-IT')} · powered by Itinera</div>`;
  }

  const PDF_CSS = `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 36px 32px; color: #1b2320; }
    .agency-bar { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; margin-bottom: 22px; border-bottom: 2px solid #0B7A6F; }
    .ag-logo { max-height: 52px; max-width: 160px; object-fit: contain; }
    .ag-name { font-size: 17px; font-weight: 800; color: #0B7A6F; }
    .ag-contacts { font-size: 12px; color: #555; margin-top: 2px; }
    .cover { margin-bottom: 30px; }
    .cover h1 { font-size: 30px; margin: 0 0 6px; color: #0B7A6F; letter-spacing: -.01em; }
    .cover .sub { font-size: 14px; color: #555; }
    .summary { display: flex; flex-wrap: wrap; gap: 18px; margin: 16px 0 6px; padding: 14px 16px; background: #f3f7f5; border-radius: 10px; }
    .summary .s-item { font-size: 13px; }
    .summary .s-item b { display: block; font-size: 20px; color: #0B7A6F; }
    .day-block { page-break-inside: avoid; margin: 26px 0; }
    .day-head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid #dfe4e1; padding-bottom: 6px; margin-bottom: 6px; }
    .day-head h2 { font-size: 19px; margin: 0; }
    .day-head .d-date { font-size: 13px; color: #0B7A6F; font-weight: 600; }
    .day-meta { font-size: 12px; color: #777; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 7px 6px; vertical-align: top; border-bottom: 1px solid #eef1ef; }
    .t-time { width: 96px; white-space: nowrap; font-weight: 700; color: #0B7A6F; font-size: 13px; }
    .t-sep { color: #aaa; margin: 0 1px; font-weight: 400; }
    .t-marker { width: 30px; }
    .marker { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 800; color: #fff; background: #0B7A6F; }
    .marker.m-start { background: #27AE60; }
    .marker.m-end { background: #888; }
    .p-name { font-size: 14px; font-weight: 700; }
    .p-meta { font-size: 12px; color: #777; margin-top: 1px; }
    .p-addr, .p-oh { font-size: 11.5px; color: #888; margin-top: 2px; }
    .p-fixed { font-size: 10px; font-weight: 700; color: #0B7A6F; background: #e5f2ef; padding: 1px 6px; border-radius: 8px; margin-left: 4px; }
    .p-conflict { font-size: 10px; font-weight: 700; color: #C0392B; background: #fbebe6; padding: 1px 6px; border-radius: 8px; margin-left: 4px; }
    .p-wait { font-size: 10px; font-weight: 700; color: #B7603B; background: #f7ece6; padding: 1px 6px; border-radius: 8px; margin-left: 4px; }
    .leg-row td { border: none; padding: 1px 6px; }
    .leg { font-size: 11px; color: #999; padding-left: 10px; }
    .map-link { font-size: 12px; margin-top: 8px; }
    .map-link a { color: #0B7A6F; text-decoration: none; }
    .foot-note { font-size: 11px; color: #666; margin-top: 30px; padding: 10px 12px; background: #f7f7f5; border-radius: 8px; line-height: 1.5; white-space: pre-wrap; }
    .foot-line { margin-top: 14px; font-size: 10.5px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }
    @media print { body { padding: 16px; } .day-block { page-break-inside: avoid; } a { color: #0B7A6F; } }
  `;

  function openPrintWindow(title: string, bodyHtml: string) {
    const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>${PDF_CSS}</style></head><body>${bodyHtml}</body></html>`;
    const win = window.open('', '_blank', 'width=860,height=720');
    if (!win) { showToast('Abilita i popup per esportare il PDF'); return; }
    win.document.write(html);
    win.document.close();
    win.addEventListener('load', () => setTimeout(() => win.print(), 350));
  }

  function mapsLinkForStops(stops: Stop[]): string {
    const pts = stops.map(s => `${s.lat},${s.lng}`).join('/');
    return `https://www.google.com/maps/dir/${pts}`;
  }

  function printTrip(tripId: string) {
    const trip = trips.get(tripId);
    if (!trip) return;
    if (!trip.days.length) { showToast('Aggiungi almeno un giorno al viaggio'); return; }

    // intervallo date del viaggio
    const dates = trip.days.map(d => d.date ?? d.departureAt?.slice(0, 10)).filter(Boolean) as string[];
    dates.sort();
    const range = dates.length
      ? (dates[0] === dates[dates.length - 1]
          ? new Date(dates[0] + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
          : `${new Date(dates[0] + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} – ${new Date(dates[dates.length - 1] + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}`)
      : '';

    const totalStops = trip.days.reduce((a, d) => a + d.stops.filter(s => s.kind === 'stop').length, 0);

    const dayBlocks = trip.days.map((d, idx) => {
      const { rows, meta } = pdfDayTable(d);
      const dateStr = pdfDayDateLabel(d);
      return `<div class="day-block">
        <div class="day-head">
          <h2>Giorno ${idx + 1} · ${esc(d.label)}</h2>
          ${dateStr ? `<span class="d-date">${esc(dateStr)}</span>` : ''}
        </div>
        <div class="day-meta">${meta}</div>
        <table>${rows}</table>
        <div class="map-link">🗺 <a href="${mapsLinkForStops(d.stops)}" target="_blank" rel="noopener">Apri il percorso del giorno su Google Maps</a></div>
      </div>`;
    }).join('');

    const body = `
      ${pdfAgencyHeader()}
      <div class="cover">
        <h1>${esc(trip.name)}</h1>
        <div class="sub">Programma di viaggio${range ? ' · ' + esc(range) : ''}</div>
        <div class="summary">
          <div class="s-item"><b>${trip.days.length}</b> ${trip.days.length === 1 ? 'giorno' : 'giorni'}</div>
          <div class="s-item"><b>${totalStops}</b> tappe totali</div>
          ${range ? `<div class="s-item"><b style="font-size:14px">${esc(range)}</b> date</div>` : ''}
        </div>
      </div>
      ${dayBlocks}
      ${pdfFooter()}`;

    openPrintWindow(`${trip.name} — programma di viaggio`, body);
  }

  // Esporta l'itinerario attualmente aperto come PDF di un singolo giorno.
  function printCurrentItinerary() {
    if (!app.stops.length) { showToast('Genera prima un itinerario'); return; }
    const label = app.editingDay?.label ?? 'Itinerario';
    const day: TripDay = {
      id: 'current', label,
      stops: app.stops, minutes: app.minutes, mode: app.mode, cats: [...app.cats],
      departureAt: app.departureAt || undefined,
      createdAt: Date.now(),
    };
    const { rows, meta } = pdfDayTable(day);
    const dateStr = pdfDayDateLabel(day);
    const body = `
      ${pdfAgencyHeader()}
      <div class="cover">
        <h1>${esc(label)}</h1>
        <div class="sub">${dateStr ? esc(dateStr) + ' · ' : ''}${esc(meta)}</div>
      </div>
      <div class="day-block">
        <table>${rows}</table>
        <div class="map-link">🗺 <a href="${mapsLinkForStops(app.stops)}" target="_blank" rel="noopener">Apri il percorso su Google Maps</a></div>
      </div>
      ${pdfFooter()}`;
    openPrintWindow(`${label} — itinerario`, body);
  }

  function loadDay(d: TripDay, tripId: string) {
    app.minutes     = d.minutes;
    app.mode        = d.mode;
    app.departureAt = d.departureAt ?? '';
    setRouteStops(JSON.parse(JSON.stringify(d.stops)));
    app.cats     = [...d.cats];
    app.loop     = !d.stops.some(s => s.kind === 'end');
    app.focusIdx = -1;
    app.editingDay = { tripId, dayId: d.id, label: d.label };
    showScreen('route');
    prefetchPhotos();
  }

  function updateCurrentDay() {
    if (!app.editingDay) return;
    trips.updateDay(app.editingDay.tripId, app.editingDay.dayId, {
      label:       app.editingDay.label,
      stops:       JSON.parse(JSON.stringify(app.stops)),
      minutes:     app.minutes,
      mode:        app.mode,
      cats:        [...app.cats],
      departureAt: app.departureAt || undefined,
    });
    showToast('Itinerario aggiornato ✓');
  }

  function closeNameDialog() { nameDialog.open = false; }
  function closeConfirmDialog() { confirmDialog.open = false; }

  function newTripPrompt() {
    nameDialog = {
      open: true,
      title: 'Nuovo viaggio',
      label: 'Nome viaggio',
      value: '',
      placeholder: 'Es. Vacanza Roma',
      confirmText: 'Crea',
      onConfirm: name => {
        trips.createTrip(name);
        closeNameDialog();
      }
    };
  }
  function renameTripPrompt(id: string, current: string) {
    nameDialog = {
      open: true,
      title: 'Rinomina viaggio',
      label: 'Nome viaggio',
      value: current,
      placeholder: 'Nome viaggio',
      confirmText: 'Salva',
      onConfirm: name => {
        trips.renameTrip(id, name);
        closeNameDialog();
      }
    };
  }
  function deleteTripConfirm(id: string, name: string) {
    confirmDialog = {
      open: true,
      title: 'Elimina viaggio',
      message: `Eliminare "${name}" e tutti i suoi giorni?`,
      confirmText: 'Elimina',
      onConfirm: () => {
        trips.deleteTrip(id);
        if (app.currentTripId === id) showScreen('trips');
        closeConfirmDialog();
      }
    };
  }
  function deleteDayConfirm(tripId: string, d: TripDay) {
    confirmDialog = {
      open: true,
      title: 'Elimina giorno',
      message: `Eliminare "${d.label}"?`,
      confirmText: 'Elimina',
      onConfirm: () => {
        trips.removeDay(tripId, d.id);
        closeConfirmDialog();
      }
    };
  }

  // ── Mount ─────────────────────────────────────────────────
  onMount(() => {
    trips.load();
    settings.load();
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
  <MapView bind:this={mapComp} />

  <!-- Brand pill -->
  <div class="brand-pill">
    <span class="logo"><i class="ti ti-compass"></i></span>
    <div class="brand-text">
      <strong>Itinera</strong>
      <span>{locLabel}</span>
    </div>
  </div>

  <!-- FAB stack (top-right) -->
  <div class="fab-stack">
    <button class="fab" aria-label="centra sulla mia posizione"
            onclick={() => mapComp?.recenter()}>
      <i class="ti ti-current-location"></i>
    </button>
    <button class="fab fab--area" aria-label="disegna area sulla mappa"
            onclick={drawAreaFlow}>
      <i class="ti ti-vector"></i>
    </button>
  </div>

  <!-- ── SHEET ───────────────────────────────────────────────── -->
  <main class="sheet">
    <div class="grab" aria-hidden="true"></div>

    <!-- ══════════ EDIT (pannello modifica) ════════════════════ -->
    {#if app.screen === 'home'}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>

      <!-- Header pannello -->
      <div class="edit-head">
        <span class="edit-title">{app.stops.length ? 'Modifica itinerario' : 'Crea il tuo giro'}</span>
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

      <div class="section">
        <div class="preset-head">
          <div class="label-sm">Che giro vuoi fare?</div>
          <span class="preset-sub">scegli una base, poi personalizza</span>
        </div>
        <div class="preset-row">
          {#each EXPERIENCE_PRESETS as p}
          <button class="preset-btn" onclick={() => applyExperiencePreset(p)}>
            <i class="ti {p.icon}"></i>
            <span>{p.label}</span>
          </button>
          {/each}
        </div>
      </div>

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

      <!-- Orario di partenza -->
      <div class="section">
        <div class="label-sm">Quando parti?</div>
        <div class="dep-row">
          <button class="dep-opt {!app.departureAt ? 'on' : ''}"
                  onclick={() => app.departureAt = ''}>
            <i class="ti ti-bolt"></i> Adesso
          </button>
          <button class="dep-opt {fmtDepLabel(app.departureAt).startsWith('Oggi') ? 'on' : ''}"
                  onclick={() => setDepAt(0, 9, 0)}>
            <i class="ti ti-sun"></i> Oggi 9:00
          </button>
          <button class="dep-opt {fmtDepLabel(app.departureAt).startsWith('Domani') ? 'on' : ''}"
                  onclick={() => setDepAt(1, 9, 0)}>
            <i class="ti ti-sunrise"></i> Domani
          </button>
          <label class="dep-opt dep-opt--pick {app.departureAt && !fmtDepLabel(app.departureAt).match(/^(Oggi|Domani)/) ? 'on' : ''}">
            <i class="ti ti-calendar-time"></i>
            <span>{app.departureAt ? fmtDepLabel(app.departureAt) : 'Scegli data'}</span>
            <input type="datetime-local"
                   value={app.departureAt}
                   oninput={e => app.departureAt = (e.target as HTMLInputElement).value} />
          </label>
        </div>
        {#if app.departureAt && app.mode === 'transit'}
        <p class="dep-hint dep-hint--transit"><i class="ti ti-info-circle"></i> Con i mezzi gli orari sono stime. Verifica sempre in app.</p>
        {:else if app.departureAt}
        <p class="dep-hint">Ogni tappa avrà il suo orario. Affinalo poi con <strong>Pianifica orari</strong>.</p>
        {/if}
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

      <!-- Ritorna al punto di partenza -->
      <div class="section">
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
        <button class="rhead-trips-btn" onclick={openTrips} aria-label="i miei viaggi salvati">
          <i class="ti ti-luggage"></i>
          <span>Salvati</span>
          {#if trips.trips.length > 0}
          <span class="rhead-trips-count">{trips.trips.length}</span>
          {/if}
        </button>
        {#if app.stops.length}
        <button class="rhead-icon" aria-label="condividi" onclick={shareRoute}>
          <i class="ti ti-share-2"></i>
        </button>
        {/if}
      </header>

      <!-- Banner "stai modificando" -->
      {#if app.editingDay && app.stops.length}
      {@const editingTrip = trips.get(app.editingDay.tripId)}
      <div class="editing-banner">
        <i class="ti ti-pencil"></i>
        <div class="editing-banner-text">
          <span class="editing-banner-label">Stai modificando</span>
          <span class="editing-banner-val">{app.editingDay.label}{editingTrip ? ` · ${editingTrip.name}` : ''}</span>
        </div>
        <button class="editing-banner-close" onclick={() => { app.editingDay = null; }}
                aria-label="esci dalla modalità modifica">
          <i class="ti ti-x"></i>
        </button>
      </div>
      {/if}

      <!-- Avviso trasporto pubblico -->
      {#if app.mode === 'transit' && app.stops.length}
      <div class="transit-notice">
        <i class="ti ti-bus"></i>
        <div class="transit-notice-body">
          <strong>Trasporto pubblico</strong>
          <span>I tempi sono stime basate sulla velocità media. Verifica gli orari reali prima di partire.</span>
          <div class="transit-links">
            <a class="transit-link" href={googleTransitUrl} target="_blank" rel="noopener">
              <i class="ti ti-brand-google-maps"></i> Google Maps
            </a>
            <a class="transit-link" href={moovitUrl} target="_blank" rel="noopener">
              <i class="ti ti-external-link"></i> Moovit
            </a>
          </div>
        </div>
      </div>
      {/if}

      <!-- OD bar: partenza → destinazione -->
      {#if app.stops.length}
      <div class="od-bar">
        <div class="od-bar-row">
          <button class="od-bar-point" onclick={() => openOdSearch('start')}
                  aria-label="cambia partenza">
            <span class="od-bar-dot od-bar-dot--start"></span>
            <div class="od-bar-text">
              <span class="od-bar-label">Da</span>
              <span class="od-bar-val">{app.startPoint?.name ?? 'La mia posizione'}</span>
            </div>
          </button>
          <div class="od-bar-sep">
            <span class="od-bar-line"></span>
            <i class="ti ti-arrow-right od-bar-arrow"></i>
            <span class="od-bar-line"></span>
          </div>
          <button class="od-bar-point" onclick={() => openOdSearch('end')}
                  aria-label="cambia destinazione">
            <span class="od-bar-dot od-bar-dot--end"></span>
            <div class="od-bar-text">
              <span class="od-bar-label">A</span>
              <span class="od-bar-val">{app.endPoint?.name ?? (app.roundTrip ? 'Ritorno al via' : 'Libera')}</span>
            </div>
          </button>
          {#if app.endPoint}
          <button class="od-bar-clear" onclick={() => { app.endPoint = null; onGenerate(); }}
                  aria-label="rimuovi destinazione">
            <i class="ti ti-x"></i>
          </button>
          {/if}
        </div>
      </div>
      {/if}

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
        {@const reason = isStop ? shortReason(s, oh) : ''}

        <div class="tl-row {s.kind} {i === app.focusIdx ? 'on' : ''}"
            data-i={i}
            draggable={isStop}
            ondragstart={e => isStop && onDragStart(e, i)}
            ondragover={e => onDragOver(e, i)}
            ondragleave={onDragLeave}
            ondrop={e => onDrop(e, i)}
            ondragend={onDragEnd}
            onclick={() => {
              if (isStop) { onCardTap(i, s); return; }
              if (s.kind === 'start') { openOdSearch('start'); return; }
              if (s.kind === 'end')   { openOdSearch('end');   return; }
              if (s.poi) openDetail(s.poi);
            }}
            onkeydown={e => {
              if (e.key !== 'Enter') return;
              if (s.kind === 'start') { openOdSearch('start'); return; }
              if (s.kind === 'end')   { openOdSearch('end');   return; }
              if (s.poi) openDetail(s.poi);
            }}
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
            {@const legAvail = legTransitAvail[i]}
            {@const noTransit = app.mode === 'transit' && legAvail === false}
            {@const legIcon = noTransit ? 'ti-walk' : modeIcon}
            {@const legVerb = noTransit ? 'a piedi' : modeVerb}
            {@const effectiveLeg = noTransit ? (correctedStops[i]?.walkMin ?? legMin) : legMin}
            <div class="tl-walk {noTransit ? 'tl-walk--foot' : ''}">
              <i class="ti {legIcon}"></i> {effectiveLeg} min {legVerb}
              {#if noTransit}<span class="tl-walk-note">· nessun mezzo disponibile</span>{/if}
              {#if app.mode === 'transit' && legAvail === undefined && transitChecking}
              <span class="tl-walk-checking"><i class="ti ti-loader-2 spin"></i></span>
              {/if}
            </div>
            {/if}

            <div class="tl-card">
              {#if isStop}
              <div
                class="tl-photo {hasRealImg(s.poi) ? '' : 'tl-photo--fallback'}"
                style="background-image:url({poiImg(s.poi)})"
              ></div>
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
                {#if schedule?.[i]}
                <div class="tl-clock">
                  <i class="ti ti-clock"></i>
                  {#if s.kind === 'start'}
                    {fmtClock(schedule[i].arrival)}
                  {:else if isStop}
                    {fmtClock(schedule[i].arrival)}–{fmtClock(schedule[i].departure)}
                  {:else}
                    arrivo {fmtClock(schedule[i].arrival)}
                  {/if}
                </div>
                {/if}
                {#if reason}
                <div class="tl-reason">{reason}</div>
                {/if}
              </div>
              {#if isStop}
              <button class="tl-del" aria-label="rimuovi tappa"
                      onclick={e => { e.stopPropagation(); removeStop(i); }}>
                <i class="ti ti-x"></i>
              </button>
              {:else}
              <i class="ti ti-pencil tl-edit-hint"></i>
              {/if}
            </div>

            <!-- azioni tappa selezionata -->
            {#if isStop && i === app.focusIdx}
            <div class="tl-stop-actions">
              <!-- Stepper durata sosta -->
              <div class="tl-stepper">
                <button class="tl-stepper-btn" onclick={e => { e.stopPropagation(); changeStopVisit(i, -15); }}>−</button>
                <span class="tl-stepper-val"><i class="ti ti-clock-hour-4"></i> {s.visit} min</span>
                <button class="tl-stepper-btn" onclick={e => { e.stopPropagation(); changeStopVisit(i, +15); }}>+</button>
              </div>

              {#if s.poi?.address}
              <span class="tl-addr"><i class="ti ti-map-pin"></i> {s.poi.address}</span>
              {/if}
              {#if s.poi}
              <button class="tl-action-btn" onclick={e => { e.stopPropagation(); s.poi && openDetail(s.poi); }}>
                <i class="ti ti-info-circle"></i> Dettagli
              </button>
              {/if}
              {#if lastAllPois.length > app.stops.length}
              <button class="tl-action-btn" onclick={e => { e.stopPropagation(); openReplaceStop(i); }}>
                <i class="ti ti-refresh"></i> Sostituisci
              </button>
              {/if}
              <button class="tl-action-btn" onclick={e => { e.stopPropagation(); toggleStopMode(i); }}>
                <i class="ti {s.mode === 'pass' ? 'ti-eye' : 'ti-route'}"></i>
                {s.mode === 'pass' ? 'Visita' : 'Passaggio'}
              </button>
              <button class="tl-action-btn" onclick={e => { e.stopPropagation(); useStopAsStart(s); }}>
                <i class="ti ti-player-play"></i> Partenza
              </button>
              <button class="tl-action-btn" onclick={e => { e.stopPropagation(); useStopAsEnd(s); }}>
                <i class="ti ti-flag"></i> Arrivo
              </button>
              <button class="tl-action-btn danger" onclick={e => { e.stopPropagation(); removeStop(i); }}>
                <i class="ti ti-x"></i> Salta
              </button>
            </div>
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
        <button class="btn btn-outline btn-block" onclick={openPlanner}>
          <i class="ti ti-clock-edit"></i>
          {app.departureAt ? `Pianifica orari · ${fmtDepLabel(app.departureAt)}` : 'Pianifica orari'}
        </button>
        <div class="rfoot-row">
          {#if app.editingDay}
          <button class="btn btn-save btn-block" onclick={updateCurrentDay}>
            <i class="ti ti-device-floppy"></i> Aggiorna itinerario
          </button>
          <button class="btn btn-ghost rfoot-icon-btn" onclick={openSaveSheet}
                  title="Salva come nuovo giorno" aria-label="salva come nuovo giorno">
            <i class="ti ti-copy-plus"></i>
          </button>
          {:else}
          <button class="btn btn-outline btn-block" onclick={openSaveSheet}>
            <i class="ti ti-bookmark"></i> Salva nel viaggio
          </button>
          {/if}
          <button class="btn btn-ghost btn-block" onclick={printCurrentItinerary}>
            <i class="ti ti-file-type-pdf"></i> PDF
          </button>
        </div>
        <button class="rfoot-maps-link" onclick={openMaps}>
          <i class="ti ti-brand-google-maps"></i> Apri in Google Maps
        </button>
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
        <div
          class="nav-target-thumb {hasRealImg(navTarget.poi) ? '' : 'nav-target-thumb--fallback'}"
          style="background-image:url({poiImg(navTarget.poi)}); background-size:cover"
        ></div>
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
      <div class="hero {hasRealImg(poi) ? '' : 'hero-fallback'}"
           style="background-image:url({poiImg(poi)})">
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
        <button class="rhead-icon" aria-label="profilo agenzia" onclick={() => showScreen('settings')}>
          <i class="ti ti-building-store"></i>
        </button>
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

      <div class="trips-footer-row">
        <button class="btn btn-primary btn-block" onclick={newTripPrompt}>
          <i class="ti ti-plus"></i> Nuovo viaggio
        </button>
        <button class="btn btn-ghost trips-cal-btn" onclick={openCalendar} aria-label="vista calendario">
          <i class="ti ti-calendar-month"></i>
        </button>
      </div>
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
          <button class="day-main" onclick={() => loadDay(d, trip.id)}>
            <span class="day-num">{i + 1}</span>
            <div class="day-text">
              <div class="day-label">{d.label}</div>
              <div class="day-sub">
                <i class="ti {modeInfo(d.mode).icon}"></i>
                {d.stops.filter(s => s.kind === 'stop').length} tappe · {fmtHours(d.minutes)}
              </div>
              {#if d.date || d.departureAt}
              <div class="day-date-badge">
                <i class="ti ti-calendar"></i>
                {#if d.date}
                  {new Date(d.date + 'T12:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
                {:else if d.departureAt}
                  {new Date(d.departureAt).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
                {/if}
                {#if d.departureAt}
                  · {new Date(d.departureAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                {/if}
              </div>
              {/if}
            </div>
            <span class="day-edit-hint"><i class="ti ti-pencil"></i> Modifica</span>
          </button>
          <div class="day-card-actions">
            <!-- Date picker per il calendario -->
            <label class="od-mini day-date-picker" aria-label="assegna data" title="Assegna data">
              <i class="ti ti-calendar-plus"></i>
              <input type="date" value={d.date ?? d.departureAt?.slice(0,10) ?? ''}
                     oninput={e => trips.setDayDate(trip.id, d.id, (e.target as HTMLInputElement).value)} />
            </label>
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

      <div class="trips-footer-row">
        <button class="btn btn-primary btn-block"
                onclick={() => { app.currentTripId = trip.id; showScreen('home'); }}>
          <i class="ti ti-plus"></i> Nuovo giorno
        </button>
        <button class="btn btn-ghost trips-cal-btn" onclick={() => printTrip(trip.id)}
                aria-label="esporta PDF" title="Stampa / Esporta PDF">
          <i class="ti ti-printer"></i>
        </button>
      </div>
    </section>
    {/if}

    <!-- ══════════ CALENDAR ════════════════════════════════════ -->
    {#if app.screen === 'calendar'}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>
      <div class="edit-head">
        <button class="rhead-icon" aria-label="indietro" onclick={() => showScreen('trips')}>
          <i class="ti ti-chevron-left"></i>
        </button>
        <span class="edit-title"><i class="ti ti-calendar-month"></i> Calendario</span>
        <button class="edit-close" aria-label="chiudi" onclick={() => showScreen('route')}>
          <i class="ti ti-x"></i>
        </button>
      </div>

      <!-- Navigazione mese -->
      <div class="cal-nav">
        <button class="cal-nav-btn" aria-label="mese precedente" onclick={() => { if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--; }}>
          <i class="ti ti-chevron-left"></i>
        </button>
        <span class="cal-nav-label">{MONTH_IT[calMonth]} {calYear}</span>
        <button class="cal-nav-btn" aria-label="mese successivo" onclick={() => { if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++; }}>
          <i class="ti ti-chevron-right"></i>
        </button>
      </div>

      <!-- Griglia mese -->
      <div class="cal-grid">
        {#each DOW_IT as d}
        <div class="cal-dow">{d}</div>
        {/each}
        {#each calDays as cell}
        {@const entries = cell.iso ? (daysByDate.get(cell.iso) ?? []) : []}
        {@const isToday = cell.iso === new Date().toISOString().slice(0,10)}
        <div class="cal-cell {cell.day ? '' : 'cal-cell--empty'} {isToday ? 'cal-cell--today' : ''} {entries.length ? 'cal-cell--has-events' : ''}">
          {#if cell.day}
          <span class="cal-day-num">{cell.day}</span>
          {#if entries.length}
          <div class="cal-dots">
            {#each entries.slice(0, 3) as e}
            <button class="cal-dot-btn" onclick={() => loadDay(e.day, e.trip.id)}
                    title="{e.trip.name} · {e.day.label}">
            </button>
            {/each}
          </div>
          <div class="cal-event-labels">
            {#each entries.slice(0, 2) as e}
            <button class="cal-event-label" onclick={() => loadDay(e.day, e.trip.id)}>
              {e.day.label}
            </button>
            {/each}
            {#if entries.length > 2}
            <span class="cal-event-more">+{entries.length - 2}</span>
            {/if}
          </div>
          {/if}
          {/if}
        </div>
        {/each}
      </div>

      {#if [...daysByDate.values()].flat().length === 0}
      <div class="cal-empty-hint">
        <i class="ti ti-calendar-off"></i>
        <p>Nessun itinerario con data. Assegna una data ai giorni dei tuoi viaggi per vederli qui.</p>
      </div>
      {/if}
    </section>
    {/if}

    <!-- ══════════ SCHEDULE (planner orari step-by-step) ═══════ -->
    {#if app.screen === 'schedule'}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>
      <div class="edit-head">
        <button class="rhead-icon" aria-label="indietro" onclick={() => showScreen('route')}>
          <i class="ti ti-chevron-left"></i>
        </button>
        <span class="edit-title"><i class="ti ti-clock-edit"></i> Pianifica orari</span>
        <button class="rhead-icon" aria-label="impostazioni agenzia" onclick={() => showScreen('settings')}>
          <i class="ti ti-settings"></i>
        </button>
      </div>

      <!-- Partenza -->
      <div class="plan-dep">
        <div class="plan-dep-head">
          <span class="label-sm">Partenza</span>
          <span class="plan-dep-presets">
            <button class="plan-chip" onclick={setDepNow}>Adesso</button>
            <button class="plan-chip" onclick={() => setDepAt(0, 9)}>Oggi 9:00</button>
            <button class="plan-chip" onclick={() => setDepAt(1, 9)}>Domani 9:00</button>
          </span>
        </div>
        <label class="plan-dep-field">
          <i class="ti ti-calendar-time"></i>
          <input type="datetime-local" value={app.departureAt}
                 oninput={e => app.departureAt = (e.target as HTMLInputElement).value} />
        </label>
      </div>

      <!-- Riepilogo programma -->
      {#if schedule}
      <div class="plan-summary {scheduleConflicts ? 'plan-summary--warn' : ''}">
        <div class="plan-summary-item">
          <span class="plan-summary-val">{fmtClock(new Date(app.departureAt).getTime())}</span>
          <span class="plan-summary-lbl">inizio</span>
        </div>
        <i class="ti ti-arrow-right"></i>
        <div class="plan-summary-item">
          <span class="plan-summary-val">{scheduleEnd ? fmtClock(scheduleEnd) : '—'}</span>
          <span class="plan-summary-lbl">fine</span>
        </div>
        <div class="plan-summary-item">
          <span class="plan-summary-val">{fmtHours(scheduleSpan)}</span>
          <span class="plan-summary-lbl">durata</span>
        </div>
        {#if scheduleConflicts}
        <div class="plan-summary-item plan-summary-conflict">
          <span class="plan-summary-val">{scheduleConflicts}</span>
          <span class="plan-summary-lbl">conflitti</span>
        </div>
        {/if}
      </div>

      <!-- Buffer transfer -->
      <div class="plan-buffer">
        <span><i class="ti ti-hourglass"></i> Margine tra le tappe (transfer)</span>
        <div class="plan-buffer-ctrl">
          <button class="tl-stepper-btn" onclick={() => { settings.bufferMin = Math.max(0, settings.bufferMin - 5); settings.save(); }}>−</button>
          <span class="plan-buffer-val">{settings.bufferMin} min</span>
          <button class="tl-stepper-btn" onclick={() => { settings.bufferMin = Math.min(60, settings.bufferMin + 5); settings.save(); }}>+</button>
        </div>
      </div>
      {/if}

      <!-- Lista step -->
      <div class="plan-list">
        {#each app.stops as s, i}
        {@const sc = schedule?.[i]}
        {@const isStop = s.kind === 'stop'}
        {@const closed = closedAtScheduled(i)}
        {#if i > 0 && (s.walkMin ?? 0) > 0}
        <div class="plan-leg"><i class="ti {app.mode === 'transit' && legTransitAvail[i] === false ? 'ti-walk' : modeIcon}"></i> {s.walkMin} min{#if settings.bufferMin > 0} + {settings.bufferMin} buffer{/if}</div>
        {/if}
        <div class="plan-step {sc?.conflict ? 'plan-step--conflict' : ''}">
          <div class="plan-step-time">
            {#if sc}
              <span class="plan-step-arr">{fmtClock(sc.arrival)}</span>
              {#if isStop}<span class="plan-step-dep">{fmtClock(sc.departure)}</span>{/if}
            {:else}<span class="plan-step-arr">—</span>{/if}
          </div>
          <div class="plan-step-rail">
            <span class="tl-dot {s.kind}" style={isStop ? `background:${catColor(s.poi)}` : ''}>
              {#if s.kind === 'start'}<i class="ti ti-map-pin-filled"></i>
              {:else if s.kind === 'end'}<i class="ti ti-flag-filled"></i>
              {:else}{app.stops.slice(0, i + 1).filter(x => x.kind === 'stop').length}{/if}
            </span>
          </div>
          <div class="plan-step-body">
            <div class="plan-step-name">{s.name}</div>
            <div class="plan-step-tags">
              {#if sc && sc.waitMin > 0}<span class="plan-tag plan-tag--wait">attesa {sc.waitMin}m</span>{/if}
              {#if sc?.conflict}<span class="plan-tag plan-tag--conflict">⚠ orario non rispettabile</span>{/if}
              {#if closed}<span class="plan-tag plan-tag--closed">chiuso a quest'ora</span>{/if}
            </div>

            {#if isStop}
            <div class="plan-step-controls">
              <!-- durata -->
              <div class="tl-stepper">
                <button class="tl-stepper-btn" onclick={() => changeStopVisit(i, -15)}>−</button>
                <span class="tl-stepper-val"><i class="ti ti-clock-hour-4"></i> {s.visit}m</span>
                <button class="tl-stepper-btn" onclick={() => changeStopVisit(i, +15)}>+</button>
              </div>
              <!-- orario fisso -->
              <label class="plan-fixed {s.fixedTime ? 'on' : ''}">
                <i class="ti ti-pin"></i>
                {#if s.fixedTime}{s.fixedTime}{:else}fissa orario{/if}
                <input type="time" value={s.fixedTime ?? ''}
                       oninput={e => app.setStopFixedTime(i, (e.target as HTMLInputElement).value)} />
              </label>
              {#if s.fixedTime}
              <button class="plan-fixed-clear" aria-label="rimuovi orario fisso"
                      onclick={() => app.setStopFixedTime(i, '')}><i class="ti ti-x"></i></button>
              {/if}
            </div>
            {/if}
          </div>
        </div>
        {/each}
      </div>

      <div class="rfoot">
        {#if app.editingDay}
        <button class="btn btn-save btn-block" onclick={updateCurrentDay}>
          <i class="ti ti-device-floppy"></i> Salva orari nel viaggio
        </button>
        {:else}
        <button class="btn btn-primary btn-block" onclick={openSaveSheet}>
          <i class="ti ti-bookmark"></i> Salva nel viaggio
        </button>
        {/if}
        <button class="btn btn-outline btn-block" onclick={printCurrentItinerary}>
          <i class="ti ti-file-type-pdf"></i> Esporta questo giorno in PDF
        </button>
      </div>
    </section>
    {/if}

    <!-- ══════════ SETTINGS (profilo agenzia) ══════════════════ -->
    {#if app.screen === 'settings'}
    <section class="screen" in:fly={{ y: 10, duration: 220 }}>
      <div class="edit-head">
        <button class="rhead-icon" aria-label="indietro" onclick={() => showScreen('route')}>
          <i class="ti ti-chevron-left"></i>
        </button>
        <span class="edit-title"><i class="ti ti-building-store"></i> Profilo agenzia</span>
        <button class="edit-close" aria-label="chiudi" onclick={() => showScreen('route')}>
          <i class="ti ti-x"></i>
        </button>
      </div>

      <p class="modal-hint-text">Questi dati appaiono in <strong>copertina e piè di pagina</strong> dei PDF esportati. Salvati solo su questo dispositivo.</p>

      <div class="settings-form">
        <label class="modal-field">
          <span>Nome agenzia</span>
          <input type="text" placeholder="Es. Viaggi del Sole" bind:value={settings.agency.name} oninput={() => settings.save()} />
        </label>

        <div class="settings-logo-row">
          <div class="settings-logo-preview">
            {#if settings.agency.logo}
            <img src={settings.agency.logo} alt="logo" />
            {:else}
            <i class="ti ti-photo"></i>
            {/if}
          </div>
          <div class="settings-logo-actions">
            <span class="modal-field-lbl">Logo</span>
            <label class="btn btn-ghost btn-sm-block">
              <i class="ti ti-upload"></i> Carica immagine
              <input type="file" accept="image/*" style="display:none"
                     onchange={onLogoUpload} />
            </label>
            {#if settings.agency.logo}
            <button class="btn btn-ghost btn-sm-block" onclick={() => { settings.agency.logo = ''; settings.save(); }}>
              <i class="ti ti-trash"></i> Rimuovi
            </button>
            {/if}
          </div>
        </div>

        <label class="modal-field">
          <span>Telefono</span>
          <input type="tel" placeholder="+39 ..." bind:value={settings.agency.phone} oninput={() => settings.save()} />
        </label>
        <label class="modal-field">
          <span>Email</span>
          <input type="email" placeholder="info@agenzia.it" bind:value={settings.agency.email} oninput={() => settings.save()} />
        </label>
        <label class="modal-field">
          <span>Sito web</span>
          <input type="text" placeholder="www.agenzia.it" bind:value={settings.agency.website} oninput={() => settings.save()} />
        </label>
        <label class="modal-field">
          <span>Nota / disclaimer (piè di pagina PDF)</span>
          <textarea rows="3" placeholder="Es. Condizioni, contatti emergenza, P.IVA…"
                    bind:value={settings.agency.note} oninput={() => settings.save()}></textarea>
        </label>
      </div>

      <button class="btn btn-primary btn-block btn-sticky" onclick={() => { settings.save(); showToast('Profilo salvato ✓'); showScreen('route'); }}>
        <i class="ti ti-check"></i> Salva profilo
      </button>
    </section>
    {/if}

  </main>

  <!-- ── Loading overlay ───────────────────────────────────── -->
  {#if loading}
  <LoadingOverlay features={LOAD_FEATURES} activeIndex={loadFeatureIdx} step={loadStep} />
  {/if}

  <!-- ── Salva nel viaggio (modale) ────────────────────────── -->
  {#if showSave}
  <div class="modal-backdrop" role="presentation"
       onclick={e => { if (e.target === e.currentTarget) showSave = false; }}
       onkeydown={e => { if (e.key === 'Escape') showSave = false; }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="salva nel viaggio" tabindex="-1">
      <div class="modal-title"><i class="ti ti-bookmark"></i> Salva l'itinerario</div>
      <p class="modal-hint-text">Organizza i tuoi itinerari in <strong>viaggi</strong>. Ogni viaggio raccoglie più giorni di esplorazione.</p>

      <label class="modal-field">
        <span>In quale viaggio?</span>
        <select value={saveTripId} onchange={e => onPickTrip((e.target as HTMLSelectElement).value)}>
          <option value="">➕ Crea nuovo viaggio…</option>
          {#each trips.trips as t}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </label>

      {#if !saveTripId}
      <label class="modal-field">
        <span>Nome del viaggio</span>
        <input type="text" placeholder="Es. Vacanza Roma, Weekend Napoli…" bind:value={newTripName} />
      </label>
      {/if}

      <label class="modal-field">
        <span>Nome di questo giorno</span>
        <input type="text" placeholder="Es. Giorno 1, Centro storico…" bind:value={dayLabel} />
      </label>

      <div class="modal-actions">
        <button class="btn btn-ghost" onclick={() => showSave = false}>Annulla</button>
        <button class="btn btn-primary" onclick={confirmSave}><i class="ti ti-device-floppy"></i> Salva</button>
      </div>
    </div>
  </div>
  {/if}

  <!-- ── OD Search sheet (partenza / destinazione) ─────────── -->
  {#if odSearchActive}
  <div class="od-sheet-backdrop" role="presentation"
       onclick={closeOdSearch}
       onkeydown={e => e.key === 'Escape' && closeOdSearch()}>
    <div class="od-sheet" role="dialog" aria-modal="true"
         aria-label={odSearchActive === 'start' ? 'Cerca partenza' : 'Cerca destinazione'}
         tabindex="-1"
         onclick={e => e.stopPropagation()}
         onkeydown={e => e.stopPropagation()}>

      <!-- Campo di ricerca -->
      <div class="od-sheet-header">
        <span class="od-sheet-dot {odSearchActive === 'start' ? 'od-sheet-dot--start' : 'od-sheet-dot--end'}"></span>
        <input class="od-sheet-input"
               type="text"
               placeholder={odSearchActive === 'start' ? 'Cerca partenza…' : 'Cerca destinazione…'}
               value={odQuery}
               oninput={e => onOdQueryInput((e.target as HTMLInputElement).value)}
               use:focusEl />
        <button class="od-sheet-close" onclick={closeOdSearch} aria-label="chiudi">
          <i class="ti ti-x"></i>
        </button>
      </div>

      <!-- Risultati -->
      <div class="od-sheet-results">
        <button class="od-result od-result--location" onclick={selectMyLocation}>
          <i class="ti ti-current-location"></i>
          <span>La mia posizione attuale</span>
        </button>

        {#if odSearching}
        <div class="od-result od-result--hint">
          <i class="ti ti-loader-2 spin"></i> Cerco…
        </div>
        {:else if odResults.length === 0 && odQuery.length >= 2}
        <div class="od-result od-result--hint">Nessun risultato per "{odQuery}"</div>
        {:else}
        {#each odResults as r}
        <button class="od-result" onclick={() => selectGeoResult(r)}>
          <i class="ti ti-map-pin"></i>
          <div class="od-result-text">
            <span class="od-result-name">{r.name}</span>
            <span class="od-result-detail">{r.detail}</span>
          </div>
        </button>
        {/each}
        {/if}
      </div>

    </div>
  </div>
  {/if}

  <!-- ── Replace stop modal ───────────────────────────────── -->
  {#if replacingIdx !== null}
  <div class="modal-backdrop" role="presentation"
       onclick={() => replacingIdx = null}
       onkeydown={e => e.key === 'Escape' && (replacingIdx = null)}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="sostituisci tappa" tabindex="-1"
         onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
      <div class="modal-title"><i class="ti ti-refresh"></i> Sostituisci tappa</div>
      {#if replacePool.length === 0}
      <p class="modal-hint">Nessuna alternativa disponibile in zona.</p>
      {:else}
      <div class="replace-list">
        {#each replacePool as poi}
        {@const color = MACRO_COLOR[poi.gem ? 'scoperte' : poi.macro] ?? '#666'}
        <button class="replace-item" onclick={() => confirmReplaceStop(poi)}>
          <span class="replace-dot" style="background:{color}"></span>
          <div class="replace-text">
            <span class="replace-name">{poi.name}</span>
            <span class="replace-sub">{catLabel(poi)} · ~{effVisit(poi)} min</span>
          </div>
          <i class="ti ti-chevron-right"></i>
        </button>
        {/each}
      </div>
      {/if}
      <button class="btn btn-ghost btn-block" style="margin-top:8px" onclick={() => replacingIdx = null}>Annulla</button>
    </div>
  </div>
  {/if}

  <!-- ── Toast ─────────────────────────────────────────────── -->
  <NameDialog
    open={nameDialog.open}
    title={nameDialog.title}
    label={nameDialog.label}
    value={nameDialog.value}
    placeholder={nameDialog.placeholder}
    confirmText={nameDialog.confirmText}
    onCancel={closeNameDialog}
    onConfirm={nameDialog.onConfirm}
  />

  <ConfirmDialog
    open={confirmDialog.open}
    title={confirmDialog.title}
    message={confirmDialog.message}
    confirmText={confirmDialog.confirmText}
    tone="danger"
    onCancel={closeConfirmDialog}
    onConfirm={confirmDialog.onConfirm}
  />

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

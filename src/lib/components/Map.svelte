<script lang="ts">
  import { browser } from '$app/environment';
  import { app } from '$lib/stores/app.svelte';

  let mapEl: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let L: any, map: any, routeLayer: any, userMarker: any;
  let ready = $state(false);

  // ── Init Leaflet ──────────────────────────────────────────
  $effect(() => {
    if (!browser) return;
    let _map: any;

    (async () => {
      const mod = await import('leaflet');
      L = mod.default ?? mod;
      _map = map = L.map(mapEl, { zoomControl: false, attributionControl: false });
      map.setView([41.8986, 12.4769], 14);
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        { maxZoom: 20, subdomains: 'abcd' }
      ).addTo(map);
      routeLayer = L.layerGroup().addTo(map);
      ready = true;
    })();

    return () => _map?.remove();
  });

  // ── Sync user dot ─────────────────────────────────────────
  $effect(() => {
    const u = app.user;
    if (!ready || !u) return;
    const pos: [number, number] = [u.lat, u.lng];
    if (!userMarker) {
      userMarker = L.marker(pos, {
        icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 1000
      }).addTo(map);
    } else {
      userMarker.setLatLng(pos);
    }
  });

  // ── Sync route ────────────────────────────────────────────
  $effect(() => {
    const stops = app.stops;
    const focus = app.focusIdx;
    if (!ready) return;

    routeLayer.clearLayers();
    if (!stops.length) return;

    const pts: [number, number][] = [];
    stops.forEach((s, i) => {
      pts.push([s.lat, s.lng]);
      const cls = s.kind === 'start' ? 'start' : s.kind === 'end' ? 'end' : (s.gem ? 'gem' : '');
      const focused = i === focus ? ' focused' : '';
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="pin ${cls}${focused}"><span>${i + 1}</span></div>`,
          iconSize: [28, 28], iconAnchor: [14, 27]
        }),
        zIndexOffset: i === focus ? 900 : 0
      }).addTo(routeLayer);
      marker.on('click', () => { app.focusIdx = i; });
    });

    if (pts.length > 1) {
      const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0e7c6b';
      L.polyline(pts, { color: col, weight: 4, opacity: .85, dashArray: '1 9', lineCap: 'round' }).addTo(routeLayer);
      // non rifittare la vista quando cambia solo il focus
      if (focus < 0) map.fitBounds(L.latLngBounds(pts).pad(.25));
    }
  });

  // ── Pan to focused stop ───────────────────────────────────
  $effect(() => {
    const focus = app.focusIdx;
    if (!ready || focus < 0 || !app.stops[focus]) return;
    const s = app.stops[focus];
    map.panTo([s.lat, s.lng], { animate: true, duration: .4 });
  });

  // ── Invalidate on screen change ───────────────────────────
  $effect(() => {
    void app.screen;
    if (!ready) return;
    setTimeout(() => map?.invalidateSize(), 70);
  });

  // ── Public API ────────────────────────────────────────────
  export function recenter() {
    if (!ready || !app.user) return;
    map.setView([app.user.lat, app.user.lng], 15);
  }

  export function moveTo(lat: number, lng: number, zoom = 14) {
    if (!ready) return;
    map.setView([lat, lng], zoom);
  }
</script>

<div class="mapwrap" class:compact={app.screen === 'home' || app.screen === 'nav'} class:mini={app.screen === 'detail'}>
  <div bind:this={mapEl} id="map" role="application" aria-label="mappa dell'itinerario"></div>
</div>

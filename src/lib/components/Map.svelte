<script lang="ts">
  import { browser } from '$app/environment';
  import { app } from '$lib/stores/app.svelte';
  import type { LatLng, Bounds } from '$lib/domain/types';

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

  // ── Selezione di un punto: il prossimo tap sulla mappa lo restituisce ──
  export function pickPoint(): Promise<LatLng | null> {
    return new Promise((resolve) => {
      if (!ready) { resolve(null); return; }
      mapEl.style.cursor = 'crosshair';
      const onClick = (e: any) => {
        map.off('click', onClick);
        mapEl.style.cursor = '';
        resolve({ lat: e.latlng.lat, lng: e.latlng.lng });
      };
      map.on('click', onClick);
    });
  }

  // ── Selezione di un'area: trascina per disegnare un riquadro ──
  export function pickArea(): Promise<Bounds | null> {
    return new Promise((resolve) => {
      if (!ready) { resolve(null); return; }
      map.dragging.disable();
      mapEl.style.cursor = 'crosshair';
      let startLL: any = null;
      let rect: any = null;

      const toLL = (ev: MouseEvent | TouchEvent) => {
        const pt: any = 'touches' in ev
          ? (ev.touches[0] ?? (ev as TouchEvent).changedTouches[0])
          : ev;
        const box = mapEl.getBoundingClientRect();
        return map.containerPointToLatLng([pt.clientX - box.left, pt.clientY - box.top]);
      };

      const move = (ev: MouseEvent | TouchEvent) => {
        if (!startLL || !rect) return;
        ev.preventDefault();
        rect.setBounds(L.latLngBounds(startLL, toLL(ev)));
      };

      const cleanup = () => {
        mapEl.removeEventListener('mousedown', down);
        mapEl.removeEventListener('touchstart', down);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('touchend', up);
        map.dragging.enable();
        mapEl.style.cursor = '';
      };

      const up = () => {
        cleanup();
        if (!rect || !startLL) { resolve(null); return; }
        const b = rect.getBounds();
        rect.remove();
        const sw = b.getSouthWest(), ne = b.getNorthEast();
        // riquadro troppo piccolo → annullato
        if (Math.abs(ne.lat - sw.lat) < 1e-4 && Math.abs(ne.lng - sw.lng) < 1e-4) {
          resolve(null); return;
        }
        resolve({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng });
      };

      const down = (ev: MouseEvent | TouchEvent) => {
        ev.preventDefault();
        startLL = toLL(ev);
        rect = L.rectangle([startLL, startLL], {
          color: '#0e7c6b', weight: 2, dashArray: '5 5', fillOpacity: .08
        }).addTo(map);
        window.addEventListener('mousemove', move, { passive: false });
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
      };

      mapEl.addEventListener('mousedown', down);
      mapEl.addEventListener('touchstart', down, { passive: false });
    });
  }
</script>

<div class="mapwrap" class:compact={app.screen === 'home' || app.screen === 'nav'} class:mini={app.screen === 'detail'}>
  <div bind:this={mapEl} id="map" role="application" aria-label="mappa dell'itinerario"></div>
</div>

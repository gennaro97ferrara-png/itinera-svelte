# Itinera

Itinera e' una web app SvelteKit per creare itinerari locali in pochi secondi. Parte dalla posizione dell'utente o da un punto scelto, cerca luoghi di interesse con OpenStreetMap/Overpass, costruisce un percorso con tempi di visita e spostamento, e permette di salvare piu' giornate dentro un viaggio.

## Funzioni principali

- Generazione automatica di itinerari per tempo disponibile, categorie e mezzo di trasporto.
- Mappa interattiva con tappe, partenza, destinazione e giro ad anello.
- Ricerca di partenza/destinazione tramite Nominatim e selezione manuale sulla mappa.
- Selezione di un'area sulla mappa per generare un itinerario dentro un riquadro.
- Sostituzione, rimozione e riordino delle tappe.
- Dettagli dei luoghi con informazioni da OpenStreetMap, Wikipedia e Wikidata quando disponibili.
- Salvataggio locale di viaggi e giornate tramite `localStorage`.
- Fallback su dati demo quando i servizi live non rispondono.

## Sviluppo

```bash
npm install
npm run dev
```

L'app viene servita di default su `http://localhost:5174`.

## Verifiche

```bash
npm run check
npm run build
```

## Note tecniche

- Il progetto usa SvelteKit con adapter statico.
- La mappa e' basata su Leaflet e tile Carto.
- I POI live arrivano da endpoint Overpass pubblici, con timeout breve e cache locale.
- Il routing usa una stima lungo strada basata sulla distanza geografica corretta per mezzo di trasporto. Non sostituisce un motore di routing turn-by-turn, ma evita stime troppo ottimistiche da linea d'aria.

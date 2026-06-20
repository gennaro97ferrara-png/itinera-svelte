# Itinera — Design Specification
> Documento di riferimento per la ricreazione in Figma.  
> Aggiornato: 2026-06-20

---

## 1. DESIGN TOKENS

### 1.1 Colori — Light Mode

| Token | Valore | Uso |
|---|---|---|
| `ink` | `#17201D` | Testo primario |
| `ink-2` | `#3E4A46` | Testo secondario |
| `bg` | `#FAFAF7` | Sfondo app |
| `surface` | `#FFFFFF` | Card, modal, input |
| `surface-2` | `#EFF2EE` | Sfondi secondari, segmented control |
| `muted` | `#6B716E` | Label, placeholder, icone inattive |
| `line` | `#E2E5DF` | Bordi, separatori |
| `accent` | `#0B7A6F` | Verde primario — CTA, link, selezioni |
| `accent-dark` | `#075E56` | Verde scuro — hover, gradiente |
| `accent-soft` | `#E5F2EF` | Sfondo leggero accent |
| `accent-ink` | `#075E56` | Testo su accent-soft |
| `on-accent` | `#FFFFFF` | Testo su bottoni accent |
| `gem` | `#B7603B` | Arancione — Esplorazione/Nascosto |
| `gem-soft` | `#F7ECE6` | Sfondo leggero gem |
| `gem-ink` | `#8E4327` | Testo su gem-soft |
| `green` | `#27AE60` | Successo, aperto, partenza |
| `red` | `#C0392B` | Errore, chiuso, eliminazione |

### 1.2 Colori — Dark Mode

| Token | Valore |
|---|---|
| `ink` | `#EFF5F1` |
| `ink-2` | `#C8D2CD` |
| `bg` | `#101713` |
| `surface` | `#18211D` |
| `surface-2` | `#22302B` |
| `muted` | `#95A39D` |
| `line` | `#2B3934` |
| `accent` | `#42B7A8` |
| `accent-dark` | `#77D2C7` |
| `accent-soft` | `#17352F` |
| `accent-ink` | `#9DE2D8` |
| `on-accent` | `#071512` |
| `gem` | `#D58A63` |
| `gem-soft` | `#332018` |
| `gem-ink` | `#F1B894` |
| `green` | `#2ECC71` |
| `red` | `#E74C3C` |

### 1.3 Colori categoria

| Macro | Hex |
|---|---|
| Cultura | `#4F7380` |
| Cibo | `#B7603B` |
| Luoghi | `#4F7F61` |
| Vita notturna | `#385A78` |
| Servizi | `#4B817A` |
| Scoperte | `#A45F3F` |

---

## 2. TIPOGRAFIA

**Font stack:** `Inter, Manrope, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`  
**Rendering:** `-webkit-font-smoothing: antialiased`

| Ruolo | Size | Weight | Colore |
|---|---|---|---|
| Titolo schermata | 19px | 800 | `ink` |
| H1 header route | 24px | 800 | `ink` |
| H1 navigazione | 40px | 800 | `ink` |
| Titolo card | 16px | 750 | `ink` |
| Titolo tappa dettaglio | 26px | 750 | `ink` |
| Corpo testo | 15px | 400 | `ink-2` |
| Meta / secondario | 13px | 500 | `muted` |
| Label sezione | 11px | 700 | `muted` uppercase, ls 0.06em |
| Chip / badge | 12px | 600 | varies |
| Caption | 11px | 500 | `muted` |
| Bottone primario | 15–16px | 700 | `on-accent` |
| Bottone secondario | 15px | 700 | `ink` / `accent` |

---

## 3. SPAZIATURE & LAYOUT

| Token | Valore | Uso |
|---|---|---|
| `r-xl` | 20px | Modal, sheet, hero |
| `r-lg` | 12px | Card, sezioni, bottoni |
| `r-md` | 10px | Bottoni piccoli, input |
| `r-sm` | 8px | Chip, badge |
| Max width app | 480px | Centrata su desktop |
| Sheet padding orizzontale | 16px | Margini laterali |
| Sheet padding bottom | 96px + safe-area | Spazio per tab/home indicator |
| Section margin-top | 28px | Tra sezioni nella home |
| Card gap timeline | 20px padding-bottom | Tra tappe |

---

## 4. OMBRE

| Token | Valore | Uso |
|---|---|---|
| `shadow-xs` | `0 1px 2px rgba(23,32,29,.05)` | Card base |
| `shadow-sm` | `0 4px 14px rgba(23,32,29,.08)` | Card elevata, FAB |
| `shadow-md` | `0 10px 30px rgba(23,32,29,.10)` | Modal, drawer |
| `shadow-lg` | `0 18px 48px rgba(23,32,29,.14)` | Bottom sheet, toast |
| `shadow-blue` | `0 6px 18px rgba(11,122,111,.24)` | Bottone primario accent |

---

## 5. SCHERMATE

### 5.1 Shell principale

```
┌─────────────────────────────┐  max-width: 480px
│  MAPPA (32vh, min 200px)    │  Leaflet, bordi arrotondati 0
│  [Brand pill TL] [FAB TR]   │
└─────────────────────────────┘
│  SHEET (flex:1, overflow-y) │  border-radius: 22px 22px 0 0
│  [grab bar] [contenuto]     │  padding: 0 16px 96px
└─────────────────────────────┘
```

**Brand pill** (top-left assoluto, z:500):
- Background: glass `rgba(248,247,252,.82)` + blur(16px)
- Border: `1px solid rgba(255,255,255,.6)`
- Padding: `7px 16px 7px 7px`
- Border-radius: 999px
- Logo circle: 34×34px, gradient accent→accent-dark, border-radius 50%
- Testo: nome 14px/800, label 11px/muted

**FAB stack** (top-right assoluto, z:500):
- Ogni FAB: 44×44px, circle
- Background: glass, blur(16px)
- Border: glass-border
- Icona: 20px, colore accent (area FAB: gem)
- Gap tra FAB: 8px

**Grab bar**:
- 40×4px, border-radius 999px, bg: `line`, opacity .5
- Margin: `10px auto 18px`

---

### 5.2 Schermata ROUTE (principale)

**Header `.rhead`**:
```
[Titoli flex:1] [btn Salvati] [btn Share]
```
- H1: icona modo 22px + testo 24px/800, gap 8px
- Meta: 13px/500/muted, margin-top 3px
- Bottone Salvati: padding 8px 12px, h:40px, border 1px line, r-md
  - Badge count: 18px circle, bg accent, 11px/800

**Barra "Personalizza l'itinerario"** `.customize-bar`:
- Sfondo: `surface`, border 1.5px `accent`
- Border-radius: r-lg (12px)
- Padding: 11px 14px
- Shadow: `0 2px 10px color-mix(accent 12%)`
- Layout: `[icona 20px] [testo colonna] [Modifica →]`
- Titolo: 13px/800/accent-ink
- Sub: 11.5px/500/muted (riepilogo impostazioni attive)
- CTA: 12px/800/accent

**Barra OD** `.od-bar`:
- Sfondo: `surface`, border 1px `line`, r-xl (20px)
- Padding: 4px
- Layout: `[punto Da] [separatore ↕] [punto A] [×]`
- Ogni punto: flex:1, min-height 56px, padding 11px 12px, r-16px
- Dot partenza: 10px circle, verde + glow
- Dot arrivo: 10px circle, transparent + border accent 2.5px
- Label: 10px/700/muted uppercase, ls 0.05em
- Valore: 14px/600/ink, ellipsis

**Banner "Orario di partenza"** `.dep-inline`:
- Sfondo: `surface`, border 1px `line`, r-lg
- Padding: 10px 12px
- Titolo: 12px/700/muted uppercase
- Recap fine: 12px/500/ink-2, accento verde su orario

**Timeline** `.tl`:
- Ogni riga `.tl-row`: flex, gap 16px, r-lg
- Stato selected: bg `accent-soft`, border accent sul `.tl-card`
- **Rail** `.tl-rail`: width 32px, flex colonna centrata
  - Dot: 32×32px circle, bg catcolor, font 13px/800 bianco
  - Dot start: verde, dot end: muted
  - Linea: 2px, gradient accent-soft→line
- **Card** `.tl-card`: flex, gap 12px, bg `surface`, border 1px `line`, r-lg, p 10px
  - Foto: 84×84px, r-md, object-cover
  - Nome: 16px/750/ink, ellipsis, flex+gap 6px
  - Meta: 13px/500/muted
  - Clock badge: inline-flex, bg accent-soft, 12.5px/700/accent-ink, r-999px
  - Reason: 12.5px/1.35/ink-2
  - Delete btn: 30×30px, r-sm, transparent

**Azioni tappa** (expanded) `.tl-stop-actions`:
- Flex wrap, gap 8px, margin 8px 0 2px
- Bottone **primario** (Dettagli): bg accent, colore on-accent
- Stepper durata: flex inline, border 1.5px accent, r-lg, overflow hidden
  - Btn: 36×34px, transparent
  - Val: padding 0 10px, 12.5px/700, min-width 72px
- Bottone **Salta**: border e testo `red`
- Bottone **Altro**: border line, bg surface-2, muted
- **Menu secondario** `.tl-more-menu`: bg surface, border line, r-lg, p 10px 12px, flex wrap gap 8px, animazione rise .15s

**Punteggio qualità** `.route-score`:
- Sfondo surface, border line, r-lg, p 12px 14px
- Numero: 28px/800 (colore per stato)
- Label: 12px/700/muted
- Pills destra: 11.5px/700, r-999px, varianti ok/warn/gem

**Footer route** `.rfoot`:
- Bottone primario ("Avvia il giro"): full width, 16px/700, padding 16px 22px, gradient accent→accent-dark
- Riga secondaria: flex gap 10px
  - "Aggiungi a un viaggio": btn-outline
  - "PDF": btn-ghost
- Link Google Maps: 13px/600/muted, centrato

---

### 5.3 Schermata PERSONALIZZA (home)

**Header**:
```
[Titolo 19px/800]          [btn × 34px circle]
```

**Durata** `.duration-row`:
- Bottoni: padding 8px 14px, border 1.5px line, r-lg, 13px/700
- Stato ON: bg accent, colore on-accent, shadow-blue
- Preview: 12px/500/muted sotto i bottoni

**Mezzo di trasporto** `.modes`:
- Segmented: bg surface-2, p 4px, r-lg, gap 4px
- Ogni btn: flex colonna, icona 20px + label 11px/600
- Stato ON: bg bg, colore accent, shadow-sm

**Orario di partenza**:
- Label sezione: 11px/700/muted uppercase
- Chip orario: padding 10px 16px, border 1.5px line, r-lg
  - ON: border accent, bg accent-soft, colore accent-ink

**Switch "Ritorna al punto di partenza"** `.switch-row`:
- Sfondo surface, border line, r-lg, p 14px 15px
- Switch: 51×31px, bg line (ON: bg accent)
- Knob: 26×26px circle, bianco, shadow, translate 20px quando ON

**Tipo itinerario** (preset) `.preset-row`:
- 4 bottoni flex:1, flex colonna, icona 22px + label 12px/600
- Padding: 12px 8px, border 1.5px line, r-lg
- Hover: border accent, bg accent-soft, translateY(-1px)

**Categorie** `.cats`:
- Ogni `.cat-block`: divider top `line`
- `.cat-macro-row`: flex, align center
  - Toggle (flex:1): dot 10px + nome 15px/700 + contatore 11px/muted
  - Expand btn: 36×36px, r-sm, color muted → accent on hover
  - Dot stato ON: bg catcolor + glow
- `.cat-micros` (espanso): flex wrap, gap 8px, padding-bottom 14px
  - Chip: padding 8px 14px, border 1.5px line, bg bg, 13px/600
  - ON: bg catcolor, bianco, border catcolor

**Modalità Esplorazione** `.gem-toggle`:
- Sfondo gem-soft, border 1.5px `rgba(255,107,53,.25)`, r-lg
- Padding: 14px 16px
- Icona: 38×38px quadrato r-md, bg gem, bianco, 18px
- Titolo: 15px/600/gem-ink
- Sub: 12px/muted
- Pills (quando ON): 11px/700/gem-ink, bg gem-15%, border gem-30%, r-999px
- Switch a destra: stesse spec, ON: bg gem

---

### 5.4 Schermata DETTAGLIO POI

**Hero**:
- Larghezza 100%, altezza 240px, r-xl, bg-cover center
- Overlay: gradient to-top `rgba(0,0,0,.45)` → trasparente al 55%
- Btn back: 36×36px circle, top 12px left 12px, bg bianco/90, shadow-sm
- Badge gem: bottom 14px left 14px, bg gem, bianco, 12px/700, r-999px

**Dettaglio**:
- Titolo: 26px/750, margin-top 14px
- Pills: flex gap 8px, wrap — 12px/600/accent-ink, bg accent-soft, border, r-999px
- Indirizzo: 14px/500/ink-2, icona accent 16px
- Sezioni `.dsection`: border-top line, padding-top 16px
  - Titolo: 12px/700/muted uppercase, icona 16px accent
  - Body: 15px/1.7/ink-2

---

### 5.5 Schermata VIAGGI

**Lista viaggi**:
- `.trip-card`: flex, border line, r-lg, overflow hidden
- `.trip-main`: flex, gap 14px, p 14px, cursor pointer
  - Emoji: 28px
  - Nome: 16px/700/ink, ellipsis
  - Sub: 13px/500/muted, icona calendar accent
  - Date badge: 11.5px/600/muted
  - Chevron: 18px, line, margin-left auto
- `.trip-card-actions`: border-left line, bg surface, padding 6px 8px, flex colonna, gap 4px

**Bottoni azione** `.od-mini`:
- 34×34px, circle, border line, bg bg, colore accent
- Min tap area: 44×44px

---

### 5.6 Schermata TRIP (giorni)

**Sommario** `.trip-summary-bar`:
- Sfondo surface, border line, r-lg, p 12px 14px, shadow-xs
- 3 blocchi: [numero 24px/800/accent + label 11px/600/muted]
- Separatori: 1px × 32px, bg line, margin 0 8px

**Card giorno** `.day-card`:
- `.day-main`: flex, gap 14px, p 14px
  - Numero: 30×30px circle, bg accent, on-accent, 14px/800
  - Label: 16px/700/ink
  - Sub: 13px/500/muted + icona modo + tappe + km
  - Date badge: 11.5px/600/accent-ink, bg accent-soft, r-999px
  - Draft badge: 11px/600/muted opacity .7
- `.day-edit-hint`: inline-flex, 11.5px/700/accent, bg accent-soft, p 5px 11px, r-999px, margin-left auto
- Actions: border-left line, flex gap 4px, p 6px 8px

---

### 5.7 Navigazione Live

**Schermata NAV**:
- Bussola: 180×180px circle, bg accent-soft, border accent 2px, margin auto
- Freccia: 96px, colore accent, transizione rotate .3s
- Distanza big: 40px/800/ink
- Card target: flex, gap 12px, border line, r-lg, bg bg
  - Thumb: 52×52px, r-md, bg-cover
  - Nome: 16px/700, ellipsis
  - Story: 12px/muted, ellipsis
- Controlli: flex gap 10px, bottoni flex:1

---

## 6. COMPONENTI ATOMICI

### 6.1 Bottoni

| Variante | Sfondo | Testo | Border | Shadow |
|---|---|---|---|---|
| Primary | gradient accent→accent-dark | on-accent | — | shadow-blue |
| Outline | transparent | accent | 1.5px accent | — |
| Ghost | surface | muted | 1px line | — |
| Save | gradient accent-dark→accent | on-accent | — | shadow-blue |
| Danger | red | bianco | — | `0 4px 18px rgba(192,57,43,.28)` |

Padding standard: `14px 22px`, r-lg, font 15px/700  
Active: `transform scale(.97)`  
Full-width: `.btn-block { width: 100%; margin-top: 12px }`  
Sticky: `position: sticky; bottom: 0; z-index: 50`

### 6.2 Badge / Pill

| Tipo | Size | Bg | Colore | Border-radius |
|---|---|---|---|---|
| Categoria | 12px/600 | accent-soft | accent-ink | 999px |
| Orario open | 11px/700 | `#ECF6EC` | green | 999px |
| Orario closed | 11px/700 | `#FBEBE6` | red | 999px |
| Orario unknown | 11px/700 | surface | muted | 999px |
| Gem | 12px/700 | gem-soft | gem-ink | 999px |
| Count | 11px/800 | accent | on-accent | 999px, min 18px |

### 6.3 Toast

- Fixed bottom-center, z:1000
- BG: `ink`, colore: `bg`
- Padding: `11px 22px`, r-14px, 13px/600
- Shadow: shadow-lg
- Max-width: 88%
- Animazione: opacity + translateY in .2s

### 6.4 Modal / Bottom Sheet

- Backdrop: `rgba(0,0,0,.45)`, blur(2px)
- Sheet: max-width 480px, bg bg, r-xl, padding 22px 18px 18px
- Shadow: shadow-lg
- Animazione: `rise` — da `opacity:0, translateY(10px)` a visibile, .22s

### 6.5 Marker mappa

| Tipo | Size | Colore bg | Colore testo |
|---|---|---|---|
| Stop numerato | 32×32px circle | catcolor | bianco 12px/800 |
| Start | 32×32px | green | — |
| End | 32×32px | muted | — |
| Gem | 32×32px | gem | — |
| Focused | scale(1.45) | — | + ring bianco 4px + shadow |
| Posizione utente | 16×16px | accent | — |

### 6.6 Chip categoria

- Padding: `8px 14px`, r-999px
- Border: 1.5px line, bg bg, 13px/600/ink-2
- ON: bg catcolor, bianco, border catcolor, `shadow 0 2px 8px catcolor-40%`
- Hover: border catcolor, colore catcolor, bg catcolor-8%

---

## 7. ANIMAZIONI

| Nome | From | To | Durata | Easing |
|---|---|---|---|---|
| `rise` | opacity:0, translateY(10px) | opacity:1, translate(0) | 200ms | cubic-bezier(.4,0,.2,1) |
| `spin` | rotate(0) | rotate(360deg) | 800ms | linear, infinite |
| `pulse` (marker me) | box-shadow 0 | box-shadow 14px opacity:0 | 2s | ease, infinite |
| `pulse-dot` | shadow 0 | shadow 6px opacity:0 | 2s | ease, infinite |
| Transizioni UI | — | — | 180ms | cubic-bezier(.4,0,.2,1) |
| Switch knob | translateX(0) | translateX(20px) | 200ms | ease |
| Bottom sheet | rise | — | 220ms | ease |

---

## 8. FLUSSO SCHERMATE

```
[LOADING]
    │ posizione OK → genera → [ROUTE]
    │ posizione negata → [ROUTE empty state]
    
[ROUTE] ──────────────────────────────────────
  │ tap "Personalizza l'itinerario" → [HOME/PERSONALIZZA]
  │ tap tappa → seleziona → tap ancora → [DETAIL]
  │ tap "Avvia il giro" → [NAV]
  │ tap "Salvati" → [TRIPS]
  │ tap "Aggiungi a un viaggio" → modal
  
[HOME/PERSONALIZZA] ──────────────────────────
  │ tap "Crea/Aggiorna itinerario" → [ROUTE]
  │ tap × → [ROUTE]

[TRIPS] ──────────────────────────────────────
  │ tap viaggio → [TRIP]
  │ tap calendario → [CALENDAR]
  │ tap profilo agenzia → [SETTINGS]

[TRIP] ───────────────────────────────────────
  │ tap giorno → carica → [ROUTE]
  │ tap "Nuovo giorno" → [HOME]
  │ tap stampa → PDF

[NAV] ────────────────────────────────────────
  │ tap "Sono arrivato" → tappa successiva
  │ tap "Concludi" / esci → [ROUTE]
  
[DETAIL] ─────────────────────────────────────
  │ tap ← → [ROUTE]
```

---

## 9. GRID & BREAKPOINTS

- **Layout:** Single column, max-width 480px, centrato su desktop
- **Breakpoint mobile piccolo:** `< 360px`
  - H1 header: 20px (da 24px)
  - Foto timeline: 68×68px (da 84×84px)
  - Preset btn: 11px, padding ridotto
- **Breakpoint medio:** `< 400px`
  - OD bar sep: padding ridotto
- **Safe area:** `env(safe-area-inset-bottom)` su tutti i bottom sticky

---

## 10. ICONE

**Libreria:** [Tabler Icons](https://tabler.io/icons) (classe `ti ti-*`)

| Elemento | Icona |
|---|---|
| App logo | `ti-compass` |
| Modifica / filtri | `ti-adjustments-horizontal` |
| Viaggi | `ti-luggage` |
| Condividi | `ti-share-2` |
| A piedi | `ti-walk` |
| Bici | `ti-bike` |
| Auto | `ti-car` |
| Mezzi | `ti-bus` |
| Partenza | `ti-map-pin-filled` |
| Arrivo | `ti-flag-filled` |
| Orologio | `ti-clock-hour-4` |
| Dettagli | `ti-info-circle` |
| Sostituisci | `ti-refresh` |
| Salta | `ti-x` |
| Altro (menu) | `ti-dots` |
| Esplorazione | `ti-compass` |
| Stella consigliata | `ti-star-filled` (#F59E0B) |
| PDF | `ti-file-type-pdf` |
| Naviga | `ti-navigation` |
| Indirizzo | `ti-map-pin` |
| Wikipedia | `ti-brand-wikipedia` |
| Google Maps | `ti-brand-google-maps` |

**Dimensione default icona in testo:** `1.15em`, `vertical-align: -.13em`

---

## 11. STATO DARK MODE

Tutti i componenti supportano `prefers-color-scheme: dark` tramite i token CSS.  
Le variazioni principali:
- Card e surface diventano verde scuro (`#18211D`)
- Le ombre diventano nere opache
- Il vetro (glass) diventa `rgba(18,17,26,.82)`
- I badge open/closed hanno bg più scuri

---

*Fine documento — Itinera Design Spec v1.0*


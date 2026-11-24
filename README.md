# CZ Sutra Studio

App responsive (desktop e smartphone) per lo studio dei sutra su Cigno Zen.
Tutti i contenuti si gestiscono da WordPress: nessun file JSON da modificare a mano.

## Uso nella pagina

```
[cz-sutra-studio]
[cz-sutra-studio sutra="hannya-shingyo"]   ← apre direttamente un sutra
```

Link diretti: `…/studio-dei-sutra/#/hannya-shingyo/3` apre la scheda 3.

## Amministrazione — menu «Studio dei Sutra»

Ogni **Sutra** ha:

| Campo | Dove |
|---|---|
| Titolo (romaji) | titolo del post |
| Titolo originale (kanji), titolo tradotto | campi sotto il titolo |
| Introduzione | editor del contenuto |
| Raccolta (es. «Cerimonia del mattino») | riquadro *Raccolte*: raggruppa i sutra nella libreria |
| Ordine nella libreria | *Attributi → Ordine* |
| Audio (mp3/m4a) | riquadro *Audio e schede* → Libreria Media |
| Schede | riquadro *Audio e schede* |

Ogni **scheda** ha testo originale, romaji, traduzione, note e i margini audio
(inizio/fine). Fine vuota = fino all’inizio della scheda successiva.
Nei testi sono ammessi `<b> <i> <em> <strong> <mark> <ruby>/<rt>` (furigana) e gli a capo.
Il simbolo `◉` (campana) viene evidenziato.

### Definire i tempi in fretta

1. Incolla il testo con **Importa testo** (un paragrafo = una scheda; un campo alla volta).
2. Premi **Segna i tempi ascoltando**, avvia l’audio e tocca **Segna** (o il tasto **M**)
   a ogni confine: inizio scheda 1, poi fine 1 / inizio 2, … fino alla fine dell’ultima.
3. Ritocca con i pulsanti −/+ (0,1 s, con ascolto immediato), «ora», o cliccando sull’onda.

## App

- Libreria con raccolte, avanzamento e «Riprendi».
- Modalità **Schede** (swipe su mobile) e **Testo** completo sincronizzato con l’audio.
- Livelli attivabili: originale, romaji, traduzione, note. **Ripasso**: originale e romaji
  sfocati, tocca per rivelarli. Dimensione del testo regolabile.
- Player: play dall’inizio della scheda visualizzata, «Ripeti» (loop della scheda con breve pausa), velocità 0,6×–1,3×.
- Controlli dalla schermata di blocco e cuffie (Media Session), schermo attivo durante l’ascolto.
- Tastiera: spazio play/pausa, ←/→ schede, R ripetizione, T modalità, Esc libreria.
- Guida interattiva al primo accesso (libreria e primo sutra aperto), richiamabile dal pulsante **?**.
- Preferenze e avanzamento salvati nel browser di chi studia.

## Sviluppo

Nessuna build: `assets/app/app.js|css` (frontend), `assets/admin/editor.js|css` (editor).

REST in sola lettura: `GET /wp-json/cz-sutra-studio/v1/sutras`.

WP-CLI:

```
wp cz-sutra-studio import [--update]   # importa da cz-sutra-memorizer/data/sutras.json
wp cz-sutra-studio list
```

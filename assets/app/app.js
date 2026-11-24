/* CZ Sutra Studio — app frontend. Vanilla JS, nessuna build richiesta. */
(function () {
  'use strict';

  const host = document.getElementById('czss-app');
  if (!host) return;

  let cfg;
  try {
    cfg = JSON.parse(host.querySelector('.czss-config').textContent);
  } catch (e) {
    host.dataset.state = 'error';
    host.textContent = 'Impossibile avviare lo Studio dei Sutra.';
    return;
  }

  const sutras = Array.isArray(cfg.sutras) ? cfg.sutras : [];
  const bySlug = new Map(sutras.map((s) => [s.slug, s]));

  // ------------------------------------------------------------ memoria locale
  const STORE_KEY = cfg.storageKey || 'czss:v1';
  const defaults = {
    prefs: { layers: { original: true, romaji: true, translation: true, note: true }, mode: 'cards', speed: 1, loop: false, review: false, scale: 1 },
    progress: {},
    last: null,
    tours: {},
  };
  const store = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        return {
          prefs: { ...defaults.prefs, ...(raw.prefs || {}), layers: { ...defaults.prefs.layers, ...((raw.prefs || {}).layers || {}) } },
          progress: raw.progress || {},
          last: raw.last || null,
          tours: raw.tours || {},
        };
      }
    } catch (e) { /* storage non disponibile */ }
    return JSON.parse(JSON.stringify(defaults));
  })();
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignora */ }
    }, 150);
  }
  const prefs = store.prefs;

  // ------------------------------------------------------------ utilità
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
    prev: '<path d="M6 5v14" /><path d="M18 5.5v13L8.5 12z" fill="currentColor" stroke="none"/>',
    next: '<path d="M18 5v14" /><path d="M6 5.5v13l9.5-6.5z" fill="currentColor" stroke="none"/>',
    all: '<path d="M4 12h13"/><path d="M13 7l5 5-5 5"/>',
    one: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 014-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 01-4 4H4"/><path d="M11.5 10.5l1.5-1v5.5" />',
    single: '<path d="M5 12h9"/><path d="M10 7l5 5-5 5"/><path d="M19 6v12"/>',
    cards: '<rect x="4" y="5" width="13" height="15" rx="2"/><path d="M8 2h10a2 2 0 012 2v13"/>',
    text: '<path d="M5 6h14M5 10h14M5 14h14M5 18h9"/>',
    eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 014.8.9c0 1.7-2.4 2.2-2.4 3.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  };
  function icon(name, cls) {
    const span = document.createElement('span');
    span.className = 'czss-ic' + (cls ? ' ' + cls : '');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    return span;
  }

  function fmt(t) {
    if (t == null || !isFinite(t)) return '0:00';
    t = Math.max(0, t);
    return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  }

  // segni di campana/strumento usati nei testi (◉ ◎ ● ▲): evidenziati, forma invariata
  const rich = (s) => (s || '').replace(/[◉◎●▲]/g, (m) => '<span class="czss-bell" title="Segno di campana">' + m + '</span>');
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ stato
  // fromStart: sutra appena aperto sulla prima scheda → il play parte da 0:00
  // (introduzione compresa) invece che dal marker della scheda 1.
  const S = { sutra: null, cur: 0, dir: 0, fromStart: false };
  let libraryQuery = ''; // ricerca nella libreria, conservata tornando indietro da un sutra
  const audio = new Audio();
  audio.preload = 'metadata';
  let ui = {};

  function progressOf(slug) {
    if (!store.progress[slug]) store.progress[slug] = { card: 0, seen: [] };
    return store.progress[slug];
  }

  function duration() {
    if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return S.sutra?.audio?.duration || 0;
  }

  function segment(i) {
    const cards = S.sutra.cards;
    const c = cards[i];
    if (!c || c.start == null) return null;
    let end = c.end;
    if (end == null) {
      for (let j = i + 1; j < cards.length; j++) if (cards[j].start != null) { end = cards[j].start; break; }
    }
    return { start: c.start, end: end ?? (duration() || Infinity) };
  }

  function indexAt(t) {
    const cards = S.sutra.cards;
    for (let i = cards.length - 1; i >= 0; i--) {
      const seg = segment(i);
      if (seg && t >= seg.start - 0.01 && t < seg.end) return i;
    }
    return -1;
  }

  // ------------------------------------------------------------ routing (#/slug/n)
  function parseHash() {
    const m = location.hash.match(/^#\/([a-z0-9-]+)(?:\/(\d+))?/i);
    return m ? { slug: m[1], card: m[2] ? parseInt(m[2], 10) - 1 : null } : null;
  }

  function go(slug, card) {
    const target = slug ? '#/' + slug + (card != null ? '/' + (card + 1) : '') : '#/';
    if (location.hash !== target) location.hash = target;
    else route();
  }

  function route() {
    const r = parseHash();
    if (tour && (!r || !S.sutra || r.slug !== S.sutra.slug)) endTour(false);
    if (r && bySlug.has(r.slug)) {
      const s = bySlug.get(r.slug);
      const card = r.card != null ? r.card : progressOf(s.slug).card || 0;
      if (S.sutra !== s) openSutra(s, card);
      else if (card !== S.cur) setCur(clampCard(card), { user: true });
    } else {
      showLibrary();
    }
  }

  function clampCard(i) {
    return Math.min(Math.max(0, i | 0), Math.max(0, S.sutra.cards.length - 1));
  }

  function scrollAppIntoView() {
    const top = host.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      window.scrollTo({ top: window.scrollY + top - 16, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }

  // ------------------------------------------------------------ libreria
  function showLibrary() {
    if (S.sutra) {
      loopGap = false;
      clearTimeout(loopTimer);
      audio.pause();
      S.sutra = null;
    }
    host.dataset.view = 'library';
    ui.slot = null;
    host.style.removeProperty('--czss-scale');
    clearMediaSession();

    const groups = new Map();
    sutras.forEach((s) => {
      const key = s.group ? s.group.name : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });

    const last = store.last && bySlug.get(store.last);
    const resume = last && last.cards.length
      ? h('a', { class: 'czss-resume', href: '#/' + last.slug + '/' + ((progressOf(last.slug).card || 0) + 1) },
          h('span', { class: 'czss-resume__label', text: 'Riprendi' }),
          h('span', { class: 'czss-resume__title', text: last.title }),
          h('span', { class: 'czss-resume__meta', text: 'Scheda ' + ((progressOf(last.slug).card || 0) + 1) + ' di ' + last.cards.length }),
          icon('chevron', 'czss-resume__go'))
      : null;

    const list = h('div', { class: 'czss-library' });
    if (!sutras.length) {
      list.append(h('p', { class: 'czss-empty', text: 'Nessun sutra disponibile al momento.' }));
    }
    const sections = [];
    groups.forEach((items, name) => {
      const heading = name ? h('h2', { class: 'czss-group', text: name }) : null;
      const tiles = items.map((s) => ({ s, el: sutraTile(s) }));
      const shelf = h('ul', { class: 'czss-shelf', role: 'list' }, tiles.map((t) => t.el));
      sections.push({ heading, shelf, tiles });
      list.append(...[heading, shelf].filter(Boolean));
    });
    const noResults = h('p', { class: 'czss-empty', hidden: true });
    list.append(noResults);

    // ricerca: titolo, kanji, traduzione del titolo, raccolta e testo delle schede
    const status = h('span', { class: 'czss-visually-hidden', role: 'status', 'aria-live': 'polite' });
    const search = h('input', {
      type: 'search', class: 'czss-search__input', placeholder: 'Cerca un sutra o una frase…',
      'aria-label': 'Cerca tra i sutra', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
    });
    search.value = libraryQuery;
    const applyFilter = () => {
      libraryQuery = search.value;
      const q = norm(search.value.trim());
      let shown = 0;
      sections.forEach((sec) => {
        let n = 0;
        sec.tiles.forEach((t) => {
          const ok = !q || q.split(/\s+/).every((w) => searchIndex(t.s).includes(w));
          t.el.hidden = !ok;
          if (ok) n++;
        });
        sec.shelf.hidden = !n;
        if (sec.heading) sec.heading.hidden = !n;
        shown += n;
      });
      noResults.hidden = !!shown || !sutras.length;
      noResults.textContent = 'Nessun sutra trovato per “' + search.value.trim() + '”.';
      if (resume) resume.hidden = !!q;
      status.textContent = q ? shown + (shown === 1 ? ' sutra trovato' : ' sutra trovati') : '';
    };
    search.addEventListener('input', applyFilter);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; applyFilter(); }
      if (e.key === 'Enter') {
        const first = list.querySelector('li:not([hidden]) .czss-tile');
        if (first) { e.preventDefault(); first.click(); }
      }
    });
    const searchBox = h('label', { class: 'czss-search' }, icon('search'), search, status);

    host.replaceChildren(...[
      h('div', { class: 'czss-lib-head' },
        sutras.length > 1 ? searchBox : h('span', { class: 'czss-spacer' }),
        h('div', { class: 'czss-lib-actions' },
          h('button', { type: 'button', class: 'czss-admin-link czss-help', 'aria-label': 'Guida', onclick: () => startTour('library', true) }, icon('help'), h('span', { class: 'czss-admin-link__lbl', text: 'Guida' })),
          cfg.adminUrl ? h('a', { class: 'czss-admin-link', href: cfg.adminUrl, 'aria-label': 'Gestisci i sutra' }, icon('edit'), h('span', { class: 'czss-admin-link__lbl', text: 'Gestisci' })) : null)),
      resume,
      list,
    ].filter(Boolean));
    host.dataset.state = 'ready';
    if (libraryQuery) applyFilter();
    maybeTour('library');
  }

  // testo senza accenti/macron e in minuscolo, per una ricerca tollerante (kū → ku)
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, ' ').toLowerCase();
  const indexCache = new Map();
  function searchIndex(s) {
    if (!indexCache.has(s.slug)) {
      const parts = [s.title, s.titleOriginal, s.titleTranslation, s.group && s.group.name, s.slug.replace(/-/g, ' ')];
      s.cards.forEach((c) => parts.push(c.original, c.romaji, c.translation));
      indexCache.set(s.slug, norm(parts.join(' \n ')).replace(/\s+/g, ' '));
    }
    return indexCache.get(s.slug);
  }

  function sutraTile(s) {
    const p = progressOf(s.slug);
    const total = s.cards.length;
    const seen = total ? Math.min(total, (p.seen || []).filter((id) => s.cards.some((c) => c.id === id)).length) : 0;
    const dur = s.audio && s.audio.duration ? fmt(s.audio.duration) : null;
    const meta = [total + (total === 1 ? ' scheda' : ' schede'), dur].filter(Boolean).join(' · ');

    return h('li', null,
      h('a', { class: 'czss-tile', href: '#/' + s.slug },
        s.titleOriginal ? h('span', { class: 'czss-tile__jp', lang: 'ja', text: s.titleOriginal }) : null,
        h('span', { class: 'czss-tile__title', text: s.title }),
        s.titleTranslation ? h('span', { class: 'czss-tile__tr', text: s.titleTranslation }) : null,
        h('span', { class: 'czss-tile__meta' },
          h('span', { text: meta }),
          total > 1 ? h('span', { class: 'czss-tile__bar', role: 'progressbar', 'aria-label': 'Schede studiate', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(seen) },
            h('span', { style: 'width:' + Math.round((seen / total) * 100) + '%' })) : null),
        icon('chevron', 'czss-tile__go')));
  }

  // ------------------------------------------------------------ vista sutra
  function openSutra(s, card) {
    loopGap = false;
    clearTimeout(loopTimer);
    audio.pause();
    S.sutra = s;
    S.cur = 0;
    store.last = s.slug;
    save();

    if (s.audio) {
      audio.src = s.audio.url;
      audio.playbackRate = prefs.speed;
    } else {
      audio.removeAttribute('src');
    }

    S.fromStart = clampCard(card) === 0;
    host.dataset.view = 'sutra';
    renderSutra();
    setCur(clampCard(card), { user: true, initial: true });
    scrollAppIntoView();
    maybeTour('sutra');
  }

  function renderSutra() {
    const s = S.sutra;
    host.style.setProperty('--czss-scale', String(prefs.scale));

    const header = h('header', { class: 'czss-head' },
      h('a', { class: 'czss-back', href: '#/', 'aria-label': 'Torna alla libreria' }, icon('back'), h('span', { text: 'Libreria' })),
      h('div', { class: 'czss-head__titles' },
        s.titleOriginal ? h('p', { class: 'czss-head__jp', lang: 'ja', text: s.titleOriginal }) : null,
        h('h2', { class: 'czss-head__title', text: s.title }),
        s.titleTranslation ? h('p', { class: 'czss-head__tr', text: s.titleTranslation }) : null),
      h('div', { class: 'czss-head__actions' },
        s.editUrl ? h('a', { class: 'czss-edit', href: s.editUrl, title: 'Modifica in WordPress', 'aria-label': 'Modifica in WordPress' }, icon('edit')) : null,
        h('button', { type: 'button', class: 'czss-edit czss-help', title: 'Guida', 'aria-label': 'Mostra la guida', onclick: () => startTour('sutra', true) }, icon('help')))
    );

    const intro = s.description
      ? h('details', { class: 'czss-intro' }, h('summary', null, h('span', { text: 'Introduzione' })), h('div', { class: 'czss-intro__body', html: s.description }))
      : null;

    // barra strumenti: modalità + livelli
    const modeSwitch = h('div', { class: 'czss-seg', role: 'tablist', 'aria-label': 'Modalità di lettura' },
      [['cards', 'Schede'], ['text', 'Testo']].map(([m, label]) => h('button', {
        type: 'button', role: 'tab', class: 'czss-seg__btn', 'aria-selected': String(prefs.mode === m), 'data-mode': m,
        onclick: () => { if (prefs.mode !== m) { prefs.mode = m; save(); renderBody(); syncToolbar(); } },
      }, icon(m), h('span', { text: label }))));

    const layers = [['original', '原', 'Originale'], ['romaji', 'Rō', 'Romaji'], ['translation', 'It', 'Traduzione'], ['note', '注', 'Note']];
    const hasNotes = s.cards.some((c) => c.note);
    const chips = h('div', { class: 'czss-chips', role: 'group', 'aria-label': 'Livelli di testo' },
      layers.filter(([k]) => k !== 'note' || hasNotes).map(([k, glyph, label]) => h('button', {
        type: 'button', class: 'czss-chip', 'aria-pressed': String(!!prefs.layers[k]), 'data-layer': k,
        onclick: () => { prefs.layers[k] = !prefs.layers[k]; save(); syncToolbar(); },
      }, h('span', { class: 'czss-chip__glyph', lang: k === 'original' ? 'ja' : null, text: glyph }), h('span', { text: label }))),
      h('span', { class: 'czss-chips__sep', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'czss-chip czss-chip--review', 'aria-pressed': String(!!prefs.review), 'data-review': '',
        title: 'Nasconde originale e romaji: tocca il testo per rivelarlo',
        onclick: () => { prefs.review = !prefs.review; save(); syncToolbar(); if (prefs.review) toast('Tocca il testo sfocato per rivelarlo'); } }, icon('eye'), h('span', { text: 'Ripasso' })),
      h('span', { class: 'czss-size', role: 'group', 'aria-label': 'Dimensione del testo' },
        h('button', { type: 'button', class: 'czss-chip czss-chip--icon', 'aria-label': 'Testo più piccolo', onclick: () => setScale(-0.1), text: 'A−' }),
        h('button', { type: 'button', class: 'czss-chip czss-chip--icon', 'aria-label': 'Testo più grande', onclick: () => setScale(0.1), text: 'A+' }))
    );

    ui = {};
    ui.body = h('div', { class: 'czss-body' });
    ui.toolbar = h('div', { class: 'czss-toolbar' }, modeSwitch, chips);
    ui.player = s.audio ? buildPlayer() : h('p', { class: 'czss-noaudio', text: 'Questo sutra non ha ancora un audio associato.' });

    // Il player sta in uno "slot" alla fine dell'app: è fisso sullo schermo mentre si legge e,
    // arrivati in fondo al sutra, si aggancia allo slot (prima del footer) come farebbe "sticky".
    ui.slot = s.audio ? h('div', { class: 'czss-player-slot' }, ui.player) : null;
    host.replaceChildren(...[h('div', { class: 'czss-sutra' }, header, intro, ui.toolbar, ui.body), ui.slot || ui.player].filter(Boolean));
    requestAnimationFrame(dockPlayer);
    host.dataset.state = 'ready';
    syncToolbar();
    renderBody();
  }

  let dockRaf = 0;
  function dockPlayer() {
    dockRaf = 0;
    const slot = ui.slot;
    if (!slot || !slot.isConnected) return;
    // si misura solo da fisso, così lo slot ha esattamente l'altezza del player e il passaggio non salta
    if (!ui.player.classList.contains('is-docked') && ui.player.offsetHeight) slot.style.height = ui.player.offsetHeight + 'px';
    const docked = slot.getBoundingClientRect().bottom <= window.innerHeight + 1;
    ui.player.classList.toggle('is-docked', docked);
  }
  const scheduleDock = () => { if (!dockRaf) dockRaf = requestAnimationFrame(dockPlayer); };
  window.addEventListener('scroll', scheduleDock, { passive: true });
  window.addEventListener('resize', scheduleDock);

  function setScale(d) {
    prefs.scale = Math.round(Math.min(1.6, Math.max(0.8, prefs.scale + d)) * 10) / 10;
    host.style.setProperty('--czss-scale', String(prefs.scale));
    save();
  }

  function syncToolbar() {
    host.querySelectorAll('.czss-seg__btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === prefs.mode)));
    host.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(!!prefs.layers[b.dataset.layer])));
    host.querySelectorAll('[data-review]').forEach((b) => b.setAttribute('aria-pressed', String(!!prefs.review)));
    const cl = host.classList;
    Object.keys(prefs.layers).forEach((k) => cl.toggle('czss-hide-' + k, !prefs.layers[k]));
    cl.toggle('czss-review', !!prefs.review);
    host.dataset.mode = prefs.mode;
    updateDensity();
  }

  // righe compatte quando in un blocco resta visibile un solo livello di testo
  function updateDensity() {
    host.querySelectorAll('.czss-lines').forEach((el) => {
      const visible = (el.dataset.fields || '').split(' ').filter((f) => f && prefs.layers[f]);
      el.classList.toggle('is-dense', visible.length <= 1);
    });
  }

  // -- contenuto di una scheda
  const LINE_CLS = { original: 'czss-veil', romaji: 'czss-veil', translation: '', note: '' };
  const splitLines = (s) => (s ? s.replace(/\s+$/, '').split('\n') : []);

  /**
   * Contenuto di una scheda, riga per riga: ORIGINALE / romaji / traduzione.
   * Originale e romaji si abbinano per numero di riga; la traduzione si abbina solo
   * se ha lo stesso numero di righe, altrimenti compare in blocco sotto.
   */
  function cardContent(c) {
    const line = (key, text) => h('div', {
      class: 'czss-l czss-l--' + key + (LINE_CLS[key] ? ' ' + LINE_CLS[key] : ''),
      lang: key === 'original' ? 'ja' : null,
      html: rich(text),
    });
    const block = (key) => (c[key] ? line(key, c[key]) : null);

    const o = splitLines(c.original);
    const r = splitLines(c.romaji);
    const t = splitLines(c.translation);
    const n = Math.max(o.length, r.length);

    // originale e romaji non allineati: layout a blocchi
    if (!n || (o.length && r.length && o.length !== r.length)) {
      return [block('original'), block('romaji'), block('translation'), block('note')];
    }

    const tAligned = t.length === n;
    const groups = [];
    for (let i = 0; i < n; i++) {
      const parts = [
        o[i] && o[i].trim() ? line('original', o[i]) : null,
        r[i] && r[i].trim() ? line('romaji', r[i]) : null,
        tAligned && t[i] && t[i].trim() ? line('translation', t[i]) : null,
      ].filter(Boolean);
      groups.push(parts.length ? h('div', { class: 'czss-line' }, parts) : h('div', { class: 'czss-line czss-line--gap', 'aria-hidden': 'true' }));
    }
    const fields = [o.length && 'original', r.length && 'romaji', tAligned && t.length && 'translation'].filter(Boolean);
    return [
      h('div', { class: 'czss-lines', 'data-fields': fields.join(' ') }, groups),
      !tAligned && t.length ? h('div', { class: 'czss-l czss-l--translation czss-l--after', html: rich(c.translation) }) : null,
      block('note'),
    ];
  }

  function bindReveal(el) {
    el.addEventListener('click', (e) => {
      if (!host.classList.contains('czss-review')) return;
      const v = e.target.closest('.czss-veil');
      if (v) { v.classList.toggle('is-revealed'); e.stopPropagation(); }
    });
  }

  function renderBody() {
    const s = S.sutra;
    ui.body.replaceChildren();
    ui.stage = ui.dots = ui.counter = null;
    ui.verses = [];

    if (!s.cards.length) {
      ui.body.append(h('p', { class: 'czss-empty', text: 'Le schede di questo sutra non sono ancora pronte.' }));
      return;
    }

    if (prefs.mode === 'cards') {
      ui.counter = h('span', { class: 'czss-counter', 'aria-live': 'polite' });
      ui.dots = h('div', { class: 'czss-dots', role: 'tablist', 'aria-label': 'Schede' },
        s.cards.map((c, i) => h('button', { type: 'button', class: 'czss-dot', role: 'tab', 'aria-label': 'Scheda ' + (i + 1), onclick: () => setCur(i, { user: true }) })));
      ui.stage = h('div', { class: 'czss-stage' });
      const nav = (d, name, label) => h('button', { type: 'button', class: 'czss-nav czss-nav--' + name, 'aria-label': label, onclick: () => step(d) }, icon(d < 0 ? 'back' : 'chevron'));
      ui.prevBtn = nav(-1, 'prev', 'Scheda precedente');
      ui.nextBtn = nav(1, 'next', 'Scheda successiva');
      // append() nativo scriverebbe "null" come testo: si filtrano gli elementi assenti
      ui.body.append(...[
        s.cards.length > 1 ? h('div', { class: 'czss-cardbar' }, ui.dots, ui.counter) : null,
        h('div', { class: 'czss-stage-wrap' }, ui.prevBtn, ui.stage, ui.nextBtn),
      ].filter(Boolean));
      bindSwipe(ui.stage);
      bindReveal(ui.stage);
      renderStage();
    } else {
      const list = h('ol', { class: 'czss-verses' });
      s.cards.forEach((c, i) => {
        const seg = segment(i);
        const v = h('li', { class: 'czss-verse', 'data-i': String(i) },
          h('button', { type: 'button', class: 'czss-verse__num', 'aria-label': (seg ? 'Ascolta da qui, strofa ' : 'Strofa ') + (i + 1), onclick: (e) => { e.stopPropagation(); setCur(i, { user: true }); if (seg) play(); } }, String(i + 1)),
          h('div', { class: 'czss-verse__text' }, cardContent(c)));
        v.addEventListener('click', (e) => {
          if (host.classList.contains('czss-review') && e.target.closest('.czss-veil')) return;
          if (window.getSelection && String(window.getSelection()).length) return;
          setCur(i, { user: true });
        });
        ui.verses.push(v);
        list.append(v);
      });
      bindReveal(list);
      ui.body.append(list);
      updateDensity();
      markActiveVerse(true);
    }
  }

  function renderStage() {
    if (!ui.stage) return;
    const s = S.sutra;
    const c = s.cards[S.cur];
    const card = h('article', { class: 'czss-card', 'aria-roledescription': 'scheda', 'aria-label': 'Scheda ' + (S.cur + 1) + ' di ' + s.cards.length }, cardContent(c));
    if (S.dir && !reducedMotion) card.classList.add(S.dir > 0 ? 'czss-in-right' : 'czss-in-left');
    ui.stage.replaceChildren(card);
    updateDensity();
    ui.counter && (ui.counter.textContent = (S.cur + 1) + ' / ' + s.cards.length);
    ui.dots && Array.from(ui.dots.children).forEach((d, i) => {
      d.setAttribute('aria-selected', String(i === S.cur));
      d.classList.toggle('is-seen', (progressOf(s.slug).seen || []).includes(s.cards[i].id));
    });
    if (ui.prevBtn) ui.prevBtn.disabled = S.cur === 0;
    if (ui.nextBtn) ui.nextBtn.disabled = S.cur === s.cards.length - 1;
  }

  let userScrollAt = 0;
  ['wheel', 'touchmove', 'keydown'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (ev === 'keydown' && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) return;
    userScrollAt = Date.now();
  }, { passive: true }));

  function markActiveVerse(force) {
    if (!ui.verses || !ui.verses.length) return;
    ui.verses.forEach((v, i) => v.classList.toggle('is-active', i === S.cur));
    const el = ui.verses[S.cur];
    if (!el) return;
    const playing = !audio.paused;
    if ((playing && Date.now() - userScrollAt > 2500) || force === 'user') {
      const r = el.getBoundingClientRect();
      const playerH = ui.player ? ui.player.getBoundingClientRect().height : 0;
      const viewH = window.innerHeight - playerH;
      if (r.top < 70 || r.bottom > viewH - 20) {
        window.scrollTo({ top: window.scrollY + r.top - Math.max(80, (viewH - r.height) / 3), behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    }
  }

  // -- navigazione schede
  function setCur(i, opts) {
    opts = opts || {};
    const s = S.sutra;
    if (!s || !s.cards.length) return;
    i = clampCard(i);
    const changed = i !== S.cur || opts.initial;
    if (changed && !opts.initial) S.fromStart = false; // ci si è spostati: d'ora in poi valgono i marker
    S.dir = i > S.cur ? 1 : i < S.cur ? -1 : 0;
    S.cur = i;

    const p = progressOf(s.slug);
    p.card = i;
    const id = s.cards[i].id;
    if (!p.seen.includes(id)) p.seen.push(id);
    save();

    if (opts.user) {
      const seg = segment(i);
      if (seg && s.audio) {
        const t = audio.currentTime;
        if (opts.initial && S.fromStart) audio.currentTime = 0;
        else if (!audio.paused || t < seg.start || t >= seg.end || opts.initial) audio.currentTime = seg.start;
      }
      const target = '#/' + s.slug + '/' + (i + 1);
      if (location.hash !== target) history.replaceState(null, '', target);
    }

    if (changed) {
      if (prefs.mode === 'cards') renderStage();
      else markActiveVerse(opts.user ? 'user' : false);
      updateMediaSession();
    }
    updatePlayer();
  }

  function step(d) {
    if (!S.sutra) return;
    const n = S.cur + d;
    if (n < 0 || n >= S.sutra.cards.length) return;
    setCur(n, { user: true });
  }

  function bindSwipe(el) {
    let x0 = null, y0 = 0, t0 = 0, dx = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); dx = 0;
    });
    el.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) { x0 = null; el.style.transform = ''; return; }
      if (Math.abs(dx) > 8 && e.pointerType !== 'mouse') el.style.transform = 'translateX(' + dx * 0.35 + 'px)';
    });
    const end = () => {
      if (x0 == null) return;
      el.style.transform = '';
      const fast = Date.now() - t0 < 300 && Math.abs(dx) > 30;
      if (Math.abs(dx) > 60 || fast) step(dx < 0 ? 1 : -1);
      x0 = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { x0 = null; el.style.transform = ''; });
    el.addEventListener('pointerleave', end);
  }

  // ------------------------------------------------------------ player
  const LOOP_GAP_MS = 900; // pausa tra una ripetizione e l'altra
  const SPEEDS = [0.6, 0.75, 0.9, 1, 1.15, 1.3];

  function buildPlayer() {
    ui.time = h('span', { class: 'czss-p__time' });
    ui.total = h('span', { class: 'czss-p__time czss-p__time--total' });
    ui.fill = h('div', { class: 'czss-p__fill' });
    ui.segHi = h('div', { class: 'czss-p__seg' });
    ui.ticks = h('div', { class: 'czss-p__ticks' });
    ui.range = h('input', { type: 'range', class: 'czss-p__range', min: '0', max: '1000', step: '1', value: '0', 'aria-label': 'Posizione audio' });
    ui.range.addEventListener('input', () => {
      const t = (ui.range.value / 1000) * duration();
      audio.currentTime = t;
      const idx = indexAt(t);
      if (idx >= 0 && idx !== S.cur) setCur(idx);
      updatePlayer();
    });

    ui.play = h('button', { type: 'button', class: 'czss-p__btn czss-p__btn--play', 'aria-label': 'Riproduci', onclick: togglePlay }, icon('play'));
    ui.prev = h('button', { type: 'button', class: 'czss-p__btn', 'aria-label': 'Scheda precedente', onclick: () => step(-1) }, icon('prev'));
    ui.next = h('button', { type: 'button', class: 'czss-p__btn', 'aria-label': 'Scheda successiva', onclick: () => step(1) }, icon('next'));
    ui.repeat = h('button', { type: 'button', class: 'czss-p__btn czss-p__btn--opt', onclick: toggleLoop });
    ui.speed = h('button', { type: 'button', class: 'czss-p__btn czss-p__btn--opt', onclick: cycleSpeed });

    const bar = h('div', { class: 'czss-p__bar' }, ui.ticks, ui.segHi, ui.fill, ui.range);
    const player = h('div', { class: 'czss-player', role: 'region', 'aria-label': 'Lettore audio' },
      h('div', { class: 'czss-p__inner' },
        h('div', { class: 'czss-p__track' }, ui.time, bar, ui.total),
        h('div', { class: 'czss-p__controls' }, ui.speed, ui.prev, ui.play, ui.next, ui.repeat)));

    renderTicks();
    syncOptions();
    return player;
  }

  function renderTicks() {
    if (!ui.ticks) return;
    const dur = duration();
    ui.ticks.replaceChildren();
    if (!dur) return;
    S.sutra.cards.forEach((c, i) => {
      if (i === 0 || c.start == null) return;
      ui.ticks.append(h('span', { style: 'left:' + (c.start / dur) * 100 + '%' }));
    });
  }

  function syncOptions() {
    if (!ui.repeat) return;
    ui.repeat.replaceChildren(icon('one'), h('span', { class: 'czss-p__lbl', text: 'Ripeti' }));
    ui.repeat.setAttribute('aria-label', 'Ripeti la scheda');
    ui.repeat.setAttribute('aria-pressed', String(!!prefs.loop));
    ui.repeat.classList.toggle('is-on', !!prefs.loop);
    ui.speed.replaceChildren(h('span', { class: 'czss-p__speed', text: String(prefs.speed).replace('.', ',') + '×' }), h('span', { class: 'czss-p__lbl', text: 'Velocità' }));
    ui.speed.setAttribute('aria-label', 'Velocità ' + prefs.speed + '. Tocca per cambiare');
    ui.speed.classList.toggle('is-on', prefs.speed !== 1);
  }

  function toggleLoop() {
    prefs.loop = !prefs.loop;
    save();
    syncOptions();
    toast(prefs.loop ? 'Ripeti la scheda ' + (S.cur + 1) : 'Riproduzione continua');
  }

  function cycleSpeed() {
    const i = SPEEDS.indexOf(prefs.speed);
    prefs.speed = SPEEDS[(i + 1) % SPEEDS.length] || 1;
    audio.playbackRate = prefs.speed;
    save();
    syncOptions();
  }

  function play() {
    if (!S.sutra || !S.sutra.audio) return;
    const seg = segment(S.cur);
    const t = audio.currentTime;
    // appena aperto, sulla prima scheda e senza "Ripeti": si ascolta anche l'introduzione
    const intro = S.fromStart && S.cur === 0 && !prefs.loop;
    if (seg && intro) {
      if (t >= seg.end - 0.05) audio.currentTime = 0;
    } else if (seg && (t < seg.start - 0.05 || t >= seg.end - 0.05)) {
      audio.currentTime = seg.start;
    }
    audio.playbackRate = prefs.speed;
    const p = audio.play();
    if (p && p.catch) p.catch(() => toast('Tocca di nuovo ▶ per avviare l’audio'));
  }

  function togglePlay() {
    if (loopGap) {
      // pausa premuta durante l'intervallo tra due ripetizioni
      loopGap = false;
      clearTimeout(loopTimer);
      wake(false);
      setPlaybackState();
      updatePlayer();
      return;
    }
    if (audio.paused) play(); else audio.pause();
  }

  function updatePlayer() {
    if (!ui.play || !S.sutra || !S.sutra.audio) return;
    const dur = duration();
    const t = audio.currentTime || 0;
    const pct = dur ? (t / dur) * 100 : 0;
    ui.fill.style.width = pct + '%';
    if (document.activeElement !== ui.range) ui.range.value = String(Math.round(pct * 10));
    ui.range.setAttribute('aria-valuetext', fmt(t) + ' di ' + fmt(dur));
    ui.time.textContent = fmt(t);
    ui.total.textContent = fmt(dur);
    const seg = segment(S.cur);
    if (seg && dur) {
      ui.segHi.style.left = (seg.start / dur) * 100 + '%';
      ui.segHi.style.width = ((Math.min(seg.end, dur) - seg.start) / dur) * 100 + '%';
      ui.segHi.hidden = false;
    } else {
      ui.segHi.hidden = true;
    }
    const playing = !audio.paused || loopGap;
    // Aggiorna l'icona solo quando cambia stato: ricrearla a ogni fotogramma
    // faceva perdere i tocchi sul pulsante (la pausa "non funzionava").
    if (ui.playState !== playing) {
      ui.playState = playing;
      ui.play.replaceChildren(icon(playing ? 'pause' : 'play'));
      ui.play.setAttribute('aria-label', playing ? 'Pausa' : 'Riproduci');
      host.classList.toggle('is-playing', playing);
    }
    if (ui.prev) ui.prev.disabled = S.cur === 0;
    if (ui.next) ui.next.disabled = S.cur === S.sutra.cards.length - 1;
  }

  let raf = 0;
  let loopGap = false;
  let loopTimer = 0;
  function tick() {
    raf = 0;
    if (!S.sutra || audio.paused) return;
    const t = audio.currentTime;
    const seg = segment(S.cur);
    if (seg && prefs.loop && t >= seg.end - 0.03) {
      // fine della scheda: breve pausa e si ricomincia dall'inizio della stessa scheda
      loopGap = true;
      audio.pause();
      audio.currentTime = seg.start;
      clearTimeout(loopTimer);
      loopTimer = setTimeout(() => {
        if (loopGap && prefs.loop && S.sutra) play();
        loopGap = false;
      }, LOOP_GAP_MS);
      return;
    } else {
      const idx = indexAt(t);
      if (idx >= 0 && idx !== S.cur) setCur(idx);
    }
    updatePlayer();
    raf = requestAnimationFrame(tick);
  }

  audio.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); updatePlayer(); wake(true); setPlaybackState(); });
  audio.addEventListener('pause', () => { updatePlayer(); if (!loopGap) { wake(false); setPlaybackState(); } });
  audio.addEventListener('ended', () => { updatePlayer(); wake(false); });
  audio.addEventListener('loadedmetadata', () => { renderTicks(); updatePlayer(); });
  audio.addEventListener('timeupdate', () => { if (audio.paused) updatePlayer(); });

  // -- schermo sempre acceso durante l'ascolto
  let wakeLock = null;
  async function wake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !audio.paused) wake(true); });

  // -- controlli dalla schermata di blocco / cuffie
  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !S.sutra || !S.sutra.audio) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: S.sutra.title + ' · ' + (S.cur + 1) + '/' + S.sutra.cards.length,
        artist: cfg.siteName || 'Studio dei Sutra',
        album: S.sutra.titleOriginal || 'Studio dei Sutra',
        artwork: cfg.artwork ? [{ src: cfg.artwork, sizes: '512x512' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', () => { if (!audio.paused || loopGap) togglePlay(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    } catch (e) { /* non supportato */ }
  }
  function setPlaybackState() {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused && !loopGap ? 'paused' : 'playing';
  }
  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.metadata = null; } catch (e) { /* ignora */ }
  }

  // -- avvisi brevi
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = h('div', { class: 'czss-toast', role: 'status', 'aria-live': 'polite' });
      host.append(toastEl);
    }
    if (!toastEl.isConnected) host.append(toastEl);
    toastEl.textContent = msg;
    toastEl.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-shown'), 1600);
  }

  // ------------------------------------------------------------ guida al primo accesso
  const TOURS = {
    library: [
      { title: 'Benvenuto nello Studio dei Sutra',
        text: 'Qui puoi ascoltare, leggere e memorizzare i sutra della liturgia, una strofa alla volta. Ti mostriamo in pochi passi come funziona.' },
      { target: '.czss-search', title: 'Cerca',
        text: 'Trova un sutra per titolo, kanji o anche da una frase del testo: per esempio “shiki soku ze ku”. Accenti e lineette sulle vocali non contano.' },
      { target: '.czss-tile', title: 'Scegli un sutra',
        text: 'Ogni sutra ha l’audio e il testo diviso in schede: originale, romaji e traduzione. La barretta indica quante schede hai già studiato.' },
      { target: '.czss-lib-head .czss-help', title: 'La guida è sempre qui',
        text: 'Puoi rivedere questa presentazione quando vuoi. Ora apri un sutra: ti mostreremo gli strumenti di studio.' },
    ],
    sutra: [
      { target: '.czss-stage, .czss-verses', title: 'Una strofa per scheda',
        text: 'Ogni scheda è una strofa del sutra. Sullo smartphone scorri col dito a destra o a sinistra per cambiarla; dal computer puoi usare le frecce ← →.' },
      { target: '.czss-dots', title: 'Dove sei',
        text: 'Ogni segmento è una scheda: toccalo per saltarci. Quelli più chiari sono le schede che hai già visto.' },
      { target: '.czss-seg', title: 'Schede o testo completo',
        text: 'In “Testo” vedi l’intero sutra: durante l’ascolto la strofa recitata si evidenzia e la pagina la segue. Tocca una strofa per ascoltarla.' },
      { target: '.czss-chips', title: 'Scegli cosa vedere',
        text: 'Mostra o nascondi originale, romaji, traduzione e note. Con “Ripasso” originale e romaji si sfocano: recitali a memoria, poi tocca il testo per controllare. A− / A+ cambiano la dimensione del testo.' },
      { target: '.czss-p__btn--play', title: 'Ascolta dalla scheda',
        text: 'Appena apri un sutra, il play parte dall’inizio dell’audio, introduzione compresa. Quando ti sposti tra le schede, parte dall’inizio della scheda che stai guardando e prosegue con le successive.' },
      { target: '.czss-p__btn--opt:last-child', title: 'Ripeti questa scheda',
        text: 'Con “Ripeti” acceso, la scheda che stai guardando viene riascoltata in loop, con una breve pausa tra una ripetizione e l’altra per recitare insieme all’audio. Se cambi scheda, il loop passa alla nuova. Toccalo di nuovo per tornare all’ascolto continuo (da tastiera: R).' },
      { target: '.czss-p__btn--opt:first-child', title: 'Velocità',
        text: 'Rallenta l’audio per imparare la pronuncia: ogni tocco passa alla velocità successiva, da 0,6× a 1,3×.' },
      { target: '.czss-head .czss-help', title: 'Buono studio',
        text: 'Preferenze e progressi restano salvati su questo dispositivo. Puoi rivedere la guida da qui in qualunque momento.' },
    ],
  };

  let tour = null;

  function maybeTour(name) {
    if (store.tours[name]) return;
    setTimeout(() => {
      // la vista potrebbe essere cambiata nel frattempo
      if ((name === 'sutra') !== !!S.sutra || tour) return;
      startTour(name, false);
    }, 450);
  }

  function visibleTarget(sel) {
    if (!sel) return null;
    for (const s of sel.split(',')) {
      const el = host.querySelector(s.trim());
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  }

  function startTour(name, manual) {
    endTour(false);
    const steps = TOURS[name].filter((st) => !st.target || visibleTarget(st.target));
    if (!steps.length) return;
    if (!audio.paused) audio.pause();

    const spot = h('div', { class: 'czss-tour__spot', 'aria-hidden': 'true' });
    const shield = h('div', { class: 'czss-tour__shield', 'aria-hidden': 'true' });
    const titleId = 'czss-tour-title';
    const pop = h('div', { class: 'czss-tour__pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
    const layer = h('div', { class: 'czss-tour' }, shield, spot, pop);
    host.append(layer);

    tour = { name, steps, i: 0, layer, spot, pop, shield, titleId, manual, raf: 0, prevFocus: document.activeElement };
    shield.addEventListener('click', () => pop.querySelector('.czss-tour__next')?.focus());
    window.addEventListener('scroll', schedulePlace, { passive: true });
    window.addEventListener('resize', schedulePlace);
    showStep(0);
  }

  function showStep(i) {
    if (!tour) return;
    tour.i = i;
    const st = tour.steps[i];
    const last = i === tour.steps.length - 1;
    const target = visibleTarget(st.target);

    tour.pop.replaceChildren(
      h('button', { type: 'button', class: 'czss-tour__x', 'aria-label': 'Chiudi la guida', onclick: () => endTour(true) }, icon('close')),
      h('p', { class: 'czss-tour__step', text: (i + 1) + ' di ' + tour.steps.length }),
      h('h3', { class: 'czss-tour__title', id: tour.titleId, text: st.title }),
      h('p', { class: 'czss-tour__text', text: st.text }),
      h('div', { class: 'czss-tour__foot' },
        h('span', { class: 'czss-tour__dots', 'aria-hidden': 'true' }, tour.steps.map((_, j) => h('span', { class: j === i ? 'is-on' : null }))),
        i > 0 ? h('button', { type: 'button', class: 'czss-tour__btn', onclick: () => showStep(i - 1), text: 'Indietro' }) : h('button', { type: 'button', class: 'czss-tour__btn', onclick: () => endTour(true), text: 'Salta' }),
        h('button', { type: 'button', class: 'czss-tour__btn czss-tour__btn--primary czss-tour__next', onclick: () => (last ? endTour(true) : showStep(i + 1)), text: last ? (tour.name === 'library' ? 'Ho capito' : 'Inizia') : 'Avanti' }))
    );

    tour.layer.classList.toggle('is-centered', !target);
    if (target) {
      const r = target.getBoundingClientRect();
      const playerH = ui.player && ui.player.isConnected && !ui.player.contains(target) ? ui.player.getBoundingClientRect().height : 0;
      if (r.top < 60 || r.bottom > window.innerHeight - playerH - 20) {
        const y = window.scrollY + r.top - Math.max(70, (window.innerHeight - playerH - Math.min(r.height, window.innerHeight * 0.5)) / 2.6);
        window.scrollTo({ top: y, behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    }
    tour.target = target;
    place();
    setTimeout(place, 380);
    tour.pop.querySelector('.czss-tour__next').focus({ preventScroll: true });
  }

  function schedulePlace() {
    if (!tour || tour.raf) return;
    tour.raf = requestAnimationFrame(() => { if (tour) { tour.raf = 0; place(); } });
  }

  function place() {
    if (!tour) return;
    const { pop, spot, target } = tour;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const margin = 12;
    const w = Math.min(360, vw - margin * 2);
    pop.style.width = w + 'px';

    if (!target || !target.isConnected) {
      spot.style.opacity = '0';
      pop.style.left = (vw - w) / 2 + 'px';
      pop.style.top = Math.max(margin, (vh - pop.offsetHeight) / 2) + 'px';
      pop.dataset.side = 'none';
      return;
    }

    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.style.opacity = '1';
    spot.style.left = r.left - pad + 'px';
    spot.style.top = r.top - pad + 'px';
    spot.style.width = r.width + pad * 2 + 'px';
    spot.style.height = r.height + pad * 2 + 'px';
    const br = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
    spot.style.borderRadius = br >= Math.min(r.width, r.height) / 2 - 1 ? '999px' : Math.max(10, br + pad) + 'px';

    const ph = pop.offsetHeight;
    const below = vh - r.bottom - pad;
    const above = r.top - pad;
    let side, top;
    if (below >= ph + 18) { side = 'bottom'; top = r.bottom + pad + 12; }
    else if (above >= ph + 18) { side = 'top'; top = r.top - pad - 12 - ph; }
    else { side = 'none'; top = below > above ? vh - ph - margin : margin; }

    const cx = r.left + r.width / 2;
    const left = Math.min(Math.max(margin, cx - w / 2), vw - w - margin);
    pop.style.left = left + 'px';
    pop.style.top = Math.max(margin, top) + 'px';
    pop.dataset.side = side;
    pop.style.setProperty('--czss-arrow-x', Math.min(Math.max(20, cx - left), w - 20) + 'px');
  }

  function endTour(markDone) {
    if (!tour) return;
    if (markDone) {
      store.tours[tour.name] = true;
      save();
    }
    const prev = tour.prevFocus;
    cancelAnimationFrame(tour.raf);
    tour.layer.remove();
    window.removeEventListener('scroll', schedulePlace);
    window.removeEventListener('resize', schedulePlace);
    tour = null;
    if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
  }

  document.addEventListener('keydown', (e) => {
    if (!tour) return;
    if (e.key === 'Escape') { e.preventDefault(); endTour(true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tour.pop.querySelector('.czss-tour__next').click(); }
    else if (e.key === 'ArrowLeft' && tour.i > 0) { e.preventDefault(); showStep(tour.i - 1); }
    else if (e.key === 'Tab') {
      const f = Array.from(tour.pop.querySelectorAll('button'));
      const idx = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(idx + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
    e.stopImmediatePropagation();
  }, true);

  // ------------------------------------------------------------ tastiera
  document.addEventListener('keydown', (e) => {
    if (tour || !S.sutra || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'range' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (t && t.tagName === 'INPUT' && t.type === 'range' && e.key.startsWith('Arrow')) return;
    switch (e.key) {
      case ' ':
      case 'k':
        if (t && t.tagName === 'BUTTON' && e.key === ' ') return;
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight': case 'j': e.preventDefault(); step(1); break;
      case 'ArrowLeft': case 'h': e.preventDefault(); step(-1); break;
      case 'r': toggleLoop(); break;
      case 't': prefs.mode = prefs.mode === 'cards' ? 'text' : 'cards'; save(); syncToolbar(); renderBody(); break;
      case 'Escape': if (location.hash.length > 2) go(null); break;
    }
  });

  // ------------------------------------------------------------ avvio
  window.addEventListener('hashchange', route);
  if (!parseHash() && cfg.initial && bySlug.has(cfg.initial)) {
    history.replaceState(null, '', '#/' + cfg.initial);
  }
  route();
})();

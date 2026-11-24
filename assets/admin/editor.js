/* CZ Sutra Studio — editor delle schede (amministrazione). Nessuna build richiesta. */
(function ($) {
  'use strict';

  const root = document.getElementById('czss-editor');
  const cardsInput = document.getElementById('czss-cards-json');
  const audioInput = document.getElementById('czss-audio-id');
  if (!root || !cardsInput || !audioInput) return;

  // ---------------------------------------------------------------- utilità
  const FIELDS = [
    { key: 'original', label: 'Testo originale', hint: 'kanji', cjk: true, rows: 4 },
    { key: 'romaji', label: 'Romaji', hint: 'pronuncia', rows: 4 },
    { key: 'translation', label: 'Traduzione', hint: 'italiano', rows: 4 },
    { key: 'note', label: 'Note', hint: 'commento, opzionale', rows: 3 },
  ];

  const uid = () => 'c' + Math.random().toString(36).slice(2, 10);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function fmt(t, precise) {
    if (t == null || !isFinite(t)) return '—';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const ss = precise ? s.toFixed(2).padStart(5, '0') : String(Math.floor(s)).padStart(2, '0');
    return m + ':' + ss;
  }

  function parseTime(v) {
    if (typeof v === 'number') return v >= 0 ? Math.round(v * 1000) / 1000 : null;
    if (typeof v !== 'string') return null;
    v = v.trim().replace(',', '.');
    if (!v) return null;
    if (/^\d+(\.\d+)?$/.test(v)) return Math.round(parseFloat(v) * 1000) / 1000;
    const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    if (!m) return undefined; // non valido
    return Math.round(((+m[1] || 0) * 3600 + +m[2] * 60 + parseFloat(m[3])) * 1000) / 1000;
  }

  // righe per campo: nell'app originale, romaji e traduzione si abbinano riga per riga
  const countLines = (s) => (s && s.trim() ? s.replace(/\s+$/, '').split('\n').length : 0);
  function alignInfo(card) {
    const o = countLines(card.original), r = countLines(card.romaji), t = countLines(card.translation);
    const n = Math.max(o, r);
    const parts = [['originale', o], ['romaji', r], ['traduzione', t]].filter(([, v]) => v).map(([k, v]) => k + ' ' + v);
    if (!parts.length) return { level: 'none', text: '' };
    if (o && r && o !== r) {
      return { level: 'warn', text: 'Righe: ' + parts.join(' · ') + '. Originale e romaji hanno un numero di righe diverso: nell’app la scheda sarà mostrata a blocchi, non riga per riga.' };
    }
    if (t && t !== n) {
      return { level: 'warn', text: 'Righe: ' + parts.join(' · ') + '. La traduzione ha un numero di righe diverso: nell’app comparirà in blocco sotto la strofa. Per abbinarla riga per riga, vai a capo negli stessi punti.' };
    }
    return { level: 'ok', text: 'Righe allineate (' + parts.join(' · ') + '): nell’app ogni riga mostra originale, romaji e traduzione insieme.' };
  }

  const firstLine = (s) => (s || '').replace(/<[^>]+>/g, '').split('\n').find((l) => l.trim()) || '';

  // ---------------------------------------------------------------- stato
  let cards = [];
  try {
    cards = JSON.parse(cardsInput.value || '[]') || [];
  } catch (e) {
    cards = [];
  }
  cards = cards.map((c) => ({
    id: c.id || uid(),
    original: c.original || '',
    romaji: c.romaji || '',
    translation: c.translation || '',
    note: c.note || '',
    start: c.start ?? null,
    end: c.end ?? null,
  }));

  let audioInfo = null;
  try {
    audioInfo = JSON.parse(root.dataset.audio || 'null');
  } catch (e) {
    audioInfo = null;
  }

  const ui = {
    open: new Set(cards.length <= 3 ? cards.map((c) => c.id) : []),
    selected: cards[0]?.id || null,
    zoom: 1,
    peaks: null,
    tap: { active: false, boundary: 0, history: [] },
    segmentStop: null,
    loopCard: null,
  };

  let dirty = false;
  function commit() {
    cardsInput.value = JSON.stringify(cards);
    dirty = true;
    drawWave();
  }

  // ---------------------------------------------------------------- audio
  const audio = new Audio();
  audio.preload = 'metadata';

  function duration() {
    return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audioInfo?.duration || 0;
  }

  function setAudio(info) {
    audioInfo = info;
    audioInput.value = info ? info.id : '';
    ui.peaks = null;
    dirty = true;
    audio.pause();
    if (info) {
      audio.src = info.url;
    } else {
      audio.removeAttribute('src');
      audio.load();
    }
    renderAudio();
    renderCards();
  }

  function playRange(start, end, loop) {
    if (!audioInfo) return;
    audio.currentTime = start || 0;
    ui.segmentStop = end != null ? { start: start || 0, end, loop: !!loop } : null;
    audio.play();
  }

  function tick() {
    if (ui.segmentStop && audio.currentTime >= ui.segmentStop.end) {
      if (ui.segmentStop.loop) {
        audio.currentTime = ui.segmentStop.start;
      } else {
        audio.pause();
        audio.currentTime = ui.segmentStop.end;
        ui.segmentStop = null;
      }
    }
    updateTransport();
    if (!audio.paused) requestAnimationFrame(tick);
  }

  audio.addEventListener('play', () => requestAnimationFrame(tick));
  audio.addEventListener('pause', updateTransport);
  audio.addEventListener('loadedmetadata', () => {
    renderAudioMeta();
    drawWave();
  });
  audio.addEventListener('seeked', updateTransport);

  async function loadPeaks(url) {
    const wrap = root.querySelector('.czss-wave');
    if (wrap) wrap.classList.add('is-loading');
    try {
      const buf = await (await fetch(url, { credentials: 'same-origin' })).arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const decoded = await ctx.decodeAudioData(buf);
      ctx.close && ctx.close();
      const data = decoded.getChannelData(0);
      const buckets = 4000;
      const size = Math.floor(data.length / buckets) || 1;
      const peaks = new Float32Array(buckets);
      let max = 0;
      for (let i = 0; i < buckets; i++) {
        let peak = 0;
        const from = i * size;
        for (let j = from; j < from + size && j < data.length; j += 4) {
          const v = Math.abs(data[j]);
          if (v > peak) peak = v;
        }
        peaks[i] = peak;
        if (peak > max) max = peak;
      }
      if (max > 0) for (let i = 0; i < buckets; i++) peaks[i] /= max;
      ui.peaks = peaks;
    } catch (e) {
      ui.peaks = null;
    }
    const w = root.querySelector('.czss-wave');
    if (w) w.classList.remove('is-loading');
    drawWave();
  }

  // ---------------------------------------------------------------- waveform
  let canvas, scroller, playhead;

  function cssVar(name, fallback) {
    return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
  }

  function drawWave() {
    if (!canvas || !scroller) return;
    const dur = duration();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(scroller.clientWidth * ui.zoom, 300);
    const height = 120;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);

    const top = 22;
    const waveH = height - top - 4;
    const mid = top + waveH / 2;

    // segmenti
    if (dur > 0) {
      cards.forEach((c, i) => {
        if (c.start == null) return;
        const next = cards.slice(i + 1).find((n) => n.start != null);
        const end = c.end ?? next?.start ?? dur;
        const x1 = (c.start / dur) * width;
        const x2 = (end / dur) * width;
        const sel = c.id === ui.selected;
        g.fillStyle = sel ? 'rgba(34, 113, 177, 0.20)' : i % 2 ? 'rgba(140, 140, 140, 0.10)' : 'rgba(140, 140, 140, 0.18)';
        g.fillRect(x1, top, Math.max(1, x2 - x1), waveH);
        g.fillStyle = sel ? '#2271b1' : '#8c8f94';
        g.fillRect(x1, 0, 1.5, height);
        g.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        g.fillText(String(i + 1), x1 + 4, 14);
      });
    }

    // onda
    g.fillStyle = cssVar('--czss-wave', '#50575e');
    if (ui.peaks) {
      const n = ui.peaks.length;
      const step = width / n;
      const barW = Math.max(1, step * 0.8);
      for (let i = 0; i < n; i++) {
        const v = Math.max(0.02, ui.peaks[i]) * (waveH / 2);
        g.fillRect(i * step, mid - v, barW, v * 2);
      }
    } else {
      g.fillRect(0, mid - 1, width, 2);
    }

    updateTransport();
  }

  function waveTime(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    return Math.min(Math.max(x, 0), 1) * duration();
  }

  // ---------------------------------------------------------------- render: audio
  const audioBox = h('div', { class: 'czss-audio' });
  const cardsBox = h('div', { class: 'czss-cards' });
  root.replaceChildren(audioBox, cardsBox);

  let timeEl, playBtn, tapPanel;

  function openMediaFrame() {
    const frame = wp.media({
      title: 'Audio del sutra',
      button: { text: 'Usa questo audio' },
      library: { type: 'audio' },
      multiple: false,
    });
    frame.on('select', () => {
      const a = frame.state().get('selection').first().toJSON();
      const len = a.fileLength ? parseTime(a.fileLength) : null;
      const vbr = a.mime === 'audio/mpeg' && !!(a.meta && a.meta.bitrate_mode === 'vbr');
      setAudio({ id: a.id, url: a.url, duration: len ?? null, title: a.title, mime: a.mime, vbr });
    });
    frame.open();
  }

  function renderAudioMeta() {
    const meta = audioBox.querySelector('.czss-audio__meta');
    if (meta && audioInfo) meta.textContent = (audioInfo.title || audioInfo.url.split('/').pop()) + ' · ' + fmt(duration());
  }

  function renderAudio() {
    audioBox.replaceChildren();
    canvas = scroller = playhead = timeEl = playBtn = tapPanel = null;

    if (!audioInfo) {
      audioBox.append(
        h('div', { class: 'czss-audio__empty' },
          h('span', { class: 'dashicons dashicons-format-audio' }),
          h('div', null,
            h('strong', { text: 'Nessun audio associato' }),
            h('p', { text: 'Carica un file mp3 (o m4a) nella Libreria Media: potrai poi definire per ogni scheda l’inizio e la fine del segmento audio.' })),
          h('button', { type: 'button', class: 'button button-primary', onclick: openMediaFrame, text: 'Scegli o carica audio' })
        )
      );
      return;
    }

    playBtn = h('button', { type: 'button', class: 'czss-btn czss-btn--play', 'aria-label': 'Riproduci / pausa', onclick: () => {
      ui.segmentStop = null;
      audio.paused ? audio.play() : audio.pause();
    } });
    timeEl = h('span', { class: 'czss-time' });

    const nudge = (d) => h('button', { type: 'button', class: 'czss-btn czss-btn--ghost', onclick: () => { audio.currentTime = Math.max(0, audio.currentTime + d); }, text: (d > 0 ? '+' : '−') + Math.abs(d) + 's' });

    const speed = h('select', { class: 'czss-select', 'aria-label': 'Velocità', onchange: (e) => { audio.playbackRate = parseFloat(e.target.value); } },
      ['0.5', '0.75', '1', '1.25'].map((v) => h('option', { value: v, selected: v === '1' ? true : null, text: v + '×' })));

    const zoom = h('label', { class: 'czss-zoom' }, 'Zoom ',
      h('input', { type: 'range', min: '1', max: '12', step: '1', value: String(ui.zoom), oninput: (e) => {
        const t = audio.currentTime / (duration() || 1);
        ui.zoom = +e.target.value;
        drawWave();
        scroller.scrollLeft = t * scroller.scrollWidth - scroller.clientWidth / 2;
      } }));

    canvas = h('canvas', { class: 'czss-wave__canvas' });
    playhead = h('div', { class: 'czss-wave__playhead' });
    scroller = h('div', { class: 'czss-wave__scroll' }, h('div', { class: 'czss-wave__inner' }, canvas, playhead));
    canvas.addEventListener('click', (ev) => {
      const t = waveTime(ev);
      audio.currentTime = t;
      const idx = cardIndexAt(t);
      if (idx >= 0) select(cards[idx].id, false);
    });

    tapPanel = h('div', { class: 'czss-tap' });

    // filter(Boolean): append() nativo scriverebbe "null" come testo
    audioBox.append(...[
      h('div', { class: 'czss-audio__head' },
        h('span', { class: 'dashicons dashicons-format-audio' }),
        h('span', { class: 'czss-audio__meta' }),
        h('span', { class: 'czss-spacer' }),
        h('button', { type: 'button', class: 'button', onclick: openMediaFrame, text: 'Cambia audio' }),
        h('button', { type: 'button', class: 'button-link button-link-delete', onclick: () => { if (confirm('Rimuovere l’audio da questo sutra? I tempi delle schede restano salvati.')) setAudio(null); }, text: 'Rimuovi' })
      ),
      audioInfo.vbr ? h('div', { class: 'czss-vbr notice notice-warning inline' },
        h('p', null,
          h('strong', { text: 'MP3 a bitrate variabile (VBR). ' }),
          'Con questo formato il browser non salta con precisione ai tempi: l’inizio di una scheda può non coincidere con la fine della precedente, anche se i numeri sono identici. ',
          'Converti il file in M4A (AAC) o in MP3 a bitrate costante (CBR) e ricaricalo.')) : null,
      h('div', { class: 'czss-wave' }, scroller),
      h('div', { class: 'czss-transport' }, playBtn, timeEl, nudge(-5), nudge(-1), nudge(1), nudge(5), speed, h('span', { class: 'czss-spacer' }), zoom),
      tapPanel,
    ].filter(Boolean));

    if (audio.src !== audioInfo.url) audio.src = audioInfo.url;
    renderAudioMeta();
    renderTap();
    requestAnimationFrame(drawWave);
    if (!ui.peaks) loadPeaks(audioInfo.url);
  }

  function updateTransport() {
    if (timeEl) timeEl.textContent = fmt(audio.currentTime, true) + ' / ' + fmt(duration());
    if (playBtn) playBtn.classList.toggle('is-playing', !audio.paused);
    if (playhead && canvas) {
      const dur = duration();
      const x = dur ? (audio.currentTime / dur) * canvas.clientWidth : 0;
      playhead.style.transform = 'translateX(' + x + 'px)';
      if (!audio.paused && ui.zoom > 1) {
        const left = scroller.scrollLeft;
        if (x < left || x > left + scroller.clientWidth - 40) scroller.scrollLeft = x - 60;
      }
    }
    // evidenzia la scheda in riproduzione
    const idx = cardIndexAt(audio.currentTime);
    cardsBox.querySelectorAll('.czss-card').forEach((el) => {
      el.classList.toggle('is-playing', !audio.paused && el.dataset.id === cards[idx]?.id);
    });
  }

  function cardIndexAt(t) {
    let found = -1;
    cards.forEach((c, i) => {
      if (c.start == null) return;
      const next = cards.slice(i + 1).find((n) => n.start != null);
      const end = c.end ?? next?.start ?? Infinity;
      if (t >= c.start && t < end) found = i;
    });
    return found;
  }

  // ---------------------------------------------------------------- marcatura a tocco
  function tapLabel() {
    const b = ui.tap.boundary;
    if (!cards.length) return 'Aggiungi prima le schede.';
    if (b === 0) return 'Prossimo tocco: inizio della scheda 1';
    if (b >= cards.length) return 'Prossimo tocco: fine della scheda ' + cards.length + ' (ultima)';
    return 'Prossimo tocco: fine scheda ' + b + ' → inizio scheda ' + (b + 1);
  }

  function renderTap() {
    if (!tapPanel) return;
    tapPanel.replaceChildren();
    if (!ui.tap.active) {
      tapPanel.append(
        h('button', { type: 'button', class: 'button', onclick: () => {
          if (!cards.length) { alert('Aggiungi prima le schede (anche solo il testo), poi segna i tempi ascoltando l’audio.'); return; }
          ui.tap = { active: true, boundary: 0, history: [] };
          renderTap();
        } }, h('span', { class: 'dashicons dashicons-clock' }), ' Segna i tempi ascoltando'),
        h('span', { class: 'czss-muted', text: ' Ascolta l’audio e tocca “Segna” (o premi M) al confine di ogni scheda: inizio e fine vengono compilati in sequenza.' })
      );
      return;
    }
    tapPanel.classList.add('is-active');
    tapPanel.append(
      h('button', { type: 'button', class: 'czss-tap__mark', onclick: mark }, 'Segna ', h('kbd', { text: 'M' })),
      h('div', { class: 'czss-tap__info' },
        h('strong', { text: tapLabel() }),
        h('span', { class: 'czss-muted', text: 'Puoi partire dal punto che vuoi: clicca sull’onda per spostarti.' })),
      h('span', { class: 'czss-spacer' }),
      h('label', { class: 'czss-tap__lead', title: 'Ogni tocco viene registrato questo tempo prima, per compensare la reazione' },
        'Anticipo ',
        (() => {
          const sel = h('select', { class: 'czss-select', onchange: (e) => {
            tapLead = parseFloat(e.target.value);
            try { localStorage.setItem('czss-admin-tap-lead', String(tapLead)); } catch (err) { /* ignora */ }
          } }, ['0', '0.1', '0.15', '0.2', '0.25', '0.3', '0.4', '0.5'].map((v) => h('option', { value: v, selected: parseFloat(v) === tapLead ? true : null, text: v.replace('.', ',') + ' s' })));
          return sel;
        })()),
      h('button', { type: 'button', class: 'button', disabled: ui.tap.history.length ? null : true, onclick: undoMark, text: 'Annulla ultimo' }),
      h('button', { type: 'button', class: 'button', onclick: () => { ui.tap.active = false; tapPanel.classList.remove('is-active'); renderTap(); }, text: 'Fine' })
    );
  }

  // Anticipo applicato a ogni tocco: tra quando si sente il confine e quando si preme
  // passano di solito 0,2–0,3 s. Regolabile e ricordato nel browser.
  let tapLead = 0.25;
  try {
    const saved = parseFloat(localStorage.getItem('czss-admin-tap-lead'));
    if (isFinite(saved) && saved >= 0 && saved <= 1) tapLead = saved;
  } catch (e) { /* storage non disponibile */ }

  function mark() {
    const t = Math.max(0, Math.round((audio.currentTime - tapLead * audio.playbackRate) * 1000) / 1000);
    const b = ui.tap.boundary;
    if (b > cards.length) return;
    const prev = cards[b - 1];
    const next = cards[b];
    ui.tap.history.push({ b, prevEnd: prev?.end, nextStart: next?.start });
    if (prev) prev.end = t;
    if (next) next.start = t;
    ui.tap.boundary = b + 1;
    if (next) select(next.id, false);
    commit();
    refreshCardTimes();
    if (ui.tap.boundary > cards.length) {
      ui.tap.active = false;
      tapPanel.classList.remove('is-active');
      audio.pause();
    }
    renderTap();
  }

  function undoMark() {
    const last = ui.tap.history.pop();
    if (!last) return;
    const prev = cards[last.b - 1];
    const next = cards[last.b];
    if (prev) prev.end = last.prevEnd ?? null;
    if (next) next.start = last.nextStart ?? null;
    ui.tap.boundary = last.b;
    audio.currentTime = Math.max(0, (next?.start ?? prev?.end ?? audio.currentTime) - 2);
    commit();
    refreshCardTimes();
    renderTap();
  }

  document.addEventListener('keydown', (e) => {
    if (!ui.tap.active || e.key.toLowerCase() !== 'm' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    mark();
  });

  // ---------------------------------------------------------------- render: schede
  function select(id, scroll) {
    ui.selected = id;
    cardsBox.querySelectorAll('.czss-card').forEach((el) => el.classList.toggle('is-selected', el.dataset.id === id));
    drawWave();
    if (scroll) cardsBox.querySelector('.czss-card[data-id="' + id + '"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function refreshCardTimes() {
    cards.forEach((c, i) => {
      const el = cardsBox.querySelector('.czss-card[data-id="' + c.id + '"]');
      if (!el) return;
      el.querySelector('.czss-card__range').textContent = rangeLabel(c, i);
      el.querySelector('.czss-card__range').classList.toggle('is-missing', c.start == null);
      const s = el.querySelector('input[data-time="start"]');
      const e = el.querySelector('input[data-time="end"]');
      if (s && document.activeElement !== s) s.value = c.start != null ? fmt(c.start, true) : '';
      if (e && document.activeElement !== e) e.value = c.end != null ? fmt(c.end, true) : '';
    });
  }

  function rangeLabel(c, i) {
    if (c.start == null) return 'senza tempi';
    const next = cards.slice(i + 1).find((n) => n.start != null);
    const end = c.end ?? next?.start ?? null;
    return fmt(c.start, true) + ' → ' + (end != null ? fmt(end, true) : 'fine');
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= cards.length) return;
    [cards[i], cards[j]] = [cards[j], cards[i]];
    commit();
    renderCards();
  }

  function timeControl(card, which) {
    const input = h('input', {
      type: 'text', class: 'czss-input czss-input--time', inputmode: 'decimal', placeholder: which === 'start' ? '0:00.00' : 'auto',
      value: card[which] != null ? fmt(card[which], true) : '', 'data-time': which,
      'aria-label': which === 'start' ? 'Inizio' : 'Fine',
    });
    input.addEventListener('change', () => {
      const v = parseTime(input.value);
      if (v === undefined) { input.classList.add('is-invalid'); return; }
      input.classList.remove('is-invalid');
      card[which] = v;
      commit();
      refreshCardTimes();
    });
    const adj = (d) => () => {
      const base = card[which] ?? (which === 'end' ? card.start ?? 0 : 0);
      card[which] = Math.max(0, Math.round((base + d) * 1000) / 1000);
      commit();
      refreshCardTimes();
      if (audioInfo) playRange(Math.max(0, which === 'start' ? card[which] : card[which] - 1.5), which === 'start' ? card[which] + 1.5 : card[which]);
    };
    return h('div', { class: 'czss-timefield' },
      h('span', { class: 'czss-timefield__label', text: which === 'start' ? 'Inizio' : 'Fine' }),
      input,
      h('button', { type: 'button', class: 'czss-btn czss-btn--ghost', title: 'Usa la posizione attuale dell’audio', disabled: audioInfo ? null : true, onclick: () => {
        card[which] = Math.round(audio.currentTime * 1000) / 1000;
        commit();
        refreshCardTimes();
      } }, h('span', { class: 'dashicons dashicons-location' }), 'ora'),
      h('button', { type: 'button', class: 'czss-btn czss-btn--ghost czss-btn--icon', title: '−0,1 s (e ascolta)', onclick: adj(-0.1), text: '−' }),
      h('button', { type: 'button', class: 'czss-btn czss-btn--ghost czss-btn--icon', title: '+0,1 s (e ascolta)', onclick: adj(0.1), text: '+' })
    );
  }

  function segmentOf(i) {
    const c = cards[i];
    const next = cards.slice(i + 1).find((n) => n.start != null);
    return { start: c.start, end: c.end ?? next?.start ?? null };
  }

  function renderCard(card, i) {
    const open = ui.open.has(card.id);
    const el = h('div', { class: 'czss-card' + (open ? ' is-open' : '') + (card.id === ui.selected ? ' is-selected' : ''), dataset: { id: card.id } });

    const preview = h('span', { class: 'czss-card__preview' },
      h('span', { lang: 'ja', class: 'czss-card__preview-jp', text: firstLine(card.original) }),
      h('span', { class: 'czss-card__preview-ro', text: firstLine(card.romaji) || firstLine(card.translation) || 'Scheda vuota' }));

    const toggle = () => {
      if (ui.open.has(card.id)) ui.open.delete(card.id); else ui.open.add(card.id);
      el.classList.toggle('is-open');
      select(card.id, false);
    };

    const warnBadge = h('span', { class: 'czss-card__warn dashicons dashicons-warning', title: 'Righe non allineate' });
    const alignNote = h('p', { class: 'czss-align' });
    const updateAlign = () => {
      const a = alignInfo(card);
      warnBadge.hidden = a.level !== 'warn';
      alignNote.className = 'czss-align czss-align--' + a.level;
      alignNote.textContent = a.text;
    };

    const head = h('div', { class: 'czss-card__head' },
      h('span', { class: 'czss-card__handle dashicons dashicons-menu', title: 'Trascina per riordinare' }),
      h('span', { class: 'czss-card__num', text: String(i + 1) }),
      h('button', { type: 'button', class: 'czss-card__toggle', 'aria-expanded': String(open), onclick: toggle }, preview),
      warnBadge,
      h('span', { class: 'czss-card__range' + (card.start == null ? ' is-missing' : ''), text: rangeLabel(card, i) }),
      h('span', { class: 'czss-card__actions' },
        h('button', { type: 'button', class: 'czss-btn czss-btn--ghost czss-btn--icon', title: 'Ascolta il segmento', disabled: audioInfo && card.start != null ? null : true, onclick: () => { const s = segmentOf(i); select(card.id, false); playRange(s.start, s.end); } }, h('span', { class: 'dashicons dashicons-controls-play' })),
        h('button', { type: 'button', class: 'czss-btn czss-btn--ghost czss-btn--icon', title: 'Su', disabled: i === 0 ? true : null, onclick: () => move(i, -1) }, h('span', { class: 'dashicons dashicons-arrow-up-alt2' })),
        h('button', { type: 'button', class: 'czss-btn czss-btn--ghost czss-btn--icon', title: 'Giù', disabled: i === cards.length - 1 ? true : null, onclick: () => move(i, 1) }, h('span', { class: 'dashicons dashicons-arrow-down-alt2' })),
        h('button', { type: 'button', class: 'czss-btn czss-btn--ghost czss-btn--icon', title: 'Duplica', onclick: () => {
          const copy = { ...card, id: uid() };
          cards.splice(i + 1, 0, copy);
          ui.open.add(copy.id);
          commit();
          renderCards();
        } }, h('span', { class: 'dashicons dashicons-admin-page' })),
        h('button', { type: 'button', class: 'czss-btn czss-btn--ghost czss-btn--icon czss-btn--danger', title: 'Elimina', onclick: () => {
          if (!confirm('Eliminare la scheda ' + (i + 1) + '?')) return;
          cards.splice(i, 1);
          commit();
          renderCards();
        } }, h('span', { class: 'dashicons dashicons-trash' }))
      )
    );

    const fields = h('div', { class: 'czss-card__fields' },
      FIELDS.map((f) => {
        const ta = h('textarea', { class: 'czss-input' + (f.cjk ? ' czss-input--cjk' : ''), rows: String(f.rows), lang: f.cjk ? 'ja' : null, spellcheck: f.cjk ? 'false' : null });
        ta.value = card[f.key] || '';
        ta.addEventListener('input', () => {
          card[f.key] = ta.value;
          commit();
          preview.firstChild.textContent = firstLine(card.original);
          preview.lastChild.textContent = firstLine(card.romaji) || firstLine(card.translation) || 'Scheda vuota';
          updateAlign();
        });
        ta.addEventListener('focus', () => select(card.id, false));
        return h('label', { class: 'czss-field czss-field--' + f.key },
          h('span', { class: 'czss-field__label' }, f.label, h('small', { text: ' · ' + f.hint })), ta);
      })
    );

    const loopBtn = h('button', { type: 'button', class: 'czss-btn czss-btn--ghost', disabled: audioInfo ? null : true, onclick: () => {
      const s = segmentOf(i);
      if (s.start == null) return;
      playRange(s.start, s.end ?? duration(), true);
    } }, h('span', { class: 'dashicons dashicons-controls-repeat' }), 'Ripeti segmento');

    const times = h('div', { class: 'czss-card__times' }, timeControl(card, 'start'), timeControl(card, 'end'), loopBtn,
      h('span', { class: 'czss-muted czss-card__hint', text: 'Fine vuota = fino all’inizio della scheda successiva.' }));

    updateAlign();
    el.append(head, h('div', { class: 'czss-card__body' }, fields, alignNote, times));
    return el;
  }

  let list;
  function renderCards() {
    const toolbar = h('div', { class: 'czss-cards__toolbar' },
      h('h3', { class: 'czss-cards__title' }, 'Schede ', h('span', { class: 'czss-count', text: String(cards.length) })),
      h('span', { class: 'czss-spacer' }),
      h('button', { type: 'button', class: 'button', onclick: openImport }, h('span', { class: 'dashicons dashicons-editor-paste-text' }), ' Importa testo'),
      h('button', { type: 'button', class: 'button', onclick: () => {
        const allOpen = cards.every((c) => ui.open.has(c.id));
        ui.open = new Set(allOpen ? [] : cards.map((c) => c.id));
        renderCards();
      }, text: cards.length && cards.every((c) => ui.open.has(c.id)) ? 'Comprimi tutte' : 'Espandi tutte' })
    );

    list = h('div', { class: 'czss-cards__list' }, cards.map(renderCard));
    if (!cards.length) {
      list.append(h('p', { class: 'czss-empty', text: 'Nessuna scheda. Aggiungine una, oppure incolla l’intero testo con “Importa testo”: ogni paragrafo diventa una scheda.' }));
    }

    const add = h('button', { type: 'button', class: 'button button-primary czss-add', onclick: () => {
      const last = cards[cards.length - 1];
      const prevEnd = last ? last.end ?? null : null;
      const c = { id: uid(), original: '', romaji: '', translation: '', note: '', start: prevEnd, end: null };
      cards.push(c);
      ui.open.add(c.id);
      ui.selected = c.id;
      commit();
      renderCards();
      cardsBox.querySelector('.czss-card[data-id="' + c.id + '"] textarea')?.focus();
    } }, h('span', { class: 'dashicons dashicons-plus-alt2' }), ' Aggiungi scheda');

    cardsBox.replaceChildren(toolbar, list, add);

    if ($ && $.fn.sortable) {
      $(list).sortable({
        handle: '.czss-card__handle',
        axis: 'y',
        placeholder: 'czss-card-placeholder',
        forcePlaceholderSize: true,
        update: () => {
          const order = Array.from(list.querySelectorAll('.czss-card')).map((el) => el.dataset.id);
          cards.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
          commit();
          renderCards();
        },
      });
    }
    drawWave();
  }

  // ---------------------------------------------------------------- importa testo
  function openImport() {
    const ta = h('textarea', { class: 'czss-input', rows: '14', placeholder: 'Incolla qui il testo.\n\nSepara le schede con una riga vuota:\n\nkan ji zai bo satsu\ngyō jin han-nya…\n\nsha ri shi\nshiki fu i kū…' });
    const field = h('select', { class: 'czss-select' }, FIELDS.map((f) => h('option', { value: f.key, text: f.label })));
    const mode = h('select', { class: 'czss-select' },
      h('option', { value: 'fill', text: 'Compila le schede esistenti in ordine (e aggiungi quelle mancanti)' }),
      h('option', { value: 'append', text: 'Aggiungi come nuove schede in fondo' }));
    const preview = h('p', { class: 'czss-muted' });
    const blocks = () => ta.value.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.replace(/^\n+|\s+$/g, '')).filter(Boolean);
    ta.addEventListener('input', () => { preview.textContent = blocks().length + ' blocchi riconosciuti → ' + blocks().length + ' schede'; });

    const dialog = h('dialog', { class: 'czss-dialog' },
      h('form', { method: 'dialog' },
        h('h2', { text: 'Importa testo' }),
        h('p', { class: 'czss-muted', text: 'Ogni blocco separato da una riga vuota diventa una scheda. Puoi importare un campo alla volta: prima il testo originale, poi il romaji, poi la traduzione.' }),
        h('div', { class: 'czss-dialog__row' }, h('label', null, 'Campo ', field), h('label', null, 'Modalità ', mode)),
        ta, preview,
        h('div', { class: 'czss-dialog__actions' },
          h('button', { value: 'cancel', class: 'button', text: 'Annulla' }),
          h('button', { value: 'ok', class: 'button button-primary', text: 'Importa' }))
      ));
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'ok') {
        const key = field.value;
        const parts = blocks();
        if (mode.value === 'append') {
          parts.forEach((p) => cards.push({ id: uid(), original: '', romaji: '', translation: '', note: '', start: null, end: null, [key]: p }));
        } else {
          parts.forEach((p, i) => {
            if (!cards[i]) cards.push({ id: uid(), original: '', romaji: '', translation: '', note: '', start: null, end: null });
            cards[i][key] = p;
          });
        }
        commit();
        renderCards();
      }
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
    ta.focus();
  }

  // ---------------------------------------------------------------- avvio
  renderAudio();
  renderCards();
  if (audioInfo) audio.src = audioInfo.url;

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawWave, 120); });

  const form = document.getElementById('post');
  if (form) form.addEventListener('submit', () => { cardsInput.value = JSON.stringify(cards); dirty = false; });
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
})(window.jQuery);

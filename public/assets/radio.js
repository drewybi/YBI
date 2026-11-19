import { B, $, esc, toast } from './common.js';

// Add a station here. stream is a public direct URL. cors true lets the meter read levels.
// Leave stream empty to link out to the station's own player.
export const STATIONS = [
  { id: 'triplej', name: 'triple j', place: 'National', genre: 'Youth', bank: 'National', stream: 'https://abc.streamguys1.com/live/triplejnsw/icecast.audio', page: 'https://www.abc.net.au/triplej', cors: true },
  { id: 'doublej', name: 'Double J', place: 'National', genre: 'Alternative', bank: 'National', stream: 'https://abc.streamguys1.com/live/doublejnsw/icecast.audio', page: 'https://www.abc.net.au/listen/doublej', cors: true },
  { id: 'classic', name: 'ABC Classic', place: 'National', genre: 'Classical', bank: 'National', stream: 'https://abc.streamguys1.com/live/classicfmnsw/icecast.audio', page: 'https://www.abc.net.au/listen/classic', cors: true },
  { id: 'jazz', name: 'ABC Jazz', place: 'National', genre: 'Jazz', bank: 'National', stream: 'https://abc.streamguys1.com/live/abcjazz/icecast.audio', page: 'https://www.abc.net.au/listen/jazz', cors: true },
  { id: 'melbourne', name: 'ABC Melbourne', place: 'Melbourne', genre: 'Local', bank: 'Melbourne', stream: 'https://abc.streamguys1.com/live/localmelbourne/icecast.audio', page: 'https://www.abc.net.au/radio/melbourne', cors: true },
  { id: 'nova', name: 'Nova 100', place: 'Melbourne', genre: 'Hits', bank: 'Melbourne', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/NOVA_100.mp3', page: 'https://www.nova100.com.au/', cors: true },
  { id: 'smooth', name: 'smooth 91.5', place: 'Melbourne', genre: 'Easy', bank: 'Melbourne', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/SMOOTH915_AAC128.aac', page: 'https://www.smoothfm.com.au/', cors: true },
  { id: 'kiis', name: 'KIIS 101.1', place: 'Melbourne', genre: 'Hits', bank: 'Melbourne', stream: 'https://ais-arn.streamguys1.com/au_001_icy', page: 'https://www.kiis1011.com.au/', cors: true },
  { id: 'gold', name: 'Gold 104.3', place: 'Melbourne', genre: 'Classic hits', bank: 'Melbourne', stream: 'https://ais-arn.streamguys1.com/au_004_icy', page: 'https://www.gold1043.com.au/', cors: true },
  { id: 'triplem', name: 'Triple M', place: 'Melbourne', genre: 'Rock', bank: 'Melbourne', stream: 'https://legacy.scahw.com.au/3mmm_128', page: 'https://www.triplem.com.au/', cors: false },
  { id: 'fox', name: 'Fox FM', place: 'Melbourne', genre: 'Hits', bank: 'Melbourne', stream: 'https://legacy.scahw.com.au/3fox_128', page: 'https://www.fox.com.au/', cors: false },
  { id: 'rrr', name: 'RRR', place: 'Melbourne', genre: 'Community', bank: 'Melbourne', stream: 'https://realtime.rrr.org.au/p1h', page: 'https://www.rrr.org.au/', cors: true },
  { id: 'pbs', name: 'PBS 106.7', place: 'Melbourne', genre: 'Community', bank: 'Melbourne', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/3PBS_FMAACHIGH.aac', page: 'https://www.pbsfm.org.au/', cors: true },
  { id: 'sen', name: 'SEN 1116', place: 'Melbourne', genre: 'Sport', bank: 'Melbourne', stream: '', page: 'https://www.sen.com.au/listen', cors: false },
  { id: 'rn', name: 'ABC RN', place: 'National', genre: 'Talk', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/rnnsw/icecast.audio', page: 'https://www.abc.net.au/listen/radionational', cors: true },
  { id: 'news', name: 'ABC News', place: 'National', genre: 'News', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/newsradio/icecast.audio', page: 'https://www.abc.net.au/listen/news', cors: true },
  { id: 'country', name: 'ABC Country', place: 'National', genre: 'Country', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/abccountry/icecast.audio', page: 'https://www.abc.net.au/listen/country', cors: true },
  { id: 'unearthed', name: 'Unearthed', place: 'National', genre: 'New music', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/triplejunearthed/icecast.audio', page: 'https://www.abc.net.au/triplej/unearthed', cors: true },
];

const KEY_STATION = 'ybi-radio-station';
const KEY_VOLUME = 'ybi-radio-volume';
const byId = id => STATIONS.find(s => s.id === id) || null;

const heard = typeof Audio !== 'undefined' ? new Audio() : null;
const probed = typeof Audio !== 'undefined' ? new Audio() : null;
if (heard) { heard.preload = 'none'; }
if (probed) { probed.preload = 'none'; probed.crossOrigin = 'anonymous'; }

const BANKS = ['Favourites', 'National', 'Melbourne', 'Genre'];
const FAV_KEY = 'ybi-radio-favs';
const DEFAULT_FAVS = ['triplej', 'doublej', 'nova', 'smooth', 'gold', 'rrr'];
let current = null;
let bank = 'National';
let playing = false;
let usingProbe = false;
let muted = false;
let scanning = false;
let scanTimer = 0;
let playGen = 0;
let volume = 0.8;
let ctx, analyser, freq;
let meterTimer = 0;
let meterPhase = 0;
const meters = new Set();
const BAR_COUNT = 24;
const barShown = new Array(BAR_COUNT).fill(0.1);

function prefersStill() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function savedVolume() {
  const raw = localStorage.getItem(KEY_VOLUME);
  if (raw == null || raw === '') return 0.8;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8;
}
function remember() {
  if (current) localStorage.setItem(KEY_STATION, current.id);
  localStorage.setItem(KEY_VOLUME, String(volume));
}
function applyVolume() {
  const out = muted ? 0 : volume;
  if (heard) heard.volume = out;
  if (probed) probed.volume = out;
}
function liveEl() { return usingProbe ? probed : heard; }

function wireProbe() {
  if (ctx || !probed) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.78;
  freq = new Uint8Array(analyser.frequencyBinCount);
  const node = ctx.createMediaElementSource(probed);
  node.connect(analyser);
  analyser.connect(ctx.destination);
}
function resumeCtx() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

function emit() {
  paintMini();
  paintConsole();
  if (playing) startMeter(); else stopMeter();
}

function fail(station) {
  playing = false;
  stopScan();
  emit();
  toast(`${station.name} didn’t start. Open their player instead.`);
}

async function playCurrent() {
  if (!current || !current.stream) { toast('Choose a station'); return; }
  const gen = ++playGen;
  const station = current;
  const useProbe = !!station.cors;
  const live = useProbe ? probed : heard;
  const other = useProbe ? heard : probed;
  if (other) other.pause();
  if (useProbe) wireProbe();
  usingProbe = useProbe;
  applyVolume();
  const abs = new URL(station.stream, location.href).href;
  if (live.src !== abs) live.src = station.stream;
  playing = true;
  emit();
  const started = () => live.currentTime > 0.05 && !live.paused;
  try {
    resumeCtx();
    await live.play();
  } catch (e) {
    if (gen !== playGen) return;
    if (useProbe && heard) {
      probed.pause();
      usingProbe = false;
      heard.src = station.stream;
      applyVolume();
      try { await heard.play(); emit(); return; }
      catch { /* still down */ }
    }
    if (!started()) fail(station);
    return;
  }
  setTimeout(() => {
    if (gen !== playGen || current !== station || !playing) return;
    if (live.currentTime > 0.05) return;
    if (live.error && live.error.code !== 1) fail(station);
  }, 1800);
}

function stopPlayback() {
  if (heard) heard.pause();
  if (probed) probed.pause();
  playing = false;
  emit();
}

function favs() {
  try {
    const list = JSON.parse(localStorage.getItem(FAV_KEY) || 'null');
    if (Array.isArray(list)) return list.filter(id => byId(id));
  } catch { /* keep defaults */ }
  return DEFAULT_FAVS.slice();
}
function stationsInBank(name = bank) {
  if (name === 'Favourites') return favs().map(byId).filter(Boolean);
  return STATIONS.filter(s => s.bank === name);
}
function playable(name = bank) {
  return stationsInBank(name).filter(s => s.stream);
}
function toggleFav() {
  if (!current) return;
  const list = favs();
  const next = list.includes(current.id) ? list.filter(id => id !== current.id) : [current.id, ...list];
  localStorage.setItem(FAV_KEY, JSON.stringify(next.slice(0, 12)));
  emit();
}
function choose(station, autoplay) {
  if (!station) return;
  if (!station.stream) {
    stopScan();
    window.open(station.page, '_blank', 'noopener');
    toast(`${station.name} has no public stream — opened their player.`);
    return;
  }
  current = station;
  if (!stationsInBank().some(s => s.id === station.id)) bank = station.bank;
  remember();
  if (autoplay || playing) playCurrent();
  else emit();
}
function step(dir) {
  const list = playable();
  if (!list.length) return;
  let i = list.findIndex(s => current && s.id === current.id);
  if (i < 0) i = dir > 0 ? -1 : 0;
  choose(list[(i + dir + list.length) % list.length], true);
}
function stopScan() {
  scanning = false;
  clearInterval(scanTimer);
  scanTimer = 0;
}
function startScan() {
  const list = playable();
  if (!list.length) { toast('Nothing to scan in this band'); return; }
  if (!current || current.bank !== bank || !current.stream) choose(list[0], true);
  else if (!playing) playCurrent();
  scanning = true;
  clearInterval(scanTimer);
  scanTimer = setInterval(() => { if (scanning) step(1); }, 8000);
  emit();
}
function toggleScan() {
  if (scanning) { stopScan(); emit(); }
  else startScan();
}
function togglePlay() {
  if (playing) { stopScan(); stopPlayback(); }
  else playCurrent();
}
function toggleMute() {
  muted = !muted;
  applyVolume();
  emit();
}
function setVolume(next) {
  volume = Math.min(1, Math.max(0, next));
  if (volume > 0) muted = false;
  applyVolume();
  remember();
  const root = document.querySelector('[data-rx]');
  const vol = root && $('[data-vol]', root);
  if (vol) vol.textContent = `${Math.round(volume * 100)}`;
  const fill = root && $('[data-volfill]', root);
  if (fill) fill.style.width = `${Math.round(volume * 100)}%`;
  const volKnob = root && $('[data-volknob]', root);
  if (volKnob) volKnob.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
  const mute = root && $('[data-mute]', root);
  if (mute) {
    mute.classList.toggle('is-on', muted);
    mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    mute.textContent = muted ? 'Muted' : 'Mute';
  }
  paintMini();
}

function onAudioError(el, probe) {
  if (probe !== usingProbe || !playing || !current) return;
  if (!el.error || el.error.code === 1) return;
  if (el.currentTime > 0.05) return;
}
if (heard) heard.addEventListener('error', () => onAudioError(heard, false));
if (probed) probed.addEventListener('error', () => onAudioError(probed, true));

function clock() {
  return new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false });
}
function mark(station) {
  const words = station.name.replace(/[0-9.]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'YBI';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function stationLine() {
  return (current ? current.name : 'YBI Radio').toUpperCase();
}
function fitStation(root) {
  const el = $('[data-ch]', root || document);
  if (!el || !el.clientWidth) return;
  const text = $('[data-ch-text]', el);
  const ghost = $('[data-ch-ghost]', el);
  if (!text || !ghost) return;
  const line = stationLine();
  text.textContent = line;
  ghost.textContent = line;
  const cap = el.clientHeight || 16;
  let size = Math.min(cap * 0.92, 28);
  const floor = Math.max(7, cap * 0.48);
  const apply = px => { el.style.fontSize = `${px}px`; };
  apply(size);
  while (size > floor && text.scrollWidth > el.clientWidth + 0.5) {
    size = Math.round((size - 0.4) * 10) / 10;
    apply(size);
  }
}
function barTargets() {
  let levels = null;
  if (playing && usingProbe && analyser && freq) {
    analyser.getByteFrequencyData(freq);
    let sum = 0;
    for (let i = 0; i < freq.length; i++) sum += freq[i];
    if (sum > 0) levels = freq;
  }
  const out = new Array(BAR_COUNT);
  for (let i = 0; i < BAR_COUNT; i++) {
    if (!playing) out[i] = 0.1;
    else if (levels) out[i] = 0.16 + 0.78 * (levels[Math.min(levels.length - 1, Math.floor(i / BAR_COUNT * levels.length))] / 255);
    else out[i] = 0.28 + 0.34 * (0.5 + 0.5 * Math.sin(meterPhase + i * 0.62));
  }
  return out;
}
function paintMeters() {
  const still = prefersStill();
  const targets = barTargets();
  meters.forEach(el => {
    if (!el.isConnected) { meters.delete(el); return; }
    const bars = el.querySelectorAll('i');
    bars.forEach((bar, i) => {
      const target = targets[i] ?? 0.1;
      const v = still ? (playing ? 0.42 : 0.1) : (barShown[i] = barShown[i] + (target - barShown[i]) * 0.42);
      bar.style.height = `${Math.round(Math.max(0.1, v) * 100)}%`;
      bar.style.opacity = playing ? '0.95' : '0.4';
      bar.style.background = !still && v > 0.82 ? '#d8ffe8' : '#00C853';
    });
  });
  if (!still && playing) meterPhase += 0.28;
}
function startMeter() {
  paintMeters();
  if (meterTimer || prefersStill()) return;
  meterTimer = setInterval(paintMeters, 110);
}
function stopMeter() {
  if (meterTimer) clearInterval(meterTimer);
  meterTimer = 0;
  paintMeters();
}
function watchMeter(el) {
  if (!el || meters.has(el)) return;
  meters.add(el);
  if (playing) startMeter();
  else paintMeters();
}

let mini;
function ensureMini() {
  if (mini) return mini;
  mini = document.createElement('div');
  mini.className = 'rx-mini';
  mini.hidden = true;
  mini.innerHTML = `<span class="rx-mini-lamp" data-mini-lamp aria-hidden="true"></span>
    <a class="rx-mini-name" data-mini-name href="${B}/studio/radio">YBI Radio</a>
    <button type="button" class="rx-transport rx-transport--sm" data-mini-play aria-label="Play">▶</button>
    <label class="rx-mini-vol"><span class="sr">Level</span><input data-mini-vol type="range" min="0" max="100" value="80" aria-label="Volume"></label>`;
  document.body.append(mini);
  $('[data-mini-play]', mini).onclick = () => playing ? stopPlayback() : playCurrent();
  $('[data-mini-vol]', mini).addEventListener('input', e => setVolume(Number(e.target.value) / 100));
  return mini;
}
function paintMini() {
  const el = ensureMini();
  const onRadio = document.body.classList.contains('is-radio');
  const show = !!current && !onRadio;
  el.hidden = !show;
  document.body.classList.toggle('rx-dock', show);
  if (!show) return;
  $('[data-mini-lamp]', el).classList.toggle('is-live', playing);
  const name = $('[data-mini-name]', el);
  name.textContent = scanning ? `${current.name} · scan` : playing ? current.name : `${current.name} · standby`;
  const play = $('[data-mini-play]', el);
  play.textContent = playing ? '❚❚' : '▶';
  play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const vol = $('[data-mini-vol]', el);
  if (document.activeElement !== vol) vol.value = String(Math.round(volume * 100));
}

function presetsHtml() {
  const list = stationsInBank();
  if (!list.length) return '<p class="rx-empty">No favourites yet. Star a station to keep it here.</p>';
  return list.map((s, i) => {
    const on = current && current.id === s.id;
    const ext = !s.stream;
    return `<button type="button" class="rx-preset${on ? ' is-on' : ''}${ext ? ' is-ext' : ''}" data-pad="${esc(s.id)}" aria-pressed="${on ? 'true' : 'false'}"><i>${esc(mark(s))}</i><small>P${i + 1}</small><b>${esc(s.name)}</b></button>`;
  }).join('');
}

function paintConsole() {
  const root = document.querySelector('[data-rx]');
  if (!root) return;
  const name = current ? current.name : 'YBI Radio';
  $('[data-led]', root).textContent = name;
  $('[data-sub]', root).textContent = current ? `${current.place} · ${current.genre}` : 'Choose a preset';
  const live = $('[data-live]', root);
  live.hidden = !playing;
  live.textContent = scanning ? 'Live · Scan' : 'Live';
  $('[data-clock]', root).textContent = clock();
  const art = $('[data-art]', root);
  if (art) {
    art.textContent = current ? mark(current) : 'YB';
    art.classList.toggle('is-live', playing);
  }
  const vol = $('[data-vol]', root);
  if (vol) vol.textContent = muted ? 'Mute' : `${Math.round(volume * 100)}`;
  const fill = $('[data-volfill]', root);
  if (fill) fill.style.width = `${Math.round((muted ? 0 : volume) * 100)}%`;
  $('[data-sig]', root).classList.toggle('is-live', playing && !muted);
  $('[data-presets]', root).innerHTML = presetsHtml();
  root.querySelectorAll('[data-bank]').forEach(btn => {
    const on = btn.dataset.bank === bank;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const play = $('[data-play]', root);
  play.textContent = playing ? '❚❚' : '▶';
  play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  play.classList.toggle('is-live', playing);
  const scan = $('[data-scan]', root);
  scan.classList.toggle('is-on', scanning);
  scan.setAttribute('aria-pressed', scanning ? 'true' : 'false');
  const mute = $('[data-mute]', root);
  mute.classList.toggle('is-on', muted);
  mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
  mute.textContent = muted ? 'Muted' : 'Mute';
  const star = $('[data-fav]', root);
  if (star && current) {
    const on = favs().includes(current.id);
    star.classList.toggle('is-on', on);
    star.textContent = on ? '★' : '☆';
    star.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const volKnob = $('[data-volknob]', root);
  if (volKnob) volKnob.setAttribute('aria-valuenow', String(Math.round((muted ? 0 : volume) * 100)));
  const tuneKnob = $('[data-tuneknob]', root);
  if (tuneKnob) tuneKnob.setAttribute('aria-valuetext', current ? current.name : 'No station');
  fitStation(root);
}

const BANK_SHORT = { Favourites: 'Fav', National: 'Nat', Melbourne: 'Mel', Genre: 'Gen' };
const GLASS = { x: 492 / 1280, y: 165 / 720, w: 214 / 1280, h: 300 / 720 };

function placeScene(root) {
  const scene = $('[data-scene]', root);
  if (!scene) return;
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const narrow = vw < 760;
  let w, h, left, top;
  if (narrow) {
    const maxW = vw * 0.94;
    const maxH = vh * 0.94;
    const s = Math.min(maxW / (GLASS.w * 16), maxH / (GLASS.h * 9));
    w = 16 * s;
    h = 9 * s;
    left = vw / 2 - (GLASS.x + GLASS.w / 2) * w;
    top = vh / 2 - (GLASS.y + GLASS.h / 2) * h;
  } else {
    const s = Math.max(vw / 16, vh / 9) * 1.14;
    w = 16 * s;
    h = 9 * s;
    left = (vw - w) / 2;
    top = (vh - h) / 2;
  }
  scene.style.width = `${w}px`;
  scene.style.height = `${h}px`;
  scene.style.left = `${left}px`;
  scene.style.top = `${top}px`;
  scene.style.transform = 'none';
  fitStation(root);
}

function bindKnob(el, { onDelta, onClick }) {
  let lastY = 0;
  let lastX = 0;
  let moved = false;
  el.addEventListener('pointerdown', e => {
    moved = false;
    lastY = e.clientY;
    lastX = e.clientX;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (el.hasPointerCapture && !el.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - lastX;
    const dy = lastY - e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    onDelta(dx, dy);
  });
  el.addEventListener('pointerup', () => { if (!moved) onClick(); });
  el.addEventListener('pointercancel', () => { moved = true; });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    onDelta(0, -Math.sign(e.deltaY) * 18);
  }, { passive: false });
}

let clockTimer = 0;
export async function radioPage() {
  document.title = 'YBI Radio · Studio';
  if (current) bank = current.bank;
  const app = document.getElementById('app');
  app.innerHTML = `<div class="rx" data-rx>
    <div class="rx-scene" data-scene>
      <img class="rx-photo" alt="" src="${B}/assets/img/ybi-dash.jpg">
      <button type="button" class="rx-hot rx-hot--vol" data-volknob aria-label="Volume" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80"></button>
      <button type="button" class="rx-hot rx-hot--tune" data-tuneknob aria-label="Tune"></button>
      <div class="rx-screen">
        <div class="rx-ui" data-ui>
          <header class="rx-bar">
            <img class="rx-logo" alt="YBI" src="${B}/assets/img/logo-white.png">
            <span class="rx-clock" data-clock>--:--</span>
            <span class="rx-sig" data-sig aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          </header>
          <section class="rx-hero">
            <div class="rx-art" data-art>YB</div>
            <div class="rx-copy">
              <p class="rx-kicker">On <span class="ol">air</span></p>
              <h1 data-led>YBI Radio</h1>
              <p class="rx-sub" data-sub>Choose a preset</p>
            </div>
            <button type="button" class="rx-star" data-fav aria-label="Favourite" aria-pressed="false">☆</button>
            <div class="rx-tune">
              <p class="rx-ch" data-ch><span class="rx-ch-ghost" data-ch-ghost aria-hidden="true">YBI RADIO</span><span class="rx-ch-text" data-ch-text>YBI RADIO</span></p>
              <p class="rx-live" data-live hidden>Live</p>
            </div>
            <div class="rx-meter" data-meter aria-hidden="true">${'<i></i>'.repeat(BAR_COUNT)}</div>
          </section>
          <div class="rx-tabs" role="tablist" aria-label="Bands">
            ${BANKS.map(name => `<button type="button" role="tab" data-bank="${esc(name)}" aria-label="${esc(name)}">${esc(BANK_SHORT[name] || name)}</button>`).join('')}
          </div>
          <div class="rx-presets" data-presets></div>
          <div class="rx-volbar" aria-hidden="true"><i data-volfill></i><span data-vol>80</span></div>
          <div class="rx-controls">
            <button type="button" data-seek="-1" aria-label="Previous station">‹‹</button>
            <button type="button" class="rx-play" data-play aria-label="Play">▶</button>
            <button type="button" data-scan aria-pressed="false">Scan</button>
            <button type="button" data-seek="1" aria-label="Next station">››</button>
            <button type="button" data-mute aria-pressed="false">Mute</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const root = $('[data-rx]');
  watchMeter($('[data-meter]', root));
  root.addEventListener('click', e => {
    const pad = e.target.closest('[data-pad]');
    if (pad) { stopScan(); const station = byId(pad.dataset.pad); if (station) choose(station, true); return; }
    const tab = e.target.closest('[data-bank]');
    if (tab) { stopScan(); bank = tab.dataset.bank; emit(); return; }
    if (e.target.closest('[data-seek]')) { stopScan(); step(Number(e.target.closest('[data-seek]').dataset.seek)); return; }
    if (e.target.closest('[data-play]')) { togglePlay(); return; }
    if (e.target.closest('[data-scan]')) { toggleScan(); return; }
    if (e.target.closest('[data-mute]')) { toggleMute(); return; }
    if (e.target.closest('[data-fav]')) { toggleFav(); }
  });
  bindKnob($('[data-volknob]', root), {
    onDelta: (_dx, dy) => setVolume(volume + dy / 160),
    onClick: () => toggleMute()
  });
  let tuneAcc = 0;
  bindKnob($('[data-tuneknob]', root), {
    onDelta: (dx, dy) => {
      tuneAcc += dx + dy;
      if (Math.abs(tuneAcc) < 36) return;
      stopScan();
      step(tuneAcc > 0 ? 1 : -1);
      tuneAcc = 0;
    },
    onClick: () => { stopScan(); step(1); }
  });
  placeScene(root);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root.isConnected) fitStation(root); });
  const ro = new ResizeObserver(() => placeScene(root));
  ro.observe(root);
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { const c = document.querySelector('[data-rx] [data-clock]'); if (c) c.textContent = clock(); }, 1000);
  paintConsole();
  paintMini();
}

export function syncRadio() { paintMini(); }

export function bootRadio() {
  volume = savedVolume();
  applyVolume();
  current = byId(localStorage.getItem(KEY_STATION) || '');
  if (current) bank = current.bank;
  ensureMini();
  paintMini();
}

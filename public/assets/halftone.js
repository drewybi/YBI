import { $, esc, toast } from './common.js';
import { DEFAULTS, cutoutOnly, fitPagePixels, pngWithDpi, processHalftone } from './halftone-core.mjs';

const STORE = 'ybi-halftone-presets';
const SIZES = {
  A4: [210, 297],
  A3: [297, 420],
  'A3+': [329, 483],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
};
const SHIRTS = {
  black: [8, 8, 10],
  white: [244, 242, 236],
  navy: [18, 32, 64],
  grey: [118, 118, 122],
  red: [148, 28, 36],
};
const SEEDS = {
  'Dark tee glow': { knockout: true, knockoutStrength: 55, shirtKey: 'black', shirt: SHIRTS.black, bgMode: 'auto', lpi: 40, angle: 22.5, shading: 40, tolerance: 10, softness: 48, solid: 92, minDot: 12, choke: 2, shape: 'round' },
  'Light tee': { knockout: false, knockoutStrength: 0, shirtKey: 'white', shirt: SHIRTS.white, bgMode: 'auto', lpi: 45, angle: 22.5, shading: 85, tolerance: 16, softness: 28, solid: 90, minDot: 12, choke: 2, shape: 'round' },
};

const app = $('#app');
let source = null;
let worker = null;
let job = 0;
let timer = 0;
  let picking = false;
let last = null;
let resizeBound = false;
let loadedPreset = '';

const state = {
  ...DEFAULTS,
  shirtKey: 'black',
  shirt: SHIRTS.black.slice(),
  zoom: 'fit',
  compare: 100,
  fileName: '',
};

function presets() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}
function savePresets(all) {
  localStorage.setItem(STORE, JSON.stringify(all));
}
function shown(mm) {
  const n = state.unit === 'in' ? mm / 25.4 : mm;
  return state.unit === 'in' ? n.toFixed(2) : String(Math.round(n * 10) / 10);
}
function fromShown(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return state.unit === 'in' ? 25.4 : 10;
  return state.unit === 'in' ? n * 25.4 : n;
}
function pageMm() {
  let w = Math.max(10, state.widthMm);
  let h = Math.max(10, state.heightMm);
  if (state.lock && source) h = w * (source.height / source.width);
  return { w, h };
}
function payload() {
  return {
    tolerance: state.tolerance,
    softness: state.softness,
    bgMode: state.bgMode,
    bgColor: state.bgColor,
    denoise: state.denoise,
    sharpen: state.sharpen,
    brightness: state.brightness,
    contrast: state.contrast,
    gamma: state.gamma,
    lpi: state.lpi,
    angle: state.angle,
    shape: state.shape,
    minDot: state.minDot,
    choke: state.choke,
    solid: state.solid,
    shading: state.shading,
    knockout: state.knockout,
    knockoutStrength: state.knockoutStrength,
    shirt: state.shirt,
    dpi: state.dpi,
  };
}
function exportBase() {
  const base = (state.fileName || 'artwork').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'artwork';
  return base + '-halftone';
}
function shirtCss() {
  const [r, g, b] = state.shirt;
  return `rgb(${r}, ${g}, ${b})`;
}
function hex(rgb) {
  return '#' + rgb.map(n => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')).join('');
}
function parseHex(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(value || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  worker = new Worker(new URL('./halftone-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.jobId !== job) return;
    if (e.data.error) {
      setStatus(e.data.error);
      return;
    }
    last = e.data;
    paint();
  };
  worker.onerror = () => setStatus('The halftone worker stopped. Reload the page and try again.');
  return worker;
}

function setStatus(text) {
  const el = $('[data-ht-status]');
  if (el) el.textContent = text;
}

function paint() {
  if (!last) return;
  const after = $('[data-ht-after]');
  const before = $('[data-ht-before]');
  const wipe = $('[data-ht-wipe]');
  const draw = (canvas, data) => {
    canvas.width = last.width;
    canvas.height = last.height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), last.width, last.height), 0, 0);
  };
  draw(before, last.placed);
  draw(after, last.halftone);
  draw(wipe, last.placed);
  applyZoom();
  const mm = pageMm();
  const capped = last.capped ? ' · capped at 40 megapixels' : '';
  setStatus(`${last.width} × ${last.height} px · ${state.dpi} DPI · ${shown(mm.w)} × ${shown(mm.h)} ${state.unit}${capped}`);
  const root = $('[data-ht]');
  if (root) root.dataset.ready = '1';
  document.querySelectorAll('[data-ht-png],[data-ht-pdf],[data-ht-psd]').forEach(b => { b.disabled = false; });
  $$busy(false);
}

function applyZoom() {
  const after = $('[data-ht-after]');
  const scroll = $('[data-ht-scroll]');
  if (!after || !after.width || !scroll) return;
  const frames = document.querySelectorAll('[data-ht-frame]');
  let cssW;
  if (state.zoom === 'fit') {
    const cols = window.matchMedia('(max-width: 980px)').matches ? 1 : 2;
    const gap = cols === 1 ? 0 : 16;
    cssW = Math.max(160, (scroll.clientWidth - 32 - gap) / cols);
  } else cssW = after.width * (Number(state.zoom) / 100);
  const cssH = cssW * (after.height / after.width);
  frames.forEach(frame => {
    frame.style.width = cssW + 'px';
    frame.style.height = cssH + 'px';
    frame.style.background = shirtCss();
  });
  scroll.classList.toggle('is-pixel', state.zoom !== 'fit');
  const wipe = $('[data-ht-wipe]');
  if (wipe) wipe.style.clipPath = `inset(0 ${Math.max(0, Math.min(100, state.compare))}% 0 0)`;
}

function $$busy(on) {
  const el = $('[data-ht-busy]');
  if (el) el.hidden = !on;
}

function schedule() {
  clearTimeout(timer);
  if (!source) return;
  $$busy(true);
  timer = setTimeout(render, 160);
}

async function render() {
  if (!source) return;
  const mm = pageMm();
  const fit = fitPagePixels(mm.w, mm.h, state.dpi);
  const id = ++job;
  const settings = payload();
  const w = getWorker();
  if (!w) {
    const canvas = document.createElement('canvas');
    canvas.width = fit.w;
    canvas.height = fit.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (state.mirror) { ctx.translate(fit.w, 0); ctx.scale(-1, 1); }
    const scale = Math.min(fit.w / source.width, fit.h / source.height);
    const dw = Math.max(1, Math.round(source.width * scale));
    const dh = Math.max(1, Math.round(source.height * scale));
    ctx.drawImage(source, Math.floor((fit.w - dw) / 2), Math.floor((fit.h - dh) / 2), dw, dh);
    const src = ctx.getImageData(0, 0, fit.w, fit.h);
    const placed = new Uint8ClampedArray(src.data);
    const halftone = processHalftone(src.data, fit.w, fit.h, settings);
    if (id !== job) return;
    last = { width: fit.w, height: fit.h, placed, halftone, capped: fit.capped };
    paint();
    return;
  }
  const bitmap = await createImageBitmap(source);
  if (id !== job) { bitmap.close(); return; }
  w.postMessage({ jobId: id, bitmap, width: fit.w, height: fit.h, settings, mirror: state.mirror, wantCutout: false, capped: fit.capped }, [bitmap]);
}

function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2500);
}

async function exportPng() {
  if (!last) return;
  const canvas = $('[data-ht-after]');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const bytes = pngWithDpi(new Uint8Array(await blob.arrayBuffer()), state.dpi);
  download(bytes, exportBase() + '.png', 'image/png');
  toast('PNG saved');
}

async function exportPdf() {
  if (!last) return;
  setStatus('Building the PDF…');
  const { PDFDocument } = await import(new URL('../vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url));
  const canvas = $('[data-ht-after]');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const png = pngWithDpi(new Uint8Array(await blob.arrayBuffer()), state.dpi);
  const mm = pageMm();
  const doc = await PDFDocument.create();
  const page = doc.addPage([mm.w / 25.4 * 72, mm.h / 25.4 * 72]);
  const image = await doc.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  download(await doc.save(), exportBase() + '.pdf', 'application/pdf');
  paint();
  toast('PDF saved');
}

async function exportPsd() {
  if (!last) return;
  setStatus('Building the PSD…');
  await new Promise(r => setTimeout(r, 30));
  const { writePsd } = await import(new URL('../vendor/ag-psd/index.js', import.meta.url));
  const layer = (name, data) => {
    const canvas = document.createElement('canvas');
    canvas.width = last.width;
    canvas.height = last.height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), last.width, last.height), 0, 0);
    return { name, canvas };
  };
  const cut = cutoutOnly(last.placed, last.width, last.height, payload());
  const bytes = writePsd({
    width: last.width,
    height: last.height,
    children: [
      layer('Original', last.placed),
      layer('Background removed', cut),
      layer('Halftone', last.halftone),
    ],
  });
  download(bytes, exportBase() + '.psd', 'image/vnd.adobe.photoshop');
  paint();
  toast('PSD saved');
}

function slider(key, label, min, max, step, map) {
  const value = map ? map.to(state[key]) : state[key];
  return `<label class="ht-sl">${label}<span data-ht-read="${key}">${value}</span><input data-ht-in="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function shell() {
  const sizeOpts = [...Object.keys(SIZES), 'Custom'].map(name => `<option value="${esc(name)}"${name === state.preset ? ' selected' : ''}>${esc(name)}</option>`).join('');
  const shirts = Object.keys(SHIRTS).map(name => `<button type="button" class="ht-swatch${state.shirtKey === name ? ' on' : ''}" data-ht-shirt="${name}" style="background:${shirtCssOf(name)}" aria-label="${name} shirt" aria-pressed="${state.shirtKey === name}"></button>`).join('');
  const saved = presets();
  const names = [...Object.keys(SEEDS), ...Object.keys(saved).filter(n => !SEEDS[n])];
  const presetOpts = names.map(name => `<option value="${esc(name)}"${name === loadedPreset ? ' selected' : ''}>${esc(name)}</option>`).join('');
  app.innerHTML = `<div class="ht" data-ht data-ready="0">
    <aside class="ht-side">
      <p class="eyebrow">Studio</p>
      <h1 class="h3">Halftone</h1>
      <p class="small mute">DTF dots for soft fades. Colour stays. Every pixel ends opaque or clear. Nothing is uploaded.</p>
      <div class="drop" data-ht-drop tabindex="0"><span class="ico" aria-hidden="true"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M7 10V1M3 5l4-4 4 4M1 13h12"/></svg></span><span><b>Drop a PNG, JPG, or WebP</b> or choose a file</span><input data-ht-file type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"></div>
      <p class="small mute" data-ht-name></p>

      <p class="k">Size</p>
      <div class="ht-row">
        <label>Preset<select data-ht-in="preset">${sizeOpts}</select></label>
        <label>Unit<select data-ht-in="unit"><option value="mm"${state.unit === 'mm' ? ' selected' : ''}>mm</option><option value="in"${state.unit === 'in' ? ' selected' : ''}>in</option></select></label>
      </div>
      <div class="ht-row">
        <label>Width<input data-ht-num="widthMm" type="number" min="0.4" step="0.1" value="${shown(state.widthMm)}"></label>
        <label>Height<input data-ht-num="heightMm" type="number" min="0.4" step="0.1" value="${shown(state.heightMm)}"></label>
      </div>
      <label class="check"><input data-ht-check="lock" type="checkbox"${state.lock ? ' checked' : ''}> Lock proportions to the artwork</label>
      <label class="ht-sl">DPI<span data-ht-read="dpi">${state.dpi}</span><input data-ht-in="dpi" type="range" min="72" max="600" step="1" value="${state.dpi}"></label>

      <p class="k">Background</p>
      <div class="ht-row">
        <button type="button" class="btn btn--sm btn--ghost" data-ht-bg="auto">Auto</button>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-bg="keep">Keep transparency</button>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-pick>Pick colour</button>
      </div>
      <p class="small mute">Auto keys a solid edge colour. Pick a colour to remove it. Keep transparency leaves an existing cut-out alone.</p>
      ${slider('tolerance', 'Tolerance', 0, 80, 1)}
      ${slider('softness', 'Soft edge', 0, 60, 1)}
      <p class="small mute">An on-device AI cut-out is not included. The model is too large to ship with Proofs, and solid print backgrounds are handled here.</p>

      <p class="k">Clean-up</p>
      <label class="check"><input data-ht-check="denoise" type="checkbox"${state.denoise ? ' checked' : ''}> Denoise</label>
      <label class="check"><input data-ht-check="sharpen" type="checkbox"${state.sharpen ? ' checked' : ''}> Sharpen</label>
      ${slider('brightness', 'Brightness', -40, 40, 1, { to: v => Math.round(v * 100), from: v => v / 100 })}
      ${slider('contrast', 'Contrast', -40, 40, 1, { to: v => Math.round(v * 100), from: v => v / 100 })}
      ${slider('gamma', 'Gamma', 40, 220, 1, { to: v => Math.round(v * 100), from: v => v / 100 })}

      <p class="k">Halftone</p>
      ${slider('lpi', 'LPI', 10, 85, 1)}
      ${slider('angle', 'Angle', 0, 90, 0.5)}
      <label class="ht-sl">Dot<select data-ht-in="shape">${['round', 'ellipse', 'square', 'line'].map(shape => `<option value="${shape}"${state.shape === shape ? ' selected' : ''}>${shape[0].toUpperCase() + shape.slice(1)}</option>`).join('')}</select></label>
      ${slider('minDot', 'Minimum dot', 0, 40, 1)}
      ${slider('choke', 'Choke', 0, 30, 1)}
      ${slider('solid', 'Solid threshold', 50, 100, 1)}
      ${slider('shading', 'Neutral shading', 0, 100, 1)}

      <p class="k">Shirt knockout</p>
      <label class="check"><input data-ht-check="knockout" type="checkbox"${state.knockout ? ' checked' : ''}> Knock out the shirt colour</label>
      ${slider('knockoutStrength', 'Strength', 0, 100, 1)}
      <p class="small mute">On a dark tee, this lets the garment show through a glow.</p>

      <p class="k">Presets</p>
      <div class="ht-row">
        <label class="ht-grow">Saved<select data-ht-presets><option value="">Choose</option>${presetOpts}</select></label>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-load>Load</button>
      </div>
      <div class="ht-row">
        <label class="ht-grow">Name<input data-ht-preset-name type="text" maxlength="40" placeholder="Dark tee glow"></label>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-save>Save</button>
      </div>
      <button type="button" class="lnk" data-ht-delete>Delete saved preset</button>

      <p class="k">Export</p>
      <label class="check"><input data-ht-check="mirror" type="checkbox"${state.mirror ? ' checked' : ''}> Mirror for film</label>
      <div class="btns" style="margin-top:14px">
        <button type="button" class="btn btn--sm" data-ht-png disabled>PNG</button>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-pdf disabled>PDF</button>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-psd disabled>PSD</button>
      </div>
      <p class="small mute">PNG carries the DPI. PDF is the print size. PSD has the original, the cut-out, and the halftone.</p>
    </aside>
    <section class="ht-stage">
      <div class="ht-bar">
        <div class="grp" role="group" aria-label="Zoom">
          ${['fit', '50', '100', '200'].map(z => `<button type="button" class="ibtn ht-zoom${z === 'fit' ? ' on' : ''}" data-ht-zoom="${z}" aria-label="${z === 'fit' ? 'Fit' : z + ' percent'}">${z === 'fit' ? 'Fit' : z + '%'}</button>`).join('')}
        </div>
        <div class="grp" role="group" aria-label="Shirt colour">${shirts}<input data-ht-custom type="color" value="${hex(state.shirt)}" aria-label="Custom shirt colour"></div>
        <p class="small mute" data-ht-status>Drop artwork to start. Preview is the print, at 100% one pixel is one print pixel.</p>
        <p class="small" data-ht-busy hidden>Working…</p>
      </div>
      <div class="ht-scroll" data-ht-scroll>
        <div class="ht-empty" data-ht-empty><p class="h3">Drop artwork here</p><p class="mute">PNG, JPG, or WebP. Large files stay on this computer.</p></div>
        <div class="ht-pair" data-ht-pair hidden>
          <figure>
            <figcaption>Original</figcaption>
            <div class="ht-frame" data-ht-frame><canvas data-ht-before></canvas></div>
          </figure>
          <figure>
            <figcaption>Halftone <span class="dim">drag to compare</span></figcaption>
            <div class="ht-frame" data-ht-frame>
              <canvas data-ht-after></canvas>
              <canvas class="ht-wipe" data-ht-wipe></canvas>
              <input class="ht-range" data-ht-compare type="range" min="0" max="100" value="${state.compare}" aria-label="Before and after">
            </div>
          </figure>
        </div>
      </div>
    </section>
  </div>`;
}

function shirtCssOf(name) {
  const [r, g, b] = SHIRTS[name];
  return `rgb(${r},${g},${b})`;
}

function readControl(key, value) {
  const map = {
    brightness: v => v / 100,
    contrast: v => v / 100,
    gamma: v => v / 100,
  };
  state[key] = map[key] ? map[key](Number(value)) : (key === 'shape' || key === 'preset' || key === 'unit' || key === 'bgMode' ? value : Number(value));
  const read = document.querySelector(`[data-ht-read="${key}"]`);
  if (read) read.textContent = value;
}

function syncSizeInputs() {
  const mm = pageMm();
  const w = $('[data-ht-num="widthMm"]');
  const h = $('[data-ht-num="heightMm"]');
  if (w && document.activeElement !== w) w.value = shown(mm.w);
  if (h) {
    h.value = shown(mm.h);
    h.disabled = !!state.lock;
  }
}

function applyPreset(name) {
  const all = { ...SEEDS, ...presets() };
  const preset = all[name];
  if (!preset) return;
  loadedPreset = name;
  Object.assign(state, preset);
  if (preset.shirtKey && SHIRTS[preset.shirtKey]) state.shirt = SHIRTS[preset.shirtKey].slice();
  shell();
  bind();
  if (source) {
    $('[data-ht-empty]').hidden = true;
    $('[data-ht-pair]').hidden = false;
    $('[data-ht-name]').textContent = state.fileName;
    document.querySelectorAll('[data-ht-png],[data-ht-pdf],[data-ht-psd]').forEach(b => { b.disabled = false; });
    schedule();
  }
}

function refreshPresetList() {
  const sel = $('[data-ht-presets]');
  if (!sel) return;
  const saved = presets();
  const names = [...Object.keys(SEEDS), ...Object.keys(saved).filter(n => !SEEDS[n])];
  const current = sel.value;
  sel.innerHTML = `<option value="">Choose</option>` + names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  sel.value = names.includes(current) ? current : '';
}

async function useFile(file) {
  if (!file) return;
  const ok = /image\/(png|jpeg|webp)/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!ok) { toast('Use a PNG, JPG, or WebP'); return; }
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch (err) { toast(err.message || 'Could not read that file'); return; }
  if (source) source.close();
  source = bitmap;
  last = null;
  state.fileName = file.name;
  if (state.lock) {
    state.widthMm = bitmap.width / state.dpi * 25.4;
    state.heightMm = bitmap.height / state.dpi * 25.4;
    state.preset = 'Custom';
    const preset = $('[data-ht-in="preset"]');
    if (preset) preset.value = 'Custom';
  }
  $('[data-ht-empty]').hidden = true;
  $('[data-ht-pair]').hidden = false;
  $('[data-ht-name]').textContent = file.name;
  syncSizeInputs();
  setStatus('Rendering…');
  schedule();
}

function bind() {
  const drop = $('[data-ht-drop]');
  const file = $('[data-ht-file]');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => useFile(file.files && file.files[0]));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('is-over');
    useFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  const scroll = $('[data-ht-scroll]');
  ['dragenter', 'dragover'].forEach(ev => scroll.addEventListener(ev, e => e.preventDefault()));
  scroll.addEventListener('drop', e => { e.preventDefault(); useFile(e.dataTransfer.files && e.dataTransfer.files[0]); });

  document.querySelectorAll('[data-ht-in]').forEach(el => {
    el.addEventListener('input', () => {
      const key = el.dataset.htIn;
      readControl(key, el.value);
      if (key === 'preset' && SIZES[el.value]) {
        state.lock = false;
        state.widthMm = SIZES[el.value][0];
        state.heightMm = SIZES[el.value][1];
        const lock = $('[data-ht-check="lock"]');
        if (lock) lock.checked = false;
        syncSizeInputs();
      }
      if (key === 'unit') syncSizeInputs();
      schedule();
    });
  });
  document.querySelectorAll('[data-ht-num]').forEach(el => {
    el.addEventListener('change', () => {
      const mm = fromShown(el.value);
      if (el.dataset.htNum === 'widthMm') state.widthMm = mm;
      else state.heightMm = mm;
      state.preset = 'Custom';
      const preset = $('[data-ht-in="preset"]');
      if (preset) preset.value = 'Custom';
      syncSizeInputs();
      schedule();
    });
  });
  document.querySelectorAll('[data-ht-check]').forEach(el => {
    el.addEventListener('change', () => {
      state[el.dataset.htCheck] = el.checked;
      if (el.dataset.htCheck === 'lock') syncSizeInputs();
      schedule();
    });
  });
  document.querySelectorAll('[data-ht-bg]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.bgMode = btn.dataset.htBg;
      picking = false;
      document.body.classList.remove('is-picking');
      schedule();
    });
  });
  $('[data-ht-pick]').addEventListener('click', () => {
    picking = !picking;
    document.body.classList.toggle('is-picking', picking);
    toast(picking ? 'Click a colour to remove' : 'Eyedropper off');
  });
  const sample = (canvas, event) => {
    if (!picking || !canvas.width) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * canvas.height)));
    const px = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    state.bgMode = 'color';
    state.bgColor = [px[0], px[1], px[2]];
    picking = false;
    document.body.classList.remove('is-picking');
    schedule();
  };
  $('[data-ht-before]').addEventListener('click', e => sample(e.currentTarget, e));
  $('[data-ht-after]').addEventListener('click', e => sample(e.currentTarget, e));

  $('[data-ht-compare]').addEventListener('input', e => {
    state.compare = Number(e.target.value);
    const wipe = $('[data-ht-wipe]');
    if (wipe) wipe.style.clipPath = `inset(0 ${state.compare}% 0 0)`;
  });
  document.querySelectorAll('[data-ht-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.zoom = btn.dataset.htZoom;
      document.querySelectorAll('[data-ht-zoom]').forEach(b => b.classList.toggle('on', b === btn));
      applyZoom();
    });
  });
  document.querySelectorAll('[data-ht-shirt]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.shirtKey = btn.dataset.htShirt;
      state.shirt = SHIRTS[state.shirtKey].slice();
      document.querySelectorAll('[data-ht-shirt]').forEach(b => {
        const on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const custom = $('[data-ht-custom]');
      if (custom) custom.value = hex(state.shirt);
      applyZoom();
      if (state.knockout) schedule();
    });
  });
  $('[data-ht-custom]').addEventListener('input', e => {
    state.shirtKey = 'custom';
    state.shirt = parseHex(e.target.value);
    document.querySelectorAll('[data-ht-shirt]').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
    applyZoom();
    if (state.knockout) schedule();
  });
  $('[data-ht-load]').addEventListener('click', () => {
    const name = $('[data-ht-presets]').value;
    if (!name) { toast('Choose a preset'); return; }
    applyPreset(name);
    toast('Preset loaded');
  });
  $('[data-ht-save]').addEventListener('click', () => {
    const name = $('[data-ht-preset-name]').value.trim();
    if (!name) { toast('Name the preset'); return; }
    const all = presets();
    all[name] = payload();
    all[name].shirtKey = state.shirtKey;
    all[name].mirror = state.mirror;
    all[name].dpi = state.dpi;
    savePresets(all);
    refreshPresetList();
    $('[data-ht-presets]').value = name;
    toast('Preset saved on this computer');
  });
  $('[data-ht-delete]').addEventListener('click', () => {
    const name = $('[data-ht-presets]').value;
    const all = presets();
    if (!name || !all[name]) { toast('Choose a preset you saved'); return; }
    delete all[name];
    savePresets(all);
    refreshPresetList();
    toast('Preset deleted');
  });
  $('[data-ht-png]').addEventListener('click', () => exportPng().catch(err => toast(err.message || 'PNG failed')));
  $('[data-ht-pdf]').addEventListener('click', () => exportPdf().catch(err => toast(err.message || 'PDF failed')));
  $('[data-ht-psd]').addEventListener('click', () => exportPsd().catch(err => toast(err.message || 'PSD failed')));
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', applyZoom);
  }
  syncSizeInputs();
}

export async function halftonePage() {
  document.title = 'Halftone · YBI Proofs';
  shell();
  bind();
}

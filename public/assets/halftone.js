import { $, esc, toast } from './common.js';
import { DEFAULTS, MAX_SIDE, SUBSTRATES, TONE, autoTolerance, detectBackground, formatLength, hexOf, outputPixels, parseHex, pngWithDpi, processHalftone, qualityLabel, resampleRGBA, substrateById, trueDpi } from './halftone-core.mjs';

const app = $('#app');
const GUIDE_KEY = 'ybi-halftone-guide';
const GARMENTS = {
  black: [8, 8, 10],
  white: [244, 242, 236],
  navy: [18, 32, 64],
  grey: [118, 118, 122],
  red: [148, 28, 36],
};
const SIZES = [
  ['custom', 'Custom'],
  ['original', 'Original'],
  ['letter', 'Letter', 8],
  ['tabloid', 'Tabloid', 10.5],
  ['a3plus', 'A3+', 12.5],
  ['a4', 'A4', 8.27],
  ['a3', 'A3', 11.69],
];
const TABS = [
  ['prepare', 'Prepare', 'Output size and background removal'],
  ['adjust', 'Adjust', 'Brightness, contrast and ink color'],
  ['screen', 'Screen', 'Dot shape, frequency and angle'],
  ['fix', 'Fix Pro', 'Edge cleanup and semi-transparency'],
];
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

const state = {
  ...DEFAULTS,
  unit: 'in',
  sizePreset: 'custom',
  widthIn: 8,
  profile: 'vibrant',
  substrate: 'custom',
  garmentKey: 'black',
  bgAuto: true,
  toleranceAuto: true,
  mirror: true,
  fileName: '',
};
let source = null;
let worker = null;
let job = 0;
let timer = 0;
let zoom = 'fit';
let view = 'result';
let showBefore = false;
let tab = 'prepare';
let last = null;
let past = [];
let future = [];
let savedSnap = '';
let historyLock = false;
let resizeBound = false;
const waiters = {};

function garmentCss() {
  const [r, g, b] = state.garment;
  return `rgb(${r}, ${g}, ${b})`;
}
function heightIn() {
  if (!source || !state.widthIn) return state.widthIn;
  return state.widthIn * (source.height / source.width);
}
function shownWidth() {
  return state.unit === 'cm' ? state.widthIn * 2.54 : state.widthIn;
}
function setWidthFromUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  state.widthIn = state.unit === 'cm' ? n / 2.54 : n;
  state.widthIn = Math.min(state.unit === 'cm' ? 200 / 2.54 : 200, Math.max(state.unit === 'cm' ? 0.5 / 2.54 : 0.5, state.widthIn));
}
function payload(previewErase = state.previewErase) {
  return {
    removeBg: state.removeBg,
    bgColor: state.bgColor,
    tolerance: state.tolerance,
    protect: state.protect,
    gain: state.gain,
    contrast: state.contrast,
    gamma: state.gamma,
    saturation: state.saturation,
    halftone: state.halftone,
    shape: state.shape,
    lpi: state.lpi,
    angle: state.angle,
    doubleScreen: state.doubleScreen,
    shrink: state.shrink,
    specks: state.specks,
    output: state.output,
    ink: state.ink,
    minDotMm: state.minDotMm,
    eraseThreshold: state.eraseThreshold,
    edgeColorPx: state.edgeColorPx,
    smoothEdge: state.smoothEdge,
    fillHoles: state.fillHoles,
    previewErase,
    knockout: state.knockout,
    knockoutStrength: state.knockoutStrength,
    knockoutTarget: state.knockoutTarget,
    blackRange: state.blackRange,
    protectColours: state.protectColours,
    garment: state.garment,
    dpi: state.dpi,
    screen: state.screen,
    denoise: state.denoise,
    sharpen: state.sharpen,
  };
}
function snap() {
  return JSON.stringify({
    ...state,
    bgColor: state.bgColor.slice(),
    garment: state.garment.slice(),
    ink: state.ink.slice(),
  });
}
function restore(json) {
  const data = JSON.parse(json);
  historyLock = true;
  Object.assign(state, data);
  historyLock = false;
  savedSnap = snap();
  refreshAll();
  schedule();
}
function commit() {
  if (historyLock) return;
  const now = snap();
  if (now === savedSnap) return;
  if (savedSnap) past.push(savedSnap);
  if (past.length > 40) past.shift();
  savedSnap = now;
  future = [];
  syncHistory();
}
function fileBase() {
  return (state.fileName || 'artwork').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'artwork';
}
function analyze(bitmap) {
  const w = Math.min(bitmap.width, 720);
  const h = Math.max(1, Math.round(bitmap.height * (w / bitmap.width)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const bg = detectBackground(data, w, h);
  return { bg, tolerance: autoTolerance(data, w, h, bg) };
}

function shell() {
  const tabs = TABS.map(([id, name]) => `<button type="button" role="tab" data-ht-tab="${id}" aria-selected="${id === tab}">${name}</button>`).join('');
  const garments = Object.keys(GARMENTS).map(name => `<button type="button" class="ht-swatch${state.garmentKey === name ? ' on' : ''}" data-ht-shirt="${name}" style="background:rgb(${GARMENTS[name].join(',')})" aria-label="${name} garment"></button>`).join('');
  const subs = SUBSTRATES.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
  app.innerHTML = `<div class="ht" data-ht data-ready="0">
    <aside class="ht-side">
      <div class="ht-sidehead"><p class="eyebrow">Studio</p><button type="button" class="lnk" data-ht-guide-open>Guide</button></div>
      <h1 class="h3">Halftone</h1>
      <div class="ht-tabs" role="tablist">${tabs}</div>
      <p class="small mute" data-ht-tabhelp></p>
      <div data-ht-panel></div>
    </aside>
    <section class="ht-stage">
      <div class="ht-tools">
        <button type="button" class="btn btn--sm btn--ghost" data-ht-undo disabled>Undo</button>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-redo disabled>Redo</button>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-before aria-pressed="false">Before/After</button>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-layers>Layers</button>
        <div class="ht-pop" data-ht-layers-pop hidden>
          <button type="button" data-ht-layer="result">Halftone</button>
          <button type="button" data-ht-layer="cutout">Background removed</button>
          <button type="button" data-ht-layer="original">Original</button>
        </div>
        <div class="ht-garments" role="group" aria-label="Garment color">${garments}<input data-ht-custom type="color" value="${hexOf(state.garment)}" aria-label="Custom garment color"></div>
      </div>
      <div class="ht-scroll" data-ht-scroll>
        <div class="ht-empty" data-ht-empty><p class="h3">Drop artwork here</p><p class="mute">PNG, JPG, or WebP. Up to 12,000 px on a side. Nothing is uploaded.</p></div>
        <div class="ht-card" data-ht-card hidden>
          <div class="ht-frame" data-ht-frame><canvas data-ht-view></canvas></div>
          <div class="ht-cardacts"><button type="button" class="lnk" data-ht-replace>Replace</button><button type="button" class="lnk" data-ht-clear>Clear</button></div>
        </div>
      </div>
      <div class="ht-zoombar">
        <button type="button" class="ibtn" data-ht-z="out" aria-label="Zoom out">−</button>
        <button type="button" class="ibtn" data-ht-z="in" aria-label="Zoom in">+</button>
        <button type="button" class="ibtn" data-ht-z="fit" aria-label="Fit">Fit</button>
        <button type="button" class="ibtn" data-ht-z="100" aria-label="100 percent">100%</button>
        <span class="small mute" data-ht-zlabel>Fit</span>
        <span class="small" data-ht-busy hidden>Working…</span>
      </div>
      <div class="ht-bottom">
        <div><span class="k">Source</span><b data-ht-source>—</b></div>
        <div><span class="k">Printable</span><b data-ht-print>—</b></div>
        <div><span class="k">Quality</span><b data-ht-quality>—</b></div>
        <button type="button" class="btn btn--sm btn--ghost" data-ht-preflight disabled>DTF preflight · View report</button>
        <label class="ht-sub">Substrate<select data-ht-substrate>${subs}</select></label>
        <button type="button" class="btn btn--sm" data-ht-export disabled>Export</button>
      </div>
    </section>
  </div>
  <div class="modal" data-ht-guide hidden><div class="panel">
    <div class="modal__h"><h2 class="h3">How it works</h2><button type="button" class="ibtn" data-ht-close aria-label="Close">✕</button></div>
    <ol class="ht-guide">
      <li><b>Prepare.</b> Set the print size and lift a solid background. Height follows the artwork, so the image is not stretched.</li>
      <li><b>Adjust.</b> Vibrant is the start for dark garments. Dense is for light garments. Default leaves the colour alone.</li>
      <li><b>Screen.</b> Round dots at a DTF frequency. Turn the screen off and only the edge is cleaned.</li>
      <li><b>Fix Pro.</b> Edges are cleaned as the file comes in. The manual tools are only for a special case.</li>
    </ol>
    <p class="small mute">The work stays in this browser. Artwork is not uploaded.</p>
    <div class="btns" style="margin-top:22px"><button type="button" class="btn btn--sm" data-ht-close>Got it</button></div>
  </div></div>
  <div class="modal" data-ht-report hidden><div class="panel">
    <div class="modal__h"><h2 class="h3">DTF preflight</h2><button type="button" class="ibtn" data-ht-close aria-label="Close">✕</button></div>
    <dl class="ht-report" data-ht-report-body></dl>
    <div class="btns" style="margin-top:22px"><button type="button" class="btn btn--sm" data-ht-close>Close</button></div>
  </div></div>
  <div class="modal" data-ht-saveas hidden><div class="panel">
    <div class="modal__h"><h2 class="h3">Choose the file format for your design.</h2><button type="button" class="ibtn" data-ht-close aria-label="Close">✕</button></div>
    <label class="check"><input data-ht-mirror type="checkbox" checked> Mirror (for DTF film) <span class="opt">Flips the file horizontally</span></label>
    <div class="ht-formats">
      <button type="button" data-ht-kind="png"><b>Transparent PNG</b> <span class="ht-rec">Recommended</span><span>The DTF standard: keeps the transparency and the real print resolution. Opens in any RIP (AcroRIP, CADlink, Flexi…).</span></button>
      <button type="button" data-ht-kind="psd"><b>Layered Photoshop PSD</b><span>The halftone on its own layer, plus a hidden garment-color layer. For final touch-ups in Photoshop before printing.</span></button>
      <button type="button" data-ht-kind="pdf"><b>Print-ready PDF</b><span>One page at the exact print size, with the full-resolution design and its transparency. For CorelDRAW, Illustrator or print shops that ask for PDF.</span></button>
    </div>
  </div></div>`;
}

function slider(key, label, min, max, step, help) {
  const value = state[key];
  const shown = typeof value === 'number' ? String(step < 1 ? roundStep(value, step) : value) : value;
  return `<label class="ht-sl">${label}<span data-ht-read="${key}">${shown}</span><input data-ht-range="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${shown}">${help ? `<span class="ht-help">${help}</span>` : ''}</label>`;
}
function roundStep(n, step) {
  const p = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(n.toFixed(p));
}
function preparePanel() {
  const sizeOpts = SIZES.map(([id, name]) => `<option value="${id}"${state.sizePreset === id ? ' selected' : ''}>${name}</option>`).join('');
  return `<div class="drop" data-ht-drop tabindex="0"><span><b>Drop a PNG, JPG, or WebP</b> or choose a file. Up to 12,000 px on a side.</span><input data-ht-file type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"></div>
    <p class="small mute" data-ht-name>${esc(state.fileName)}</p>
    <p class="ht-help">For a sharp print, aim for 250 px per inch. Letter 8 × 10.5 in needs 2000 × 2625 px. Tabloid 10.5 × 16.5 in needs 2625 × 4125 px. A3+ 12.5 × 19.5 in needs 3125 × 4875 px. A small image stretched to a large size will look soft in print.</p>
    <div class="ht-row">
      <span class="k">Units</span>
      <div class="ht-pills" role="group" aria-label="Units"><button type="button" data-ht-unit="in" class="${state.unit === 'in' ? 'on' : ''}">in</button><button type="button" data-ht-unit="cm" class="${state.unit === 'cm' ? 'on' : ''}">cm</button></div>
    </div>
    <label class="ht-sl">Size<select data-ht-size>${sizeOpts}</select></label>
    <div class="ht-row">
      <label>Width<input data-ht-width type="number" min="0.5" max="200" step="0.25" value="${roundStep(shownWidth(), 0.01)}"></label>
      <label>Height<input data-ht-height type="text" readonly value="${source ? roundStep(state.unit === 'cm' ? heightIn() * 2.54 : heightIn(), 0.01) : ''}"></label>
    </div>
    <p class="ht-help">Height is worked out automatically so the image is not stretched.</p>
    ${slider('dpi', 'Resolution (dpi)', 150, 1200, 10)}
    <label class="check"><input data-ht-check="removeBg" type="checkbox"${state.removeBg ? ' checked' : ''}> Remove background <span class="opt">Keeps only the artwork, no halos</span></label>
    <div class="ht-row">
      <label>Target color<input data-ht-bg type="color" value="${hexOf(state.bgColor)}"></label>
      <button type="button" class="btn btn--sm btn--ghost" data-ht-auto>Auto</button>
    </div>
    ${slider('tolerance', 'Tolerance', 0, 1, 0.01, 'How much gets cleaned: the background color and the near-black haze (fades and smoke end clean). Auto sets it for each image.')}
    <label class="check"><input data-ht-check="protect" type="checkbox"${state.protect ? ' checked' : ''}> Protect subject <span class="opt">Turn off to also remove that color inside the artwork</span></label>`;
}
function adjustPanel() {
  const pills = ['default', 'vibrant', 'dense'].map(name => `<button type="button" data-ht-profile="${name}" class="${state.profile === name ? 'on' : ''}">${name === 'vibrant' ? 'Vibrant' : name === 'dense' ? 'Dense' : 'Default'}</button>`).join('');
  return `<p class="k">Tone profile</p><div class="ht-pills">${pills}</div>
    <p class="ht-help">Vibrant is for dark garments. Dense is for light garments.</p>
    ${slider('gain', 'Gain', -100, 100, 1)}
    ${slider('contrast', 'Contrast', -100, 100, 1)}
    ${slider('gamma', 'Gamma', 0.1, 3, 0.01)}
    ${slider('saturation', 'Saturation', 0, 3, 0.05)}
    <label class="check"><input data-ht-check="denoise" type="checkbox"${state.denoise ? ' checked' : ''}> Denoise</label>
    <label class="check"><input data-ht-check="sharpen" type="checkbox"${state.sharpen ? ' checked' : ''}> Sharpen</label>`;
}
function screenPanel() {
  const shapes = ['circle', 'ellipse', 'diamond', 'square', 'euclidean'].map(name => `<option value="${name}"${state.shape === name || (name === 'circle' && state.shape === 'round') ? ' selected' : ''}>${name[0].toUpperCase() + name.slice(1)}</option>`).join('');
  return `<label class="check"><input data-ht-check="halftone" type="checkbox"${state.halftone ? ' checked' : ''}> Apply halftone <span class="opt">Off: only the edge is cleaned</span></label>
    <div class="ht-pills"><button type="button" data-ht-shape="round" class="${state.shape === 'round' || state.shape === 'circle' ? 'on' : ''}">Round</button><button type="button" data-ht-shape="line" class="${state.shape === 'line' ? 'on' : ''}">Line</button></div>
    <p class="k">Knockout target</p>
    <div class="ht-pills"><button type="button" data-ht-target="blacks" class="${state.knockoutTarget !== 'tones' ? 'on' : ''}">Blacks only</button><button type="button" data-ht-target="tones" class="${state.knockoutTarget === 'tones' ? 'on' : ''}">All tones</button></div>
    <p class="ht-help">Blacks only turns near-black and fades into black into dots. Solid blue, red and white stay solid.</p>
    ${slider('blackRange', 'Black range', 0, 100, 1, 'How dark a colour must be before it starts screening.')}
    ${slider('protectColours', 'Protect colours', 0, 100, 1, 'Colours more saturated than this stay solid.')}
    ${slider('lpi', 'Frequency (LPI)', 10, 100, 1)}
    ${slider('angle', 'Angle', 0, 90, 0.5)}
    <label class="check"><input data-ht-check="doubleScreen" type="checkbox"${state.doubleScreen ? ' checked' : ''}> Double screen <span class="opt">A second, rotated and denser screen</span></label>
    ${slider('shrink', 'Shrink edge (px)', -5, 10, 1)}
    ${slider('specks', 'Remove specks (px)', 0, 400, 1)}
    <details class="ht-more"><summary>More options</summary>
      <label class="ht-sl">Output<select data-ht-output><option value="original"${state.output === 'original' ? ' selected' : ''}>Original color</option><option value="single"${state.output === 'single' ? ' selected' : ''}>Single ink</option><option value="cmyk"${state.output === 'cmyk' ? ' selected' : ''}>CMYK</option></select></label>
      <label class="ht-sl">Ink<input data-ht-ink type="color" value="${hexOf(state.ink)}"></label>
      <label class="ht-sl">Dot shape<select data-ht-moreshape>${shapes}</select></label>
      ${slider('minDotMm', 'Minimum dot (mm)', 0, 1, 0.01)}
    </details>`;
}
function fixPanel() {
  const n = last ? last.semi : 0;
  const pct = last ? (n / (last.width * last.height) * 100) : 0;
  const status = !last ? 'Drop artwork to check the edges.' : n === 0 ? 'Image is in great shape!' : `${n.toLocaleString()} semi-transparent pixels (${pct.toFixed(2)}%) were cleaned automatically: no halos or dirty edges.`;
  return `<div class="ht-status" data-ht-statuscard>${esc(status)}</div>
    <details class="ht-more"><summary>Manual adjustment</summary>
      <p class="ht-help">The image is already ready; this is only needed in special cases.</p>
      <label class="check"><input data-ht-check="previewErase" type="checkbox"${state.previewErase ? ' checked' : ''}> Preview selection <span class="opt">Marks in magenta what will be erased</span></label>
      ${slider('eraseThreshold', 'Erase threshold', 3, 252, 1)}
      ${slider('edgeColorPx', 'Remove edge color (px)', 0, 6, 1)}
      ${slider('smoothEdge', 'Smooth edge', 0, 3, 0.1)}
      ${slider('fillHoles', 'Fill holes (px)', 0, 400, 1)}
    </details>`;
}

function renderPanel() {
  const help = $('[data-ht-tabhelp]');
  const found = TABS.find(([id]) => id === tab);
  if (help) help.textContent = found ? found[2] : '';
  document.querySelectorAll('[data-ht-tab]').forEach(btn => {
    const on = btn.dataset.htTab === tab;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const panel = $('[data-ht-panel]');
  if (!panel) return;
  panel.innerHTML = tab === 'adjust' ? adjustPanel() : tab === 'screen' ? screenPanel() : tab === 'fix' ? fixPanel() : preparePanel();
  bindPanel();
}

function bindPanel() {
  const drop = $('[data-ht-drop]');
  const file = $('[data-ht-file]');
  if (drop && file) {
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    file.addEventListener('change', () => useFile(file.files && file.files[0]));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('is-over'); useFile(e.dataTransfer.files && e.dataTransfer.files[0]); });
  }
  document.querySelectorAll('[data-ht-range]').forEach(el => {
    el.addEventListener('input', () => {
      state[el.dataset.htRange] = Number(el.value);
      const read = document.querySelector(`[data-ht-read="${el.dataset.htRange}"]`);
      if (read) read.textContent = el.value;
      if (el.dataset.htRange === 'tolerance') state.toleranceAuto = false;
      if (['gain', 'contrast', 'gamma', 'saturation'].includes(el.dataset.htRange)) markCustom();
      if (['dpi', 'lpi', 'angle', 'shrink', 'specks', 'minDotMm', 'smoothEdge', 'blackRange', 'protectColours'].includes(el.dataset.htRange)) markCustom();
      schedule();
    });
    el.addEventListener('change', commit);
  });
  document.querySelectorAll('[data-ht-check]').forEach(el => {
    el.addEventListener('change', () => {
      state[el.dataset.htCheck] = el.checked;
      markCustom();
      commit();
      schedule();
    });
  });
  document.querySelectorAll('[data-ht-unit]').forEach(btn => btn.addEventListener('click', () => {
    state.unit = btn.dataset.htUnit;
    commit();
    renderPanel();
  }));
  const size = $('[data-ht-size]');
  if (size) size.addEventListener('change', () => {
    state.sizePreset = size.value;
    const picked = SIZES.find(([id]) => id === size.value);
    if (size.value === 'original' && source) state.widthIn = source.width / state.dpi;
    else if (picked && picked[2]) state.widthIn = picked[2];
    commit();
    renderPanel();
    schedule();
  });
  const width = $('[data-ht-width]');
  if (width) width.addEventListener('change', () => {
    setWidthFromUnit(width.value);
    state.sizePreset = 'custom';
    commit();
    renderPanel();
    schedule();
  });
  const bg = $('[data-ht-bg]');
  if (bg) bg.addEventListener('input', () => {
    state.bgColor = parseHex(bg.value);
    state.bgAuto = false;
    commit();
    schedule();
  });
  const auto = $('[data-ht-auto]');
  if (auto) auto.addEventListener('click', () => { runAuto(); commit(); });
  document.querySelectorAll('[data-ht-profile]').forEach(btn => btn.addEventListener('click', () => {
    state.profile = btn.dataset.htProfile;
    Object.assign(state, TONE[state.profile]);
    markCustom();
    commit();
    renderPanel();
    schedule();
  }));
  document.querySelectorAll('[data-ht-shape]').forEach(btn => btn.addEventListener('click', () => {
    state.shape = btn.dataset.htShape;
    markCustom();
    commit();
    renderPanel();
    schedule();
  }));
  document.querySelectorAll('[data-ht-target]').forEach(btn => btn.addEventListener('click', () => {
    state.knockoutTarget = btn.dataset.htTarget;
    markCustom();
    commit();
    renderPanel();
    schedule();
  }));
  const output = $('[data-ht-output]');
  if (output) output.addEventListener('change', () => {
    state.output = output.value;
    if (state.output === 'single' && state.ink.every(n => n === 0) === false && state.screen !== 'fm') { /* keep ink */ }
    markCustom();
    commit();
    schedule();
  });
  const more = $('[data-ht-moreshape]');
  if (more) more.addEventListener('change', () => {
    state.shape = more.value === 'circle' ? 'round' : more.value;
    markCustom();
    commit();
    renderPanel();
    schedule();
  });
  const ink = $('[data-ht-ink]');
  if (ink) ink.addEventListener('input', () => { state.ink = parseHex(ink.value); state.output = 'single'; commit(); schedule(); });
}

function markCustom() {
  if (state.substrate !== 'custom') {
    state.substrate = 'custom';
    const sel = $('[data-ht-substrate]');
    if (sel) sel.value = 'custom';
  }
}
function runAuto() {
  if (!source) return;
  const found = analyze(source);
  state.bgColor = found.bg;
  state.bgAuto = true;
  state.tolerance = found.tolerance;
  state.toleranceAuto = true;
  renderPanel();
  schedule();
}
function syncHistory() {
  const undo = $('[data-ht-undo]');
  const redo = $('[data-ht-redo]');
  if (undo) undo.disabled = past.length === 0;
  if (redo) redo.disabled = future.length === 0;
}
function refreshAll() {
  const sel = $('[data-ht-substrate]');
  if (sel) sel.value = state.substrate;
  document.querySelectorAll('[data-ht-shirt]').forEach(btn => btn.classList.toggle('on', btn.dataset.htShirt === state.garmentKey));
  const custom = $('[data-ht-custom]');
  if (custom) custom.value = hexOf(state.garment);
  const mirror = $('[data-ht-mirror]');
  if (mirror) mirror.checked = state.mirror;
  renderPanel();
  applyZoom();
  syncHistory();
}

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  worker = new Worker(new URL('./halftone-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.jobId !== job) return;
    if (e.data.error) { setBusy(false); toast(e.data.error); if (waiters[e.data.jobId]) waiters[e.data.jobId](null); return; }
    const exact = fullSize();
    last = e.data;
    last.full = e.data.width === exact.w && e.data.height === exact.h;
    last.proxy = !last.full;
    paint();
    if (waiters[e.data.jobId]) waiters[e.data.jobId](last);
  };
  worker.onerror = () => { setBusy(false); toast('The halftone worker stopped. Reload the page and try again.'); };
  return worker;
}
function setBusy(on) {
  const el = $('[data-ht-busy]');
  if (el) el.hidden = !on;
}
function schedule() {
  clearTimeout(timer);
  if (!source) return;
  setBusy(true);
  timer = setTimeout(() => { render().catch(err => { setBusy(false); toast(err.message || 'Could not render'); }); }, 140);
}
function fullSize() {
  return outputPixels(state.widthIn, heightIn(), state.dpi);
}
let plate = null;
function storePlate(data, w, h) {
  if (!plate) plate = document.createElement('canvas');
  plate.width = w;
  plate.height = h;
  plate.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
}
function viewScale(printW, printH) {
  if (zoom === 'fit') {
    const scroll = $('[data-ht-scroll]');
    if (!scroll) return 1;
    return Math.max(0.05, Math.min(1, (scroll.clientWidth - 48) / printW, (scroll.clientHeight - 48) / printH));
  }
  return zoom;
}
async function render() {
  if (!source) return;
  clearTimeout(timer);
  const size = fullSize();
  const id = ++job;
  const settings = { ...payload(), dpi: state.dpi };
  const engine = getWorker();
  if (!engine) {
    const sw = source.width, sh = source.height;
    const raw = new Uint8ClampedArray(sw * sh * 4);
    const grab = document.createElement('canvas');
    const band = 256;
    for (let y = 0; y < sh; y += band) {
      const n = Math.min(band, sh - y);
      grab.width = sw; grab.height = n;
      const g = grab.getContext('2d', { willReadFrequently: true });
      g.drawImage(source, 0, y, sw, n, 0, 0, sw, n);
      raw.set(g.getImageData(0, 0, sw, n).data, y * sw * 4);
    }
    const pixels = sw === size.w && sh === size.h ? raw : resampleRGBA(raw, sw, sh, size.w, size.h);
    const placed = new Uint8ClampedArray(pixels);
    const result = processHalftone(pixels, size.w, size.h, settings);
    if (id !== job) return;
    last = { width: size.w, height: size.h, placed, rgba: result.rgba, cutout: result.cutout, semi: result.semi, bg: result.bg, ms: result.ms, full: true, proxy: false };
    paint();
    return last;
  }
  const bitmap = await createImageBitmap(source);
  if (id !== job) { bitmap.close(); return; }
  const done = new Promise(resolve => { waiters[id] = resolve; });
  engine.postMessage({ jobId: id, bitmap, width: size.w, height: size.h, settings, purpose: 'print' }, [bitmap]);
  return done;
}
function paint() {
  if (!last) return;
  const which = showBefore || view === 'original' ? last.placed : view === 'cutout' ? last.cutout : last.rgba;
  storePlate(which, last.width, last.height);
  applyZoom();
  const src = $('[data-ht-source]');
  const printable = $('[data-ht-print]');
  const quality = $('[data-ht-quality]');
  if (source && src) src.textContent = `${source.width} × ${source.height} px`;
  if (printable) printable.textContent = `${formatLength(state.widthIn, state.unit)} × ${formatLength(heightIn(), state.unit)} ${state.unit}`;
  if (quality && source) quality.textContent = qualityLabel(trueDpi(source.width, state.widthIn));
  const root = $('[data-ht]');
  if (root) root.dataset.ready = '1';
  document.querySelectorAll('[data-ht-export],[data-ht-preflight]').forEach(btn => { btn.disabled = false; });
  if (tab === 'fix') {
    const card = $('[data-ht-statuscard]');
    if (card) {
      const n = last.semi || 0;
      const pct = (n / (last.width * last.height) * 100);
      card.textContent = n === 0 ? 'Image is in great shape!' : `${n.toLocaleString()} semi-transparent pixels (${pct.toFixed(2)}%) were cleaned automatically: no halos or dirty edges.`;
    }
  }
  setBusy(false);
}
function applyZoom() {
  const canvas = $('[data-ht-view]');
  const frame = $('[data-ht-frame]');
  const scroll = $('[data-ht-scroll]');
  if (!canvas || !plate || !plate.width || !frame || !scroll) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = viewScale(plate.width, plate.height);
  const cssW = Math.max(1, Math.round(plate.width * scale));
  const cssH = Math.max(1, Math.round(plate.height * scale));
  frame.style.width = cssW + 'px';
  frame.style.height = cssH + 'px';
  frame.style.background = garmentCss();
  const srect = scroll.getBoundingClientRect();
  const frect = frame.getBoundingClientRect();
  const left = Math.max(0, srect.left - frect.left);
  const top = Math.max(0, srect.top - frect.top);
  const right = Math.min(cssW, srect.right - frect.left);
  const bottom = Math.min(cssH, srect.bottom - frect.top);
  const vw = Math.max(1, Math.round(right - left));
  const vh = Math.max(1, Math.round(bottom - top));
  canvas.style.left = left + 'px';
  canvas.style.top = top + 'px';
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
  canvas.width = Math.max(1, Math.round(vw * dpr));
  canvas.height = Math.max(1, Math.round(vh * dpr));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const sx = left / scale;
  const sy = top / scale;
  const sw = Math.min(plate.width - sx, vw / scale);
  const sh = Math.min(plate.height - sy, vh / scale);
  if (sw > 0 && sh > 0) ctx.drawImage(plate, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const label = $('[data-ht-zlabel]');
  if (label) label.textContent = `${Math.round(scale * 100)}%`;
}
function fitScale() {
  const dims = plate && plate.width ? { w: plate.width, h: plate.height } : fullSize();
  return viewScale(dims.w, dims.h);
}

async function useFile(file) {
  if (!file) return;
  const ok = /image\/(png|jpeg|webp)/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!ok) { toast('Use a PNG, JPG, or WebP'); return; }
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch (err) { toast(err.message || 'Could not read that file'); return; }
  if (bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE) {
    bitmap.close();
    toast('That image is over 12,000 px on a side.');
    return;
  }
  if (source) source.close();
  source = bitmap;
  last = null;
  state.fileName = file.name;
  if (state.bgAuto || state.toleranceAuto) {
    const found = analyze(bitmap);
    if (state.bgAuto) state.bgColor = found.bg;
    if (state.toleranceAuto) state.tolerance = found.tolerance;
  }
  const sheet = SIZES.find(([id]) => id === state.sizePreset);
  if (!sheet || sheet[2] == null) state.widthIn = bitmap.width / state.dpi;
  $('[data-ht-empty]').hidden = true;
  $('[data-ht-card]').hidden = false;
  showBefore = false;
  view = 'result';
  commit();
  renderPanel();
  schedule();
}
function clearArt() {
  if (source) source.close();
  source = null;
  last = null;
  state.fileName = '';
  $('[data-ht-empty]').hidden = false;
  $('[data-ht-card]').hidden = true;
  document.querySelectorAll('[data-ht-export],[data-ht-preflight]').forEach(btn => { btn.disabled = true; });
  const src = $('[data-ht-source]'); if (src) src.textContent = '—';
  const printable = $('[data-ht-print]'); if (printable) printable.textContent = '—';
  const quality = $('[data-ht-quality]'); if (quality) quality.textContent = '—';
  renderPanel();
}

function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function canvasFrom(data, w, h, mirror) {
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  if (!mirror) return src;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.translate(w, 0); ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return out;
}
function exportPixels() {
  if (!state.previewErase) return last.rgba;
  return processHalftone(last.placed, last.width, last.height, payload(false)).rgba;
}
async function exportKind(kind) {
  if (!source) return;
  setBusy(true);
  await new Promise(r => setTimeout(r, 20));
  try {
    await render({ full: true });
    if (!last || !last.full) throw new Error('The print file is not ready yet.');
    const pixels = exportPixels();
    const canvas = canvasFrom(pixels, last.width, last.height, state.mirror);
    const base = fileBase() + '_halftone';
    if (kind === 'png') {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      download(pngWithDpi(new Uint8Array(await blob.arrayBuffer()), state.dpi), base + '.png', 'image/png');
    } else if (kind === 'pdf') {
      const { PDFDocument } = await import(new URL('../vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url));
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const png = pngWithDpi(new Uint8Array(await blob.arrayBuffer()), state.dpi);
      const doc = await PDFDocument.create();
      const page = doc.addPage([state.widthIn * 72, heightIn() * 72]);
      const image = await doc.embedPng(png);
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      download(await doc.save(), base + '.pdf', 'application/pdf');
    } else {
      const { writePsd } = await import(new URL('../vendor/ag-psd/index.js', import.meta.url));
      const layer = (name, data, hidden) => {
        const c = canvasFrom(data, last.width, last.height, state.mirror);
        return { name, canvas: c, hidden: !!hidden };
      };
      const garment = new Uint8ClampedArray(last.width * last.height * 4);
      for (let i = 0; i < garment.length; i += 4) {
        garment[i] = state.garment[0]; garment[i + 1] = state.garment[1]; garment[i + 2] = state.garment[2]; garment[i + 3] = 255;
      }
      const bytes = writePsd({
        width: last.width,
        height: last.height,
        children: [
          layer('Garment color', garment, true),
          layer('Original', last.placed, true),
          layer('Background removed', last.cutout, true),
          layer('Halftone', pixels, false),
        ],
      });
      download(bytes, base + '.psd', 'image/vnd.adobe.photoshop');
    }
    toast('Saved ' + base);
  } catch (err) {
    toast(err.message || 'Export failed');
  }
  setBusy(false);
}
function openReport() {
  if (!last || !source) return;
  const cleaned = last.semi || 0;
  const dpi = Math.round(trueDpi(source.width, state.widthIn));
  const dark = (0.2126 * state.garment[0] + 0.7152 * state.garment[1] + 0.0722 * state.garment[2]) / 255 < 0.45;
  const ms = last.ms || 0;
  const time = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
  const rows = [
    ['Clean edges', `No semi-transparent pixels: there will be no halos. (${cleaned.toLocaleString()} px)`],
    ['Resolution', `The original gives a true ${dpi} dpi at this size.`],
    ['Minimum dot', `${Number(state.minDotMm).toFixed(2)} mm at ${state.lpi} LPI.`],
    ['White base', 'No white base.'],
    ['Garment', `Screen for ${dark ? 'dark' : 'light'} garments · no white base.`],
    ['Background', state.removeBg ? `${hexOf(last.bg || state.bgColor)} was removed.` : 'Background was kept.'],
    ['Calculation time', time],
  ];
  $('[data-ht-report-body]').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('[data-ht-report]').hidden = false;
}
function applySubstrate(id) {
  state.substrate = id;
  if (id === 'custom') return;
  const sub = substrateById(id);
  state.dpi = sub.dpi;
  state.lpi = sub.lpi;
  state.angle = sub.angle;
  state.output = sub.output;
  state.minDotMm = sub.minDotMm;
  state.shrink = sub.shrink;
  state.specks = sub.specks;
  state.gain = sub.gain;
  state.contrast = sub.contrast;
  state.gamma = sub.gamma;
  state.saturation = sub.saturation;
  state.profile = 'default';
  state.smoothEdge = 0;
  state.halftone = true;
  state.doubleScreen = false;
  state.shape = 'round';
  state.screen = sub.screen || 'am';
  state.knockout = !!sub.knockout;
  state.knockoutTarget = sub.knockoutTarget || (sub.garment === 'light' ? 'tones' : 'blacks');
  state.blackRange = sub.blackRange == null ? 45 : sub.blackRange;
  state.protectColours = sub.protectColours == null ? 32 : sub.protectColours;
  if (sub.ink) state.ink = sub.ink.slice();
  if (sub.bgColor) { state.bgColor = sub.bgColor.slice(); state.bgAuto = false; }
  if (sub.garment === 'light') { state.garmentKey = 'white'; state.garment = GARMENTS.white.slice(); }
  if (sub.garment === 'dark') { state.garmentKey = 'black'; state.garment = GARMENTS.black.slice(); }
  refreshAll();
  commit();
  schedule();
}

function bind() {
  document.querySelectorAll('[data-ht-tab]').forEach(btn => btn.addEventListener('click', () => { tab = btn.dataset.htTab; renderPanel(); }));
  $('[data-ht-undo]').addEventListener('click', () => {
    if (!past.length) return;
    future.push(savedSnap);
    savedSnap = past.pop();
    restore(savedSnap);
  });
  $('[data-ht-redo]').addEventListener('click', () => {
    if (!future.length) return;
    past.push(savedSnap);
    savedSnap = future.pop();
    restore(savedSnap);
  });
  $('[data-ht-before]').addEventListener('click', () => {
    showBefore = !showBefore;
    $('[data-ht-before]').setAttribute('aria-pressed', showBefore ? 'true' : 'false');
    if (last) paint();
  });
  $('[data-ht-layers]').addEventListener('click', () => { $('[data-ht-layers-pop]').hidden = !$('[data-ht-layers-pop]').hidden; });
  document.querySelectorAll('[data-ht-layer]').forEach(btn => btn.addEventListener('click', () => {
    view = btn.dataset.htLayer;
    showBefore = false;
    $('[data-ht-layers-pop]').hidden = true;
    if (last) paint();
  }));
  document.querySelectorAll('[data-ht-shirt]').forEach(btn => btn.addEventListener('click', () => {
    state.garmentKey = btn.dataset.htShirt;
    state.garment = GARMENTS[state.garmentKey].slice();
    document.querySelectorAll('[data-ht-shirt]').forEach(b => b.classList.toggle('on', b === btn));
    $('[data-ht-custom]').value = hexOf(state.garment);
    applyZoom();
    if (state.knockout) { commit(); schedule(); }
  }));
  $('[data-ht-custom]').addEventListener('input', e => {
    state.garmentKey = 'custom';
    state.garment = parseHex(e.target.value);
    document.querySelectorAll('[data-ht-shirt]').forEach(b => b.classList.remove('on'));
    applyZoom();
    if (state.knockout) { commit(); schedule(); }
  });
  document.querySelectorAll('[data-ht-z]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.htZ === 'fit') zoom = 'fit';
    else if (btn.dataset.htZ === '100') zoom = 1;
    else {
      const current = zoom === 'fit' ? fitScale() : zoom;
      const next = btn.dataset.htZ === 'in'
        ? ZOOMS.find(z => z > current + 0.01) || ZOOMS[ZOOMS.length - 1]
        : [...ZOOMS].reverse().find(z => z < current - 0.01) || ZOOMS[0];
      zoom = next;
    }
    applyZoom();
  }));
  $('[data-ht-substrate]').addEventListener('change', e => applySubstrate(e.target.value));
  $('[data-ht-preflight]').addEventListener('click', openReport);
  $('[data-ht-export]').addEventListener('click', () => { $('[data-ht-saveas]').hidden = false; });
  $('[data-ht-replace]').addEventListener('click', () => { const input = $('[data-ht-file]') || document.querySelector('[data-ht-file]'); if (input) input.click(); else { const el = document.createElement('input'); el.type = 'file'; el.accept = 'image/png,image/jpeg,image/webp'; el.addEventListener('change', () => useFile(el.files[0])); el.click(); } });
  $('[data-ht-clear]').addEventListener('click', clearArt);
  document.querySelectorAll('[data-ht-close]').forEach(btn => btn.addEventListener('click', () => btn.closest('.modal').hidden = true));
  document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; }));
  $('[data-ht-guide-open]').addEventListener('click', () => { $('[data-ht-guide]').hidden = false; });
  const mirror = $('[data-ht-mirror]');
  if (mirror) mirror.addEventListener('change', () => { state.mirror = mirror.checked; });
  document.querySelectorAll('[data-ht-kind]').forEach(btn => btn.addEventListener('click', () => exportKind(btn.dataset.htKind)));
  const scroll = $('[data-ht-scroll]');
  ['dragenter', 'dragover', 'drop'].forEach(ev => scroll.addEventListener(ev, e => e.preventDefault()));
  scroll.addEventListener('drop', e => useFile(e.dataTransfer.files && e.dataTransfer.files[0]));
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', applyZoom);
    const scroll = $('[data-ht-scroll]');
    if (scroll) scroll.addEventListener('scroll', applyZoom, { passive: true });
  }
  savedSnap = snap();
  renderPanel();
  if (!localStorage.getItem(GUIDE_KEY)) {
    $('[data-ht-guide]').hidden = false;
    localStorage.setItem(GUIDE_KEY, '1');
  }
}

export async function halftonePage() {
  document.title = document.documentElement.dataset.brand === 'fx' ? 'Halftone · YBI FX Proofs' : 'Halftone · YBI Proofs';
  shell();
  bind();
}

// Pure helpers for site-survey photo marks. The dimension label is often typed
// after the line is drawn, and on a phone the field may still be focused when
// Save is tapped. These functions apply that text onto the dimension.

export function readMarkLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function measureMm(x1, y1, x2, y2, scale, w, h) {
  if (!scale || !(Number(scale.mm) > 0)) return null;
  const ref = Math.hypot((scale.x2 - scale.x1) * w, (scale.y2 - scale.y1) * h);
  if (ref < 2) return null;
  const px = Math.hypot((x2 - x1) * w, (y2 - y1) * h);
  return Math.max(1, Math.round(px / ref * scale.mm));
}

export function dimensionFromDrag(a, b, fieldValue, scale, imgW, imgH) {
  if (!a || !b) return null;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 0.012) return null;
  let label = readMarkLabel(fieldValue);
  if (!label && scale) {
    const mm = measureMm(a.x, a.y, b.x, b.y, scale, imgW, imgH);
    if (mm) label = `${mm} mm`;
  }
  return { type: 'dim', x1: a.x, y1: a.y, x2: b.x, y2: b.y, label: label || '' };
}

// boundIndex is the dimension currently tied to the label field, or -1.
// A filled field updates that dimension. An empty field does not wipe a label
// that was filled from the scale. With no bound dimension, the text fills the
// latest dimension that has none.
export function commitDimensionLabel(items, fieldValue, boundIndex) {
  const typed = readMarkLabel(fieldValue);
  const next = (Array.isArray(items) ? items : []).map(it => ({ ...it }));
  const idx = Number.isInteger(boundIndex) ? boundIndex : -1;
  if (idx >= 0 && next[idx] && next[idx].type === 'dim') {
    if (typed && next[idx].label !== typed) {
      next[idx] = { ...next[idx], label: typed };
      return { items: next, boundIndex: idx, changed: true };
    }
    return { items: next, boundIndex: idx, changed: false };
  }
  if (typed) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].type === 'dim' && !readMarkLabel(next[i].label)) {
        next[i] = { ...next[i], label: typed };
        return { items: next, boundIndex: i, changed: true };
      }
    }
  }
  return { items: next, boundIndex: idx, changed: false };
}

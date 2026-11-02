// Staff quote totals. Shared by the studio page and server.js so the figures match.
// A blank quantity is 1: a design or print line with only a price is charged once.
// An entered quantity (including 0) is used as-is, and the line amount is quantity × price.
// A blank price is $0. Prices are ex GST. GST is 10% of the subtotal, rounded to the nearest cent (half up).

export const QUOTE_LINES = 20;
export const QUOTE_VALIDITY = ['7 days', '30 days', '6 months'];

export function priceToCents(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [w, f = ''] = s.split('.');
  if (w.length > 7) return undefined;
  const cents = Number(w) * 100 + Number((f + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > 999999999) return undefined;
  return cents;
}

export function qtyToMilli(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return undefined;
  const [w, f = ''] = s.split('.');
  if (w.length > 7) return undefined;
  const milli = Number(w) * 1000 + Number((f + '000').slice(0, 3));
  if (!Number.isSafeInteger(milli) || milli > 1000000000) return undefined;
  return milli;
}

export function milliToQty(milli) {
  if (milli == null) return null;
  const w = Math.trunc(milli / 1000);
  const f = milli % 1000;
  if (!f) return String(w);
  return `${w}.${String(f).padStart(3, '0').replace(/0+$/, '')}`;
}

export function centsToInput(cents) {
  if (cents == null) return '';
  const a = Math.abs(Math.trunc(cents));
  return `${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

// qtyMilli null means blank (treated as 1). priceCents null means blank ($0).
export function lineCents(qtyMilli, priceCents) {
  if (priceCents == null) return 0;
  const milli = qtyMilli == null ? 1000n : BigInt(qtyMilli);
  const prod = milli * BigInt(priceCents);
  const q = prod / 1000n;
  const rem = prod % 1000n;
  return Number(q + (rem >= 500n ? 1n : 0n));
}

export function gstOn(subtotalCents) {
  const n = BigInt(subtotalCents) * 10n;
  const q = n / 100n;
  const rem = n % 100n;
  return Number(q + (rem >= 50n ? 1n : 0n));
}

export function quoteTotals(lines) {
  const amounts = [];
  const errors = [];
  let subtotal = 0;
  (lines || []).forEach((line, i) => {
    const price = priceToCents(line && line.price);
    const qty = qtyToMilli(line && line.qty);
    if (price === undefined) errors.push(`Line ${i + 1} price isn’t valid.`);
    if (qty === undefined) errors.push(`Line ${i + 1} quantity isn’t valid.`);
    if (price === undefined || qty === undefined) {
      amounts.push(null);
      return;
    }
    const cents = lineCents(qty, price);
    amounts.push(cents);
    subtotal += cents;
  });
  const gst = gstOn(subtotal);
  return { amounts, subtotal, gst, total: subtotal + gst, errors };
}

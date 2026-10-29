// Staff-calendar reschedule math. Dates are Australia/Melbourne wall-clock strings:
// all-day is YYYY-MM-DD, timed is YYYY-MM-DDTHH:mm. Dropping on a day shifts the
// whole event by that many days and keeps the clock. Dropping a timed event on an
// HH:mm slot also moves the start and keeps the duration. All-day events and proof
// jobs stay all-day — a time slot only changes their date.

export function isoParts(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return { y, m, d };
}

export function addDays(iso, n) {
  const { y, m, d } = isoParts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dayDelta(from, to) {
  const a = isoParts(from), b = isoParts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

export function minutesOf(hhmm) {
  return +String(hhmm).slice(0, 2) * 60 + +String(hhmm).slice(3, 5);
}

export function hhmm(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Add minutes to a wall-clock time. Minutes may be negative and may cross midnight.
export function addMinutes(day, clock, delta) {
  const total = minutesOf(clock) + delta;
  const days = Math.floor(total / 1440);
  const rem = total - days * 1440;
  return { day: addDays(day, days), clock: hhmm(rem) };
}

export function movedTimes(ev, fromDay, toDay, slot) {
  const delta = dayDelta(fromDay, toDay);
  const startDay = String(ev.start).slice(0, 10);
  const endStamp = ev.end ? String(ev.end) : '';
  const endDay = endStamp ? endStamp.slice(0, 10) : '';
  if (ev.allDay || ev.kind === 'job') {
    return {
      start: addDays(startDay, delta),
      end: ev.kind === 'job' ? null : (endDay ? addDays(endDay, delta) : null)
    };
  }
  const startClock = String(ev.start).slice(11, 16);
  const useSlot = typeof slot === 'string' && /^\d{2}:\d{2}$/.test(slot);
  const extra = useSlot ? minutesOf(slot) - minutesOf(startClock) : 0;
  const start = addMinutes(addDays(startDay, delta), startClock, extra);
  let end = null;
  if (endStamp.length >= 16) {
    const dur = dayDelta(startDay, endDay) * 1440 + (minutesOf(endStamp.slice(11, 16)) - minutesOf(startClock));
    const endAt = addMinutes(start.day, start.clock, dur);
    end = `${endAt.day}T${endAt.clock}`;
  }
  return { start: `${start.day}T${start.clock}`, end };
}

export function sameSpan(ev, next) {
  return String(ev.start) === String(next.start) && String(ev.end || '') === String(next.end || '');
}

// Lower dayOrder wins. An item with no dayOrder keeps the old order and sits after
// anything that has been given a place: all-day first, then start, title, id.
export function compareEvents(a, b) {
  const ao = Number.isInteger(a?.dayOrder) ? a.dayOrder : null;
  const bo = Number.isInteger(b?.dayOrder) ? b.dayOrder : null;
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if (ao != null && bo == null) return -1;
  if (ao == null && bo != null) return 1;
  if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
  return String(a.start).localeCompare(String(b.start))
    || String(a.title).localeCompare(String(b.title))
    || String(a.id).localeCompare(String(b.id));
}

// toIndex is the slot among the chips that are not `id` (0 = before the first).
export function movedOrder(ids, id, toIndex) {
  const from = ids.indexOf(id);
  if (from < 0) return ids.slice();
  const without = ids.filter(x => x !== id);
  const index = Math.max(0, Math.min(without.length, Number.isFinite(toIndex) ? toIndex : without.length));
  if (index === from) return ids.slice();
  const next = without.slice();
  next.splice(index, 0, id);
  return next;
}

// Permute the chips that were in the dragged list and leave every other id where it was.
export function mergeOrder(fullIds, containerIds, nextContainerIds) {
  const set = new Set(containerIds);
  let k = 0;
  return fullIds.map(id => (set.has(id) ? nextContainerIds[k++] : id));
}

import assert from 'node:assert/strict';
import { movedTimes, sameSpan } from '../public/assets/cal-move.mjs';

const timed = { kind: 'event', allDay: false, start: '2026-11-12T09:15', end: '2026-11-12T10:45' };
const overnight = { kind: 'event', allDay: false, start: '2026-11-12T22:00', end: '2026-11-13T01:00' };
const openEnded = { kind: 'event', allDay: false, start: '2026-11-12T09:30', end: null };
const allDay = { kind: 'event', allDay: true, start: '2026-11-16', end: '2026-11-18' };
const oneDay = { kind: 'event', allDay: true, start: '2026-11-16', end: null };
const job = { kind: 'job', allDay: true, start: '2026-11-12', end: null };

// Day drop keeps the clock and the duration.
{
  const next = movedTimes(timed, '2026-11-12', '2026-11-13', null);
  assert.deepEqual(next, { start: '2026-11-13T09:15', end: '2026-11-13T10:45' });
}

// A chip on the second day of an overnight event shifts the whole span.
{
  const next = movedTimes(overnight, '2026-11-13', '2026-11-14', null);
  assert.deepEqual(next, { start: '2026-11-13T22:00', end: '2026-11-14T01:00' });
}

// Half-hour slot changes the clock and keeps a 90-minute duration, including across midnight.
{
  const next = movedTimes(timed, '2026-11-12', '2026-11-13', '15:00');
  assert.deepEqual(next, { start: '2026-11-13T15:00', end: '2026-11-13T16:30' });
  const back = movedTimes(overnight, '2026-11-12', '2026-11-12', '10:00');
  assert.deepEqual(back, { start: '2026-11-12T10:00', end: '2026-11-12T13:00' });
}

// Earlier slot on the previous day.
{
  const next = movedTimes(timed, '2026-11-12', '2026-11-11', '08:30');
  assert.deepEqual(next, { start: '2026-11-11T08:30', end: '2026-11-11T10:00' });
}

// No end stays open-ended. Same place is a no-op.
{
  const next = movedTimes(openEnded, '2026-11-12', '2026-11-14', null);
  assert.deepEqual(next, { start: '2026-11-14T09:30', end: null });
  assert.equal(sameSpan(openEnded, movedTimes(openEnded, '2026-11-12', '2026-11-12', null)), true);
  assert.equal(sameSpan(timed, movedTimes(timed, '2026-11-12', '2026-11-12', '09:15')), true);
}

// All-day keeps its length. A time slot does not turn it into a timed event.
{
  const fromMiddle = movedTimes(allDay, '2026-11-17', '2026-11-18', '15:00');
  assert.deepEqual(fromMiddle, { start: '2026-11-17', end: '2026-11-19' });
  assert.deepEqual(movedTimes(oneDay, '2026-11-16', '2026-12-01', '09:00'), { start: '2026-12-01', end: null });
}

// Proof jobs are a single all-day override. Month edges roll over.
{
  assert.deepEqual(movedTimes(job, '2026-11-12', '2026-11-13', '14:00'), { start: '2026-11-13', end: null });
  assert.deepEqual(movedTimes({ ...oneDay, start: '2026-01-31' }, '2026-01-31', '2026-02-01', null), { start: '2026-02-01', end: null });
  assert.deepEqual(movedTimes({ ...oneDay, start: '2026-02-28' }, '2026-02-28', '2026-03-01', null), { start: '2026-03-01', end: null });
}

console.log('cal-move: ok');

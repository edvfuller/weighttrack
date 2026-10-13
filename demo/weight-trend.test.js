import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrend,
  dayNumber,
  isoFromDayNumber,
  projectGoal,
  trendChange,
  weeklyRate,
} from './weight-trend.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

// One weigh-in per day starting 2026-01-01, weights given in order.
const daily = (weights, start = '2026-01-01') =>
  weights.map((weight, i) => ({ date: isoFromDayNumber(dayNumber(start) + i), weight }));

test('day numbers round-trip and ignore time zones', () => {
  assert.equal(isoFromDayNumber(dayNumber('2026-03-29')), '2026-03-29');
  assert.equal(dayNumber('2026-01-02') - dayNumber('2026-01-01'), 1);
});

test('trend starts at the first reading and moves 10% toward each new one', () => {
  const points = computeTrend(daily([90, 80, 80]));
  close(points[0].trend, 90);
  close(points[1].trend, 89);
  close(points[2].trend, 88.1);
});

test('a gap compounds the smoothing as if the reading were repeated', () => {
  const gapped = computeTrend([
    { date: '2026-01-01', weight: 90 },
    { date: '2026-01-04', weight: 80 },
  ]);
  const repeated = computeTrend(daily([90, 80, 80, 80]));
  close(gapped[1].trend, repeated[3].trend);
});

test('entries are sorted and the last entry for a repeated date wins', () => {
  const points = computeTrend([
    { date: '2026-01-02', weight: 85 },
    { date: '2026-01-01', weight: 90 },
    { date: '2026-01-02', weight: 80 },
  ]);
  assert.deepEqual(points.map((p) => p.date), ['2026-01-01', '2026-01-02']);
  assert.equal(points[1].weight, 80);
});

test('weeklyRate recovers a steady loss once the trend has settled', () => {
  // Lose 0.1 kg a day for 120 days; the smoothed trend lags but its slope converges.
  const points = computeTrend(daily(Array.from({ length: 120 }, (_, i) => 100 - i * 0.1)));
  close(weeklyRate(points), -0.7, 0.01);
});

test('weeklyRate needs a week of history', () => {
  assert.equal(weeklyRate(computeTrend(daily([90, 89.8, 89.9]))), null);
});

test('trendChange looks back to the last weigh-in on or before the cutoff', () => {
  const points = computeTrend(daily([90, 80, 80, 80]));
  close(trendChange(points, 2), points[3].trend - points[1].trend);
  assert.equal(trendChange(points, 30), null);
});

test('projectGoal handles on-track, off-track and reached goals', () => {
  const points = computeTrend(daily([90, 90]));
  assert.deepEqual(projectGoal(points, 89, -0.7), { status: 'on-track', days: 10, date: '2026-01-12' });
  assert.deepEqual(projectGoal(points, 89, 0.2), { status: 'off-track' });
  assert.deepEqual(projectGoal(points, 91, -0.7), { status: 'off-track' });
  assert.equal(projectGoal(points, 89, null), null);

  const past = computeTrend(daily([90, 70]));
  assert.deepEqual(projectGoal(past, 89, -0.7), { status: 'reached' });
});

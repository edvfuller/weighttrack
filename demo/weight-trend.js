// Trend-weight math in the style of Happy Scale and The Hacker's Diet.
// Pure functions with no DOM, storage or framework code, so this file can be
// copied into any app. Weights are plain numbers in whatever unit you store
// (the demo stores kilograms); dates are ISO calendar dates (YYYY-MM-DD).

const MS_PER_DAY = 86400000;

export const KG_PER_LB = 0.45359237;

/** Whole days since 1970-01-01 for an ISO date, independent of time zone. */
export function dayNumber(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function isoFromDayNumber(day) {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Sorts weigh-ins by date and adds a `trend` value to each: an exponentially
 * smoothed moving average that moves `smoothing` (10%) of the way toward each
 * new reading. A gap of N days compounds the smoothing N times, as if the new
 * reading had been taken on each missed day. If a date appears more than once,
 * the last entry for that date wins.
 *
 * Returns [{ date, day, weight, trend }] in date order.
 */
export function computeTrend(entries, { smoothing = 0.1 } = {}) {
  const byDay = new Map();
  for (const entry of entries) {
    if (!Number.isFinite(entry.weight)) continue;
    byDay.set(dayNumber(entry.date), entry.weight);
  }

  const points = [];
  let trend;
  let prevDay;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const weight = byDay.get(day);
    if (trend === undefined) {
      trend = weight;
    } else {
      const alpha = 1 - Math.pow(1 - smoothing, day - prevDay);
      trend += alpha * (weight - trend);
    }
    points.push({ date: isoFromDayNumber(day), day, weight, trend });
    prevDay = day;
  }
  return points;
}

/**
 * Change in trend weight over the last `days` days, measured from the latest
 * weigh-in back to the last weigh-in on or before that point.
 * Returns null when the history doesn't reach back that far.
 */
export function trendChange(points, days) {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const target = last.day - days;
  let ref = null;
  for (const p of points) {
    if (p.day > target) break;
    ref = p;
  }
  return ref ? last.trend - ref.trend : null;
}

/**
 * Rate of change per week: the least-squares slope of the trend over the last
 * `windowDays` days. Negative means losing. Returns null until the window
 * holds at least a week of weigh-ins.
 */
export function weeklyRate(points, { windowDays = 28 } = {}) {
  if (points.length < 2) return null;
  const lastDay = points[points.length - 1].day;
  const recent = points.filter((p) => p.day > lastDay - windowDays);
  if (recent.length < 2 || lastDay - recent[0].day < 7) return null;

  const n = recent.length;
  const meanX = recent.reduce((s, p) => s + p.day, 0) / n;
  const meanY = recent.reduce((s, p) => s + p.trend, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of recent) {
    num += (p.day - meanX) * (p.trend - meanY);
    den += (p.day - meanX) ** 2;
  }
  return den === 0 ? null : (num / den) * 7;
}

/**
 * When the trend reaches `goal` at the current weekly rate.
 *   { status: 'reached' }                  trend is at or past the goal
 *   { status: 'on-track', days, date }     projected arrival
 *   { status: 'off-track' }                flat, or moving away from the goal
 *   null                                   no weigh-ins, no goal or no rate yet
 * The goal's direction (lose or gain) comes from where the history started.
 */
export function projectGoal(points, goal, ratePerWeek, { maxDays = 3650 } = {}) {
  if (points.length === 0 || !Number.isFinite(goal)) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const direction = Math.sign(goal - first.trend) || Math.sign(goal - last.trend);
  if (direction === 0 || direction * (goal - last.trend) <= 0) return { status: 'reached' };
  if (ratePerWeek === null || ratePerWeek === undefined) return null;
  if (Math.sign(ratePerWeek) !== direction) return { status: 'off-track' };

  // The epsilon keeps float noise (10.000000000000002) from adding a day.
  const days = Math.ceil((goal - last.trend) / (ratePerWeek / 7) - 1e-9);
  if (days > maxDays) return { status: 'off-track' };
  return { status: 'on-track', days, date: isoFromDayNumber(last.day + days) };
}

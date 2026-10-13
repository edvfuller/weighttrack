// Demo UI for weight-trend.js: localStorage persistence, a hand-drawn SVG chart
// and a weigh-in table. Weights are stored in kilograms and converted for display.
import {
  KG_PER_LB,
  computeTrend,
  dayNumber,
  isoFromDayNumber,
  projectGoal,
  trendChange,
  weeklyRate,
} from './weight-trend.js';

const STORAGE_KEY = 'weighttrack:v1';
const RANGE_DAYS = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, All: Infinity };
const ROWS_COLLAPSED = 14;
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);

// ---------- storage ----------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.entries)) return null;
    return {
      entries: saved.entries.filter((e) => typeof e.date === 'string' && Number.isFinite(e.weight)),
      goal: Number.isFinite(saved.goal) ? saved.goal : null,
      unit: saved.unit === 'lb' ? 'lb' : 'kg',
      isExample: Boolean(saved.isExample),
    };
  } catch {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked (private windows, previews); the page still works for this visit.
  }
}

// ---------- example data ----------

function exampleState() {
  return { entries: exampleEntries(), goal: 82, unit: 'kg', isExample: true };
}

// 150 days of plausible weigh-ins: a steady loss that slows, daily water-weight
// noise, a bump after weekends and some skipped days. Seeded, so it's stable.
function exampleEntries() {
  let seed = 20260101;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const today = dayNumber(todayIso());
  const entries = [];
  for (let ago = 149; ago >= 0; ago--) {
    if (ago > 0 && rand() < 0.14) continue;
    const t = 149 - ago;
    const base = t < 100 ? 95 - (t * 0.55) / 7 : 95 - (100 * 0.55) / 7 - ((t - 100) * 0.3) / 7;
    const weekday = new Date((today - ago) * 86400000).getUTCDay();
    const afterWeekend = weekday === 0 || weekday === 1 ? 0.35 : 0;
    const noise = (rand() + rand() + rand() - 1.5) * 0.7;
    entries.push({ date: isoFromDayNumber(today - ago), weight: round1(base + afterWeekend + noise) });
  }
  return entries;
}

// ---------- formatting ----------

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round1 = (n) => Math.round(n * 10) / 10;
const toUnit = (kg) => (state.unit === 'lb' ? kg / KG_PER_LB : kg);
const fromUnit = (v) => (state.unit === 'lb' ? v * KG_PER_LB : v);
const fmt = (kg, digits = 1) => toUnit(kg).toFixed(digits);
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
const fmtDelta = (kg, digits = 1) => {
  const v = toUnit(kg);
  const rounded = Number(Math.abs(v).toFixed(digits));
  return `${rounded === 0 ? '±' : sign(v)}${rounded.toFixed(digits)}`;
};

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateFmtLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateFmtRow = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayDate = (day) => new Date(day * 86400000);
const fmtDay = (day) => dateFmt.format(dayDate(day));

function parseWeight(text) {
  const value = Number(String(text).trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) ? null : value;
}

// ---------- state ----------

const state = loadState() ?? exampleState();
const view = { range: '3M', showAllRows: false, hover: null, clearArmed: false };
let points = [];
let visible = [];

// ---------- rendering ----------

function render() {
  points = computeTrend(state.entries);
  const lastDay = points.length ? points[points.length - 1].day : dayNumber(todayIso());
  const span = RANGE_DAYS[view.range];
  visible = points.filter((p) => p.day > lastDay - span);

  document.querySelectorAll('[data-unit-label]').forEach((el) => (el.textContent = state.unit));
  document.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
  document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === view.range)));
  $('example-banner').hidden = !state.isExample;
  $('example-btn').hidden = state.isExample;

  renderSummary();
  renderChart();
  renderTable();
  renderSettings();
}

function renderSummary() {
  const last = points[points.length - 1];
  if (!last) {
    $('hero-num').textContent = '–';
    $('hero-sub').textContent = 'Log a weigh-in to start your trend.';
  } else {
    $('hero-num').textContent = fmt(last.trend);
    const diff = last.weight - last.trend;
    const when = last.date === todayIso() ? 'Today' : `On ${fmtDay(last.day)}`;
    const relation = Math.abs(toUnit(diff)) < 0.05 ? 'right on your trend' : `${fmt(Math.abs(diff))} ${state.unit} ${diff > 0 ? 'above' : 'below'} your trend`;
    $('hero-sub').textContent = `${when} the scale read ${fmt(last.weight)} ${state.unit}, ${relation}.`;
  }

  const towardGoal = (delta) => {
    if (state.goal === null || !last || delta === null || Math.abs(delta) < 1e-9) return false;
    return Math.sign(delta) === Math.sign(state.goal - points[0].trend);
  };
  const statDelta = (el, delta, suffix, digits) => {
    el.replaceChildren();
    el.classList.toggle('toward', towardGoal(delta));
    if (delta === null) {
      el.textContent = '–';
      return;
    }
    if (Number(Math.abs(toUnit(delta)).toFixed(digits)) !== 0) {
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = delta < 0 ? '▼' : '▲';
      el.append(arrow);
    }
    el.append(`${fmtDelta(delta, digits)} ${state.unit}${suffix}`);
  };

  const rate = weeklyRate(points);
  statDelta($('stat-7'), trendChange(points, 7), '', 1);
  statDelta($('stat-30'), trendChange(points, 30), '', 1);
  statDelta($('stat-rate'), rate, '/wk', 2);

  const goalEl = $('stat-goal');
  const note = $('stat-goal-note');
  goalEl.classList.remove('toward');
  if (state.goal === null) {
    goalEl.textContent = '–';
    note.textContent = 'Set a goal in Settings';
    return;
  }
  const goalText = `${fmt(state.goal)} ${state.unit}`;
  const projection = projectGoal(points, state.goal, rate);
  if (!projection) {
    goalEl.textContent = goalText;
    note.textContent = 'ETA after a week of weigh-ins';
  } else if (projection.status === 'reached') {
    goalEl.textContent = 'Reached';
    goalEl.classList.add('toward');
    note.textContent = `Goal ${goalText}`;
  } else if (projection.status === 'off-track') {
    goalEl.textContent = goalText;
    note.textContent = 'Not heading there at your current rate';
  } else {
    goalEl.textContent = fmtDay(dayNumber(projection.date));
    const weeks = Math.round(projection.days / 7);
    note.textContent = `${goalText} in about ${weeks <= 1 ? `${projection.days} days` : `${weeks} weeks`}`;
  }
}

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
}

function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}

let scales = null;

function renderChart() {
  const chart = $('chart');
  const root = $('chart-svg');
  root.replaceChildren();
  $('tip').hidden = true;

  const empty = visible.length === 0;
  chart.hidden = empty;
  $('legend').hidden = empty;
  $('chart-empty').hidden = !empty;
  $('empty-example').hidden = state.entries.length > 0;
  $('chart-empty-text').textContent = state.entries.length
    ? 'There are no weigh-ins in this date range. Pick a longer range above.'
    : 'Log a weigh-in above. The trend line starts with your first entry, and the weekly rate appears after a week.';
  if (empty) return;

  const width = chart.clientWidth;
  const height = chart.clientHeight;
  const narrow = width < 520;
  const m = { top: 16, right: narrow ? 44 : 56, bottom: 26, left: narrow ? 36 : 44 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  // X domain runs from the first weigh-in in the window to the last; gaps in logging show as gaps.
  const lastDay = visible[visible.length - 1].day;
  const span = RANGE_DAYS[view.range];
  let x0 = Number.isFinite(span) ? Math.max(lastDay - span + 1, visible[0].day) : visible[0].day;
  let x1 = lastDay;
  if (x1 - x0 < 6) { x0 -= 3; x1 += 3; }

  // Y domain in display units, so ticks land on round kg or lb values.
  const ys = visible.flatMap((p) => [toUnit(p.weight), toUnit(p.trend)]);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const goal = state.goal === null ? null : toUnit(state.goal);
  const dataSpan = Math.max(y1 - y0, 1);
  const showGoal = goal !== null && goal >= y0 - dataSpan && goal <= y1 + dataSpan;
  if (showGoal) { y0 = Math.min(y0, goal); y1 = Math.max(y1, goal); }
  const pad = Math.max((y1 - y0) * 0.08, 0.3);
  y0 -= pad; y1 += pad;
  const step = niceStep(y1 - y0, narrow ? 4 : 5);
  y0 = Math.floor(y0 / step) * step;
  y1 = Math.ceil(y1 / step) * step;
  $('legend-goal').hidden = !showGoal;

  const sx = (day) => m.left + ((day - x0) / (x1 - x0)) * plotW;
  const sy = (v) => m.top + (1 - (v - y0) / (y1 - y0)) * plotH;
  scales = { sx, sy, m, plotW, plotH, width };

  // Grid and y-axis labels.
  const grid = svg('g', {}, root);
  const digits = step < 1 ? 1 : 0;
  for (let v = y0; v <= y1 + step / 2; v += step) {
    const y = sy(v);
    svg('line', { x1: m.left, x2: m.left + plotW, y1: y, y2: y, stroke: v === y0 ? 'var(--axis)' : 'var(--hair)', 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, grid);
    svg('text', { x: m.left - 8, y: y + 4, 'text-anchor': 'end' }, grid).textContent = v.toFixed(digits);
  }

  // X-axis ticks: weekly for short windows, monthly otherwise.
  const ticks = [];
  if (x1 - x0 <= 45) {
    for (let d = x0; d <= x1; d++) if (dayDate(d).getUTCDay() === 1) ticks.push({ day: d, label: fmtDay(d) });
  } else {
    const every = x1 - x0 > 400 ? (narrow ? 3 : 2) : narrow && x1 - x0 > 200 ? 2 : 1;
    let count = 0;
    for (let d = x0; d <= x1; d++) {
      const date = dayDate(d);
      if (date.getUTCDate() !== 1) continue;
      if (count++ % every === 0) {
        ticks.push({ day: d, label: date.getUTCMonth() === 0 ? monthYearFmt.format(date) : monthFmt.format(date) });
      }
    }
  }
  for (const t of ticks) {
    const x = sx(t.day);
    svg('line', { x1: x, x2: x, y1: m.top + plotH, y2: m.top + plotH + 4, stroke: 'var(--axis)', 'shape-rendering': 'crispEdges' }, grid);
    svg('text', { x, y: m.top + plotH + 18, 'text-anchor': 'middle' }, grid).textContent = t.label;
  }

  // Goal line.
  if (showGoal) {
    const y = sy(goal);
    svg('line', { x1: m.left, x2: m.left + plotW, y1: y, y2: y, stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '4 4' }, root);
    const label = svg('text', { x: m.left + 6, y: y - 6, class: 'goal-label' }, root);
    label.textContent = `Goal ${goal.toFixed(1)}`;
  }

  // Each reading's distance from the trend ("floaters and sinkers"), then the readings.
  const dense = visible.length > 120 || plotW / visible.length < 5;
  const r = dense ? 2.5 : 3.5;
  const stems = svg('g', { stroke: 'var(--stem)', 'stroke-width': 1 }, root);
  const dots = svg('g', { fill: 'var(--reading)', stroke: 'var(--surface)', 'stroke-width': dense ? 1 : 1.5 }, root);
  for (const p of visible) {
    const x = sx(p.day);
    svg('line', { x1: x, x2: x, y1: sy(toUnit(p.weight)), y2: sy(toUnit(p.trend)) }, stems);
    svg('circle', { cx: x, cy: sy(toUnit(p.weight)), r }, dots);
  }

  // Trend line, drawn over the readings.
  const d = visible.map((p, i) => `${i ? 'L' : 'M'}${sx(p.day).toFixed(1)},${sy(toUnit(p.trend)).toFixed(1)}`).join('');
  svg('path', { d, fill: 'none', stroke: 'var(--trend)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'trend-path' }, root);

  const last = visible[visible.length - 1];
  const lx = sx(last.day);
  const ly = sy(toUnit(last.trend));
  svg('circle', { cx: lx, cy: ly, r: 4.5, fill: 'var(--trend)', stroke: 'var(--surface)', 'stroke-width': 2 }, root);
  svg('text', { x: lx + 9, y: ly + 4, class: 'end-label' }, root).textContent = toUnit(last.trend).toFixed(1);

  // Hover layer.
  const hover = svg('g', { id: 'hover-layer' }, root);
  hover.style.display = 'none';
  svg('line', { id: 'cross', y1: m.top, y2: m.top + plotH, stroke: 'var(--axis)', 'stroke-width': 1 }, hover);
  svg('circle', { id: 'hover-reading', r: 5, fill: 'var(--reading)', stroke: 'var(--surface)', 'stroke-width': 2 }, hover);
  svg('circle', { id: 'hover-trend', r: 5, fill: 'var(--trend)', stroke: 'var(--surface)', 'stroke-width': 2 }, hover);

  const first = visible[0];
  chart.setAttribute(
    'aria-label',
    `Weight chart. Trend went from ${fmt(first.trend)} to ${fmt(last.trend)} ${state.unit} between ${fmtDay(first.day)} and ${fmtDay(last.day)}. ` +
      'Use the left and right arrow keys to step through weigh-ins; the table below lists every value.',
  );

  if (view.hover !== null) showHover(Math.min(view.hover, visible.length - 1));
}

function showHover(index) {
  if (!scales || !visible.length) return;
  view.hover = index;
  const p = visible[index];
  const { sx, sy, width } = scales;
  const x = sx(p.day);
  const layer = $('hover-layer');
  layer.style.display = '';
  $('cross').setAttribute('x1', x);
  $('cross').setAttribute('x2', x);
  $('hover-reading').setAttribute('cx', x);
  $('hover-reading').setAttribute('cy', sy(toUnit(p.weight)));
  $('hover-trend').setAttribute('cx', x);
  $('hover-trend').setAttribute('cy', sy(toUnit(p.trend)));

  const tip = $('tip');
  tip.replaceChildren();
  const date = document.createElement('div');
  date.className = 'tip-date';
  date.textContent = dateFmtLong.format(dayDate(p.day));
  tip.append(date, tipRow('line', 'var(--trend)', fmt(p.trend), 'Trend'), tipRow('dot', 'var(--reading)', fmt(p.weight), 'Scale'));
  const diff = document.createElement('div');
  diff.className = 'tip-diff';
  diff.textContent = `Scale is ${fmtDelta(p.weight - p.trend)} ${state.unit} vs trend`;
  tip.append(diff);
  tip.hidden = false;

  const tipW = tip.offsetWidth;
  const left = x + 14 + tipW > width ? x - 14 - tipW : x + 14;
  tip.style.left = `${Math.max(0, Math.min(left, width - tipW))}px`;
}

function tipRow(kind, color, value, label) {
  const row = document.createElement('div');
  row.className = 'tip-row';
  const key = document.createElementNS(SVG_NS, 'svg');
  key.setAttribute('width', '14');
  key.setAttribute('height', '10');
  key.setAttribute('aria-hidden', 'true');
  if (kind === 'line') svg('line', { x1: 1, x2: 13, y1: 5, y2: 5, stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }, key);
  else svg('circle', { cx: 7, cy: 5, r: 4, fill: color }, key);
  const strong = document.createElement('strong');
  strong.textContent = `${value} ${state.unit}`;
  const name = document.createElement('span');
  name.textContent = label;
  row.append(key, strong, name);
  return row;
}

function hideHover() {
  view.hover = null;
  const layer = $('hover-layer');
  if (layer) layer.style.display = 'none';
  $('tip').hidden = true;
}

function nearestIndex(clientX) {
  const rect = $('chart').getBoundingClientRect();
  const x = clientX - rect.left;
  let best = 0;
  let bestDist = Infinity;
  visible.forEach((p, i) => {
    const dist = Math.abs(scales.sx(p.day) - x);
    if (dist < bestDist) { best = i; bestDist = dist; }
  });
  return best;
}

function renderTable() {
  const rows = $('rows');
  rows.replaceChildren();
  const newestFirst = [...visible].reverse();
  const shown = view.showAllRows ? newestFirst : newestFirst.slice(0, ROWS_COLLAPSED);

  if (!shown.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'No weigh-ins in this range.';
    td.style.textAlign = 'left';
    tr.append(td);
    rows.append(tr);
  }

  for (const p of shown) {
    const tr = document.createElement('tr');
    const cells = [
      [(p.date.slice(0, 4) === todayIso().slice(0, 4) ? dateFmtRow : dateFmtLong).format(dayDate(p.day)), ''],
      [fmt(p.weight), ''],
      [fmt(p.trend), 'trend-cell'],
      [fmtDelta(p.weight - p.trend), 'diff'],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove';
    btn.textContent = '×';
    btn.setAttribute('aria-label', `Remove weigh-in on ${fmtDay(p.day)}`);
    btn.addEventListener('click', () => removeEntry(p.date));
    td.append(btn);
    tr.append(td);
    rows.append(tr);
  }

  const more = newestFirst.length > ROWS_COLLAPSED;
  $('more').hidden = !more;
  $('more-btn').textContent = view.showAllRows ? 'Show fewer' : `Show all ${newestFirst.length} weigh-ins in this range`;
}

function renderSettings() {
  const input = $('goal-input');
  if (document.activeElement !== input) input.value = state.goal === null ? '' : fmt(state.goal);
  const clear = $('clear-btn');
  clear.hidden = state.entries.length === 0;
  clear.textContent = view.clearArmed ? `Click again to delete all ${state.entries.length} weigh-ins` : 'Clear all weigh-ins';
}

// ---------- actions ----------

function removeEntry(date) {
  state.entries = state.entries.filter((e) => e.date !== date);
  saveState();
  render();
}

function clearAll() {
  if (state.isExample) state.goal = null;
  state.entries = [];
  state.isExample = false;
  view.clearArmed = false;
  view.hover = null;
  saveState();
  render();
  $('log-weight').focus();
}

function loadExamples() {
  Object.assign(state, exampleState(), { unit: state.unit });
  view.hover = null;
  saveState();
  render();
}

$('log-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const msg = $('log-msg');
  const date = $('log-date').value;
  const value = parseWeight($('log-weight').value);
  msg.classList.add('error');
  if (!date) {
    msg.textContent = 'Pick the date of this weigh-in.';
    return;
  }
  if (date > todayIso()) {
    msg.textContent = 'Pick today or an earlier date.';
    return;
  }
  if (value === null) {
    msg.textContent = `Enter your weight in ${state.unit}, for example ${state.unit === 'kg' ? '82.4' : '181.6'}.`;
    return;
  }
  const kg = fromUnit(value);
  if (kg < 20 || kg > 400) {
    msg.textContent = `That doesn't look like a body weight in ${state.unit}. Check the number and the unit.`;
    return;
  }
  const existed = state.entries.some((e) => e.date === date);
  state.entries = state.entries.filter((e) => e.date !== date);
  state.entries.push({ date, weight: Math.round(kg * 1000) / 1000 });
  saveState();
  msg.classList.remove('error');
  msg.textContent = `${existed ? 'Updated' : 'Saved'} ${value.toFixed(1)} ${state.unit} for ${fmtDay(dayNumber(date))}.`;
  $('log-weight').value = '';
  render();
});

document.querySelectorAll('[data-unit]').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.unit = btn.dataset.unit;
    saveState();
    render();
  }),
);

document.querySelectorAll('[data-range]').forEach((btn) =>
  btn.addEventListener('click', () => {
    view.range = btn.dataset.range;
    view.hover = null;
    view.showAllRows = false;
    render();
  }),
);

$('goal-input').addEventListener('change', (event) => {
  const msg = $('goal-msg');
  const text = event.target.value;
  if (text.trim() === '') {
    state.goal = null;
    msg.textContent = 'Goal removed.';
  } else {
    const value = parseWeight(text);
    const kg = value === null ? null : fromUnit(value);
    if (kg === null || kg < 20 || kg > 400) {
      msg.textContent = `Enter a goal in ${state.unit}, or leave it empty for none.`;
      return;
    }
    state.goal = kg;
    msg.textContent = 'Goal saved.';
  }
  saveState();
  render();
});

$('clear-btn').addEventListener('click', () => {
  if (view.clearArmed) return clearAll();
  view.clearArmed = true;
  renderSettings();
});
$('clear-btn').addEventListener('blur', () => {
  view.clearArmed = false;
  renderSettings();
});
$('banner-clear').addEventListener('click', clearAll);
$('example-btn').addEventListener('click', loadExamples);
$('empty-example').addEventListener('click', loadExamples);
$('more-btn').addEventListener('click', () => {
  view.showAllRows = !view.showAllRows;
  renderTable();
});

const chart = $('chart');
chart.addEventListener('pointermove', (e) => visible.length && showHover(nearestIndex(e.clientX)));
chart.addEventListener('pointerdown', (e) => visible.length && showHover(nearestIndex(e.clientX)));
chart.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideHover());
chart.addEventListener('blur', hideHover);
chart.addEventListener('focus', () => visible.length && showHover(view.hover ?? visible.length - 1));
chart.addEventListener('keydown', (e) => {
  if (!visible.length) return;
  const i = view.hover ?? visible.length - 1;
  const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: visible.length - 1 }[e.key];
  if (e.key === 'Escape') return hideHover();
  if (next === undefined) return;
  e.preventDefault();
  showHover(Math.max(0, Math.min(visible.length - 1, next)));
});

let lastWidth = 0;
new ResizeObserver(() => {
  if (chart.clientWidth !== lastWidth) {
    lastWidth = chart.clientWidth;
    renderChart();
  }
}).observe(chart);

$('log-date').value = todayIso();
$('log-date').max = todayIso();
render();

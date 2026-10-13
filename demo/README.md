# Weighttrack demo

A working version of the idea in this repo's description: a Happy Scale–style
weight tracker that turns noisy daily weigh-ins into a smoothed trend.

- Log a weigh-in per day (logging the same date again replaces it)
- Trend weight: an exponentially smoothed moving average (10% per day)
- Last 7 and 30 day change, weekly rate, and the projected date you reach your goal
- Chart of scale readings, the trend line and your goal, with 1M to All ranges
- kg or lb, saved in the browser's `localStorage`
- Opens with 150 days of example data; clear it to start your own log

No build step and no dependencies.

## Run it

```sh
cd demo
python3 -m http.server 8000   # or: npx serve .
```

Then open http://localhost:8000. It needs a local server because the page
loads ES modules, which browsers block from `file://` URLs.

```sh
node --test   # unit tests for the trend math (Node 18+)
```

## Files

| File | What it is | Reuse it? |
|---|---|---|
| `weight-trend.js` | Trend, weekly rate, change over N days, goal projection. Pure functions. | Copy it as is into any JS/TS app. |
| `weight-trend.test.js` | Tests for the above. | Bring them along. |
| `app.js` | Demo UI: storage, SVG chart, table, form. | Use as a reference; rebuild in your app's framework. |
| `index.html` | Markup and styles. | Reference only. |

## Integrating into your app

`weight-trend.js` doesn't care where weigh-ins come from. Give it
`{ date: 'YYYY-MM-DD', weight }` objects from your database and it returns the
trend points and stats:

```js
import { computeTrend, weeklyRate, trendChange, projectGoal } from './weight-trend.js';

const points = computeTrend(entries);              // [{ date, day, weight, trend }]
const rate = weeklyRate(points);                   // kg/week over the last 28 days, or null
const last7 = trendChange(points, 7);              // change in trend over 7 days, or null
const eta = projectGoal(points, goalKg, rate);     // { status: 'on-track', date, days } etc.
```

Store weights in one unit (the demo uses kg) and convert only for display.
To swap `localStorage` for a real backend, replace `loadState` and `saveState`
in `app.js`. A weigh-ins table needs one row per user and date
(`user_id`, `date`, `weight_kg`).

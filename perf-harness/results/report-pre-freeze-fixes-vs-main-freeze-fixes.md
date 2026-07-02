# Freeze metrics: pre-freeze-fixes → main-freeze-fixes

- CPU throttle: 10× (pre-freeze-fixes) / 10× (main-freeze-fixes); repeats: 4/4; Chrome 149.0.7827.201
- Values are **medians** across repeats. Lower is better for every metric.

## idle-numeric-24
_baseline render/CD load: 24 numeric widgets, low data rate (WS4 baseline)_

| Metric | pre-freeze-fixes | main-freeze-fixes | Δ |
|---|--:|--:|--:|
| Longest task (ms) | 0 | 0 | 0% |
| Blocking time (ms) | 0 | 0 | 0% |
| Max handler wait (ms) | 4 | 7 | +75% |
| p95 handler wait (ms) | 2 | 3 | +50% |
| Dropped frames | 0 | 0 | 0% |
| Heap growth (MB) | 4 | 4 | 0% |
| _(context: widgets / deltas)_ | 24/16 | 24/16 | |

## delta-storm-30x10
_sustained ingestion: 30 paths @ 10Hz over a numeric+gauge dashboard (rank 2, delta coalescing)_

| Metric | pre-freeze-fixes | main-freeze-fixes | Δ |
|---|--:|--:|--:|
| Longest task (ms) | 0 | 0 | 0% |
| Blocking time (ms) | 0 | 0 | 0% |
| Max handler wait (ms) | 9 | 4 | -56% |
| p95 handler wait (ms) | 2 | 3 | +50% |
| Dropped frames | 0 | 0 | 0% |
| Heap growth (MB) | 4 | 4 | 0% |
| _(context: widgets / deltas)_ | 20/119 | 20/119 | |

## reconnect-backlog
_reconnect snapshot: one frame carrying 6000 values (rank 2, single synchronous parse+fan-out long task)_

| Metric | pre-freeze-fixes | main-freeze-fixes | Δ |
|---|--:|--:|--:|
| Longest task (ms) | 50 | 54 | +8% |
| Blocking time (ms) | 0 | 4 | +4 (was 0) |
| Max handler wait (ms) | 58 | 61 | +5% |
| p95 handler wait (ms) | 2 | 3 | +50% |
| Dropped frames | 1 | 1 | 0% |
| Heap growth (MB) | 5 | 5 | 0% |
| _(context: widgets / deltas)_ | 20/29 | 20/29 | |

## resize-storm
_28 canvas widgets + repeated viewport resizes: shared ResizeObserver reallocates every canvas in one task (rank 1, the fullscreen enter/exit storm)_

| Metric | pre-freeze-fixes | main-freeze-fixes | Δ |
|---|--:|--:|--:|
| Longest task (ms) | 177 | 73 | -59% |
| Blocking time (ms) | 1900 | 112 | -94% |
| Max handler wait (ms) | 324 | 134 | -59% |
| p95 handler wait (ms) | 170 | 79 | -54% |
| Dropped frames | 37 | 21 | -43% |
| Heap growth (MB) | 4 | 4 | 0% |
| _(context: widgets / deltas)_ | 28/15 | 28/15 | |

## ais-radar-150
_150 AIS targets @ 4Hz + streaming own-ship (ranks 4/5, radar render loops)_

| Metric | pre-freeze-fixes | main-freeze-fixes | Δ |
|---|--:|--:|--:|
| Longest task (ms) | 795 | 1169 | +47% |
| Blocking time (ms) | 7826 | 8398 | +7% |
| Max handler wait (ms) | 1406 | 1511 | +7% |
| p95 handler wait (ms) | 1180 | 1316 | +12% |
| Dropped frames | 32 | 38 | +19% |
| Heap growth (MB) | 10 | 13 | +30% |
| _(context: widgets / deltas)_ | 1/7550 | 1/7701 | |

## gauges-16
_16 radial ng-canvas-gauges @ 4Hz (rank 7, animation duty cycle)_

| Metric | pre-freeze-fixes | main-freeze-fixes | Δ |
|---|--:|--:|--:|
| Longest task (ms) | 51 | 0 | -100% |
| Blocking time (ms) | 1 | 0 | -100% |
| Max handler wait (ms) | 48 | 39 | -19% |
| p95 handler wait (ms) | 25 | 19 | -24% |
| Dropped frames | 0 | 0 | 0% |
| Heap growth (MB) | 4 | 3 | -25% |
| _(context: widgets / deltas)_ | 16/40 | 16/40 | |

## ais-growth-churn
_AIS radar with 40 targets + 40 new MMSIs/sec churn for 30s (ranks 8/9, heap growth)_

| Metric | pre-freeze-fixes | main-freeze-fixes | Δ |
|---|--:|--:|--:|
| Longest task (ms) | 4347 | 6313 | +45% |
| Blocking time (ms) | 27231 | 25163 | -8% |
| Max handler wait (ms) | 8696 | 6447 | -26% |
| p95 handler wait (ms) | 6658 | 5091 | -24% |
| Dropped frames | 33 | 41 | +24% |
| Heap growth (MB) | 9 | 18 | +100% |
| _(context: widgets / deltas)_ | 1/8183 | 1/7546 | |

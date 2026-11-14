# D-306: Safari's WebGL2 context losses follow the preset, and a pair of draws tells a cold start from a device loss

Status: proposed. The engine and the harness change nothing for a context that a browser loses. The run counts it as that page's failure, as it counts any other. Built: the checks plan draws one page twice in a row, cold then warm, and the run's notes give the reading of each pair of draws. Pending: that pair's first result. It decides whether the loss belongs to the first use of the page's programs or to the device. Task: none.

Summary: CI's Safari lost the WebGL2 context in 137 page results of one run, on 48 of its 49 shards. The losses follow what a page asks the GPU to do, not the contexts it holds. An image page at High lost in 14.6 per cent of its runs, against 0.7 per cent without a preset. The pages that keep 43 canvases alive lost none. The pair of draws then decides whether the first use of a page's programs is the trigger.

## Question

What the engine and the harness do about a browser that loses its WebGL2 context, and how a loss that the browser causes is told from a fault in the page.

## Rule

- A change must not cost pages that work today to repair one that does not, as [D-290](D-290-a-browser-that-loses-images-leaves-the-fault-open.md) says for an image that a browser lost.
- A fault that the browser causes is recorded, not repaired in the engine, unless a page can avoid the cost that provokes it without changing what it tests.
- Every figure names its run and the phase of the page that each loss struck.

## Data

CI run 41595950594 at `f92e311fb` ran every Safari shard. All 49 shard artifacts were read, and every page result that names the engine's lost-context error was counted. No device took part.

| Measure, CI's Safari 27.2 | Count |
| --- | --- |
| Shards with at least one lost context, of 49 | 48 |
| Page results that lost a context | 137 |
| Losses reported in hold mode, where the engine draws one device and cannot recover | 114 |
| Losses after the engine had recovered twice within a minute | 23 |
| Losses in the render worker, the sketch worker, and the page | 128, 8, 1 |
| Image pages at High: runs that lost, of runs | 115 of 790, 14.6 per cent |
| Image pages without a preset: runs that lost, of runs | 10 of 1491, 0.7 per cent |
| Losses an hour of page time, High against no preset | 39.9 against 8.2 |
| Runs that lost, by canvas size: 320 by 180, 480 by 270, 640 by 360 | 12.4, 11.3, 9.3 per cent |
| Losses in the first and second half of their shard | 50 and 82 |
| Restart pages that lost a context, of their runs | 4 of 13, each on its first cycle |
| Kept-canvas restart pages that lost a context, though each keeps 43 canvases | 0 |
| Shard 35: items, minutes, losses | 48, 20, 0 |
| Median time from page start to the loss, High against other pages | 12.1 s against 49.5 s |
| Losses before any pipeline was built, while building them, before drawing, and after a first frame | 92, 9, 13, 23 |

## Look

The two options look the same. A page that lost its context draws no picture, and a page that keeps it draws the picture it drew before, so neither option changes what a reader sees.

## Decision

Keep the loss as the browser's fault until the pair of draws says otherwise, and decide how each pair reads before it runs. The checks plan draws the terrain page at High twice in a row on WebGL2. It draws at 320 by 180 pixels with a 1 s hold, and keeps both results.

- The first draw loses its context and the second keeps its own: the loss belongs to the first use of that page's programs in the browser session. A cache of the compiled programs can spare it, and the shader cache work on the branch is then the lever.
- Both draws lose their context: the loss strikes the page whatever its programs. This is the browser's fault, and the record then moves beside [D-290](D-290-a-browser-that-loses-images-leaves-the-fault-open.md) with the figures above.
- The first draw keeps its context and the second loses it: the loss does not belong to the first use, and the pair says nothing about the cache.
- Both draws keep their context: the page lost none in this run, and the pair says nothing.

The reading lives in `warmPageNote` in `tests/lib/plans.ts`, so a run records it beside the two results.

## Consequences

The checks plan gains two items. They share one shard and run in order, which costs about 5 s of a full run, and the run's notes carry the reading of the pair. The engine changes nothing: a hold-mode page cannot recover a lost device, and the run counts the loss as that page's failure. Read together, the two results say whether a fix belongs in the engine's compiled-program cache or in a browser-fault record with D-290.

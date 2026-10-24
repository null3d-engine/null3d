# D-246: Skyway's frame goes on the vehicles' vertices

Status: decided on 24 October 2026 for the Skyway showcase (M3-C1) and the traffic-lanes example
add-on. Date: 2026-10-24. Task: M3-C1 follow-up.

Summary: At Low, on the Mac, Skyway's frame costs 3.79 ms of GPU time on WebGPU and 7.09 ms on
WebGL2, against Night town's 1.86 ms and 2.90 ms at the same viewport. The sky lanes' 30,000 cars
were the largest single cost, 1.33 ms and 2.81 ms, because every car's hull gives each face its own
vertices and every pass that draws the lanes pays for them. A hull that shares each vertex between
the faces that meet at it keeps the silhouette and the 36 triangles, takes 24 vertices instead of
72, and brings the frame to 3.06 ms and 5.38 ms.

## Question

Where does Skyway's GPU time go at the preset that a phone runs, and what should change so that the
demo keeps its look and reaches the showcase's frame target?

## Rule

The showcase bar: a demo keeps its look, and a fix may not remove a feature to make a figure. The
engine's presets already decide what a phone draws, so a change made for a phone belongs either in
the demo's own choices or in the engine where the engine imposes the cost.

## Data

The starting figures came from the cloud Galaxy S24 (SM-S921B, Xclipse 940, Chrome 152, WebGL2,
display 30 Hz) of run `20261024-084928-demos`, on the demo-frames page, at the preset the engine
chose (Low). Skyway presented 7.75 frames a second, with a median frame interval of 33.3 ms, and a
95th percentile of 354 ms and a 99th of 2,083 ms: the picture held the display most of the time and
stalled a few times in the 5 s window. Night town, minutes later on the same device, presented
29.1 frames a second with a 95th percentile of 37.3 ms.

A second run of the changed demo measured two windows in a row on a cloud S24, run
`20261024-100026-skyway`, at both presets:

| Preset and window | Presented fps | Median | 95th | 99th |
| --- | --- | --- | --- | --- |
| Low, first 5 s | 7.22 | 33.3 ms | 408.3 ms | 2,226.6 ms |
| Low, next 5 s | 29.40 | 33.3 ms | 33.4 ms | 66.7 ms |
| Medium (asked High), first 5 s | 20.85 | 33.3 ms | 66.7 ms | 389.8 ms |
| Medium (asked High), next 5 s | 27.99 | 33.3 ms | 66.6 ms | 66.7 ms |

So the stalls are the demo's first seconds. In both windows the engine built no pipeline, skipped no
draw and rebuilt no table, and both windows carry upload spikes of about 1.2 MB, so neither pipeline
builds nor uploads explain the first window. The steady play holds the device's 30 Hz display at
both presets. What stalls a cold phone's first seconds is therefore outside the demo's frame work
and needs a measurement of its own.

The cost of each feature was then measured in Chrome on the Mac's own GPU (M5 Max), at a canvas of
618 x 1372 device pixels, which is the pixel size that the cloud phone's screen gives the demo at
Low. The demo's preset was fixed at Low, and the engine's frame-budget governor ran. The figures
are the engine's own GPU times, from its timestamp queries on WebGPU.

| Case, one feature off | WebGPU |
| --- | --- |
| Skyway, nothing off | 3.79 ms |
| no traffic (all 30,000 cars) | 2.46 ms |
| no screen-space reflections | 2.93 ms |
| no city lights (162 lamps, 3 searchlights) | 3.31 ms |
| no sharpening | 3.53 ms |
| no rain | 3.60 ms |
| no towers | 3.84 ms |
| Night town, for scale | 1.86 ms |

The same cases on WebGL2 ran after the change, with the light hull, because the run of the full hull
came first. Their frame with everything on is 5.38 ms, and Night town's is 2.90 ms.

| Case, one feature off | WebGL2 |
| --- | --- |
| Skyway, nothing off | 5.38 ms |
| no cars | 4.28 ms |
| no screen-space reflections | 3.27 ms |
| no city lights | 4.59 ms |
| no sharpening | 5.33 ms |
| no rain | 5.06 ms |
| no towers | 5.75 ms |
| Night town, for scale | 2.90 ms |

Each case is its own page load, and the governor's render scale can sit a step or two apart between
loads: two loads that should cost the same measured 4.82 and 5.38 ms on WebGL2. So a difference
under about half a millisecond is noise there. Removing the towers or the rain makes the WebGL2
frame costlier, because the ground and the sky then fill the pixels they had covered, and the
ground's noise costs more at those pixels than the tower shader does.

The traffic was the largest cost on both paths, and a car's hull explains it. The add-on's hull is a
loft of 18 quads whose every face carries its own four vertices: 72 vertices for 36 triangles. The
lanes draw the hull in the opaque pass, and the depth prepass draws it again, because the
reflections turn that prepass on at every preset and on both paths. So 30,000 cars are 4.3M vertex
shader runs in a frame.

| Measure | Full hull | Welded hull |
| --- | --- | --- |
| Vertices a car | 72 | 24 |
| Triangles a car | 36 | 36 |
| WebGPU frame, Low | 3.79 ms | 3.06 ms |
| WebGL2 frame, Low | 7.09 ms | 5.38 ms |
| WebGPU, the traffic alone | 1.33 ms | 0.64 ms |
| WebGL2, the traffic alone | 2.81 ms | 1.11 ms |

How the figures were produced: the diagnostic page ran `demo-frames` with `?demo=skyway&gpu=<path>
&preset=low&seconds=5` on Chrome 155 on the Mac, once per case, and printed `engine.measure`'s
figures. The before rows are one run, and the after rows another run of the same page and switches,
so each frame pair is one command on the same machine. A "traffic alone" figure subtracts the same
run's load without cars, except the full hull's WebGL2 figure, which subtracts the no-cars load of
the run after the change (4.28 ms) from the full hull's frame (7.09 ms), because no run measured
both. The vertices and triangles were compared offline by building both hulls and matching every
triangle's three corners.

## Decision

The hull takes a detail. `full` keeps every face on its own vertices, and `light` shares each vertex
between the faces that meet at it. The light hull draws the same triangles from a third of the
vertices, so a car's outline does not move; its normals are averaged across the faces that share a
vertex, so its body lights as one smooth shell instead of faceted panels. Skyway asks for the light
hull at Low, the preset a phone runs, and keeps the full one at Medium and above, so the close
pictures and the desktop look do not change. The hero car, the instances demo's traffic and any
scene that keeps the default keep the full hull too.

That takes 0.73 ms from the WebGPU frame and 1.71 ms from the WebGL2 frame, about a fifth and a
quarter of the frame. The look changes in one way: the lanes' cars shade smooth instead of faceted.
Their outline, their tail bars, nose lamps and skirt, and the traffic's density do not change. The
Mac's three pictures stay within their tolerance against the old references. The software renderer's
three moved 0.125 to 0.155 per cent of their pixels, past the 0.100 per cent limit, so those three
references are redrawn.

The cars stay at 30,000 on Low, and the lanes stay 2,400 m long, so the traffic reads as it did.

## Consequences

- `createVehicleHull()` takes `HullDetail` as its third argument, and the add-on's README gives the
  two hulls' vertices and the reason a scene with many vehicles asks for `light`.
- Skyway's `traffic.ts` builds the light hull at Low and the full one above, and builds the lanes
  again when a preset crosses between them. `examples/showcase/skyway/hero.ts` and
  `examples/instances/traffic.ts` keep the full hull.
- The demo's three software-renderer references are redrawn for the smooth shading, which is the
  only thing that moved them: their pixels are that of the same city, pose and traffic, with a
  car's body shaded smooth instead of faceted. The Mac's three keep their references, because the
  preset they draw keeps the full hull.
- The screen-space reflections are now the largest single cost on WebGL2, about 1.55 ms of 5.38 ms.
  Eight of the frame's passes are theirs: the depth copy, six reduce steps and the trace. On WebGL2
  a pass costs about 0.19 ms whatever its size, so the chain's fixed cost is most of the figure. A
  later change could cut the pyramid's levels at the preset a phone runs; it is not made here,
  because it trades the reflections' reach for the frame and belongs with the reflections' own
  record ([D-134](D-134-screen-space-reflections.md)).
- The city's 162 lamps and 3 searchlights cost 0.23 ms on WebGL2 and 0.48 ms on WebGPU. A pool of
  the nearest lamps would take most of that, and would change what the far streets reflect. It is
  left for a later change.

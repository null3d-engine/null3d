// Measures what the engine's sketch worker and render worker allocate per frame while S1 runs, with
// Chrome's heap profiler. Engine code and the sketch's row writes must allocate nothing per frame;
// the few places that allocate because the browser does each have a budget below. It opens the
// null3d S1 page in Chrome, lets the browser optimize the frame code, attaches the heap profiler to
// both workers through Chrome's debugging protocol, and samples allocations twice, a few seconds
// each. It prints the bytes per frame of every place that allocated, or the bytes per call of the
// places whose worker counts calls, and judges each place by the sample where it allocated least,
// so an event that happens once fails no place. In each sample it
// sets aside one burst of objects per place: the browser makes one when it installs code that it
// has just optimized, in whichever callback runs first, even an empty one. From the page's
// start to the end of the samples, it moves the mouse over the canvas and presses a key and the
// mouse button, so the samples cover the sketch's reading of input. It draws with WebGPU, or with
// WebGL2 when `--gpu webgl2` asks for it. `--scene s1-cells` runs S1-cells, whose views skip whole
// grid cells, `--scene s3` runs S3, whose 256 point lights move every frame, `--scene s4` runs
// S4, the phone scene, with its shadows, street lights and quality governor, `--scene s5` runs S5,
// the crowd of 500 animated knights that blend two clips and cast shadows, and `--scene s6` runs
// S6, the city, with its occlusion culling, bloom, ambient occlusion, labels and picking. Each
// scene runs at its own object count unless `--n` names one. A scene that streams in, as S6
// does, is whole before the warm-up starts. `--blend` makes
// S1's boxes see through, so each frame sorts every visible row for the transparent pass.
// `--animated 64` adds 64 animated characters to S1, which play, cross-fade, blend a masked layer
// and an additive one, play phase-synced blends and clips at weights that the sketch moves, and
// fire events to the sketch's handlers through the animator, and turn joints and aim chains of
// joints on top of their clips. `--morphed 64`
// adds 64 spheres with three morph targets each, whose weights the sketch sets in every frame.
// `--grading`
// gives S1 a color grading table and the vignette, and changes both every frame. `--sprites` draws
// S1's swarm as one dynamic batch of blended sprites instead of boxes, and `--lines` as one dynamic
// batch of dashed line segments, whose dashes move every frame. `--labels 256` adds 256
// objects to S1, each with an HTML label that the page binds. `--ao` turns ambient occlusion
// on in S1, and changes its intensity every frame. `--bloom` turns bloom on in S1, and changes
// its intensity every frame, so the core writes the chain's settings again in each frame. `--dof`
// turns depth of field on in S1, focused on a point that moves every frame, so the core writes its
// steps' blocks again in each frame. `--exposure` turns automatic exposure on in S1, and changes
// its compensation every frame, so the meter runs and uploads its block in each frame. `--fog`
// gives S1 height fog with the volumetric fog on, and changes the volumetric fog's intensity with
// `scene.setFog` every frame, so the core writes the fog's block again in each frame.
// The camera orbits, so each frame
// places every label at a new point, and the thread that draws copies them for the page.
// `--outline` adds 16 outlined boxes to S1, turns outlines on with a hidden line, and changes the
// line's width every frame. `--tile-shadows` adds two point lights and two spot lights that cast
// shadows to S1, with casters that circle them, so tiles of the shadow atlas draw again every
// frame. `--batch-shadows` gives the sun shadows in 3 cascades and makes S1's rows
// cast and receive them, so a moving batch tests the far cascades and the tiles each frame.
// `--row-values` gives S1's rows colors and values that change every frame, which a custom
// material reads to sway and tint each box, so the frame uploads every row's values; with
// `--batch-shadows`, the rows cast with the material's own caster builds. `--levels` gives S1's
// boxes levels of detail, so each frame picks a level for every row, and fades rows between two.
// `--effects` adds two custom effects to S1, one of which reads the scene's depth, and
// changes a uniform of each every frame. `--canvas` follows an OffscreenCanvas with a texture and
// refreshes a rectangle of it every frame, so the sample holds the browser's image data and the
// upload that the refresh makes. `--environment` lights S1 with the built-in room, and
// turns it and changes its intensity every frame. `--probes` sets a small light probe grid over
// S1, so the lit draws take the grid's templates and read it three times a pixel. `--hemisphere`
// adds two hemisphere lights to S1,
// one of them tilted, and changes their intensities every frame. `--area-lights` adds eight
// rectangle lights, two with images, and four tube lights to S1, which circle the swarm and change
// their intensities every frame. `--setters` calls, every frame, each setter that a sketch may
// call per frame, with fractions and colors: the lights', a standard and a custom material's, a
// line batch's, the camera's field of view, the fog and the background color. Run it after a
// change of any setter, on both GPU paths. `--sky` draws three.js's sky behind S1, and
// moves its sun and its clouds every frame. `--sky-environment` does the same, and lights S1 with
// the sky's environment too, which refreshes one stage a frame while the sun moves. `--atmosphere`
// and `--atmosphere-environment` do the same with the physical sky, whose sky view table draws
// again in every frame while the sun moves. `--reflection`
// puts rippled water under S1, which a reflection pass mirrors the swarm and the orbiting camera's
// view into in every frame. `--particles` adds two particle systems to S1, whose emitters write
// births every frame, one of them soft, so the frame copies the opaque depth for it.
// `--translucency` makes S1's boxes let light through to their other side, which lights their
// backs, and `--subsurface` adds 64 spheres to S1 whose light spreads under their surface, which the
// skin pass draws again and the subsurface blur's steps spread.
// `--transmission` puts clear water that lets light through under S1,
// which samples a copy of the swarm's colors that the frame makes, with its mip levels, in every
// frame. `--reflection-probes` places two reflection probes over S1 that capture again in turns in
// every frame, so each frame draws six capture views and runs a probe's filter.
// `--ssr` puts a polished floor under S1 with screen-space reflections on, which draw a
// depth pyramid, trace it and copy the opaque colors in every frame.
// `--coat-sheen` gives S1's boxes a clear coat and a sheen, the shaders of layered
// materials. `--weighted` puts a column of smoke of the weighted blending over S1, whose 2,000
// puffs rise in every frame, which the camera's weighted layer draws. `--decals` puts a ground
// with a batch of decals under S1, which turn every frame, so the decal pass culls, orders and
// uploads their rows in every frame. `--passes` adds a full-screen pass that reads S1's color
// at half the render size, whose texture a custom effect adds as a glow, and changes the pass's
// uniform every frame, and keeps the pass on with `render.setPassEnabled` in every frame.
// `--terrain` puts the terrain add-on's ground under S1, whose quadtree
// follows the orbiting camera in every frame. `--impostors` puts a field of the impostors add-on's
// cards around S1, which pick their views from the camera in every frame. `--splats` puts a cloud
// of the splats add-on's Gaussians above S1, whose chunks a job worker selects for the camera's
// position in every frame, through the engine's public task hook. `--inertial` makes the
// animated characters that play one clip switch clips by inertial transitions, with 64 characters
// unless `--animated` names a count. `--calls` makes, every frame, the
// calls whose docs promise no allocation and that no other switch makes: a raycast, a mesh's vertex
// update, a camera's ray through the pointer and its screen point of a place, the orbit and fly
// controls' update, and the sketch's read of the frame's figures, which turns on the figures that
// `--stats` samples. `--time-of-day` moves a day cycle's hour in every frame, through the object
// that the first `timeOfDay` call made, for the allocation sample of the helper's per-frame form.
// `--prepass` turns the depth prepass on, in any scene.
// `--terrain` and `--impostors` fail the check while their add-ons stand as they are: measured on
// the Mac on 15 October 2026, the terrain's update allocated 1908 bytes per frame in the heightfield
// sampling, 1871 in the chunks it evicts and 1163 more in the same sampling, about 5 KB in all, and
// the impostors' batch update allocated 187 KB per frame with 23 KB in the sampling beside it. Both
// add-ons must stop allocating in their per-frame update, which their owners owe.
// `--stats` shows the stats overlay through the `?stats` switch, so the engine samples its costly
// figures while the profiler samples: GPU time on one frame in eleven, the counts of the draws that
// the GPU culls, and the memory figures that the sketch thread publishes. `--stats-collapsed` shows
// it collapsed to its frame rate, which samples none of them, so it keeps the budgets of a page
// without the overlay.
// It samples the production build
// of the benchmark pages, as a developer ships the engine, and names
// the build's functions through its source maps; `--dev` samples the dev server's pages, with the
// engine's development checks. `--no-inline` turns the browser's inlining off, so each function's
// objects count in its own place, not in its caller's; budgets then do not hold, so read the places,
// not the verdict. `--warmup-frames 1200` sets the warm-up's frames, for a quick look whose code
// the browser may not have optimized yet. With CI set, as on CI's machines, it runs Playwright's
// Chromium without a window, on SwiftShader, and samples S1 with fewer boxes. It then counts the
// frames that S1 steps, and judges a few places by budgets of SwiftShader's own.
// From the repository root:
//   bun run bench:allocation
//   bun run bench:allocation --n 30000 --seconds 5 --warmup 30
//   bun run bench:allocation --gpu webgl2
//   bun run bench:allocation --scene s1-cells --gpu webgl2
//   bun run bench:allocation --scene s3
//   bun run bench:allocation --scene s4 --gpu webgl2
//   bun run bench:allocation --scene s5 --gpu webgl2
//   bun run bench:allocation --scene s6 --gpu webgl2
//   bun run bench:allocation --blend --n 30000 --gpu webgl2
//   bun run bench:allocation --animated 64 --gpu webgl2
//   bun run bench:allocation --morphed 64 --gpu webgl2
//   bun run bench:allocation --grading --gpu webgl2
//   bun run bench:allocation --sprites --gpu webgl2
//   bun run bench:allocation --lines --gpu webgl2
//   bun run bench:allocation --ao --gpu webgl2
//   bun run bench:allocation --bloom --gpu webgl2
//   bun run bench:allocation --dof --gpu webgl2
//   bun run bench:allocation --exposure --gpu webgl2
//   bun run bench:allocation --fog --gpu webgl2
//   bun run bench:allocation --outline --gpu webgl2
//   bun run bench:allocation --scene s4 --prepass --gpu webgl2
//   bun run bench:allocation --labels 256 --gpu webgl2
//   bun run bench:allocation --labels 256 --no-inline
//   bun run bench:allocation --environment --gpu webgl2
//   bun run bench:allocation --hemisphere --gpu webgl2
//   bun run bench:allocation --area-lights --gpu webgl2
//   bun run bench:allocation --setters --gpu webgl2
//   bun run bench:allocation --effects --gpu webgl2
//   bun run bench:allocation --stats --gpu webgl2
//   bun run bench:allocation --sky --gpu webgl2
//   bun run bench:allocation --sky-environment --gpu webgl2
//   bun run bench:allocation --reflection --gpu webgl2
//   bun run bench:allocation --transmission --gpu webgl2
//   bun run bench:allocation --reflection-probes --gpu webgl2
//   bun run bench:allocation --translucency --gpu webgl2
//   bun run bench:allocation --subsurface --gpu webgl2
//   bun run bench:allocation --ssr --gpu webgl2
//   bun run bench:allocation --weighted --gpu webgl2
//   bun run bench:allocation --decals --gpu webgl2
//   bun run bench:allocation --particles --gpu webgl2
//   bun run bench:allocation --passes --gpu webgl2
//   bun run bench:allocation --coat-sheen --gpu webgl2
//   bun run bench:allocation --atmosphere --gpu webgl2
//   bun run bench:allocation --terrain --gpu webgl2
//   bun run bench:allocation --impostors --gpu webgl2
//   bun run bench:allocation --splats --gpu webgl2
//   bun run bench:allocation --inertial --gpu webgl2
//   bun run bench:allocation --time-of-day
//   bun run bench:allocation --calls --gpu webgl2
// At 30,000 instances a frame's upload goes through the staging ring; at 100,000 it does not.
import type { Page } from '@playwright/test';
import {
	defaultEnvironment,
	launchChromium,
	SWIFTSHADER_ARGS,
} from '../packages/cli/src/browser.js';
import { HeapSampler } from '../packages/cli/src/devtools.js';
import {
	countIn,
	type ProfileNode,
	perCall,
	profilePlaces,
	type Sample,
	steadyPlaces,
	totalSize,
} from '../packages/cli/src/heap-profile.js';
import { launchInWindow, newParkedPage } from '../tests/lib/app-window.ts';
import { DEBUG_PORT } from '../tests/lib/server.ts';
import { attachWorkers, DevTools, evaluate, pagesAt, sleep, within } from './lib/devtools';
import { pagePath } from './lib/parity';
import { DEV_OPTION, pagesText, serveBenchPages } from './lib/serve';
import type { BuildNames } from './lib/source-names';
import { SCENE_COUNTS } from './lib/visual';

/** Bytes between allocation samples: small, so a few bytes per frame still show. */
const SAMPLING_INTERVAL = 128;
/**
 * Seconds the sketch runs before sampling starts. The browser optimizes code that runs once per frame
 * only after many frames, and until then the numbers such code computes are allocated.
 */
const WARMUP_SECONDS = 30;
/**
 * Frames the page must draw before sampling starts as well. The browser optimizes by frames, so a
 * display at a lower refresh rate needs more seconds for the same warm-up. Its optimizing compiler
 * takes a function after a few thousand calls, and code that runs once per frame gets one call a
 * frame.
 */
const WARMUP_FRAMES = 3600;
/**
 * S1's object count on SwiftShader, where the check runs in CI. SwiftShader draws S1's 100,000
 * boxes at under one frame a second, and 1,000 at 3 to 8 on CI's machines. Each frame runs the same
 * engine code whatever the count.
 */
const SWIFTSHADER_COUNT = 1000;
/**
 * The pixel ratio that S1 draws at on SwiftShader, which shades every pixel on the processor: half
 * the protocol's, so a frame shades a quarter of the pixels and the warm-up reaches its frames
 * sooner. A frame's engine code is the same at any size.
 */
const SWIFTSHADER_PIXEL_RATIO = 0.5;
/**
 * On SwiftShader the browser's compilers take a function after fewer calls, so a shorter warm-up
 * reaches the code that a long one reaches. At 3,600 frames the warm-up took 8 to 18 minutes on
 * CI's machines. At 1,200 frames with the browser's own counts, the sketch's phase timer and the
 * canvas view's helper had not been optimized yet, and allocated. With these counts, 600 frames
 * still left a callback of the sketch worker unoptimized, and 900 frames passed.
 */
const SWIFTSHADER_JS_FLAGS =
	'--invocation-count-for-maglev=100 --invocation-count-for-turbofan=500 --minimum-invocations-after-ic-update=100';
/** The warm-up's frames on SwiftShader, with the lower counts of `SWIFTSHADER_JS_FLAGS`. */
const SWIFTSHADER_WARMUP_FRAMES = 1200;
/**
 * Samples the check takes one after another. Allocation in every frame shows in each of them. An
 * event that happens once, such as the browser installing code it has just optimized, lands in one.
 */
const SAMPLES = 2;
/** The scenes that the check runs. */
const ALLOCATION_SCENES = ['s1', 's1-cells', 's3', 's4', 's5', 's6'] as const;
/** How long a scene that streams in may take to be whole, in milliseconds. */
const WHOLE_TIMEOUT_MS = 300_000;
/** The workers the check samples, by a part of their script's URL. */
const WORKERS = ['sketch-worker', 'render-worker'] as const;

/**
 * Places that allocate for reasons outside the engine's frame code, by function and file, with the
 * most bytes per frame each may allocate:
 * - frame timers, which get a new number object from the browser's clock at each reading;
 * - the sketch worker's frame wait in the frame loop, which the runner holds: the result and promise
 *   of `Atomics.waitAsync`, the await on that promise, and settling it between tasks;
 * - the render worker's WebGPU objects: the command encoder, the passes, the command buffer, and
 *   the canvas texture and its view. Each render pass adds its encoder, about 17 bytes. S4's two
 *   shadow passes and nine more uploads per frame put its replay 46 to 48 bytes above S1's. The
 *   canvas hands out a new texture each frame, so the view of it must be made each frame too, about
 *   34 bytes on S1. The backend's `colorView` and `targetView` make them, and the check counts both
 *   in the replay that calls them (`COUNTED_IN_CALLER`), whose budget holds them;
 * - the completion tracker's object for each frame: the queue's promise and its reaction on WebGPU,
 *   which the browser counts in the renderer's `drawFrame` where it inlines the tracker, or the fence
 *   on WebGL2. After a few minutes the browser compiles the render loop's `draw` with `drawFrame`
 *   inlined and the tracker's `afterSubmit` not, and counts the object there. Also the clock
 *   readings at each frame's submit and completion, and at each check of the frames still in flight,
 *   including `giveUpStalled`, which reads the clock at each frame while frames stall;
 * - the staging ring's mapping, for uploads that go through it: the mapped range and the views that
 *   copy into it, and the promise of the request to map the buffer again;
 * - the upload route timing, which reads the clock around the uploads of one submit in a few;
 * - the time the browser passes to each animation frame callback, between tasks;
 * - the benchmark sketch's camera path. With --dev, its numbers go to the engine's development
 *   checks. In S4, the browser runs it on its middle tier for the whole sample, which boxes about
 *   two of the numbers that it passes to the camera's setters;
 * - an instance batch's array views, rebuilt once each time the engine's memory grows, which it
 *   does a few times while its buffers reach their final sizes;
 * - the sketch worker's reading of pointer events. It runs at the input's rate, not the frame's,
 *   so the browser may keep it in a lower tier, where each fraction it computes is a new number.
 *   With a mouse move about every third frame, S5 and S6 took 2 to 11 bytes per frame there.
 * - the wake path's slot change, which the sketch worker reads each frame: measured on the Mac at
 *   High on 15 October 2026, it took 17.5 bytes per frame, up to 19.7;
 * - the frame's pending reads, which the render worker maps after it submits: each read makes a
 *   promise with its reactions, about 18 bytes, and S1 reads once a frame, so it took 18.2 bytes
 *   per frame, up to 20.4.
 */
export const BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {
		'frame sketch/runner.ts': 240,
		'runPipelined sketch/runner.ts': 128,
		'slotChange shared/wake.ts': 20,
		'(IDLE)': 96,
		'(anonymous) null3d/sketch-common.ts': 48,
		'views scene/scene.ts': 16,
		'onPointer sketch/input.ts': 16,
	},
	'render-worker': {
		// The passes' objects, and the canvas texture and its view at 48.
		'replay webgpu/backend.ts': 368,
		'commandEncoder webgpu/backend.ts': 32,
		'draw render/loop.ts': 64,
		'drawFrame render/webgpu-renderers.ts': 192,
		'drawFrame render/webgl2-renderers.ts': 192,
		'(IDLE)': 48,
		'(JS)': 24,
		'take webgpu/staging.ts': 160,
		'write webgpu/staging.ts': 96,
		'afterSubmit webgpu/staging.ts': 160,
		'then (built-in)': 128,
		'Uint8Array (built-in)': 64,
		'submit webgpu/backend.ts': 32,
		'start webgpu/buffer-reads.ts': 24,
		'afterSubmit gpu/completion.ts': 160,
		'push gpu/completion.ts': 24,
		'finish gpu/completion.ts': 40,
		'unfinished gpu/completion.ts': 16,
		'giveUpStalled gpu/completion.ts': 16,
	},
};
/**
 * Places that allocate with `--stats` on top of `BUDGETS`, while the overlay samples, which
 * `CALLS_BUDGETS` takes over too, because `--calls` reads the frame's figures and turns the same
 * sampling on. On WebGPU, on
 * one frame in eleven, the GPU timer's readback and the readback of the GPU-culled draws' counts
 * each make a command buffer or a view of the mapped range, and a promise with its reaction: the
 * browser returns each of them, so no pool can keep them. On S1 the timer's places took 35 to 38
 * bytes per frame in all and the counts' 17 to 20, with 100,000 instances and with 20,000. A frame
 * without a readback allocates nothing more, so these budgets stay the same whatever the scene
 * holds. WebGL2's timer allocated nothing that the profiler saw.
 */
export const STATS_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {},
	'render-worker': {
		'copyOut webgpu/gpu-timer.ts': 24,
		'afterSubmit webgpu/gpu-timer.ts': 16,
		'read webgpu/gpu-timer.ts': 16,
		'afterSubmit webgpu/culled-counts.ts': 16,
		'read webgpu/culled-counts.ts': 12,
		'Uint32Array (built-in)': 8,
		'then (built-in)': 32,
	},
};

/**
 * Places that allocate with `--sky-environment` on top of `BUDGETS`, while the sun moves in every
 * frame. Each stage of the sky map that draws makes one object that the browser returns, in every
 * frame but the copy's: on WebGPU its render pass's encoder, about 17 bytes, and on WebGL2 its fence,
 * about 16 bytes.
 */
export const SKY_ENVIRONMENT_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {},
	'render-worker': { 'draw webgpu/environment.ts': 20, 'stage webgl2/environment.ts': 20 },
};

/**
 * Places that allocate with `--setters` and `--hemisphere` on top of `BUDGETS`: the browser's
 * boxing of a number that a step of S1's frame computes and passes to a setter that it does not
 * inline. The step runs in the sketch's own frame code, where the browser also inlines the large
 * `pose`; its inlining budget can then run out before the setter, and the number becomes an object
 * of its own. The same boxing is why S1's camera step, `(anonymous) null3d/sketch-common.ts`, has a
 * budget of 48. A run of the same switch that passes whole numbers in place of the fractions
 * allocates nothing, so no setter call of its own is the cause. The engine's setters write their
 * numbers into the core's call values (see `CoreMemory.callValues`), so no fraction reaches the core
 * as an argument.
 */
export const SETTER_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {
		'(anonymous) null3d/s1-sketch.ts': 48,
		'pose null3d/s1-sketch.ts': 40,
	},
	'render-worker': {
		// A line batch that the switch makes dashed draws a pass of its own, so the WebGL2 backend
		// begins one more pass each frame and the browser makes its per-pass object, about 23 bytes.
		'beginPass webgl2/backend.ts': 32,
	},
};

/**
 * The bytes per frame that the WebGPU replay may allocate on top of its budget with
 * `--reflection-probes`: the encoders of the six capture views' culling passes, render passes and
 * the passes that copy their images upright, at bloom's allowance per pass.
 */
const PROBES_REPLAY_BUDGET = 6 * 3 * 64;

/**
 * The bytes per frame that a reflection probe's filter may allocate on WebGPU with
 * `--reflection-probes`: the encoder of each of its render passes, at bloom's allowance per pass. A
 * filter of probes 256 texels across draws 6 passes that copy the views' images, 42 that make the
 * chain's levels and 7 that fill the probe's levels.
 */
const PROBE_FILTER_BUDGET = 55 * 64;

/** The budgets that `--reflection-probes` adds to a frame's places. */
const PROBE_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {},
	'render-worker': {
		'replay webgpu/backend.ts': PROBES_REPLAY_BUDGET,
		'draw webgpu/probes.ts': PROBE_FILTER_BUDGET,
	},
};

/**
 * Places that allocate with `--calls`, on top of `BUDGETS`: the sketch's own step, which makes the
 * calls that the engine's docs promise allocate nothing, and the figure places that its read of
 * `debug.frameStats` turns on, which are `STATS_BUDGETS`'.
 */
export const CALLS_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {},
	'render-worker': { ...STATS_BUDGETS['render-worker'] },
};

/**
 * Places that allocate with `--time-of-day`, on top of `BUDGETS`: the day cycle's own steps, which
 * pass fractions to each other from a call that the browser does not inline, and the sketch's step
 * that calls the helper.
 */
export const DAY_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {},
	'render-worker': {},
};

/**
 * Places that allocate with `--canvas`, on top of `BUDGETS`: the browser's image data for the
 * rectangle and its copy into engine memory, which the browser attributes to the refresh and to
 * the copy at each read, the argument object that the sketch passes to the call, and the render
 * passes that make the texture's mip levels again. Measured on the Mac on 25 October 2026, on the
 * run that passed on each path: the sketch worker read 144.6, 141.2 and 27.4 bytes per frame on
 * the WebGPU path and 153.2, 147.1 and 25.3 on WebGL2, for the image data, the copy and the call's
 * argument, and the WebGPU replay's place read 169.2 for the levels, which WebGL2 makes without a
 * render pass.
 */
export const CANVAS_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {
		'refresh scene/textures.ts': 192,
		'setRegion scene/textures.ts': 192,
		'onLateUpdate null3d/s1-sketch.ts': 48,
	},
	'render-worker': { 'generateMipmaps webgpu/backend.ts': 208 },
};

/**
 * Budgets on SwiftShader, where the check runs in CI, in place of those of `BUDGETS`. SwiftShader
 * draws a few frames a second, and the browser still calls the render worker at the display's rate,
 * so work that runs at each of those calls weighs several times as much per frame:
 * - the browser's own objects in the render worker between tasks and outside the engine's
 *   functions, which on WebGL2 took 195 to 323 bytes per frame in `(IDLE)` and 86 to 148 in
 *   `(JS)`, against under 50 and 25 on a real GPU;
 * - the completion tracker's clock reading at each check of a frame that the GPU still holds, which
 *   SwiftShader holds at nearly every check: up to 20 bytes per frame on WebGPU and 128 on WebGL2,
 *   whose fence the render worker checks at each call. On a real GPU the frames finish before the
 *   check, and the place allocates nothing.
 */
export const SWIFTSHADER_BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {},
	'render-worker': {
		// The fallback when a worker gives no call count: the figures that two slow runners read,
		// with room above them.
		'(IDLE)': 1024,
		'(JS)': 640,
		'giveUpStalled gpu/completion.ts': 256,
		// The frame's own work is paid at each call of the render worker, which the browser makes at
		// the display's rate, while the check counts the frames that S1 steps. A slower runner
		// therefore steps fewer frames for the same calls: a healthy CI run read 110.7 bytes per
		// frame at 430a851c9, a local run in CI's mode 157.7 to 173.6 (most 190.5), and one slow
		// runner 444.4, which failed the real-GPU budget of 192. The Mac's gate keeps that 192.
		'drawFrame render/webgpu-renderers.ts': 512,
	},
};

/** The most bytes per frame any other place may allocate: sampling noise, less than one object. */
const OTHER_BUDGET = 4;

/**
 * Places whose allocation follows the browser's calls into the worker rather than the engine's
 * frames, and the bytes each may allocate per call. The browser calls the render worker at the
 * display's rate, so a slow GPU steps fewer frames per call: on SwiftShader a frame that takes a
 * second takes about 50 calls, and the browser's own per-call objects then weigh about 50 times as
 * much per frame. On 20 October 2026 two runs read 865 and 965 bytes per frame at (IDLE) and 470
 * and 560 at (JS), while a run of the same code whose warm-up was 2.6 times faster read 698 in all.
 * Judging these two per call removes the runner's speed from the figure. The budgets equal the
 * per-frame budgets of a real GPU, where each call draws one frame.
 */
const CALL_BUDGETS: Readonly<Record<string, number>> = { '(IDLE)': 48, '(JS)': 24 };

/**
 * Places on the sketch worker that allocate at each task call rather than at each frame, and the
 * bytes each may allocate per call. A task's input and answer cross to a job worker and back as
 * messages, and its promise settles between frames, so the engine's loader makes the browser's
 * message and promise objects at each call, in `shared/tasks.ts`. The add-on's own code makes one
 * promise for its `then`, which is `choose` here. A slow GPU steps fewer frames per task call, as on
 * SwiftShader, so judging per frame would weigh one call many times; the check counts the thread's
 * tasks (`__null3dTaskCalls`) and judges these places per call. The frame step itself carries the
 * ask on SwiftShader, which keeps its sketch in the browser's middle tier: the profiler then charges
 * a call's promise objects to the inlined frame step, `pose`, where the Mac charges them to the
 * loader's places. So `pose` is judged per call here too. The figures come from the Mac's WebGL2 run
 * and SwiftShader runs on 24 October 2026 with `--splats` and the task asked about once a frame,
 * with room above them. The add-on's frame step makes no array and no number object.
 */
const TASK_CALL_BUDGETS: Readonly<Record<string, number>> = {
	'pose null3d/s1-sketch.ts': 128,
	'run shared/tasks.ts': 560,
	'n.onmessage shared/tasks.ts': 240,
	'Promise (built-in)': 160,
	'delete (built-in)': 130,
	'leastBusy shared/tasks.ts': 100,
	'choose src/system.ts': 64,
	'select src/select.ts': 64,
	'runTask shared/run-task.ts': 64,
	'(anonymous) shared/tasks.ts': 48,
	'(JS)': 48,
	'(V8 API)': 32,
	'values (built-in)': 16,
	'next (built-in)': 16,
};

/** The budget of `place` per call in `worker`, or undefined where the worker judges it per frame. */
function callBudgetFor(worker: string, place: string): number | undefined {
	return worker === 'render-worker' ? CALL_BUDGETS[place] : TASK_CALL_BUDGETS[place];
}

/**
 * The budget of `place` in `worker` for a run: the tables' figure, SwiftShader's own where it has
 * one, plus what the run's switches and scene add. A run on SwiftShader judges a place by the
 * SwiftShader figure when the table names one.
 */
export function placeBudget(
	worker: string,
	place: string,
	options: { swiftShader: boolean; extra?: number },
): number {
	const table = {
		...BUDGETS[worker as (typeof WORKERS)[number]],
		...(options.swiftShader ? SWIFTSHADER_BUDGETS[worker as (typeof WORKERS)[number]] : {}),
	};
	return (table[place] ?? OTHER_BUDGET) + (options.extra ?? 0);
}

/** The place of the WebGPU replay, which makes the browser's objects of each pass. */
const REPLAY = 'replay webgpu/backend.ts';

/**
 * Functions whose objects the check counts in their caller's place. The browser counts an object in
 * the function that makes it, or in the caller where it inlines that function, and the canvas
 * texture and its view moved between `colorView` and the replay from run to run while their sum
 * held: in five runs of 24 October 2026 on SwiftShader, `colorView` read 7.3 to 52.8 bytes per frame
 * and the replay 76.8 to 100.8, their sum 101.5 to 129.6. With samples of 420 frames, `colorView`
 * read 30.5. Counted in the replay, the two read the same whichever way the inlining fell.
 */
const COUNTED_IN_CALLER: ReadonlyMap<string, string> = new Map([
	['colorView webgpu/backend.ts', REPLAY],
	['targetView webgpu/backend.ts', REPLAY],
]);

/** Budgets of places by worker, in bytes per frame. */
type WorkerBudgets = Partial<Record<(typeof WORKERS)[number], Record<string, number>>>;

/**
 * The bytes per frame that the WebGPU replay may allocate for each render pass or compute pass that
 * a switch or a scene adds on top of S1's: the browser's encoder of the pass, which it makes for
 * each pass. Measured on the Mac at High: (2026-10-15) the pass-heavy switches added 25.5 to 34.4
 * bytes per pass over S1's own figure — 24 for `--tile-shadows`, 28 for `--bloom`, 26 for `--dof`,
 * 34 for `--fog` and 25 for `--passes` — so 32 covers them with room for sampling noise.
 */
const PASS_REPLAY_BYTES = 32;

/**
 * The render passes that the sun's contact shadows add, in scenes whose sun casts shadows (S4, and
 * S1 with `--batch-shadows`), with ambient occlusion off: the depth prepass's own pass, the depth
 * copy, the horizon step that marches them and the denoise that blurs them. The Mac draws these
 * scenes at High, where contact shadows draw. With `--ao` they add no pass: ambient occlusion runs
 * the same steps already.
 */
const CONTACT_PASSES = 5;

/**
 * What `--transmission` adds to the WebGPU backend's mip levels: the encoders of the render passes
 * that make the copy's levels, one per level after the first, for a render size of up to 4096
 * pixels. On the Mac the page's ten such passes allocated about 17 bytes per pass, 173 per frame.
 */
const TRANSMISSION_MIPS_BUDGETS: WorkerBudgets = {
	'render-worker': { 'generateMipmaps webgpu/backend.ts': 11 * 32 },
};

/**
 * What `--ssr` adds to the WebGPU replay each frame, beyond the passes that `PAGE_SWITCHES` counts:
 * the encoders of the ten render passes that screen-space reflections add (the depth prepass, which
 * draws apart from the opaque pass, the depth copy, the six levels of the depth pyramid, the trace
 * and the copy of the opaque colors). On the Mac each allocated about 64 bytes, twice
 * `PASS_REPLAY_BYTES`, so the table adds the other half and keeps one pass's room above the ten, as
 * bloom's does. The reflections share the copy's mip levels with `--transmission`, at the same
 * allowance.
 */
const SSR_BUDGETS: WorkerBudgets = {
	'render-worker': {
		[REPLAY]: 10 * 32 + 64,
		'generateMipmaps webgpu/backend.ts': 11 * 32,
	},
};

/**
 * What `--weighted` writes through the staging ring each frame: the blended rows' weights, which the
 * page uploads as its rows move. Measured on the Mac on 15 October 2026: the write took 123.5 bytes
 * per frame against the 96 that a page without the switch takes, up to 124.1.
 */
const WEIGHTED_BUDGETS: WorkerBudgets = {
	'render-worker': { 'write webgpu/staging.ts': 32 },
};

/** A switch of the check that S1's page takes as a switch of its sketch. */
interface PageSwitch {
	/** The check's flag. */
	flag: string;
	/** What the flag adds to the page's address. */
	query: string;
	/** What the flag adds to the page's address on SwiftShader, where a smaller scene runs. */
	swiftShaderQuery?: string;
	/** The render passes and compute passes that it adds to each WebGPU frame, if any. */
	passes?: number;
	/** What it allocates on top of `BUDGETS` beyond its passes, by place. */
	budgets?: WorkerBudgets;
	/** True for a switch that any scene takes; the others change S1 alone. */
	anyScene?: boolean;
}

/**
 * The switches that the check passes to the page, as the header lists them. Each pass that a
 * switch adds to a WebGPU frame adds `PASS_REPLAY_BYTES` to the replay's budget:
 * - `--tile-shadows`: a culling pass and a render pass for each tile, for the most tiles that draw
 *   again in a frame (`MAX_REDRAWS` in `shadow_tiles.rs`). Moving casters draw tiles in every
 *   frame of that page;
 * - `--batch-shadows`: a culling pass and a render pass for each of the sun's 3 cascades. The rows
 *   move through every cascade, so each cascade draws again in every frame, not only on its turn;
 *   and the contact shadows' passes, without `--ao`;
 * - `--bloom`: bloom's default chain of 15 passes;
 * - `--dof`: depth of field's four passes;
 * - `--exposure`: the meter's two, a compute pass for the histogram or two render passes for the
 *   downsample;
 * - `--fog`: the volumetric fog's three;
 * - `--effects`: the two effects' passes;
 * - `--reflection`: the reflection's culling pass, its render pass and the pass that copies its
 *   image upright;
 * - `--transmission`: the pass that copies the opaque color, with the passes of its mip levels;
 * - `--ssr`: the depth prepass, the depth copy, the six levels of the depth pyramid, the trace and
 *   the copy of the opaque colors, with the passes of the copy's mip levels;
 * - `--particles`: the pass that copies the opaque depth for the soft particles;
 * - `--decals`: the decal pass;
 * - `--splats`: the pass that copies the opaque depth, which the splats' soft mix with meshes reads.
 *   On SwiftShader the switch names a smaller cloud, 12,000 splats of which 4,800 draw, because
 *   the software renderer draws the blended cards slowly. The selection's code is the same.
 * - `--passes`: the full-screen pass and the effect's pass;
 * - `--prepass`: the depth prepass.
 */
export const PAGE_SWITCHES: readonly PageSwitch[] = [
	{ flag: '--blend', query: '&blend' },
	{ flag: '--grading', query: '&grading' },
	{ flag: '--sprites', query: '&sprites' },
	{ flag: '--lines', query: '&lines' },
	{ flag: '--ao', query: '&ao' },
	{ flag: '--bloom', query: '&bloom', passes: 15 },
	{ flag: '--dof', query: '&dof', passes: 4 },
	{ flag: '--exposure', query: '&exposure', passes: 2 },
	{ flag: '--fog', query: '&fog', passes: 3 },
	{ flag: '--outline', query: '&outline' },
	{ flag: '--prepass', query: '&prepass=on', anyScene: true },
	{ flag: '--tile-shadows', query: '&tileShadows', passes: 2 * 12 },
	{ flag: '--batch-shadows', query: '&shadows=3&batchShadows', passes: 2 * 3 },
	{ flag: '--row-values', query: '&rowValues' },
	{ flag: '--levels', query: '&levels' },
	{ flag: '--environment', query: '&environment' },
	{
		flag: '--reflection-probes',
		query: '&reflectionProbes=always',
		budgets: PROBE_BUDGETS,
	},
	{ flag: '--hemisphere', query: '&hemisphere', budgets: SETTER_BUDGETS },
	{ flag: '--area-lights', query: '&areaLights' },
	{ flag: '--setters', query: '&setters', budgets: SETTER_BUDGETS },
	{ flag: '--effects', query: '&effects', passes: 2 },
	{ flag: '--canvas', query: '&canvas', budgets: CANVAS_BUDGETS },
	{ flag: '--sky', query: '&sky' },
	{ flag: '--sky-environment', query: '&sky=light', budgets: SKY_ENVIRONMENT_BUDGETS },
	{ flag: '--atmosphere', query: '&sky=physical' },
	{
		flag: '--atmosphere-environment',
		query: '&sky=physical-light',
		budgets: SKY_ENVIRONMENT_BUDGETS,
	},
	{ flag: '--reflection', query: '&reflection', passes: 3 },
	{
		flag: '--transmission',
		query: '&transmission',
		passes: 1,
		budgets: TRANSMISSION_MIPS_BUDGETS,
	},
	{ flag: '--translucency', query: '&translucency' },
	// The skin pass, the culling pass that follows it on the GPU-driven path, and the blur's two
	// steps.
	{ flag: '--subsurface', query: '&subsurface', passes: 4 },
	{
		flag: '--ssr',
		query: '&ssr',
		passes: 10,
		budgets: SSR_BUDGETS,
	},
	{ flag: '--coat-sheen', query: '&coatSheen' },
	{ flag: '--weighted', query: '&weighted', budgets: WEIGHTED_BUDGETS },
	{ flag: '--decals', query: '&decals', passes: 1 },
	{ flag: '--particles', query: '&particles', passes: 1 },
	{ flag: '--passes', query: '&passes', passes: 2 },
	{ flag: '--terrain', query: '&terrain' },
	{ flag: '--impostors', query: '&impostors' },
	{ flag: '--splats', query: '&splats', swiftShaderQuery: '&splats=12000', passes: 1 },
	{ flag: '--inertial', query: '&inertial' },
	{ flag: '--calls', query: '&calls', budgets: CALLS_BUDGETS },
	{ flag: '--time-of-day', query: '&timeOfDay', budgets: DAY_BUDGETS },
	{ flag: '--stats', query: '&stats', budgets: STATS_BUDGETS, anyScene: true },
	{ flag: '--stats-collapsed', query: '&stats=collapsed', anyScene: true },
];

/** The flags that each draw one background behind S1, of which a run takes one at most. */
const SKY_FLAGS = ['--sky', '--sky-environment', '--atmosphere', '--atmosphere-environment'];

/** The animated characters that `--inertial` adds to S1 when `--animated` names no count. */
const INERTIAL_CROWD = 64;

/**
 * What S4, S5 and S6 allocate on top of `BUDGETS`, on a real GPU, for what they draw more than S1:
 * - S4's and S5's WebGPU replay: the passes of the contact shadows, at `PASS_REPLAY_BYTES` each.
 *   S5's sun casts them too, at the preset that the Mac picks;
 * - S5's camera path, which the browser runs beside 500 knights' moves without inlining the
 *   camera's setters, so it boxes up to all seven numbers that it passes to them: 46 to 84 bytes
 *   per frame on the Mac;
 * - S5's WebGPU uploads of the crowd's poses, through the staging ring, each with a view that
 *   copies into the mapped range: 360 to 416 bytes per frame on the Mac, about six views more than
 *   S1's;
 * - S5's clock readings at each check of a frame that the GPU still holds, which its crowd keeps
 *   busy longer than S1's boxes;
 * - S6's camera path, whose route the browser does not inline, so it boxes the route's time:
 *   41 to 50 bytes per frame on the Mac, at the edge of the budget that boxes four numbers;
 * - S6's WebGPU replay: the encoders of its render passes, at `PASS_REPLAY_BYTES` each. S6 draws
 *   bloom's 15 passes, the depth prepass, ambient occlusion's 3 and a culling pass and a render pass
 *   for each of up to 4 shadow cascades.
 */
const SCENE_BUDGETS: Partial<Record<(typeof ALLOCATION_SCENES)[number], WorkerBudgets>> = {
	s4: {
		'render-worker': { 'replay webgpu/backend.ts': CONTACT_PASSES * PASS_REPLAY_BYTES },
	},
	s5: {
		'sketch-worker': { '(anonymous) null3d/sketch-common.ts': 48 },
		'render-worker': {
			'replay webgpu/backend.ts': CONTACT_PASSES * PASS_REPLAY_BYTES,
			'write webgpu/staging.ts': 8 * 64,
			'giveUpStalled gpu/completion.ts': 12,
		},
	},
	s6: {
		'sketch-worker': { '(anonymous) null3d/sketch-common.ts': 16 },
		'render-worker': { 'replay webgpu/backend.ts': (15 + 1 + 3 + 2 * 4) * PASS_REPLAY_BYTES },
	},
};

/** Gives each node of a profile its function's name and file from the build's source maps. */
function nameNodes(node: ProfileNode, names: BuildNames): void {
	node.callFrame = names.name(node.callFrame);
	for (const child of node.children) nameNodes(child, names);
}

/** How often the input driver acts, in milliseconds: about once per frame at 60 Hz. */
const INPUT_STEP_MS = 16;

/**
 * Moves the mouse in circles over the canvas until `running` turns false, and counts its steps in
 * `driven`. It presses a key every 10 steps and holds the mouse button down for a few steps in every
 * 30, so the page writes moves, drags, clicks and key presses into the input ring.
 */
async function driveInput(
	page: Page,
	running: () => boolean,
	driven: { steps: number },
): Promise<void> {
	const box = await page.locator('canvas').boundingBox();
	if (!box) throw new Error('the benchmark page has no canvas');
	for (let step = 0; running(); step++, driven.steps++) {
		const angle = step * 0.2;
		await page.mouse.move(
			box.x + box.width * (0.5 + 0.3 * Math.cos(angle)),
			box.y + box.height * (0.5 + 0.3 * Math.sin(angle)),
		);
		if (step % 10 === 0) await page.keyboard.press('KeyW');
		if (step % 30 === 0) await page.mouse.down();
		if (step % 30 === 5) await page.mouse.up();
		await sleep(INPUT_STEP_MS);
	}
}

/** Seconds without a new frame after which the check gives up on a page that stopped drawing. */
const STALL_SECONDS = 60;

/**
 * The longest that one call to the browser may take, such as starting or stopping a sample, or
 * reading the frame count. Each takes under a few seconds; a call that never returns would
 * otherwise hold CI's machine until the job's own time runs out.
 */
const STEP_MS = 60_000;

/**
 * Waits until `frames` counts `target` frames, and says how far the count has come once a minute.
 * Throws when the count stands still for `STALL_SECONDS`, as on a page whose engine failed.
 */
async function reachFrames(frames: () => Promise<number>, target: number): Promise<void> {
	let last = -1;
	let still = 0;
	for (let second = 1; ; second++) {
		const now = await frames();
		if (now >= target) return;
		still = now === last ? still + 1 : 0;
		if (still >= STALL_SECONDS)
			throw new Error(`the page drew no frame for ${STALL_SECONDS} s, at ${now} of ${target}`);
		if (second % 60 === 0) console.log(`Warming up: ${now} of ${target} frames`);
		last = now;
		await sleep(1000);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const option = (name: string, fallback: number) => {
		const at = args.indexOf(name);
		return at >= 0 ? Number(args[at + 1]) : fallback;
	};
	const named = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : 's1';
	const scene = ALLOCATION_SCENES.find((name) => name === named);
	if (!scene) throw new Error(`--scene takes ${ALLOCATION_SCENES.join(', ')}, not ${named}`);
	// With CI set, as on CI's machines, Playwright's Chromium draws on SwiftShader, the software GPU.
	const swiftShader = defaultEnvironment() === 'chromium-swiftshader';
	if (swiftShader && scene !== 's1')
		throw new Error(
			'on SwiftShader the check counts the frames that S1 steps, so it samples S1 only',
		);
	const n = option('--n', swiftShader ? SWIFTSHADER_COUNT : SCENE_COUNTS[scene]);
	const seconds = option('--seconds', 5);
	const gpu = args.includes('--gpu') ? args[args.indexOf('--gpu') + 1] : 'webgpu';
	if (gpu !== 'webgpu' && gpu !== 'webgl2')
		throw new Error(`--gpu takes webgpu or webgl2, not ${gpu}`);
	// The browser optimizes code that runs once per frame only after many frames; until then,
	// numbers that such code computes are allocated.
	const warmup = option('--warmup', WARMUP_SECONDS);
	const warmupFrames = option(
		'--warmup-frames',
		swiftShader ? SWIFTSHADER_WARMUP_FRAMES : WARMUP_FRAMES,
	);
	const has = (flag: string) => args.includes(flag);
	const chosen = PAGE_SWITCHES.filter(({ flag }) => has(flag));
	for (const { flag, anyScene } of chosen)
		if (!anyScene && scene !== 's1') throw new Error(`${flag} changes S1 only, not ${scene}`);
	const skies = SKY_FLAGS.filter(has);
	if (skies.length > 1) throw new Error(`${skies.join(' and ')} each draw a background; give one`);
	const animatedCount = option('--animated', has('--inertial') ? INERTIAL_CROWD : 0);
	if (animatedCount > 0 && scene !== 's1')
		throw new Error('--animated adds animated characters to S1 only');
	const morphedCount = option('--morphed', 0);
	if (morphedCount > 0 && scene !== 's1')
		throw new Error('--morphed adds morphed objects to S1 only');
	const labelCount = option('--labels', 0);
	if (labelCount > 0 && scene !== 's1') throw new Error('--labels adds labels to S1 only');
	const counts = [
		animatedCount > 0 ? `&animated=${animatedCount}` : '',
		morphedCount > 0 ? `&morphed=${morphedCount}` : '',
		labelCount > 0 ? `&labels=${labelCount}` : '',
	].join('');
	const dev = args.includes(DEV_OPTION);
	const noInline = args.includes('--no-inline');
	const server = await serveBenchPages({ dev });
	// The browser takes one set of script engine flags, so these share one switch.
	const jsFlags = [
		...(noInline ? ['--no-turbo-inlining --no-maglev-inlining'] : []),
		...(swiftShader ? [SWIFTSHADER_JS_FLAGS] : []),
	];
	const browserArgs = [
		`--remote-debugging-port=${DEBUG_PORT}`,
		...(jsFlags.length > 0 ? [`--js-flags=${jsFlags.join(' ')}`] : []),
	];
	const browser = swiftShader
		? await launchChromium({ headless: true, args: [...SWIFTSHADER_ARGS, ...browserArgs] })
		: await launchInWindow({ channel: 'chrome', args: browserArgs });
	try {
		const page = await newParkedPage(browser, { viewport: { width: 1400, height: 800 } });
		const kind = gpu === 'webgl2' ? 'null3d-webgl2' : 'null3d-webgpu';
		// `?keep` runs the scene as a timed run draws it until the page closes, with no measurement of
		// the page's own, so no timer of the page's runs and the engine never stops before the samples
		// end. A demo would add the playable controls and the stats overlay of S5 and S6.
		const query = `keep&n=${n}${counts}${chosen.map((choice) => (swiftShader ? (choice.swiftShaderQuery ?? choice.query) : choice.query)).join('')}${swiftShader ? `&frames&maxPixelRatio=${SWIFTSHADER_PIXEL_RATIO}` : ''}`;
		const url = `${server.url}${pagePath(scene, kind, query)}`;
		await page.goto(url);
		// On a real GPU the engine draws a frame at each of the display's frames, so the check counts
		// the display's frames on the page. On SwiftShader the display's frames outrun the frames
		// that the engine computes and draws, so it counts the frames that S1 steps, which the page
		// publishes once the sketch has started.
		if (!swiftShader)
			await page.evaluate(() => {
				const scope = globalThis as unknown as {
					requestAnimationFrame(callback: () => void): number;
					__frameCounter?: { frames: number };
				};
				const counter = { frames: 0 };
				const tick = () => {
					counter.frames++;
					scope.requestAnimationFrame(tick);
				};
				scope.requestAnimationFrame(tick);
				scope.__frameCounter = counter;
			});
		const framesSoFar = () =>
			within(
				page.evaluate(() => {
					const scope = globalThis as {
						__frameCounter?: { frames: number };
						__null3dFrames?: Int32Array;
					};
					return scope.__null3dFrames
						? Atomics.load(scope.__null3dFrames, 0)
						: (scope.__frameCounter?.frames ?? 0);
				}),
				STEP_MS,
				'reading the frame count',
			);
		/**
		 * The render worker's count of the browser's calls into it so far, or null where the engine
		 * gives none. The check judges the browser's own places per call, so a runner's speed does
		 * not change their bytes.
		 */
		const callsSoFar = async (): Promise<number | null> => {
			const session = sessions.get('render-worker');
			if (!session) return null;
			return evaluate<number | null>(
				devtools,
				session,
				'globalThis.__null3dBrowserCalls?.() ?? null',
			).catch(() => null);
		};
		/**
		 * The sketch worker's count of the tasks that it has run so far, or null where the engine
		 * gives none. The check judges a task's own places per call, so a frame that runs many tasks,
		 * as on SwiftShader, does not weigh them many times.
		 */
		const tasksSoFar = async (): Promise<number | null> => {
			const session = sessions.get('sketch-worker');
			if (!session) return null;
			return evaluate<number | null>(
				devtools,
				session,
				'globalThis.__null3dTaskCalls?.() ?? null',
			).catch(() => null);
		};
		const devtools = await DevTools.connect(DEBUG_PORT);
		const [target] = await pagesAt(devtools, url);
		if (!target) throw new Error(`no page target for ${url}`);
		const { workers: sessions } = await attachWorkers(devtools, target.targetId, WORKERS);
		// Input runs from now to the end of the sample, so the code that reads it warms up too.
		let driving = true;
		const driven = { steps: 0 };
		const input = driveInput(page, () => driving, driven);
		// A failure is reported where the input is awaited, after the sample.
		input.catch(() => {});
		// Let the sketch build its whole scene and warm up before sampling.
		const warmupStart = performance.now();
		await page.waitForFunction(
			() => (globalThis as { __null3dWhole?: boolean }).__null3dWhole === true,
			undefined,
			{ timeout: WHOLE_TIMEOUT_MS, polling: 1000 },
		);
		await sleep(warmup * 1000);
		await reachFrames(framesSoFar, warmupFrames);
		console.log(
			`Warmed up: ${await framesSoFar()} frames in ${((performance.now() - warmupStart) / 1000).toFixed(0)} s`,
		);
		const sampler = new HeapSampler(devtools, sessions);
		await sampler.enable();
		const stepsBefore = driven.steps;
		const samples = new Map<string, Sample[]>();
		const bytes = new Map<string, number>();
		let frames = 0;
		for (let k = 0; k < SAMPLES; k++) {
			await sampler.start(SAMPLING_INTERVAL);
			const startFrames = await framesSoFar();
			const startCalls = await callsSoFar();
			const startTasks = await tasksSoFar();
			await sleep(seconds * 1000);
			const profiles = await sampler.stop();
			for (const profile of profiles.values())
				if (server.names) nameNodes(profile.head, server.names);
			const sampleFrames = (await framesSoFar()) - startFrames;
			const endCalls = await callsSoFar();
			const endTasks = await tasksSoFar();
			frames += sampleFrames;
			const calls = startCalls === null || endCalls === null ? undefined : endCalls - startCalls;
			const tasks = startTasks === null || endTasks === null ? undefined : endTasks - startTasks;
			for (const [name, profile] of profiles) {
				// Each worker counts the calls that its own places are judged by.
				const counted = name === 'sketch-worker' ? tasks : calls;
				samples.set(name, [
					...(samples.get(name) ?? []),
					{
						places: profilePlaces(profile),
						frames: sampleFrames,
						...(counted !== undefined && { calls: counted }),
					},
				]);
				bytes.set(name, (bytes.get(name) ?? 0) + totalSize(profile.head));
			}
		}
		driving = false;
		const inputSteps = driven.steps - stepsBefore;
		// On SwiftShader a mouse or key press now and then never returns. The input then stops, and
		// the frames go on, so the samples still judge the frame code; the count shows how much input
		// they held.
		await within(input, STEP_MS, 'moving the mouse and pressing keys').catch((e: Error) =>
			console.log(`warning: ${e.message}`),
		);
		devtools.close();
		console.log(
			`${scene.toUpperCase()} on ${gpu} with ${n} instances${animatedCount > 0 ? ` and ${animatedCount} animated characters` : ''}${morphedCount > 0 ? ` and ${morphedCount} morphed objects` : ''}${labelCount > 0 ? ` and ${labelCount} labels` : ''}${chosen.map(({ flag }) => ` ${flag}`).join('')}, ${pagesText(dev)}${noInline ? ', inlining off' : ''}, sampled ${SAMPLES} times for ${seconds} s after ${warmup} s: ${frames} frames, ${inputSteps} input steps`,
		);
		console.log(
			'Bytes per frame, or per call where the worker counts calls, in the sample where each place allocated least, its budget, and the most:',
		);
		// The passes that the switches add to each WebGPU frame, with the contact shadows' passes when
		// the rows cast the sun's shadows and ambient occlusion does not run the same steps already.
		const replayPasses =
			chosen.reduce((sum, choice) => sum + (choice.passes ?? 0), 0) +
			(has('--batch-shadows') && !has('--ao') ? CONTACT_PASSES : 0);
		// Two switches that share a table of budgets, such as `--setters` and `--hemisphere`, count it once.
		const switchBudgets = [...new Set(chosen.flatMap(({ budgets }) => (budgets ? [budgets] : [])))];
		const over: string[] = [];
		const unsampled: string[] = [];
		for (const [worker, workerSamples] of samples) {
			const sceneBudgets = SCENE_BUDGETS[scene]?.[worker as (typeof WORKERS)[number]] ?? {};
			console.log(`${worker}: ${((bytes.get(worker) ?? 0) / frames).toFixed(1)} bytes per frame`);
			// The fewest calls the browser made for a frame in any sample: the strictest per-call
			// figure, on the same sample that each place's least per-frame figure comes from.
			const counted = workerSamples
				.filter((sample) => sample.calls !== undefined)
				.map((sample) => (sample.calls as number) / Math.max(1, sample.frames));
			const callsPerFrame = counted.length > 0 ? Math.max(1, Math.min(...counted)) : null;
			// Each worker allocates in every frame, the sketch worker's frame wait and the replay's
			// browser objects at least. A worker whose samples hold nothing was not sampled at all.
			if (!bytes.get(worker)) unsampled.push(worker);
			for (const [name, { perFrame, most, callers }] of steadyPlaces(
				countIn(workerSamples, COUNTED_IN_CALLER),
			)) {
				const extra =
					(name === REPLAY ? replayPasses * PASS_REPLAY_BYTES : 0) +
					switchBudgets.reduce(
						(sum, table) => sum + (table[worker as (typeof WORKERS)[number]]?.[name] ?? 0),
						0,
					) +
					(sceneBudgets[name] ?? 0);
				// The render worker's browser calls and the sketch worker's tasks judge their own places.
				const callBudget = callBudgetFor(worker, name);
				if (callBudget !== undefined && worker === 'sketch-worker') {
					const measured = perCall(workerSamples, name);
					const figure = measured?.perCall ?? 0;
					if (figure > callBudget) over.push(`${worker}: ${name}`);
					console.log(
						`  ${figure.toFixed(1).padStart(6)} of ${String(callBudget).padStart(3)} per call, ${String(measured?.calls ?? 0).padStart(4)} calls  ${name}${callers ? ` < ${callers}` : ''}`,
					);
					continue;
				}
				if (callBudget !== undefined && callsPerFrame !== null) {
					const perCall = perFrame / callsPerFrame;
					if (perCall > callBudget) over.push(`${worker}: ${name}`);
					console.log(
						`  ${perCall.toFixed(1).padStart(6)} of ${String(callBudget).padStart(3)} per call, ${callsPerFrame.toFixed(1)} a frame (${perFrame.toFixed(1).padStart(6)} a frame)  ${name}${callers ? ` < ${callers}` : ''}`,
					);
					continue;
				}
				const budget = placeBudget(worker, name, { swiftShader, extra });
				if (perFrame > budget) over.push(`${worker}: ${name}`);
				console.log(
					`  ${perFrame.toFixed(1).padStart(6)} of ${String(budget).padStart(3)} (${most.toFixed(1).padStart(6)})  ${name}${callers ? ` < ${callers}` : ''}`,
				);
			}
		}
		if (unsampled.length > 0)
			console.log(`FAIL: the profiler sampled nothing in ${unsampled.join(' and ')}`);
		if (over.length > 0) console.log(`FAIL: over budget: ${over.join('; ')}`);
		const passed = over.length === 0 && unsampled.length === 0;
		if (passed) console.log('pass');
		process.exitCode = passed ? 0 : 1;
	} finally {
		// A browser that does not close must not hide the error that ended the check.
		await within(browser.close(), STEP_MS, 'closing the browser').catch((e: Error) =>
			console.error(`error: ${e.message}`),
		);
		server.stop();
	}
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}

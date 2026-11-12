// The wind add-on's field: one grid of air that follows the camera, filled by a compute pass on
// WebGPU and by its fragment form on WebGL2, and sampled by plants, flags and smoke with one
// texture read. A page makes the wind once, sets its base wind, sends gusts and pushes the air.
import {
	type Camera,
	defineFeature,
	type EngineCapabilities,
	FeatureHost,
	type FeatureValue,
	type SketchContext,
	type Texture,
} from '@null3d/engine';
import {
	analyticVelocity,
	createPushRing,
	createReading,
	defaultFieldState,
	type FieldState,
	type Push,
	RING_SLOTS,
	type WindReading,
	writeReading,
} from './analytic';
import { WindProbes } from './field';
import { ASK_NUMBERS, ASK_PUSH_RADIUS, ASK_TIME, SLOT_FLOATS } from './field-layout';
import fallbackShader from './grid.fallback.wgsl';
import gridShader from './grid.wgsl';
import { NAMESPACE } from './namespace';

/**
 * What a page gives the wind, at the start or later.
 *
 * @category api/wind
 */
export interface WindOptions {
	/** The camera whose ground place the box follows. The field is centered on it in every frame. */
	camera: Camera;
	/**
	 * The box's width across the ground, in meters. Zero keeps no grid, so every reader works the
	 * air out from the steady field.
	 */
	box?: number;
	/**
	 * The grid's texels across each way. A page that gives it keeps it; otherwise the preset's
	 * `windGrid` row sets it, and 0 keeps no grid.
	 */
	grid?: number;
	/** The air's settings: its speed, heading, gust, push and swirl. */
	air?: Partial<FieldState>;
}

/**
 * The field that a reader samples: a texture of the air, and the box it covers.
 *
 * @category api/wind
 */
export interface WindField {
	/**
	 * The texture. A reader declares it as `var wind: texture_2d<f32>;` and samples it through the
	 * sampling function, which gives the air back: the wind across the ground, the wind's rise,
	 * which is zero while the field is flat, and how fast the air moves. The grid keeps its state
	 * in the texture's own numbers, so a reader does not decode them itself. A preset change that
	 * changes the grid makes a new texture, so read this again after one.
	 */
	readonly texture: Texture;
	/** The box's near corner across the ground, in meters: x and z. */
	readonly origin: [number, number];
	/**
	 * The box's width across the ground, in meters, or zero on a device that keeps no grid. A
	 * reader that is given zero works out the air from `air` everywhere. That is the steady field
	 * which the grid's edge and the far field hold where a device keeps one.
	 */
	readonly size: number;
	/**
	 * The steady settings that a reader works out beyond the box. Give them to a material with the
	 * sampling function's three vectors, and give them again when `setBase` or the air changes.
	 */
	readonly air: WindReading;
}

/**
 * The wind that a page reads and drives.
 *
 * @category api/wind
 */
export interface Wind {
	/** The field that a plant, a flag or a smoke card samples. */
	readonly field: WindField;
	/** Sets the steady wind: its speed in meters a second and its heading in radians. */
	setBase(speed: number, heading: number): void;
	/**
	 * Sends a gust of `strength` from a ground place, whose wave then travels along the heading, so
	 * the air turns as it passes over the scene.
	 */
	gust(at: readonly [number, number], strength?: number): void;
	/** Pushes the air about a ground place, as a body moving through it does. */
	push(at: readonly [number, number], strength?: number): void;
	/**
	 * The air at a world place, in meters a second, written into `out`, from the analytic field that
	 * the solver pulls the air toward and the pushes and the gust it injects. The solved air itself
	 * is on the GPU, so a page's own motion follows the forces rather than the wakes.
	 *
	 * This call works in TypeScript, which suits a test and a read outside a frame. A page that moves
	 * its own objects with the air in every frame asks `read` instead, whose work runs in a job
	 * worker.
	 */
	sample(x: number, y: number, z: number, out: [number, number, number]): [number, number, number];
	/**
	 * The feature's settings, as the preset and the frame-budget governor resolve them now: the step
	 * interval, the pressure steps, the spring trees and the grid. The object stays the same and its
	 * values change in place, so read it in a frame without allocating.
	 */
	readonly settings: Readonly<Record<string, FeatureValue>>;
	/**
	 * The field's budget, as the preset and the frame-budget governor leave it. The object stays the
	 * same, so read it in a frame without allocating.
	 */
	readonly budget: {
		/** The time in ms that the field may take in a frame at this preset. */
		readonly ms: number;
		/** The share of full quality that the governor gives the field, from its floor to 1. */
		readonly scale: number;
		/** The time in ms that the field may take in a frame now. */
		readonly allowedMs: number;
	};
	/**
	 * Asks a job worker for the air at each place in `points`, three numbers a place across the
	 * ground, and puts the velocities in `out`, three numbers a place. The answer lands before the
	 * next frame's update, so a page reads it in its next `onUpdate`. One call takes about five
	 * thousand places.
	 */
	read(points: Float32Array, out: Float32Array): void;
	/**
	 * Places the box about the camera, runs the steps that the sketch time owes and sends the
	 * values to the GPU. Call once in each frame.
	 */
	update(): void;
	/** Removes the pass and its texture. */
	destroy(): void;
}

/** The presets in the order that a setting's row gives them. */
const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
/** The time between field steps at each preset, in ms. Low keeps the analytic field. */
const STEP_MS = [0, 33, 33, 16] as const;
/** The same on WebGL2, where a run costs far more: ten steps a second at Medium and above. */
const STEP_MS_WEBGL2 = [0, 100, 100, 100] as const;
/** The pressure iterations of one cycle at each preset. */
const PRESSURE_ROW = [0, 16, 24, 40] as const;
/** The trees that keep branch springs at each preset. The vegetation add-on reads it. */
const SPRING_ROW = [0, 8, 32, 64] as const;
/**
 * The grid's texels across each way at each preset. Low keeps no grid and reads the steady field,
 * so a phone pays nothing for the field. High and Ultra name the flat sizes that stand in for the
 * layered and volume grids until the solver builds them.
 */
const GRID_ROW = [0, 64, 128, 256] as const;
/** The field's own budget per frame at each preset, in ms, from M3-V14's figures. */
const BUDGET_MS = [0.5, 1.2, 4.9, 6.25] as const;
/** The least share of full quality that the governor gives the field, so it always keeps moving. */
const BUDGET_MIN = 0.25;
/**
 * The divisor that keeps the ground's share below one while the pressure count fills the whole
 * part of the same value. The grid multiplies the fraction by it to give the ground back, so the
 * two must agree.
 */
export const GROUND_PACK = 100;

/** The Jacobi iterations that one cycle runs by default, before a preset applies. */
export const PRESSURE_STEPS = 20;
/** The runs that one cycle takes: the forces and the advection, the pressure, the projection. */
export const CYCLE_STEPS = PRESSURE_STEPS + 2;
/** The fixed time that one cycle steps the air by, in seconds, before a preset applies. */
export const STEP_SECONDS = 1 / 60;
/**
 * The most cycles that one frame runs, which is ten seconds of air. A longer stall in a page skips
 * the air that it missed rather than spends one frame solving it.
 */
const MAX_CYCLES = 600;

/** How strong a gust is when the page names no strength. */
const GUST = 7;
/** How strong a push is when the page names no strength. */
const PUSH = 2.5;

/**
 * True when the device draws into a 16-bit float texture, which the grid needs. Every WebGPU path
 * does. A WebGL2 device keeps the grid only when the engine's own probe drew into `rgba16f` and read
 * the pixels back, which `hdr` reports. A device that advertises the extensions but fails that probe
 * keeps no grid, and its readers work the air out from the steady field instead, so a plant still
 * moves there.
 */
export function holdsField(capabilities: Pick<EngineCapabilities, 'tier' | 'hdr'>): boolean {
	return capabilities.tier !== 'webgl2' || capabilities.hdr;
}

/**
 * Makes the air in a scene: the field, the pass that fills it, and the calls that a page uses to
 * set the wind, send a gust and push the air.
 *
 * @category api/wind
 */
export function createWind(ctx: SketchContext, options: WindOptions): Wind {
	const { camera } = options;
	const box = options.box ?? 128;
	const air: FieldState = { ...defaultFieldState(), ...options.air };
	const pushes = createPushRing();

	// The preset gives the field's step interval, its pressure count and its grid. A page's own
	// grid wins over the preset's.
	const at = PRESETS.indexOf(ctx.quality.preset as (typeof PRESETS)[number]);
	const preset = at < 0 ? 1 : at;
	let stepSeconds =
		((ctx.engine.capabilities.tier === 'webgl2' ? STEP_MS_WEBGL2 : STEP_MS)[preset] ?? 33) / 1000;
	let pressureSteps: number = PRESSURE_ROW[preset] ?? 16;
	// A page that names a grid keeps it: it is the page's own, not the preset's.
	const fixedGrid = options.grid !== undefined;
	let grid = options.grid ?? GRID_ROW[preset] ?? 64;
	let gridDirty = false;

	// The solver runs one fixed step per cycle, and the pass takes eight value vectors: the step and
	// the settings, the ring of pushes and gusts, and the box. A frame sets the runs that the sketch
	// time owes, so the air keeps the same pace whatever the frame rate.
	//
	// The air starts when a page makes the wind. A held page's first drawn frame runs the air from
	// then to the held time, so a held picture carries the air that the hold built. Each frame reads
	// the sketch time from the engine's field, because a helper that answered it would box its
	// fraction on a call that the browser does not inline.
	let solved = ctx.time.now;
	// The preset names no field at Low. A page that keeps its own grid there still gets a field, at
	// the add-on's own step and pressure count, because air that never steps never moves.
	const presetField = (): boolean => stepSeconds > 0;
	const solverPressureSteps = (): number => (presetField() ? pressureSteps : PRESSURE_STEPS);
	const cycleSteps = (): number => solverPressureSteps() + 2;
	const owedSteps = (): number => {
		// A held page steps its sketch many times and draws only the frames at the end, so the pass
		// of a step before them never runs. The time stays owed until a frame that draws, which runs
		// the air for the whole hold. A second drawn frame runs only the time since the first.
		if (!ctx.time.drawn) return 0;
		const step = presetField() ? stepSeconds : STEP_SECONDS;
		// The sketch time is a sum of frame times, so a frame that owes exactly one step can read a
		// hair under it.
		const owed = Math.floor((ctx.time.now - solved) / step + 1e-6);
		if (owed <= 0) return 0;
		const cycles = Math.min(owed, MAX_CYCLES);
		// A stall that owes more than one frame runs skips the air that it missed. Crediting only
		// the cycles that ran would leave a debt, and every later frame would pay it.
		solved = owed > MAX_CYCLES ? ctx.time.now : solved + cycles * step;
		return cycles * cycleSteps();
	};

	const values = new Array<number>(32).fill(0);
	// The ring of pushes and the gust, in the order that the field's job worker reads it. A push
	// writes its own slot where the page sends it, so a frame copies nothing across the ring.
	const ringValues = new Float32Array(RING_SLOTS * SLOT_FLOATS);
	// The push's width and the sketch time reach the ask in this array, whose numbers it reads for
	// itself: a fraction passed as an argument becomes a number object where the browser does not
	// inline the call.
	const askNumbers = new Float64Array(ASK_NUMBERS);
	const place: number[] = [0, 0, 0];
	const write = (): void => {
		// The first vector holds the solver's step, then the air's settings.
		values[0] = presetField() ? stepSeconds : STEP_SECONDS;
		// The ring's slots keep the numbers that the page's pushes gave them.
		values[1] = air.speed;
		values[2] = air.heading;
		// A pass takes eight value vectors and every field of them already has a meaning, so the
		// cycle's pressure count rides in the ground setting's whole part and the ground's share in
		// its fraction. The grid splits the two before it uses them.
		values[3] = solverPressureSteps() + air.ground / GROUND_PACK;
		values[4] = air.gustStrength;
		values[5] = air.gustRadius;
		values[6] = air.gustWave;
		values[7] = air.gustSpeed;
		values[8] = air.swirl;
		values[9] = air.swirlScale;
		values[10] = air.swirlDrift;
		values[11] = air.seed;
		camera.getPosition(place);
		values[28] = (place[0] as number) - box / 2;
		values[29] = (place[2] as number) - box / 2;
		values[30] = box;
		values[31] = air.pushRadius;
	};

	// A device without float targets keeps no grid, so it costs no pass. A reader still samples a
	// texture, which holds the field's neutral black, but its box has no width, so every sample is
	// the steady field that `shaders/field.wgsl` works out. A box of no width asks for the same.
	const holds = box > 0 && holdsField(ctx.engine.capabilities);
	const neutral = ctx.textures.fromData({
		width: 1,
		height: 1,
		depth: 1,
		data: new Uint8Array(4),
	});
	type Pass = ReturnType<typeof ctx.render.addPass>;
	/** The texture of the grid that the readers sample now. */
	let gridTexture: Texture | undefined;

	// Makes the grid's pass at the setting's size, or keeps no grid. The pass keeps two states, so a
	// reader samples the one that the last run wrote.
	const makePass = (): Pass | undefined => {
		gridTexture = undefined;
		if (!holds || grid <= 0) return undefined;
		const created = ctx.render.addPass({
			kind: 'compute',
			description: defineFeature({
				name: 'wind',
				frame: 'background',
				kind: 'compute',
				outputs: { wind: { default: 'black' } },
			}),
			wgsl: gridShader,
			fallback: { wgsl: fallbackShader },
			format: 'rgba16float',
			size: [grid, grid],
			history: true,
			steps: cycleSteps(),
			values,
			name: 'wind-field',
		});
		gridTexture = ctx.textures.fromPass(created);
		return created;
	};
	let pass = makePass();

	const field: WindField = {
		get texture(): Texture {
			return gridTexture ?? neutral;
		},
		origin: [0, 0],
		get size(): number {
			return holds && grid > 0 ? box : 0;
		},
		air: createReading(air),
	};

	// The feature's settings reach the solver here. A change of grid needs a pass of another size,
	// which the frame loop makes so a preview of the change never shows a half-made pass.
	const applySettings = (own: Readonly<Record<string, FeatureValue>>): void => {
		stepSeconds = (own.windStepMs as number) / 1000;
		pressureSteps = own.windPressureSteps as number;
		const next = fixedGrid ? grid : (own.windGrid as number);
		if (next !== grid) {
			grid = next;
			gridDirty = true;
		}
	};
	const describe = (): ReturnType<typeof defineFeature> =>
		defineFeature({
			name: 'wind',
			gpu: pass ? { passes: [pass] } : undefined,
			settings: {
				windStepMs: {
					presets: STEP_MS,
					webgl2: STEP_MS_WEBGL2,
					values: { min: 0, max: 133, whole: true },
					governor: 'double',
				},
				windPressureSteps: {
					presets: PRESSURE_ROW,
					values: { min: 0, max: 80, whole: true },
					governor: 'scale',
				},
				windSpringTrees: {
					presets: SPRING_ROW,
					values: { min: 0, max: 128, whole: true },
					governor: 'scale',
				},
				windGrid: {
					// A new size needs a new pass, so a preset change alone moves this row.
					presets: GRID_ROW,
					values: GRID_ROW,
					governor: 'none',
				},
			},
			budget: { presets: BUDGET_MS, min: BUDGET_MIN },
			memory: () => (pass ? grid * grid * 2 * 8 : 0),
			quality: (_preset, _settings, own) => applySettings(own.settings),
		});
	const host = new FeatureHost({
		quality: ctx.quality,
		tier: ctx.engine.capabilities.tier,
		page: ctx.page,
		namespace: NAMESPACE,
	});
	let feature = host.add(describe());

	// A preset that changes the grid makes the pass again at the new size. The state starts empty,
	// so the new grid fills from the analytic field over its first cycles.
	const rebuild = (): void => {
		gridDirty = false;
		const old = pass;
		if (old) ctx.render.removePass(old);
		pass = makePass();
		solved = ctx.time.now;
		host.remove('wind');
		feature = host.add(describe());
		feature.refresh();
	};

	// The box follows the camera and the pushes fade, so the values go up in every frame.
	const apply = (): void => {
		if (gridDirty) rebuild();
		write();
		if (pass) {
			ctx.render.setPassSteps(pass, owedSteps());
			ctx.render.setPassUniforms(pass, values);
		}
		field.origin[0] = values[28] as number;
		field.origin[1] = values[29] as number;
	};
	apply();

	const sample = (
		x: number,
		y: number,
		z: number,
		out: [number, number, number],
	): [number, number, number] => analyticVelocity(air, pushes.slots, x, y, z, ctx.time.now, out);

	const probes = new WindProbes();

	// A push takes the next of the three push slots, and a gust takes the slot after them, so a
	// page's pushes never push its gust out. A gust travels from where it was sent, and a push
	// stays there. The frame writes the slot's numbers here rather than passing them into a call,
	// where the browser would box each fraction; they go into the pass's values and into the ring
	// that a job worker reads, so a push copies no slot.
	const turn = (at: readonly [number, number], strength: number, gust: boolean): void => {
		const born = ctx.time.now;
		const index = pushes.take(gust);
		const x = at[0];
		const z = at[1];
		const push = pushes.slots[index] as Push;
		push.x = x;
		push.z = z;
		push.strength = strength;
		push.born = born;
		const slot = index * SLOT_FLOATS;
		ringValues[slot] = x;
		ringValues[slot + 1] = z;
		ringValues[slot + 2] = strength;
		ringValues[slot + 3] = born;
		// The ring follows the pass's first twelve numbers, which are the step and the air's
		// settings.
		const into = 12 + slot;
		values[into] = x;
		values[into + 1] = z;
		values[into + 2] = strength;
		values[into + 3] = born;
		// The steady field carries the sent gust too, so a reader that works the air out with no grid
		// sees it travel from where it was sent.
		if (gust) {
			const sent = field.air.sent;
			sent[0] = x;
			sent[1] = z;
			sent[2] = strength;
			sent[3] = born;
		}
	};

	// The handle keeps its budget current, and its figures carry the full time that the preset
	// gave, so the page reads both without asking the engine again.
	const budget = {
		get ms() {
			return feature.stats.budgetMs ?? 0;
		},
		get scale() {
			return feature.budgetScale;
		},
		get allowedMs() {
			return feature.stats.allowedMs ?? 0;
		},
	};

	return {
		field,
		get settings() {
			return feature.settings;
		},
		budget,
		setBase(speed, heading) {
			air.speed = speed;
			air.heading = heading;
			writeReading(air, field.air);
		},
		gust(at, strength = GUST) {
			turn(at, strength, true);
		},
		push(at, strength = PUSH) {
			turn(at, strength, false);
		},
		sample,
		read(points, out) {
			askNumbers[ASK_PUSH_RADIUS] = air.pushRadius;
			askNumbers[ASK_TIME] = ctx.time.now;
			probes.ask(points, out, field.air, ringValues, askNumbers);
		},
		update: apply,
		destroy() {
			probes.stop();
			host.destroy();
			if (pass) ctx.render.removePass(pass);
			neutral.destroy();
		},
	};
}

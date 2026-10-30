// The wind add-on's field: one grid of air that follows the camera, filled by a compute pass on
// WebGPU and by its fragment form on WebGL2, and sampled by plants, flags and smoke with one
// texture read. A page makes the wind once, sets its base wind, sends gusts and pushes the air.
import {
	type Camera,
	defineFeature,
	type EngineCapabilities,
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
import fallbackShader from './grid.fallback.wgsl';
import gridShader from './grid.wgsl';

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
	/** The grid's texels across each way. */
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
	 * in the texture's own numbers, so a reader does not decode them itself.
	 */
	readonly texture: Texture;
	/** The box's near corner across the ground, in meters: x and z. */
	readonly origin: [number, number];
	/**
	 * The box's width across the ground, in meters, or zero on a device that keeps no grid. A
	 * reader that is given zero works out the air from `air` everywhere, which is the same field
	 * the texture holds where a device can keep one.
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
	 */
	sample(x: number, y: number, z: number, out: [number, number, number]): [number, number, number];
	/**
	 * Places the box about the camera, runs the steps that the sketch time owes and sends the
	 * values to the GPU. Call once in each frame.
	 */
	update(): void;
	/** Removes the pass and its texture. */
	destroy(): void;
}

/** The Jacobi iterations that one cycle of the solver runs, as its shaders hold them. */
export const PRESSURE_STEPS = 20;
/** The runs that one cycle takes: the forces and the advection, the pressure, the projection. */
export const CYCLE_STEPS = PRESSURE_STEPS + 2;
/** The fixed time that one cycle steps the air by, in seconds. */
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
 * does. A WebGL2 device without either extension keeps no grid, and its readers work the air out
 * from the steady field instead, so a plant still moves there.
 */
export function holdsField(capabilities: Pick<EngineCapabilities, 'tier' | 'features'>): boolean {
	const { tier, features } = capabilities;
	return (
		tier !== 'webgl2' ||
		features.includes('EXT_color_buffer_float') ||
		features.includes('EXT_color_buffer_half_float')
	);
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
	const grid = options.grid ?? 64;
	const air: FieldState = { ...defaultFieldState(), ...options.air };
	const pushes = createPushRing();
	const now = (): number => ctx.time.now;

	// The solver runs one fixed step per cycle, and the pass takes eight value vectors: the step and
	// the settings, the ring of pushes and gusts, and the box. A frame sets the runs that the sketch
	// time owes, so the air keeps the same pace whatever the frame rate.
	//
	// The air starts when a page makes the wind. A held page steps its updates up to the held time
	// and the pass runs with each step, so a held picture carries the air that the hold built.
	let solved = now();
	const owedSteps = (): number => {
		// The sketch time is a sum of frame times, so a frame that owes exactly one step can read a
		// hair under it.
		const owed = Math.floor((now() - solved) / STEP_SECONDS + 1e-6);
		if (owed <= 0) return 0;
		const cycles = Math.min(owed, MAX_CYCLES);
		// A stall that owes more than one frame runs skips the air that it missed. Crediting only
		// the cycles that ran would leave a debt, and every later frame would pay it.
		solved = owed > MAX_CYCLES ? now() : solved + cycles * STEP_SECONDS;
		return cycles * CYCLE_STEPS;
	};

	const values = new Array<number>(32).fill(0);
	const place: number[] = [0, 0, 0];
	const write = (): void => {
		// The first vector holds the solver's step, then the air's settings.
		values[0] = STEP_SECONDS;
		values[1] = air.speed;
		values[2] = air.heading;
		values[3] = air.ground;
		values[4] = air.gustStrength;
		values[5] = air.gustRadius;
		values[6] = air.gustWave;
		values[7] = air.gustSpeed;
		values[8] = air.swirl;
		values[9] = air.swirlScale;
		values[10] = air.swirlDrift;
		values[11] = air.seed;
		// The ring is made once, so every slot is there to read.
		for (let i = 0; i < RING_SLOTS; i++) {
			const slot = pushes.slots[i] as Push;
			const at = 12 + i * 4;
			values[at] = slot.x;
			values[at + 1] = slot.z;
			values[at + 2] = slot.strength;
			values[at + 3] = slot.born;
		}
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
	const pass = holds
		? ctx.render.addPass({
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
				steps: CYCLE_STEPS,
				values,
				name: 'wind-field',
			})
		: undefined;
	const field: WindField = {
		texture: pass
			? ctx.textures.fromPass(pass)
			: ctx.textures.fromData({
					width: 1,
					height: 1,
					depth: 1,
					data: new Uint8Array(4),
				}),
		origin: [0, 0],
		size: holds ? box : 0,
		air: createReading(air),
	};
	// The box follows the camera and the pushes fade, so the values go up in every frame.
	const apply = (): void => {
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
	): [number, number, number] => analyticVelocity(air, pushes.slots, x, y, z, now(), out);

	// A push takes the next of the three push slots, and a gust takes the slot after them, so a
	// page's pushes never push its gust out. A gust travels from where it was sent, and a push
	// stays there. The ring writes its own slots, so neither call allocates anything.
	const turn = (at: readonly [number, number], strength: number, gust: boolean): void => {
		pushes.add(at[0], at[1], strength, now(), gust);
	};

	return {
		field,
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
		update: apply,
		destroy() {
			if (pass) ctx.render.removePass(pass);
			else field.texture.destroy();
		},
	};
}

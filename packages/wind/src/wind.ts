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
	PUSH_LIFE,
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
	 * The texture. A reader declares it as `var wind: texture_2d_array<f32>;` and samples layer 0.
	 * Its red and blue channels hold the wind across the ground, and its green channel holds the
	 * wind's rise, which is zero while the field is flat. Its alpha holds how fast the air moves.
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
	 * The air at a world place, in meters a second, written into `out`. The CPU form of the same
	 * field that the GPU fills, for a page's own motion and for a test.
	 */
	sample(x: number, y: number, z: number, out: [number, number, number]): [number, number, number];
	/** Places the box about the camera and sends the values to the GPU. Call once in each frame. */
	update(): void;
	/** Removes the pass and its texture. */
	destroy(): void;
}

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

	// The pass takes eight value vectors: the settings, the ring of pushes and gusts, and the box.
	const values = new Array<number>(32).fill(0);
	const place: number[] = [0, 0, 0];
	const write = (): void => {
		values[0] = now();
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
		for (let i = 0; i < RING_SLOTS; i++) {
			const push = pushes.slots[i];
			const at = 12 + i * 4;
			values[at] = push?.x ?? 0;
			values[at + 1] = push?.z ?? 0;
			values[at + 2] = push?.strength ?? 0;
			values[at + 3] = push?.born ?? -PUSH_LIFE;
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
					data: new Float32Array(4),
				}),
		origin: [0, 0],
		size: holds ? box : 0,
		air: createReading(air),
	};
	// The box follows the camera and the pushes fade, so the values go up in every frame.
	const apply = (): void => {
		write();
		if (pass) ctx.render.setPassUniforms(pass, values);
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

	// A gust and a push each write one slot of the ring, and the newest replaces the oldest. A gust
	// travels from where it was sent, and a push stays there. The ring writes its own slots, so
	// neither call allocates anything.
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

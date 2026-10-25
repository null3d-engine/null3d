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
	defaultFieldState,
	type FieldState,
	PUSH_LIFE,
	PUSH_SLOTS,
	type Push,
} from './analytic';
import fallbackShader from './grid.fallback.wgsl';
import gridShader from './grid.wgsl';

/** What a page gives the wind, at the start or later. */
export interface WindOptions {
	/** The camera whose ground place the box follows. The field is centered on it in every frame. */
	camera: Camera;
	/** The box's width across the ground, in meters. */
	box?: number;
	/** The grid's texels across each way. */
	grid?: number;
	/** The air's settings: its speed, heading, gust, push and swirl. */
	air?: Partial<FieldState>;
}

/** The field that a reader samples: a texture of the air, and the box it covers. */
export interface WindField {
	/**
	 * The texture. A reader declares it as `var wind: texture_2d_array<f32>;` and samples layer 0.
	 * Its red and blue channels hold the wind across the ground, and its green channel holds the
	 * wind's rise, which is zero while the field is flat. Its alpha holds how fast the air moves.
	 */
	readonly texture: Texture;
	/** The box's near corner across the ground, in meters: x and z. */
	readonly origin: [number, number];
	/** The box's width across the ground, in meters. */
	readonly size: number;
}

/** The wind that a page reads and drives. */
export interface Wind {
	/** The field that a plant, a flag or a smoke card samples. */
	readonly field: WindField;
	/** Sets the steady wind: its speed in meters a second and its heading in radians. */
	setBase(speed: number, heading: number): void;
	/** Sends a gust of `strength` at a ground place, which turns the air about it as it fades. */
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
 * True when the device draws into a 16-bit float texture, which the field needs. Every WebGPU path
 * does. A WebGL2 device without either extension cannot hold the field, and its readers read the
 * texture's neutral black instead.
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
	const pushes: (Push | undefined)[] = new Array(PUSH_SLOTS).fill(undefined);
	let next = 0;
	const now = (): number => ctx.time.now;

	// The pass takes eight value vectors: the settings, the pushes' ring and the box.
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
		for (let i = 0; i < PUSH_SLOTS; i++) {
			const push = pushes[i];
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
	// texture, which holds the field's neutral black, and `sample` still gives it the air.
	const pass = holdsField(ctx.engine.capabilities)
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
		size: box,
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
	): [number, number, number] => analyticVelocity(air, pushes, x, y, z, now(), out);

	// A gust and a push are one turn of the air, and the newest replaces the oldest.
	const turn = (at: readonly [number, number], strength: number): void => {
		pushes[next] = { x: at[0], z: at[1], strength, born: now() };
		next = (next + 1) % PUSH_SLOTS;
	};

	return {
		field,
		setBase(speed, heading) {
			air.speed = speed;
			air.heading = heading;
		},
		gust(at, strength = GUST) {
			turn(at, strength);
		},
		push(at, strength = PUSH) {
			turn(at, strength);
		},
		sample,
		update: apply,
		destroy() {
			if (pass) ctx.render.removePass(pass);
			else field.texture.destroy();
		},
	};
}

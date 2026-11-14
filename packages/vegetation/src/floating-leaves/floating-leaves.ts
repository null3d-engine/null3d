// Floating and falling leaves that ride the wind add-on's one field. A page gives the field, the
// leaves to draw and the box that they fill. Two forms move them, for the cost comparison that
// chooses the form a scene uses:
//
// - `offset`: each leaf follows a closed-form fall from its own seed, and the air where it passes
//   pushes it. One texture read a frame moves each leaf, and no state passes between frames, so a
//   leaf cannot ride a gust along its path.
// - `state`: a pass keeps each leaf's place and speed from one frame to the next and drags the leaf
//   toward the air it meets, so a gust carries it along its path. The pass keeps its state in a
//   texture that the material reads, and the same work runs as a fragment form on WebGL2.
import {
	type Camera,
	defineFeature,
	type InstanceBatch,
	type Material,
	type SketchContext,
	type Texture,
} from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import { unitAt } from '../core/hash';
import offsetShader from './floating-leaves.wgsl';
import stateFallback from './floating-leaves-state.fallback.wgsl';
import stateShader from './floating-leaves-state.wgsl';
import stateDrawShader from './floating-leaves-state-draw.wgsl';

/**
 * How a leaf rides the air: `offset` pushes a closed-form fall by the air where the leaf passes, and
 * `state` gives each leaf a place and a speed of its own that a pass steps through the field.
 *
 * @category api/vegetation
 */
export type FloatingLeavesRide = 'offset' | 'state';

/**
 * The box that the leaves fill: its middle across the ground, its width, and the heights of the top
 * and of the ground. A leaf falls from the top to the ground and starts again.
 *
 * @category api/vegetation
 */
export interface FloatingLeavesArea {
	/** The middle of the box across the ground, in meters: its x. */
	readonly x: number;
	/** The middle of the box across the ground, in meters: its z. */
	readonly z: number;
	/** The box's width across the ground, in meters. */
	readonly size: number;
	/** The height that a leaf falls from, in meters. */
	readonly high: number;
	/** The ground that a leaf falls to, in meters. */
	readonly low: number;
}

/**
 * What `createFloatingLeaves` takes: the field, the leaves to draw, the box that they fill and the form.
 *
 * @category api/vegetation
 */
export interface FloatingLeavesOptions {
	/** The one wind field that moves the leaves. */
	readonly wind: WindField;
	/** The camera whose place the leaves' box follows, for the state form. */
	readonly camera: Camera;
	/** The leaves to draw, from 1 up to the device's instance limit. */
	readonly count: number;
	/** The box that the leaves fill. */
	readonly area: FloatingLeavesArea;
	/** The leaf's size in meters. It is 0.12 by default. */
	readonly size?: number;
	/** The scene's seed. It is 0 by default. */
	readonly seed?: number;
	/** How the leaves ride the air. It is `state` by default, the form that carries a gust. */
	readonly ride?: FloatingLeavesRide;
	/** The linear colour that multiplies the leaf's own. */
	readonly color?: readonly [number, number, number];
	/** The layers that the leaves draw on. */
	readonly layers?: number;
	/** The name of the state pass, which one page may hold more than one of. It is `leaves`. */
	readonly name?: string;
}

/**
 * FloatingLeaves that `createFloatingLeaves` made.
 *
 * @category api/vegetation
 */
export interface FloatingLeaves {
	/** The batch that draws the leaves. */
	readonly batch: InstanceBatch;
	/** How the leaves ride the air. */
	readonly ride: FloatingLeavesRide;
	/** The leaves that the batch holds. */
	readonly count: number;
	/**
	 * The state texture of the `state` form, or undefined on the `offset` form. A page reads it for a
	 * cost figure, and the material samples the layer that its last run wrote.
	 */
	readonly state: Texture | undefined;
	/**
	 * Steps the state by the frame's time and gives the shaders the field's newest layer. Call once
	 * in each frame before the engine draws. The default step is a sixtieth of a second.
	 */
	update(dt?: number): void;
	/** Changes the linear colour that multiplies the leaves' own, as a mood tints them. */
	setColor(color: readonly [number, number, number]): void;
	/** Removes the leaves and, with the state form, the pass that steps them. */
	destroy(): void;
}

/** The column count of the state texture: a row of leaves, and the rows below it. */
const COLUMNS = 512;
/** The seconds that a leaf takes to fall on the offset form, and how fast it drifts. */
const FALL = 8;
/** The drag toward the air, a second, that the state form gives a leaf. */
const DRAG = 1.4;
/** The turns a second that a leaf makes as it falls. */
const SPIN = 1.1;

/**
 * Makes leaves that ride the wind field, in the form that the page asks for.
 *
 * @param ctx The sketch's context.
 * @param options The field, the leaves, the box and the form.
 * @returns The leaves' batch and the calls that step and remove them.
 * @category api/vegetation
 */
export function createFloatingLeaves(
	ctx: SketchContext,
	options: FloatingLeavesOptions,
): FloatingLeaves {
	const { wind, camera, count, area } = options;
	const ride = options.ride ?? 'state';
	const seed = Math.floor(options.seed ?? 0);
	const size = options.size ?? 0.12;
	const columns = Math.min(COLUMNS, Math.max(1, count));
	const rows = Math.ceil(count / columns);
	const leafMap = leafAtlas(ctx);

	// Each leaf's place in the box, from its own integer hash, so every device puts it in the same
	// place. The state form moves the places that the pass holds, and the shader places every leaf,
	// so the rows exist for the instance count rather than for the places that they name.
	// The shader places and turns every leaf, so the quad takes no levels.
	const mesh = ctx.geometry.plane({ width: 1, height: 1, levels: false });
	const makeBatch = (material: Material): InstanceBatch => {
		const batch = ctx.scene.createInstances(mesh, count, {
			material,
			receiveShadows: true,
			...(options.layers !== undefined && { layers: options.layers }),
		});
		const positions = batch.positions as Float32Array;
		for (let index = 0; index < count; index++) {
			positions[index * 3] = area.x + (unitAt(seed, index, 1) - 0.5) * area.size;
			positions[index * 3 + 1] = area.low;
			positions[index * 3 + 2] = area.z + (unitAt(seed, index, 2) - 0.5) * area.size;
		}
		batch.markDirty();
		// A leaf draws where the shader places it, not at its own row's place, so the row's culling
		// cannot tell whether the leaf is in view. Every row draws.
		batch.setFrustumCulled(false);
		return batch;
	};

	const color = options.color ?? ([0.55, 0.62, 0.3] as const);
	if (ride === 'offset') {
		const airSettings = readingTexture(ctx, wind.air);
		/** The sent gust's born time that the settings texture holds, so one gust costs one upload. */
		let sentBorn = Number.NaN;
		const material = ctx.materials.shader({
			wgsl: offsetShader,
			color: [color[0], color[1], color[2]],
			alphaMode: 'mask',
			alphaCutoff: 0.5,
			doubleSided: true,
			textures: {
				leafMap,
				wind: wind.texture,
				airSettings,
			},
			uniforms: {
				height: area.high,
				low: area.low,
				fall: FALL,
				size,
				seed,
				drift: 0.12,
				spin: SPIN,
				windBox: wind.size,
				windLayer: 0,
			},
		});
		const batch = makeBatch(material);
		return {
			batch,
			ride,
			count,
			state: undefined,
			update() {
				material.setUniform('windLayer', wind.texture.layer);
				// A gust that a page sends travels through the steady field, which the settings carry.
				// The texels go up when a gust is sent, not once a frame.
				if (wind.air.sent[3] !== sentBorn) {
					sentBorn = wind.air.sent[3];
					airSettings.update(readingData(wind.air));
				}
			},
			setColor(next) {
				material.set({ color: [next[0], next[1], next[2]] });
			},
			destroy() {
				batch.destroy();
			},
		};
	}

	// The state form: a pass that steps each leaf's place and speed through the air, and a material
	// that reads the state to place the cards. The values carry two boxes: the field's, which the
	// pass samples, and the leaves', in which they start again and wrap.
	const values = new Array<number>(28).fill(0);
	for (let i = 0; i < 4; i++) {
		values[i] = wind.air.base[i] as number;
		values[4 + i] = wind.air.gust[i] as number;
		values[8 + i] = wind.air.swirl[i] as number;
	}
	const place: number[] = [0, 0, 0];
	camera.getPosition(place);
	const put = (): void => {
		values[12] = (place[0] as number) - wind.size / 2;
		values[13] = (place[2] as number) - wind.size / 2;
		values[14] = wind.size;
		values[15] = wind.texture.layer;
		values[16] = area.high;
		values[17] = area.low;
		values[18] = FALL;
		values[19] = DRAG;
		values[20] = seed;
		values[21] = 1 / 60;
		values[24] = (place[0] as number) - area.size / 2;
		values[25] = (place[2] as number) - area.size / 2;
		values[26] = area.size;
	};
	put();
	const pass = ctx.render.addPass({
		kind: 'compute',
		description: defineFeature({
			name: options.name ?? 'leaves',
			frame: 'background',
			kind: 'compute',
			outputs: { leaves: { default: 'black' } },
		}),
		wgsl: stateShader,
		fallback: { wgsl: stateFallback },
		format: 'rgba16float',
		size: [columns, rows],
		history: true,
		textures: [wind.texture],
		values,
	});
	const state = ctx.textures.fromPass(pass);
	const material = ctx.materials.shader({
		wgsl: stateDrawShader,
		color: [color[0], color[1], color[2]],
		alphaMode: 'mask',
		alphaCutoff: 0.5,
		doubleSided: true,
		textures: { leaves: state, leafMap },
		uniforms: {
			columns,
			layer: 0,
			height: area.high,
			low: area.low,
			fall: FALL,
			size,
			seed,
			spin: SPIN,
		},
	});
	const batch = makeBatch(material);
	return {
		batch,
		ride,
		count,
		state,
		update(dt = 1 / 60) {
			camera.getPosition(place);
			put();
			values[21] = Math.min(Math.max(dt, 0), 0.1);
			ctx.render.setPassUniforms(pass, values);
			material.setUniform('layer', state.layer);
		},
		setColor(next) {
			material.set({ color: [next[0], next[1], next[2]] });
		},
		destroy() {
			batch.destroy();
			ctx.render.removePass(pass);
		},
	};
}

/** The field's settings as the texture holds them: the air, the gust, the swirl and the sent gust. */
function readingData(air: WindField['air']): Float32Array {
	const data = new Float32Array(16);
	data.set(air.base, 0);
	data.set(air.gust, 4);
	data.set(air.swirl, 8);
	data.set(air.sent.slice(0, 4), 12);
	return data;
}

/** The texture that holds the field's settings: four texels of four numbers each. */
function readingTexture(ctx: SketchContext, air: WindField['air']): Texture {
	return ctx.textures.fromData({
		width: 4,
		height: 1,
		format: 'rgba16float',
		data: readingData(air),
	});
}

/** An atlas of one leaf: an ovate blade with a point, a midrib and a short stem. */
function leafAtlas(ctx: SketchContext): Texture {
	const width = 32;
	const height = 32;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const u = (x + 0.5) / width - 0.5;
			const v = (y + 0.5) / height;
			// The blade's half width at a height, widest below the middle and pointed at the tip.
			const half = 0.32 * Math.sin(Math.PI * Math.min(Math.max((v - 0.08) / 0.84, 0), 1)) ** 0.75;
			const inside = Math.min(Math.max((half - Math.abs(u)) * width + 0.5, 0), 1);
			const rib = Math.abs(u) < 0.025 ? 1.2 : 1;
			const edge = v < 0.1 ? 0.7 : 1;
			data.set(
				[
					Math.min(255, 96 * rib * edge),
					Math.min(255, 128 * rib * edge),
					Math.min(255, 54 * rib * edge),
					Math.round(255 * inside),
				],
				(y * width + x) * 4,
			);
		}
	return ctx.textures.fromData({ width, height, data, colorSpace: 'srgb', mipmaps: true });
}

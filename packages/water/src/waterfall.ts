// The waterfall: a sheet of water that falls from a river's lip, with a froth of spray at the lip,
// a cloud of mist that it bursts into lower down and a plume of mist at its foot. The sheet follows
// the path that falling water takes, and its material moves every streak with the water from the
// time alone, so the CPU does no work for it in a frame. The spray and the mist are particle
// systems of the particles add-on, whose particles the GPU moves from their birth and age, so a
// frame only steps their emitters. `fall.ts` places the emitters along the fall's path.
import type { ParticleWindField, ShaderOptions, SketchContext } from '@null3d/engine';
import type { ParticleSystem, ParticleSystemOptions } from '@null3d/particles';
import {
	APRON,
	checkFallSheet,
	type FallEmitter,
	type FallSheet,
	fallEmitters,
	fallSheet,
	fallTime,
	GRAVITY,
	type WaterfallMesh,
} from './fall';
import fallShader from './fall.wgsl';
import type { WaterPoint } from './shape';

/** The current at the lip that a fall takes when the caller gives none, in meters a second. */
const SPEED = 1.2;
/**
 * How far each side of the sheet widens for each meter that the water falls, by default: a creek
 * 5 m wide that falls 13 m is about twice as wide halfway down.
 */
const SPREAD = 0.3;
/** The most spray and mist that `setSpray` gives, as a factor of the fall's own. */
const MOST_SPRAY = 3;
/** The glassy water's color at the lip: a grey green, as linear red, green and blue. */
const GLASS = [0.05, 0.075, 0.068] as const;
/** The height that stands for no cloud below the fall: far below any scene. */
const NO_FADE = -1e9;
/** The meters below the lip over which the water turns from glassy to white. */
const CLEAR = 0.7;
/** The gap to a wall behind the sheet over which the sheet fades as it nears it, in meters. */
const SOFTNESS = 0.6;
/** The light on the spray and the mist when the scene sets none, as a linear color. */
const MIST_LIGHT = [0.92, 0.93, 0.95] as const;
/** The longest life of a puff of the froth, a drop, a puff of the mist and the plume, in seconds. */
const FROTH_LIFE = 1.8;
const DROP_LIFE = 1.4;
const MIST_LIFE = 4.5;
const PLUME_LIFE = 9;

/**
 * The standard material values that a waterfall's sheet takes, such as the color of its white
 * water.
 *
 * @category api/water
 */
export type WaterfallMaterialOptions = Omit<
	ShaderOptions<typeof fallShader>,
	'wgsl' | 'uniforms' | 'textures' | 'sceneInputs'
>;

/**
 * Options of `createWaterfall`.
 *
 * @category api/water
 */
export interface WaterfallOptions {
	/** The middle of the lip, where the river's surface ends and the water falls, as [x, z] in meters. */
	readonly lip: WaterPoint;
	/** The way the water runs over the lip, as [x, z]. Its length does not matter. */
	readonly direction: WaterPoint;
	/** Half the river's width at the lip, in meters. */
	readonly halfWidth: number;
	/** The height of the water's surface at the lip, in meters. It is 0 by default. */
	readonly level?: number;
	/**
	 * The current's speed at the lip, in meters a second. It sets how far the water leaps out from
	 * the lip's line: at 1.2 m/s the back of the column is 0.6 m out 2 m down and 1.3 m out
	 * 13 m down. A wall below the lip that leans out further than that meets the water, and the
	 * column fades where it nears the rock. A river runs faster as it nears a brink, so give the
	 * speed at the lip itself. It is 1.2 by default.
	 */
	readonly speed?: number;
	/**
	 * How far the fall drops below the lip, in meters. The sheet thins into mist over the lower half
	 * of the drop, and never lands.
	 */
	readonly drop: number;
	/**
	 * How far each side of the sheet widens for each meter that the water falls. It is 0.3 by
	 * default.
	 */
	readonly spread?: number;
	/**
	 * How far upstream of the lip the fall's water starts, lying on the river's surface, in meters.
	 * There it fades in at uneven distances and takes the place of the river's own surface, so the
	 * river's square end at the lip is covered and the water runs into the fall with no straight
	 * edge. Give the reach of the broken water before the brink. It is 1 by default.
	 */
	readonly apron?: number;
	/**
	 * The world height of a cloud sea, a fog bank or a mist that the fall drops into, in meters. A
	 * cloud that draws before the fall does not hide it, so below this height the fall vanishes
	 * itself over 2.5 m, each clump at its own depth. The water then breaks up and bursts into mist
	 * over the part of the drop above the cloud. By default it never vanishes.
	 */
	readonly fadeBelow?: number;
	/**
	 * The spray and the mist, as a factor of the fall's own, from 0 to 3. It is 1 by default. At 0
	 * the fall makes no particles, neither the particles add-on nor the engine's particle code loads,
	 * and `setSpray` has nothing to raise.
	 */
	readonly spray?: number;
	/**
	 * The layers that the sheet and its spray draw on, as a 32-bit mask. It is layer 0 by default.
	 * Leave out the layers that a water's reflection draws when the fall lies past the water's edge.
	 */
	readonly layers?: number;
	/** A field of air that carries the mist, such as the wind add-on's field. */
	readonly wind?: ParticleWindField;
	/** The sheet's standard material values, such as the color of its white water. */
	readonly material?: WaterfallMaterialOptions;
	/** How fine the sheet's mesh is. */
	readonly mesh?: WaterfallMesh;
}

/**
 * A waterfall that `createWaterfall` made.
 *
 * @category api/water
 */
export interface Waterfall {
	/** The seconds that the water takes to fall from the lip to the foot. */
	readonly fallTime: number;
	/**
	 * Steps the spray and the mist by the frame's time. Call it once in each frame, in
	 * `onLateUpdate`, after the wind's field steps, as a particle system's `update` is called.
	 */
	update(): void;
	/**
	 * Sets the light on the spray and the mist, as a linear color. Particles are not lit, so a scene
	 * gives them its light in each mood. The sheet takes the scene's own light.
	 */
	setLight(color: readonly [red: number, green: number, blue: number]): void;
	/**
	 * Sets the spray and the mist, as a factor of the fall's own, from 0 to 3. A storm raises it.
	 */
	setSpray(amount: number): void;
	/** Removes the sheet, its material and its particles. */
	destroy(): void;
}

/** One of the fall's particle systems and the births per second that it makes at a spray of 1. */
interface Emitter {
	readonly system: ParticleSystem;
	readonly rate: number;
}

/** An error of the water add-on's own. */
function error(message: string): Error {
	const error = new Error(`@null3d/water: ${message}`);
	error.name = 'WaterError';
	return error;
}

/** A spray amount, or an error that says what it must be. */
function sprayAmount(amount: number): number {
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MOST_SPRAY)
		throw error(`a waterfall's spray must be from 0 to ${MOST_SPRAY}, and it is ${amount}`);
	return amount;
}

/** The lip's direction across the water, to its right, as a unit vector in the world. */
function acrossOf(direction: WaterPoint): [number, number, number] {
	const length = Math.hypot(direction[0], direction[1]);
	return [-direction[1] / length, 0, direction[0] / length];
}

/** The height below which a fall vanishes, from its options: far below any scene when none is given. */
function sinkHeight(height: number | undefined): number {
	if (height === undefined) return NO_FADE;
	if (typeof height !== 'number' || !Number.isFinite(height))
		throw error(`a waterfall's fadeBelow must be a finite number, and it is ${height}`);
	return height;
}

/** The births that a system keeps room for: its most rate over its longest life, and a margin. */
function room(rate: number, life: number): number {
	return Math.ceil(rate * MOST_SPRAY * life * 1.15) + 16;
}

/**
 * Makes a waterfall that falls from a river's lip: a sheet of water that curves over the lip and
 * drops almost straight, glassy at the lip and white lower down, with spray at the lip, a cloud of
 * mist that it bursts into lower down and a plume of mist at its foot. Give it the lip, the way the water runs, the river's
 * half width, its surface height and its current there, and the drop. End the river's own surface
 * at the lip: the sheet starts a short way upstream, on the river's surface, and fades in over it.
 *
 * @category api/water
 */
export async function createWaterfall(
	ctx: SketchContext,
	options: WaterfallOptions,
): Promise<Waterfall> {
	const { scene, geometry, materials, textures } = ctx;
	const level = options.level ?? 0;
	const speed = options.speed ?? SPEED;
	const sheet: FallSheet = {
		lip: options.lip,
		direction: options.direction,
		halfWidth: options.halfWidth,
		level,
		speed,
		drop: options.drop,
		spread: options.spread ?? SPREAD,
		apron: options.apron ?? APRON,
		...(options.mesh && { mesh: options.mesh }),
	};
	checkFallSheet(sheet);
	let spray = sprayAmount(options.spray ?? 1);
	const sink = sinkHeight(options.fadeBelow);
	// The part of the drop that shows: down to a meter below the cloud that the fall sinks into, or
	// the whole drop. The water breaks up and bursts into mist over this part, so the burst stands
	// above the cloud rather than inside it.
	const shown: FallSheet = { ...sheet, drop: Math.min(sheet.drop, Math.max(level - sink + 1, 1)) };
	const material = materials.shader({
		color: '#f2f3f2',
		roughness: 0.95,
		metalness: 0,
		// Foam scatters light more than it mirrors it, so its edges catch little of the sky's glare,
		// which would draw a thin bluish line down a column seen from the side.
		specularIntensity: 0.35,
		// Both faces draw, so the column's far side shows through the gaps in its near side.
		doubleSided: true,
		alphaMode: 'blend',
		depthWrite: false,
		// White water lets the light behind it through, so a low sun behind the fall lights it.
		diffuseTransmission: 0.35,
		...options.material,
		wgsl: fallShader,
		// The sheet fades where it nears a wall behind it, from the copy of the scene's depth.
		sceneInputs: ['sceneDepth'],
		uniforms: {
			glass: [GLASS[0], GLASS[1], GLASS[2]],
			drop: shown.drop,
			clear: CLEAR,
			softness: SOFTNESS,
			apron: (sheet.apron ?? APRON) / speed,
			halfWidth: sheet.halfWidth,
			fadeBelow: sink,
			across: acrossOf(options.direction),
		},
	});
	const mesh = scene.createMesh({
		mesh: geometry.fromArrays(fallSheet(sheet)),
		material,
		receiveShadows: true,
		...(options.layers !== undefined && { layers: options.layers }),
	});

	const end = fallTime(sheet.drop);
	const emitters: Emitter[] = [];
	const light: [number, number, number] = [MIST_LIGHT[0], MIST_LIGHT[1], MIST_LIGHT[2]];
	// The tint over each particle's life, one light throughout, which `setLight` changes in place.
	const tint = { colorOverLife: [light, light] };
	if (spray > 0) {
		// The particles add-on loads with the first fall that makes spray, so a page that draws only
		// water loads none of it.
		const { createParticles, particleTextures } = await import('@null3d/particles');
		const common = {
			...particleTextures.smoke(textures),
			blending: 'normal' as const,
			prewarm: true,
			colorOverLife: tint.colorOverLife,
			// Puffs fade where they near the cliff and near the camera, so none cuts a line or fills
			// the view.
			softness: 0.8,
			nearFade: 2,
			...(options.layers !== undefined && { layers: options.layers }),
		};
		const look = (place: FallEmitter, seed: number): ParticleSystemOptions => {
			const half = place.halfWidth;
			const base = {
				...common,
				seed,
				position: place.position,
				shape: { type: 'box' as const, size: place.box },
				rate: place.rate * spray,
			};
			if (place.kind === 'froth')
				// Small puffs thrown out and down with the water over the brink.
				return {
					...base,
					capacity: room(place.rate, FROTH_LIFE),
					direction: [0, -0.35, 1],
					spread: 0.5,
					speed: [speed * 0.6, speed * 1.4 + 0.3],
					gravity: [0, -2.5, 0],
					drag: 1.4,
					lifetime: [0.9, FROTH_LIFE],
					size: [0.25 * half, 0.45 * half],
					sizeOverLife: [0.6, 1.3, 1.9],
					alphaOverLife: [0, 0.85, 0.5, 0],
					opacity: 0.55,
				};
			if (place.kind === 'drops')
				// Small round drops flung off the column's surface, out and down with the water. Those
				// born inside the column hide in it; those outside show close up as spray.
				return {
					...base,
					...particleTextures.glow(textures),
					capacity: room(place.rate, DROP_LIFE),
					direction: [0, -0.2, 1],
					spread: 1.4,
					speed: [0.5, 2.5],
					velocity: [0, -6, 0],
					gravity: [0, -GRAVITY, 0],
					drag: 0.2,
					lifetime: [0.5, DROP_LIFE],
					// Small enough that from far off a drop covers a pixel or less, and reads as spray
					// rather than as a fleck.
					size: [0.03, 0.08],
					sizeOverLife: [1, 1, 0.7],
					alphaOverLife: [0, 1, 0.8, 0],
					opacity: 0.7,
				};
			const wind = options.wind && { windField: options.wind };
			if (place.kind === 'mist')
				// Broad puffs that sink slower than the water and drift out from it.
				return {
					...base,
					...wind,
					capacity: room(place.rate, MIST_LIFE),
					speed: [0, 0.4],
					velocity: [0, -2, 0.6],
					drag: 0.8,
					turbulence: 0.8,
					turbulenceScale: 0.3,
					lifetime: [2.5, MIST_LIFE],
					// Billows sized by the creek, not by the fall's fan, so a wide fall makes more of
					// them rather than a wall of haze.
					size: [0.6 * sheet.halfWidth, 1.3 * sheet.halfWidth],
					sizeOverLife: [0.6, 1.2, 1.7],
					alphaOverLife: [0, 0.9, 0.75, 0],
					opacity: 0.5,
				};
			// The plume: broad puffs that rise and spread where the fall thins into cloud.
			return {
				...base,
				...wind,
				capacity: room(place.rate, PLUME_LIFE),
				speed: [0, 0.6],
				velocity: [0, 0.5, 0.4],
				turbulence: 1.2,
				turbulenceScale: 0.2,
				turbulenceSpeed: 0.3,
				lifetime: [5, PLUME_LIFE],
				size: [0.9 * sheet.halfWidth, 1.8 * sheet.halfWidth],
				sizeOverLife: [0.5, 1.4, 2.2],
				alphaOverLife: [0, 0.8, 0.7, 0],
				opacity: 0.7,
			};
		};
		const places = fallEmitters(shown);
		const made = await Promise.all(
			places.map((place, k) => createParticles(ctx, look(place, 61 + k))),
		);
		for (let k = 0; k < made.length; k++) {
			const system = made[k] as ParticleSystem;
			const place = places[k] as FallEmitter;
			// Each system's frame turns with the lip, so its box lies across the fall.
			system.object.setRotation(0, Math.sin(place.turn / 2), 0, Math.cos(place.turn / 2));
			emitters.push({ system, rate: place.rate });
		}
	}
	return {
		fallTime: end,
		// The frame's calls loop with an index, which makes no iterator.
		update() {
			for (let k = 0; k < emitters.length; k++) (emitters[k] as Emitter).system.update();
		},
		setLight(color) {
			light[0] = color[0];
			light[1] = color[1];
			light[2] = color[2];
			for (let k = 0; k < emitters.length; k++) (emitters[k] as Emitter).system.set(tint);
		},
		setSpray(amount) {
			if (amount === spray) return;
			spray = sprayAmount(amount);
			for (let k = 0; k < emitters.length; k++) {
				const emitter = emitters[k] as Emitter;
				emitter.system.rate = emitter.rate * spray;
			}
		},
		destroy() {
			for (let k = 0; k < emitters.length; k++) (emitters[k] as Emitter).system.destroy();
			emitters.length = 0;
			mesh.destroy();
			material.destroy();
		},
	};
}

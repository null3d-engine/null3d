// The waterfall: a sheet of water that falls from a river's lip, with a froth of spray at the lip,
// mist down the fall and a plume of mist at its foot. The sheet follows the path that falling water
// takes, and its material moves every streak with the water from the time alone, so the CPU does no
// work for it in a frame. The spray and the mist are particle systems of the particles add-on,
// whose particles the GPU moves from their birth and age, so a frame only steps their emitters.
import type { ParticleWindField, ShaderOptions, SketchContext, Vec3Like } from '@null3d/engine';
import { createParticles, type ParticleSystem, particleTextures } from '@null3d/particles';
import {
	APRON,
	checkFallSheet,
	type FallSheet,
	fallPlace,
	fallSheet,
	fallTime,
	type WaterfallMesh,
} from './fall';
import fallShader from './fall.wgsl';
import type { WaterPoint } from './shape';

/** The current at the lip that a fall takes when the caller gives none, in meters a second. */
const SPEED = 1.2;
/** How far each side of the sheet widens for each meter that the water falls, by default. */
const SPREAD = 0.12;
/** The most spray and mist that `setSpray` gives, as a factor of the fall's own. */
const MOST_SPRAY = 3;
/** The glassy water's color at the lip: a grey green, as linear red, green and blue. */
const GLASS = [0.05, 0.075, 0.068] as const;
/** The meters below the lip over which the water turns from glassy to white. */
const CLEAR = 1.2;
/** The gap to a wall behind the sheet over which the sheet fades as it nears it, in meters. */
const SOFTNESS = 0.6;
/** The light on the spray and the mist when the scene sets none, as a linear color. */
const MIST_LIGHT = [0.92, 0.93, 0.95] as const;

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
	 * The current's speed at the middle of the lip, in meters a second. It sets how far the water
	 * leaps clear of the lip before it drops. A river runs faster as it nears a brink, so give the
	 * speed at the lip itself: 1 to 2 m/s throws a creek's fall clear of the wall below it. It is
	 * 1.2 by default.
	 */
	readonly speed?: number;
	/**
	 * How far the fall drops below the lip, in meters. The sheet thins into mist over the lower half
	 * of the drop, and never lands.
	 */
	readonly drop: number;
	/**
	 * How far each side of the sheet widens for each meter that the water falls. It is 0.12 by
	 * default.
	 */
	readonly spread?: number;
	/**
	 * The spray and the mist, as a factor of the fall's own, from 0 to 3. It is 1 by default. At 0
	 * the fall makes no particles and loads no particle code, and `setSpray` has nothing to raise.
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

/** The births that a system keeps room for: its most rate over its longest life, and a margin. */
function room(rate: number, life: number): number {
	return Math.ceil(rate * MOST_SPRAY * life * 1.15) + 16;
}

/**
 * Makes a waterfall that falls from a river's lip: a sheet of water that curves over the lip and
 * drops almost straight, glassy at the lip and white lower down, with spray at the lip, mist down
 * the fall and a plume of mist at its foot. Give it the lip, the way the water runs, the river's
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
		...(options.mesh && { mesh: options.mesh }),
	};
	checkFallSheet(sheet);
	let spray = sprayAmount(options.spray ?? 1);
	const material = materials.shader({
		color: '#f2f3f2',
		roughness: 0.85,
		metalness: 0,
		// Both faces draw, so the fall shows from behind as well, and its veils cross without
		// hiding each other.
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
			drop: sheet.drop,
			clear: CLEAR,
			softness: SOFTNESS,
			apron: APRON / speed,
		},
	});
	const mesh = scene.createMesh({
		mesh: geometry.fromArrays(fallSheet(sheet)),
		material,
		receiveShadows: true,
		...(options.layers !== undefined && { layers: options.layers }),
	});

	// The places along the fall that the particles start from, in the frame of the lip: x across the
	// lip, y up and z out from it, which a turn about the vertical axis gives each system.
	const length = Math.hypot(sheet.direction[0], sheet.direction[1]);
	const dx = sheet.direction[0] / length;
	const dz = sheet.direction[1] / length;
	const turn = Math.atan2(dx, dz) / 2;
	const end = fallTime(sheet.drop);
	const place: [number, number] = [0, 0];
	const world = (forward: number, height: number): Vec3Like => [
		sheet.lip[0] + dx * forward,
		level + height,
		sheet.lip[1] + dz * forward,
	];
	const halfAt = (fallen: number) => sheet.halfWidth + sheet.spread * fallen;
	const emitters: Emitter[] = [];
	const light: [number, number, number] = [MIST_LIGHT[0], MIST_LIGHT[1], MIST_LIGHT[2]];
	// The tint over each particle's life, one light throughout, which `setLight` changes in place.
	const tint = { colorOverLife: [light, light] };
	if (spray > 0) {
		const smoke = particleTextures.smoke(textures);
		const common = {
			...smoke,
			blending: 'normal' as const,
			prewarm: true,
			colorOverLife: tint.colorOverLife,
			// Puffs fade where they near the cliff and near the camera, so none cuts a line or fills
			// the view.
			softness: 0.8,
			nearFade: 2,
			...(options.layers !== undefined && { layers: options.layers }),
		};
		const half = sheet.halfWidth;
		// The froth over the brink: small puffs thrown out and down with the water.
		const frothRate = 6 * half;
		const frothLife = 1.8;
		// The mist down the fall: puffs that sink slower than the water and drift out from it.
		const middle = sheet.drop * 0.55;
		fallPlace(end * 0.55, speed, place);
		const mistOut = place[0];
		const mistRate = half * Math.max(1, sheet.drop / 6);
		const mistLife = 4.5;
		// The plume at the foot: broad puffs that rise and spread, where the fall thins into cloud.
		fallPlace(end, speed, place);
		const footOut = place[0];
		const foot = halfAt(sheet.drop);
		const plumeRate = 1.1 * foot;
		const plumeLife = 9;
		const made = await Promise.all([
			createParticles(ctx, {
				...common,
				seed: 61,
				capacity: room(frothRate, frothLife),
				position: world(0.25, -0.1),
				shape: { type: 'box', size: [half * 1.9, 0.25, 0.5] },
				direction: [0, -0.35, 1],
				spread: 0.5,
				speed: [speed * 0.6, speed * 1.4 + 0.3],
				gravity: [0, -2.5, 0],
				drag: 1.4,
				lifetime: [0.9, frothLife],
				rate: frothRate * spray,
				size: [0.25 * half, 0.45 * half],
				sizeOverLife: [0.6, 1.3, 1.9],
				alphaOverLife: [0, 0.85, 0.5, 0],
				opacity: 0.55,
			}),
			createParticles(ctx, {
				...common,
				seed: 62,
				capacity: room(mistRate, mistLife),
				position: world(mistOut, -middle),
				shape: { type: 'box', size: [halfAt(middle) * 2, sheet.drop * 0.75, 1.2] },
				speed: [0, 0.4],
				velocity: [0, -2.5, 0.6],
				drag: 0.8,
				turbulence: 0.6,
				turbulenceScale: 0.4,
				lifetime: [2.5, mistLife],
				rate: mistRate * spray,
				size: [0.5 * half, 1.1 * half],
				sizeOverLife: [0.7, 1.4, 2.1],
				alphaOverLife: [0, 0.7, 0.5, 0],
				opacity: 0.45,
				...(options.wind && { windField: options.wind }),
			}),
			createParticles(ctx, {
				...common,
				seed: 63,
				capacity: room(plumeRate, plumeLife),
				position: world(footOut + 0.5, -sheet.drop * 0.92),
				shape: { type: 'box', size: [foot * 2.8, sheet.drop * 0.2, 3] },
				speed: [0, 0.6],
				velocity: [0, 0.5, 0.4],
				turbulence: 1.2,
				turbulenceScale: 0.2,
				turbulenceSpeed: 0.3,
				lifetime: [5, plumeLife],
				rate: plumeRate * spray,
				size: [0.9 * foot, 1.8 * foot],
				sizeOverLife: [0.5, 1.4, 2.2],
				alphaOverLife: [0, 0.6, 0.55, 0],
				opacity: 0.5,
				...(options.wind && { windField: options.wind }),
			}),
		]);
		const rates = [frothRate, mistRate, plumeRate];
		for (let k = 0; k < made.length; k++) {
			const system = made[k] as ParticleSystem;
			// Each system's frame turns with the lip, so its box lies across the fall.
			system.object.setRotation(0, Math.sin(turn), 0, Math.cos(turn));
			emitters.push({ system, rate: rates[k] as number });
		}
	}
	return {
		fallTime: end,
		update() {
			for (const emitter of emitters) emitter.system.update();
		},
		setLight(color) {
			light[0] = color[0];
			light[1] = color[1];
			light[2] = color[2];
			for (const emitter of emitters) emitter.system.set(tint);
		},
		setSpray(amount) {
			if (amount === spray) return;
			spray = sprayAmount(amount);
			for (const emitter of emitters) emitter.system.rate = emitter.rate * spray;
		},
		destroy() {
			for (const emitter of emitters) emitter.system.destroy();
			emitters.length = 0;
			mesh.destroy();
			material.destroy();
		},
	};
}

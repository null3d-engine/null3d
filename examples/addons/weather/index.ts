// Weather for null3D scenes: water on the ground and on a windshield, and the link to the particles
// add-on for the splashes and steam that rain makes. The wet surface is one WGSL block that a
// scene's own material copies between markers and calls at the end of its surface function, so the
// scene keeps its own paint, its maps and its lane markings and the add-on only adds water to what
// it is given. `wet.wgsl` is the canonical block, and `wet.test.ts` fails when a copy is edited
// alone. This module gives the block its values: the three vectors, the planar reflection pass and
// its cadence, and the mirror texture.
//
// The rain streaks themselves are not here. They come from the core's draw from a vertex count
// (M3-A5), and the splashes and steam come from @null3d/particles.
import type {
	ColorInput,
	Material,
	MaterialOptions,
	MeshGeometry,
	Object3D,
	QualityPreset,
	SketchContext,
	Texture,
	Vec3Like,
} from '@null3d/engine';
import {
	createParticles,
	type ParticleSystem,
	type ParticleTexture,
	particleTextures,
} from '@null3d/particles';
import shieldShader from './shield.wgsl';
import wetShader from './wet.wgsl';

/** The four numbers of one of the block's setting vectors. */
export type WetPair = [number, number, number, number];

/** The wet surface's look. A value that a call leaves out keeps its default. */
export interface WetLook {
	/** The share of the ground that holds water, from 0 to 1. The default is 0.55. */
	coverage?: number;
	/** How wide the edge between dry ground and water is in the depth's units. The default is 0.055. */
	softness?: number;
	/** The width of one ripple cell in meters, and the ripples one cell shows a second. */
	rippleSize?: number;
	rippleRate?: number;
	/** How dark the water turns the surface under it, from 0 for no change to 1 for black. The default is 0.5. */
	darken?: number;
	/**
	 * How much of the planar mirror the water shows, from 0 to 1. It is 0 by default, and 1 when
	 * the call asks for a planar reflection and names no share.
	 */
	mirrorShare?: number;
	/** The perceptual roughness of the water. The default is 0.03, a mirror. */
	wetRoughness?: number;
	/** How far the ripple rings bend the normal. The default is 0.32. */
	rippleStrength?: number;
	/** The rain's strength, from 0 for a dry ground to 1 for heavy rain. The default is 1. */
	rain?: number;
	/** The scale of the asphalt's grain, in cells a meter, which breaks the mirror into streaks. The default is 1.6. */
	grainScale?: number;
	/** How much of the planar mirror the wet asphalt between the puddles shows. The default is 0. */
	roadMirror?: number;
}

/** The planar reflection that the wet surface reads. */
export interface WetReflection {
	/** The texture's size as a share of the render size each way. The default is the preset's. */
	scale?: 1 | 0.5 | 0.25;
	/**
	 * The frames between two draws of the reflection on each preset, which replaces the add-on's
	 * own cadence. The default draws every other frame on Low and Medium and every frame above.
	 * The governor does not reach it; pass 1 where a comparison must draw in every frame.
	 */
	every?: Partial<Record<QualityPreset, number>>;
	/** The layers of the objects that the mirror shows. It is the camera's layers by default. */
	layers?: number;
	/** The pass's name in the render graph, which must be unique in the scene. The default is `wet`. */
	name?: string;
}

/** Options of `createWetSurface`. */
export interface WetSurfaceOptions extends WetLook {
	/** The planar reflection pass, or false to reflect from the screen. The default is false. */
	reflection?: WetReflection | false;
	/** The ground's height, which the planar pass mirrors across. The default is 0. */
	planeHeight?: number;
}

/** The vectors and texture that a reader gives its material. */
export interface WetSurface {
	/** The three settings vectors for the reader's `struct Uniforms`, which it passes to the block. */
	readonly uniforms: { readonly wet0: WetPair; readonly wet1: WetPair; readonly wet2: WetPair };
	/** The texture for the reader's `wetMirror`, which is black where the scene has no planar pass. */
	readonly textures: { readonly wetMirror: Texture };
	/** The frames between two reflection draws now. */
	readonly reflectionEvery: number;
	/**
	 * Writes the frame's time and the look's values into the reader's material, and draws the
	 * reflection when its turn comes. Call once per frame.
	 */
	update<
		Values extends MaterialOptions & {
			wet0?: readonly number[];
			wet1?: readonly number[];
			wet2?: readonly number[];
		},
	>(material: Material<Values>, time: number): void;
	/** Changes the look. The next update writes it. */
	set(look: WetLook): void;
	/** Stops the reflection pass, while the surface that owns it is not drawn. */
	pause(): void;
	/** Removes the reflection pass and frees what the add-on made. */
	destroy(): void;
}

/** The frames between two reflection draws at each preset, before the scene's own cadence. */
const REFLECT_EVERY = [2, 2, 1, 1] as const;
/** The presets from the lightest to the heaviest. */
const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/** The look's defaults, as the block's three vectors. */
function lookVectors(look: Required<WetLook>): {
	wet0: WetPair;
	wet1: WetPair;
	wet2: WetPair;
} {
	return {
		wet0: [look.coverage, look.softness, look.rippleSize, look.rippleRate],
		wet1: [look.darken, look.mirrorShare, look.wetRoughness, look.rippleStrength],
		wet2: [0, look.rain, look.grainScale, look.roadMirror],
	};
}

/** The look's defaults, used for a value that the scene leaves out. */
const DEFAULT_LOOK: Required<WetLook> = {
	coverage: 0.55,
	softness: 0.055,
	rippleSize: 0.9,
	rippleRate: 0.8,
	darken: 0.5,
	mirrorShare: 0,
	wetRoughness: 0.03,
	rippleStrength: 0.32,
	rain: 1,
	grainScale: 1.6,
	roadMirror: 0,
};

/** The look with every value given, from the values that `look` names and the ones before. */
function resolveLook(look: WetLook, from: Required<WetLook> = DEFAULT_LOOK): Required<WetLook> {
	return {
		coverage: look.coverage ?? from.coverage,
		softness: look.softness ?? from.softness,
		rippleSize: look.rippleSize ?? from.rippleSize,
		rippleRate: look.rippleRate ?? from.rippleRate,
		darken: look.darken ?? from.darken,
		mirrorShare: look.mirrorShare ?? from.mirrorShare,
		wetRoughness: look.wetRoughness ?? from.wetRoughness,
		rippleStrength: look.rippleStrength ?? from.rippleStrength,
		rain: look.rain ?? from.rain,
		grainScale: look.grainScale ?? from.grainScale,
		roadMirror: look.roadMirror ?? from.roadMirror,
	};
}

/**
 * Makes the wet surface: the three settings vectors and the mirror texture that a scene's own
 * material takes, and the planar reflection pass when the scene asks for one. The scene's material
 * copies the block from `wet.wgsl` and ends its surface function with a call to it.
 */
export function createWetSurface(ctx: SketchContext, options: WetSurfaceOptions = {}): WetSurface {
	const { render, textures, quality } = ctx;
	let look = resolveLook(options);
	// A pass that the scene asks for is a pass that it shows, unless it names its own share.
	if (options.reflection && options.mirrorShare === undefined) look.mirrorShare = 1;
	const uniforms = lookVectors(look);
	const reflection = options.reflection === false ? null : (options.reflection ?? null);
	const pass =
		reflection === null
			? null
			: render.addPass({
					kind: 'reflection',
					writes: reflection.name ?? 'wet',
					plane: { point: [0, options.planeHeight ?? 0, 0] },
					...(reflection.scale !== undefined && { scale: reflection.scale }),
					...(reflection.layers !== undefined && { layers: reflection.layers }),
				});
	const black = pass
		? null
		: textures.fromData({
				width: 1,
				height: 1,
				data: new Uint8Array([0, 0, 0, 255]),
				colorSpace: 'linear',
			});
	const mirror = pass ? textures.fromPass(pass) : (black as Texture);
	// The frames between two draws of the pass: the scene's own cadence, else the preset's.
	const everyAt = (preset: QualityPreset): number =>
		Math.max(
			1,
			Math.round(reflection?.every?.[preset] ?? (REFLECT_EVERY[PRESETS.indexOf(preset)] as number)),
		);
	let every = everyAt(quality.preset);
	quality.onChange(() => {
		every = everyAt(quality.preset);
	});
	let frame = 0;
	return {
		uniforms,
		textures: { wetMirror: mirror },
		get reflectionEvery() {
			return every;
		},
		update(material, time) {
			uniforms.wet2[0] = time;
			material.setUniform('wet0', uniforms.wet0);
			material.setUniform('wet1', uniforms.wet1);
			material.setUniform('wet2', uniforms.wet2);
			if (!pass) return;
			if (every <= 1) {
				render.setPassEnabled(pass, true);
				return;
			}
			frame = (frame + 1) % every;
			render.setPassEnabled(pass, frame === 0);
		},
		set(next) {
			look = resolveLook(next, look);
			const current = lookVectors(look);
			copy(uniforms.wet0, current.wet0);
			copy(uniforms.wet1, current.wet1);
			uniforms.wet2[1] = current.wet2[1];
			uniforms.wet2[2] = current.wet2[2];
			uniforms.wet2[3] = current.wet2[3];
		},
		pause() {
			if (pass) render.setPassEnabled(pass, false);
		},
		destroy() {
			if (pass?.live) render.removePass(pass);
			if (black) black.destroy();
		},
	};
}

/** Copies four numbers into a vector, without making one. */
function copy(to: WetPair, from: readonly number[]): void {
	to[0] = from[0] as number;
	to[1] = from[1] as number;
	to[2] = from[2] as number;
	to[3] = from[3] as number;
}

/** Options of `createWetGround`. */
export interface WetGroundOptions extends WetSurfaceOptions {
	/** The dry ground's color. The default is a dark asphalt. */
	color?: ColorInput;
	/** The dry ground's perceptual roughness. The default is 0.55. */
	roughness?: number;
	/** The dry ground's metalness. The default is 0. */
	metalness?: number;
}

/** A plain wet ground, for a demo or a test that has no material of its own. */
export interface WetGround {
	/** The ground's material, which draws the add-on's own default wet surface. */
	readonly material: Material;
	/** The surface's values and reflection, for `update` in each frame. */
	readonly wet: WetSurface;
}

/**
 * Makes the add-on's own wet ground material, a dark asphalt with water on it. A scene that paints
 * its own surface copies the block from `wet.wgsl` instead and calls `createWetSurface` for the
 * values.
 */
export function createWetGround(ctx: SketchContext, options: WetGroundOptions = {}): WetGround {
	const wet = createWetSurface(ctx, options);
	const material = ctx.materials.shader({
		wgsl: wetShader,
		color: options.color ?? '#1b1d21',
		roughness: options.roughness ?? 0.55,
		metalness: options.metalness ?? 0,
		uniforms: { ...wet.uniforms },
		textures: { wetMirror: wet.textures.wetMirror },
	});
	return { material, wet };
}

/** How the windshield's drops run. A value that a call leaves out keeps its default. */
export interface WindshieldLook {
	/** The rain's strength, from 0 for a dry glass to 1. The default is 1. */
	rain?: number;
	/**
	 * The wiper: the seconds between two sweeps, and how long one sweep takes. A look without a
	 * wiper leaves it out, and the drops stay.
	 */
	wiper?: { every?: number; duration?: number };
}

/** Options of `createWindshield`. */
export interface WindshieldOptions extends WindshieldLook {
	/** The canopy mesh that the drops cover. */
	mesh: MeshGeometry;
	/** The object that the canopy hangs under, such as the car's body. */
	parent?: Object3D;
	/** Where the overlay sits when it has no parent. The default is the origin. */
	position?: readonly [number, number, number];
	/** The overlay's rotation as a quaternion, when it has no parent. */
	rotation?: readonly [number, number, number, number];
	/** The layers that the overlay draws on. It is the parent's layers by default. */
	layers?: number;
}

/** The drops on a car's canopy. */
export interface Windshield {
	/** The overlay's material, if a scene wants to change one of its values itself. */
	readonly material: Material;
	/** Turns the drops on or off. */
	setVisible(on: boolean): void;
	/** Sets the rain's strength, from 0 for a dry glass to 1. */
	setRain(value: number): void;
	/** Moves the drops and the wiper. Call once per frame with the sketch time. */
	update(time: number): void;
	/** Frees the overlay's material. */
	destroy(): void;
}

/**
 * Adds windshield drops over a canopy: beads of water that slide and leave trails, with an optional
 * wiper. The overlay is its own blended surface, so the canopy's own material and paint stay under
 * it.
 */
export function createWindshield(ctx: SketchContext, options: WindshieldOptions): Windshield {
	const { scene, materials } = ctx;
	const wipe = options.wiper;
	const every = wipe?.every ?? 7;
	const duration = wipe?.duration ?? 0.9;
	const material = materials.shader({
		wgsl: shieldShader,
		uniforms: { time: 0, rain: options.rain ?? 1, wipe: 0, since: 10 },
		alphaMode: 'blend',
		depthWrite: false,
		depthBias: { constant: -2, slopeScale: -2 },
	});
	const mesh = scene.createMesh({
		mesh: options.mesh,
		material,
		...(options.parent && { parent: options.parent }),
		...(options.position && { position: options.position }),
		...(options.rotation && { rotation: options.rotation }),
		...(options.layers !== undefined && { layers: options.layers }),
		castShadows: false,
		receiveShadows: false,
	});
	/** True once a sweep has run, so the drops grow back after it and not before the first. */
	let wiped = false;
	return {
		material,
		setVisible(on) {
			mesh.setVisible(on);
		},
		setRain(value) {
			material.setUniform('rain', value);
		},
		update(time) {
			material.setUniform('time', time);
			if (!wipe) return;
			const phase = time % every;
			const start = every - duration;
			const sweeping = phase >= start;
			if (sweeping) wiped = true;
			const going = sweeping ? (phase - start) / duration : 0;
			// While the sweep runs, the drops stay above its line; after it, they grow back over time.
			const since = sweeping ? 10 : wiped ? phase : 10;
			material.setUniform('wipe', going);
			material.setUniform('since', since);
		},
		destroy() {
			material.destroy();
		},
	};
}

/** A small crown of water, made in code, for the splashes that rain makes. */
function splashTexture(ctx: Pick<SketchContext, 'textures'>, size = 32): ParticleTexture {
	const data = new Uint8Array(size * size * 4);
	const half = (size - 1) / 2;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const u = (x - half) / half;
			const v = (y - half) / half;
			const r = Math.hypot(u, v);
			const angle = Math.atan2(v, u);
			// A ring of droplets, each ring a little broken, with a pale core.
			const spikes = 0.5 + 0.5 * Math.cos(angle * 7 + 0.6);
			const band = Math.exp(-((r - 0.5 - spikes * 0.12) ** 2) / 0.012);
			const core = Math.exp(-r * r * 40) * 0.5;
			const edge = 1 - Math.max(0, r - 0.9) * 5;
			const alpha = Math.min(1, Math.max(0, (band + core) * edge));
			const light = Math.round((0.8 + 0.2 * (1 - r)) * 255);
			const at = (y * size + x) * 4;
			data[at] = light;
			data[at + 1] = light;
			data[at + 2] = light;
			data[at + 3] = Math.round(alpha * 255);
		}
	return {
		map: ctx.textures.fromData({
			width: size,
			height: size,
			data,
			wrap: 'clamp',
			mipmaps: true,
		}),
		flipbook: { columns: 1, rows: 1 },
	};
}

/** Options of `createSplashes`. */
export interface SplashOptions {
	/** The object that the splashes hang under, such as a car. */
	parent?: Object3D;
	/** Where the drops land, in the parent's space. The default is the origin. */
	position?: Vec3Like;
	/** The area that the drops land over. The default is a patch a little over a meter wide. */
	size?: Vec3Like;
	/** Splashes a second. The default is 60. */
	rate?: number;
	/** The splashes' color. The default is a cold white. */
	color?: ColorInput;
	/** How bright the splashes glow. The default is 0.7. */
	intensity?: number;
}

/** The splashes that drops make where they land. */
export interface Splashes {
	/** The particle system, if a scene wants to change it itself. */
	readonly system: ParticleSystem;
	/** Turns the splashes on or off. */
	setVisible(on: boolean): void;
	/** Sets the splashes a second. */
	setRate(value: number): void;
	/** Moves the particles. Call once per frame, in the late update. */
	update(): void;
}

/** Adds the splashes that rain drops make where they land. */
export async function createSplashes(
	ctx: SketchContext,
	options: SplashOptions = {},
): Promise<Splashes> {
	const system = await createParticles(ctx, {
		...splashTexture(ctx),
		...(options.parent && { parent: options.parent }),
		position: options.position ?? [0, 0, 0],
		shape: { type: 'box', size: options.size ?? [1.6, 0.08, 3.2] },
		direction: [0, 1, 0],
		spread: 0.8,
		speed: [0.5, 1.6],
		gravity: [0, -9, 0],
		lifetime: [0.16, 0.34],
		rate: options.rate ?? 60,
		size: [0.025, 0.06],
		sizeOverLife: [1, 0.6],
		colors: options.color ?? '#dfeeff',
		alphaOverLife: [1, 0.7, 0],
		intensity: options.intensity ?? 0.7,
		blending: 'additive',
		prewarm: true,
	});
	return {
		system,
		setVisible(on) {
			system.object.setVisible(on);
		},
		setRate(value) {
			system.rate = value;
		},
		update() {
			system.update();
		},
	};
}

/** Options of `createSteam`. */
export interface SteamOptions {
	/** The object that the steam rises from, such as a car. */
	parent?: Object3D;
	/** Where the steam is born, in the parent's space. The default is the origin. */
	position?: Vec3Like;
	/** The emitter's size, which spreads the births. The default is a small patch. */
	size?: Vec3Like;
	/** Puffs a second. The default is 10. */
	rate?: number;
	/** The steam's colors, from birth to age. The default is a cold grey-blue. */
	colors?: readonly [ColorInput, ColorInput];
	/** The wind that carries the steam, in meters a second. The default is a soft drift. */
	wind?: Vec3Like;
}

/** The steam that a hot thing lets out into the rain. */
export interface Steam {
	/** The particle system, if a scene wants to change it itself. */
	readonly system: ParticleSystem;
	/** Turns the steam on or off. */
	setVisible(on: boolean): void;
	/** Sets the puffs a second. */
	setRate(value: number): void;
	/** Moves the particles. Call once per frame, in the late update. */
	update(): void;
}

/** Adds the steam that rises from vents, nozzles or a hot body in the rain. */
export async function createSteam(ctx: SketchContext, options: SteamOptions = {}): Promise<Steam> {
	const system = await createParticles(ctx, {
		...particleTextures.smoke(ctx.textures),
		blending: 'normal',
		...(options.parent && { parent: options.parent }),
		position: options.position ?? [0, 0, 0],
		shape: { type: 'box', size: options.size ?? [0.3, 0.05, 0.3] },
		direction: [0, 1, 0],
		spread: 0.35,
		speed: [0.3, 0.9],
		drag: 0.6,
		wind: options.wind ?? [0.4, 0.5, 0],
		turbulence: 0.45,
		lifetime: [0.9, 1.8],
		rate: options.rate ?? 10,
		size: [0.12, 0.3],
		sizeOverLife: [0.4, 1, 2.2],
		colors: options.colors ?? ['#9fb6c8', '#6b7784'],
		alphaOverLife: [0, 0.28, 0.14, 0],
		prewarm: true,
	});
	return {
		system,
		setVisible(on) {
			system.object.setVisible(on);
		},
		setRate(value) {
			system.rate = value;
		},
		update() {
			system.update();
		},
	};
}

// The ocean: a sea of three bands of waves, each band a square tile with a spectrum of its own, whose
// heights are transformed from that spectrum on the GPU and read back by one surface material. The
// transform runs as a chain of compute passes that a material reads in the same frame, and as a chain
// of fragment passes on WebGL2. The surface follows the camera, sums the bands at their own scales,
// and lights the slopes that the transform gives it.
import {
	type Camera,
	defineFeature,
	FeatureHost,
	type MeshArrays,
	type QualityPreset,
	type RenderPass,
	type ShaderOptions,
	type SketchContext,
} from '@null3d/engine';
import bandsFallbackShader from './bands.fallback.wgsl';
import bandsShader from './bands.wgsl';
import { cadenceRow, REFLECT_EVERY_MAX, REFLECT_MS } from './cadence';
import fftFallbackShader from './fft.fallback.wgsl';
import fftShader from './fft.wgsl';
import oceanShader from './ocean.wgsl';
import {
	bandFields,
	GRID,
	type OceanBand,
	PASSES,
	heightAt as sampleHeight,
	spectrum,
} from './spectrum';
import { NAMESPACE } from './water';

/** The meters of the gap to the bed over which the water fades to nothing at a shore. */
const SOFTNESS = 0.12;
/** The height at which foam breaks on a crest, in meters. */
const FOAM = 1.1;
/** How far past the camera the sea's mesh reaches, in meters. */
const REACH = 3000;
/** The mesh's segments each way, which the graded grid spends most of near the camera. */
const SEGMENTS = 256;
/** How fast the mesh's cells grow with distance, where one is the even spacing. */
const GRADE = 2.2;

/**
 * The bands that the sea holds when a page names none: a long swell, a wind sea and the chop on top.
 *
 * @category api/water
 */
export const OCEAN_BANDS: readonly OceanBand[] = [
	{ tile: 512, height: 2.4, wind: 12, direction: 0.6, seed: 1 },
	{ tile: 128, height: 1.1, wind: 9, direction: 0.75, seed: 2 },
	{ tile: 32, height: 0.35, wind: 6, direction: 0.9, seed: 3 },
];

/**
 * The standard material values that the ocean's surface takes.
 *
 * @category api/water
 */
export type OceanMaterialOptions = Omit<
	ShaderOptions<typeof oceanShader>,
	'wgsl' | 'uniforms' | 'textures' | 'sceneInputs'
>;

/**
 * Options of `createOcean`.
 *
 * @category api/water
 */
export interface OceanOptions {
	/** The camera that the sea's mesh follows. It stays about the camera in every frame. */
	readonly camera: Camera;
	/** The height of the sea's surface, in meters. It is 0 by default. */
	readonly level?: number;
	/**
	 * The bands of the sea, from two to three, each with the meters of its tile, its significant wave
	 * height, and the wind that shapes it. The default bands are a long swell, a wind sea and chop.
	 */
	readonly bands?: readonly OceanBand[];
	/** How far past the camera the mesh reaches, in meters. It is 3000 by default. */
	readonly reach?: number;
	/** The mesh's segments each way. It is 256 by default. */
	readonly segments?: number;
	/** The height at which foam breaks on a crest, in meters. It is 1.1 by default. */
	readonly foam?: number;
	/** The meters of the gap to the bed over which the water fades at a shore. It is 0.12 by default. */
	readonly softness?: number;
	/**
	 * The frames between two draws of the reflection at each preset, which replaces the add-on's own
	 * cadence for the presets that it names.
	 */
	readonly reflectionEvery?: Partial<Record<QualityPreset, number>>;
	/** The layers that the reflection pass draws, as a 32-bit mask. It is the camera's by default. */
	readonly layers?: number;
	/**
	 * The reflection's size as a share of the render size each way: 1, 0.5 or 0.25. It is the render
	 * size by default.
	 */
	readonly reflectionScale?: 1 | 0.5 | 0.25;
	/** The standard material values, such as the water's tint and its thickness. */
	readonly material?: OceanMaterialOptions;
}

/**
 * The sea that `createOcean` made.
 *
 * @category api/water
 */
export interface Ocean {
	/** The height of the sea's surface, in meters. */
	readonly level: number;
	/** The bands of the sea, in the order that they sum. */
	readonly bands: readonly OceanBand[];
	/** The frames between two draws of the reflection now. */
	readonly reflectionEvery: number;
	/**
	 * Moves the sea's mesh about the camera. The reflection pass carries its own cadence. Call once in
	 * each frame, after the camera moves and before the engine draws.
	 */
	update(): void;
	/**
	 * The height of the sea at a world place, in meters, as the bands sum at the sketch time. It runs
	 * the bands' transforms on this thread, and transforms again only when the sketch time moves, so
	 * several reads in a frame share one transform.
	 */
	heightAt(x: number, z: number): number;
	/**
	 * @internal The height that one band adds at a world place, in meters, at the sketch time `at`,
	 * or now without one, for the tests.
	 */
	bandHeightAt(band: number, x: number, z: number, at?: number): number;
	/** @internal The pass that holds the bands, which a test reads back. */
	readonly bandsPass: RenderPass;
	/** @internal Turns the transform's passes on or off, for a cost measurement. */
	setTransformEnabled(on: boolean): void;
	/** @internal Draws the sea's surface or leaves it out, for a cost measurement. */
	setSurfaceDrawn(on: boolean): void;
	/** Removes the surface, the transform's passes, the reflection and the material. */
	destroy(): void;
}

/** The passes that the add-on added, so that each reflection names a texture of its own. */
let reflections = 0;

/** The sea's mesh: a square grid that grows coarser with distance, so the camera keeps fine waves. */
export function oceanMesh(reach: number, segments: number): MeshArrays {
	const count = segments + 1;
	const positions = new Float32Array(count * count * 3);
	const normals = new Float32Array(count * count * 3);
	const uvs = new Float32Array(count * count * 2);
	const indices = new Uint32Array(segments * segments * 6);
	// The cell at `share` of the way out covers `share` of the reach, raised to a power so that the
	// cells near the camera are small and those far away are large.
	const place = (share: number): number => Math.sign(share) * Math.abs(share) ** GRADE * reach;
	for (let j = 0; j < count; j++)
		for (let i = 0; i < count; i++) {
			const at = j * count + i;
			positions[at * 3] = place((i / segments) * 2 - 1);
			positions[at * 3 + 1] = 0;
			positions[at * 3 + 2] = place((j / segments) * 2 - 1);
			normals[at * 3 + 1] = 1;
			uvs[at * 2] = i / segments;
			uvs[at * 2 + 1] = j / segments;
		}
	for (let j = 0; j < segments; j++)
		for (let i = 0; i < segments; i++) {
			const at = j * count + i;
			const to = (j * segments + i) * 6;
			indices[to] = at;
			indices[to + 1] = at + count;
			indices[to + 2] = at + 1;
			indices[to + 3] = at + 1;
			indices[to + 4] = at + count;
			indices[to + 5] = at + count + 1;
		}
	return { positions, normals, uvs, indices };
}

/** The bands that a call asks for, refused when they cannot make a sea. */
function bandList(bands: readonly OceanBand[] | undefined): readonly OceanBand[] {
	const list = bands ?? OCEAN_BANDS;
	if (list.length < 2 || list.length > 3)
		throw new Error('@null3d/water: an ocean takes two or three bands');
	for (const band of list) {
		if (!(band.tile > 0) || !Number.isFinite(band.tile))
			throw new Error('@null3d/water: a band needs a tile above 0 meters');
		if (!(band.height >= 0) || !Number.isFinite(band.height))
			throw new Error('@null3d/water: a band needs a height of 0 meters or more');
	}
	return list;
}

/**
 * Makes a sea of waves in a scene: the transform's passes, the material that reads them, and the
 * reflection that mirrors the sky and the far shore. The sea's mesh follows the camera, and the
 * surface moves its vertices and lights its slopes from the transform's heights.
 *
 * @category api/water
 */
export function createOcean(ctx: SketchContext, options: OceanOptions): Ocean {
	const { scene, geometry, materials, textures, render, quality } = ctx;
	const camera = options.camera;
	const level = options.level ?? 0;
	const bands = bandList(options.bands);
	const tiles = bands.map((band) => band.tile);
	while (tiles.length < 3) tiles.push(1);
	const layerCount = bands.length;
	const foam = options.foam ?? FOAM;
	const softness = options.softness ?? SOFTNESS;
	const reach = options.reach ?? REACH;
	const segments = options.segments ?? SEGMENTS;

	// Each band's spectrum, uploaded once as a layer of one texture. The spectrum holds the waves'
	// amplitudes and phases, and the transform only turns them through time.
	const spectra = new Float32Array(GRID * GRID * 4 * layerCount);
	const cpuSpectra: Float32Array[] = [];
	for (let band = 0; band < layerCount; band++) {
		const data = spectrum(bands[band] as OceanBand, GRID);
		spectra.set(data, band * GRID * GRID * 4);
		cpuSpectra.push(data);
	}
	const waves = textures.fromData({
		width: GRID,
		height: GRID,
		depth: layerCount,
		format: 'rgba16float',
		data: spectra,
		colorSpace: 'linear',
		filter: 'nearest',
	});

	// The transform's passes: one stage each, the horizontal axis' stages first, then the vertical
	// axis'. Each pass reads the pass before it, and the first reads the spectrum.
	const passes: RenderPass[] = [];
	let source = waves;
	for (let stage = 0; stage < PASSES; stage++) {
		const pass = render.addPass({
			kind: 'compute',
			description: defineFeature({
				name: `ocean-waves-${stage}`,
				frame: 'background',
				kind: 'compute',
				outputs: { [`oceanWaves${stage}`]: { default: 'black' } },
			}),
			wgsl: fftShader,
			fallback: { wgsl: fftFallbackShader },
			format: 'rgba16float',
			size: [GRID, GRID],
			layers: layerCount,
			values: [stage, tiles[0] as number, tiles[1] as number, tiles[2] as number],
			textures: [source],
			name: `ocean-waves-${stage}`,
		});
		passes.push(pass);
		source = textures.fromPass(pass);
	}
	// The heights arrive in the transform's own units, a spread of one. This pass scales each band to
	// its own height and adds the slopes that the heights beside it give.
	const bandPass = render.addPass({
		kind: 'compute',
		description: defineFeature({
			name: 'ocean-bands',
			frame: 'background',
			kind: 'compute',
			outputs: { oceanBands: { default: 'black' } },
		}),
		wgsl: bandsShader,
		fallback: { wgsl: bandsFallbackShader },
		format: 'rgba16float',
		size: [GRID, GRID],
		layers: layerCount,
		values: [
			(bands[0]?.height as number) / 4,
			(bands[1]?.height as number) / 4,
			(bands[2]?.height ?? bands[1]?.height ?? 0) / 4,
			0,
			tiles[0] as number,
			tiles[1] as number,
			tiles[2] as number,
			0,
		],
		textures: [source],
		name: 'ocean-bands',
	});
	const field = textures.fromPass(bandPass);

	// The mirror of the scene above the water, which the surface bends with its slopes.
	const reflection = render.addPass({
		kind: 'reflection',
		writes: reflections === 0 ? 'oceanMirror' : `oceanMirror${reflections + 1}`,
		plane: { point: [0, level, 0] },
		...(options.layers !== undefined && { layers: options.layers }),
		...(options.reflectionScale !== undefined && { scale: options.reflectionScale }),
	});
	reflections++;
	const mirror = textures.fromPass(reflection);

	const material = materials.shader({
		color: '#0b3444',
		roughness: 0.04,
		metalness: 0,
		ior: 1.33,
		transmission: 1,
		doubleSided: true,
		alphaMode: 'blend',
		thickness: 0.6,
		attenuationColor: '#2e6f68',
		attenuationDistance: 1.5,
		...options.material,
		wgsl: oceanShader,
		sceneInputs: ['sceneDepth'],
		textures: { bands: field, mirror },
		uniforms: {
			tiles: [tiles[0] as number, tiles[1] as number, tiles[2] as number],
			foam,
			count: layerCount,
			softness,
		},
	});
	const mesh = scene.createMesh({
		// The waves move the grid's vertices in the shader, so the flat grid takes no levels.
		mesh: geometry.fromArrays({ ...oceanMesh(reach, segments), levels: false }),
		material,
		position: [0, level, 0],
		receiveShadows: true,
	});

	// The feature carries the cadence through the sketch's quality, as the river and lake water does.
	let every = 1;
	const host = new FeatureHost({
		quality,
		tier: ctx.engine.capabilities.tier,
		page: ctx.page,
		namespace: NAMESPACE,
	});
	host.add(
		defineFeature({
			name: 'ocean',
			settings: {
				reflectionEvery: {
					presets: cadenceRow(options.reflectionEvery),
					values: { min: 1, max: REFLECT_EVERY_MAX, whole: true },
					governor: 'double',
				},
			},
			budget: { presets: REFLECT_MS, min: 0.25 },
			quality: (_preset, _settings, own) => {
				every = own.settings.reflectionEvery as number;
				// The pass carries its cadence itself, so no frame recompiles the graph.
				render.setPassEvery(reflection, every);
			},
		}),
	);

	const eye: [number, number, number] = [0, 0, 0];
	const fieldOf = bandFields(cpuSpectra, bands);
	const heightOf = (band: number, x: number, z: number, t: number): number => {
		const one = bands[band] as OceanBand;
		const insideX = ((x % one.tile) + one.tile) % one.tile;
		const insideZ = ((z % one.tile) + one.tile) % one.tile;
		// A significant height is about four times the spread, as the transform's field has one.
		return sampleHeight(fieldOf(band, t), insideX, insideZ, one.tile, one.height / 4, GRID);
	};
	const sum = (x: number, z: number, t: number): number => {
		let height = level;
		for (let band = 0; band < layerCount; band++) height += heightOf(band, x, z, t);
		return height;
	};
	return {
		level,
		bands,
		get reflectionEvery() {
			return every;
		},
		update() {
			camera.getPosition(eye);
			mesh.setPosition(eye[0], level, eye[2]);
		},
		heightAt(x, z) {
			return sum(x, z, ctx.time.now);
		},
		bandHeightAt(band, x, z, at) {
			return heightOf(band, x, z, at ?? ctx.time.now);
		},
		bandsPass: bandPass,
		setTransformEnabled(on) {
			for (const pass of passes) render.setPassEnabled(pass, on);
			render.setPassEnabled(bandPass, on);
		},
		setSurfaceDrawn(on) {
			mesh.setVisible(on);
		},
		destroy() {
			host.destroy();
			mesh.destroy();
			material.destroy();
			render.removePass(reflection);
			render.removePass(bandPass);
			for (const pass of passes) render.removePass(pass);
			// The band and mirror textures belong to their passes, which go with them; the
			// spectrum's data texture is the add-on's own.
			waves.destroy();
		},
	};
}

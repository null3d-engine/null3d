// The sea around the island: an FFT ocean from the water add-on, three bands of long swell, wind sea
// and chop that run from the open water into the bay. The island breaks its surface, the shore fades
// against the real bed, and the breakers and lacy foam ride the heights that the ocean reports at
// their own places, so the surf moves with the water rather than lying on a still level. Everything
// the scene knows about the sea stays in this module, so a body of another kind can take its place
// by changing this file alone.
import type { Camera, MeshArrays, QualityPreset, SketchContext } from '@null3d/engine';
import { createOcean, type Ocean, type OceanBand } from '@null3d/water';
import { INTERIOR_LAYER } from '../../lib/layers';
import { Noise, random } from '../../lib/procedural';
import { BAY, GROUND, SEA_LEVEL, sandyBed } from './island';
import { groundHeight } from './plan';

/** How far the deep water's floor reaches from the island's middle, in meters: past the horizon's haze. */
export const SEA_REACH = 40000;
/** The sides of the open floor's outline. */
const SIDES = 96;
/** How far under the sea's level the deep's floor lies, and where the bed starts to fade into it, in meters. */
const DEEP_FLOOR = 44;
const DEEP_FROM = 25;
/** The meters between the lines of the skin over the deep bed, and how far above and below the bed it lies. */
const DEEP_CELL = 6;
const DEEP_LIFT = 5;
const DEEP_UNDER = -1;
/** The meters of depth over which that skin rises from under the bed to over it. */
const SKIN_FADE = 16;
/** The bed's colours where the fade starts, and the deep's, as linear values. */
const BED_COLOR = [0.13, 0.12, 0.1] as const;
const SAND_COLOR = [0.62, 0.48, 0.28] as const;
const DEEP_COLOR = [0.03, 0.115, 0.235] as const;
const DEEP_COLOR_HEX = '#305e85';
/** How far out over the water the shore's foam reaches at most, and how far back on the sand it starts, in meters. */
const FOAM_WIDTH = 9;
const FOAM_ON_SAND = 12;
/** The meters of the shore's foam that one copy of its lace covers. */
const FOAM_TILE = 11;
/** How far past the camera the ocean's own surface reaches, and the segments it spends, per preset. */
const OCEAN_DETAIL: Record<QualityPreset, { reach: number; segments: number }> = {
	low: { reach: 6000, segments: 192 },
	medium: { reach: 9000, segments: 256 },
	high: { reach: 12000, segments: 384 },
	ultra: { reach: 12000, segments: 384 },
};
/**
 * The bay's waves: a gentle swell from the open water, heading in toward the sand, with the wind sea
 * and the chop that break its crests. A band's height is its significant height, so its crests stand
 * about half of that above the level.
 */
const BAY_BANDS: readonly OceanBand[] = [
	{ tile: 180, height: 0.5, wind: 7.5, direction: 3.94, seed: 11 },
	{ tile: 64, height: 0.28, wind: 5.5, direction: 3.7, seed: 12 },
	{ tile: 24, height: 0.12, wind: 4.2, direction: 3.4, seed: 13 },
];
/** The height at which a crest breaks into foam, in meters. */
const CREST_FOAM = 0.3;
/** The seconds between two reads of the ocean's heights. The surf's places move in every frame. */
const HEIGHT_STEP = 0.15;
/** The breakers that take the bay, the lines of vertices across each one, and where its crest's lip sits. */
const BREAKERS = 38;
const BREAKER_ACROSS = 8;
const BREAKER_LIP = 0.78;
/** The shore foam's steps along the bay, and its lines of vertices across. */
const FOAM_STEPS = 320;
const FOAM_ACROSS = 14;
/** The meters above the waterline that the swash's foam reaches up the sand at most. */
const SWASH_REACH = 0.45;

/** A flat ring between two reaches, at a depth under the sea's level. */
function openSea(from: number, to: number, depth: number) {
	const positions: number[] = [];
	const indices: number[] = [];
	for (let k = 0; k <= SIDES; k++) {
		const bearing = (k / SIDES) * Math.PI * 2;
		const [x, z] = [Math.cos(bearing), Math.sin(bearing)];
		positions.push(x * from, SEA_LEVEL - depth, z * from);
		positions.push(x * to, SEA_LEVEL - depth, z * to);
		if (k < SIDES) {
			const at = k * 2;
			indices.push(at, at + 2, at + 1, at + 1, at + 2, at + 3);
		}
	}
	return { positions, indices, computeNormals: true };
}

/** Foam's map: white, with a soft alpha of broken lace. */
function foamMap({ textures }: SketchContext) {
	const size = 1024;
	const noise = new Noise(307);
	const data = new Uint8Array(size * size * 4);
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size; i++) {
			const [u, v] = [i / size, j / size];
			// Thin threads along the zero lines of the noise, which join up as a web of lace.
			const coarse = 1 - Math.abs(noise.fbm2(u * 9, v * 9, 3, 9)) * 7;
			const fine = 1 - Math.abs(noise.fbm2(u * 27, v * 27, 2, 27)) * 7;
			const lace = Math.max(coarse, fine * 0.85) * 0.5 + 0.05 * noise.fbm2(u * 60, v * 60, 2, 60);
			const at = (j * size + i) * 4;
			const tone = 235 + Math.min(20, Math.max(0, lace * 30));
			data[at] = tone;
			data[at + 1] = tone;
			data[at + 2] = tone;
			data[at + 3] = Math.max(0, Math.min(255, 50 + lace * 370));
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/**
 * A skin over the seabed from where it starts to fall away: it takes the bed's colour where it begins
 * and the deep's colour by the floor, so the rock fades into the deep with no edge.
 */
function deepBed() {
	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const side = Math.ceil(GROUND / DEEP_CELL);
	const place = (i: number) => (i - side / 2) * DEEP_CELL;
	const depths = new Float32Array((side + 1) * (side + 1));
	for (let j = 0; j <= side; j++)
		for (let i = 0; i <= side; i++) {
			const [x, z] = [place(i), place(j)];
			const depth = SEA_LEVEL - groundHeight(x, z);
			depths[j * (side + 1) + i] = depth;
			const t = smoothstep01(depth, DEEP_FROM + SKIN_FADE * 0.25, DEEP_FLOOR);
			// The skin starts under the bed, so the bed cuts its rim and no square cell shows, and it rises
			// over the bed, far enough that the bed's coarse far blocks stay under it.
			const lift =
				DEEP_UNDER +
				(DEEP_LIFT - DEEP_UNDER) * smoothstep01(depth, DEEP_FROM, DEEP_FROM + SKIN_FADE);
			positions.push(x, SEA_LEVEL - Math.min(depth, DEEP_FLOOR) + lift, z);
			// It lights as the flat floor past it does, so its slope leaves no line where it meets that floor.
			normals.push(0, 1, 0);
			// The skin starts in the bed's own colour, pale sand or dark rock, so its rim shows no line.
			const sandy = sandyBed(x, z);
			for (let c = 0; c < 3; c++) {
				const bed =
					(BED_COLOR[c] as number) + ((SAND_COLOR[c] as number) - (BED_COLOR[c] as number)) * sandy;
				colors.push(bed + ((DEEP_COLOR[c] as number) - bed) * t);
			}
		}
	for (let j = 0; j < side; j++)
		for (let i = 0; i < side; i++) {
			const at = j * (side + 1) + i;
			const [a, b, c, d] = [at, at + 1, at + side + 1, at + side + 2];
			const deepest = Math.max(
				depths[a] as number,
				depths[b] as number,
				depths[c] as number,
				depths[d] as number,
			);
			if (deepest > DEEP_FROM) indices.push(a, c, b, b, c, d);
		}
	return { positions, normals, colors, indices };
}

/** A smooth step from 0 at one value to 1 at another. */
function smoothstep01(v: number, from: number, to: number): number {
	const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
	return t * t * (3 - 2 * t);
}

/** One breaker: a short crest that runs in toward the sand at its own speed and place. */
interface Breaker {
	/** The crest's place among the heights that the update keeps, and its first vertex and steps. */
	readonly heights: number;
	readonly first: number;
	readonly steps: number;
	/** The bearing where the crest starts, and the radians that it sweeps along the bay. */
	readonly angle: number;
	readonly sweep: number;
	/** The meters from the sand where the crest comes in, and the seconds of one run. */
	readonly offshore: number;
	readonly period: number;
	/** The place of the crest's own run in its cycle, the share of that cycle it lives for, and where in the cycle that share starts. */
	readonly phase: number;
	readonly duty: number;
	readonly start: number;
	/** The meters that one end of the crest leads the other, so it comes in askew, and its middle's bow. */
	readonly lead: number;
	readonly bow: number;
	/** The crest's width, its height above the water, and how white it reads. */
	readonly width: number;
	readonly lift: number;
	readonly strength: number;
	/** The seed that tears the crest into patches of white. */
	readonly seed: number;
}

/** A ribbon of crests that moves with the water, and the arrays that the breakers write each update. */
interface Breakers {
	readonly mesh: MeshArrays;
	readonly positions: Float32Array;
	readonly colors: Float32Array;
	/** Places the crests and writes their vertices, reading the water's heights when `resample` asks. */
	update(t: number, resample: boolean): void;
}

/**
 * The breakers across the bay: short crest lines that come in toward the sand. Each takes a slot on
 * the shore with enough jitter that neighbours clump and leave gaps, and its own length, lean, run
 * and timing, so no two read as one row of arcs. The crest is a narrow raised lip with white water
 * spread behind it and a thin surge ahead, torn into patches that the foam map breaks up further.
 * Each crest rides the water's own height along its length, so it neither floats above the surface
 * nor sinks below it as the swell passes.
 */
function breakers(ocean: Ocean): Breakers {
	const next = random(211);
	const noise = new Noise(211);
	const crests: Breaker[] = [];
	const indices: number[] = [];
	const uvs: number[] = [];
	const arc = Math.abs(BAY.sweep) * BAY.radius;
	let vertices = 0;
	let steps = 0;
	for (let c = 0; c < BREAKERS; c++) {
		// A slot on the shore, jittered by almost its whole width, then the crest's own numbers.
		const place = Math.min(0.94, Math.max(0.06, (c + 0.5 + (next() - 0.5) * 0.9) / BREAKERS));
		const reach = 8 + next() * 47;
		const offshore = 18 + next() * 26;
		const period = 10 + next() * 14;
		const duty = 0.65 + next() * 0.25;
		const phase = next();
		const start = next() * (1 - duty);
		const lead = -9 + next() * 18;
		const bow = -5 + next() * 10;
		const width = 5 + next() * 9;
		const lift = 0.1 + next() * 0.18;
		const strength = 0.7 + next() * 0.3;
		const seed = next() * 40;
		// A crest keeps inside the sand's bearings, and alternate crests lean opposite ways, so
		// neighbouring lines cross rather than run parallel.
		const room = Math.min(place, 1 - place) * 2 * arc + 12;
		const length = Math.min(reach, room);
		const lean = c % 2 === 0 ? 1 : -1;
		const sweep = (lean * length) / (BAY.radius - 40);
		const count = Math.max(4, Math.round(length / 2.5));
		const angle = BAY.from + BAY.sweep * place - sweep * 0.5;
		const first = vertices;
		const heights = steps;
		for (let k = 0; k <= count; k++)
			for (let w = 0; w <= BREAKER_ACROSS; w++)
				// The lace is carried with the crest, so its pattern moves with the breaker rather than
				// sliding over it, and each crest carries its own part of the map.
				uvs.push((k * 2.4 + seed) / FOAM_TILE, (w * 1.6) / FOAM_TILE);
		for (let k = 0; k < count; k++)
			for (let w = 0; w < BREAKER_ACROSS; w++) {
				const at = first + k * (BREAKER_ACROSS + 1) + w;
				indices.push(at, at + 1, at + BREAKER_ACROSS + 1);
				indices.push(at + 1, at + BREAKER_ACROSS + 2, at + BREAKER_ACROSS + 1);
			}
		vertices += (count + 1) * (BREAKER_ACROSS + 1);
		steps += count + 1;
		crests.push({
			heights,
			first,
			steps: count,
			angle,
			sweep,
			offshore,
			period,
			phase,
			duty,
			start,
			lead,
			bow,
			width,
			lift,
			strength,
			seed,
		});
	}
	const positions = new Float32Array(vertices * 3);
	const colors = new Float32Array(vertices * 4);
	const heights = new Float32Array(steps);
	const update = (t: number, resample: boolean): void => {
		for (const crest of crests) {
			// A crest comes in from its own distance offshore, white as it gathers, and dies away as it
			// reaches the sand. Each keeps its own run and time, so the lines never arrive together.
			const cycle = (crest.phase + t / crest.period) % 1;
			const q = Math.min(1, Math.max(0, (cycle - crest.start) / crest.duty));
			const fade = smoothstep01(q, 0, 0.22) * (1 - smoothstep01(q, 0.78, 1));
			const r0 = BAY.radius - 3 - crest.offshore * (1 - q);
			for (let k = 0; k <= crest.steps; k++) {
				const u = k / crest.steps;
				const a = crest.angle + crest.sweep * u;
				const [cx, cz] = [Math.cos(a), Math.sin(a)];
				// The crest fades at both ends, and its body swells and thins along its own length.
				const ends = Math.min(1, Math.sin(u * Math.PI) * 2.4);
				const lump = 0.6 + 0.4 * noise.fbm2(a * 9 + crest.seed, 4.5, 2);
				// One end leads the other and the middle bows, so no two crests lie on one ring. The
				// wander and the noise tear the line into white patches.
				const skew = crest.lead * (2 * u - 1) + crest.bow * Math.sin(u * Math.PI);
				const wander = 3.5 * noise.fbm2(a * 7 + crest.seed, q * 5 + t * 0.04, 2);
				const patches = smoothstep01(noise.fbm2(a * 22 + crest.seed * 3, t * 0.09, 2), -0.4, 0.15);
				const centre = r0 - skew - wander;
				const at = crest.first + k * (BREAKER_ACROSS + 1);
				if (resample)
					heights[crest.heights + k] = ocean.heightAt(BAY.x + cx * centre, BAY.z + cz * centre);
				const water = heights[crest.heights + k] as number;
				const across = crest.width * lump;
				for (let w = 0; w <= BREAKER_ACROSS; w++) {
					const f = w / BREAKER_ACROSS;
					// White water runs from the raised lip back over the seaward face, and a thin surge
					// reaches ahead of it. The lip itself is a narrow, bright ridge.
					const body = smoothstep01(f, 0, BREAKER_LIP) * (1 - smoothstep01(f, BREAKER_LIP, 1));
					const ridge = Math.exp(-(((f - BREAKER_LIP) / 0.18) ** 2));
					const profile = Math.min(1, 0.8 * body + 0.45 * ridge);
					const rr = centre + (f - BREAKER_LIP) * across;
					const vertex = (at + w) * 3;
					positions[vertex] = BAY.x + cx * rr;
					positions[vertex + 1] = water + 0.06 + profile * crest.lift * fade;
					positions[vertex + 2] = BAY.z + cz * rr;
					const alpha = ends * fade * crest.strength * profile * (0.75 + 0.25 * patches);
					colors[(at + w) * 4] = 1;
					colors[(at + w) * 4 + 1] = 1;
					colors[(at + w) * 4 + 2] = 1;
					colors[(at + w) * 4 + 3] = Math.min(1, alpha);
				}
			}
		}
	};
	update(0, true);
	return {
		// The vertices move in every frame, so the mesh plans no levels.
		mesh: { positions, colors, uvs, indices, computeNormals: true, levels: false },
		positions,
		colors,
		update,
	};
}

/** The shore's foam, its arrays, and the call that moves it with the water. */
interface ShoreFoam {
	readonly mesh: MeshArrays;
	readonly positions: Float32Array;
	readonly colors: Float32Array;
	update(t: number): void;
}

/**
 * The shore's foam: a lace line that stands where the swash's front reaches the sand. The front runs
 * up the beach and drains back with the water's height, and its crest travels along the shore, so no
 * two parts of the beach stand at the same stage of the wave. The lace covers the wet sand up to the
 * swash's reach, breaks into threads and gaps, and thins over the deeper water offshore.
 */
function shoreFoam(ocean: Ocean): ShoreFoam {
	const noise = new Noise(431);
	const count = (FOAM_STEPS + 1) * (FOAM_ACROSS + 1);
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 4);
	const uvs: number[] = [];
	const indices: number[] = [];
	const ground = new Float32Array(count);
	const reach = new Float32Array(FOAM_STEPS + 1);
	for (let k = 0; k <= FOAM_STEPS; k++) {
		const a = BAY.from + (BAY.sweep * k) / FOAM_STEPS;
		const [cx, cz] = [Math.cos(a), Math.sin(a)];
		reach[k] = FOAM_WIDTH * (0.65 + 0.5 * noise.fbm2(a * 14, 2.5, 3));
		for (let w = 0; w <= FOAM_ACROSS; w++) {
			const f = w / FOAM_ACROSS;
			const r = BAY.radius + FOAM_ON_SAND - f * ((reach[k] as number) + FOAM_ON_SAND);
			const [x, z] = [BAY.x + cx * r, BAY.z + cz * r];
			const at = k * (FOAM_ACROSS + 1) + w;
			positions[at * 3] = x;
			positions[at * 3 + 1] = SEA_LEVEL;
			positions[at * 3 + 2] = z;
			ground[at] = groundHeight(x, z) - SEA_LEVEL;
			uvs.push((a * BAY.radius) / FOAM_TILE, r / FOAM_TILE);
		}
		if (k < FOAM_STEPS)
			for (let w = 0; w < FOAM_ACROSS; w++) {
				const at = k * (FOAM_ACROSS + 1) + w;
				indices.push(at, at + 1, at + FOAM_ACROSS + 1);
				indices.push(at + 1, at + FOAM_ACROSS + 2, at + FOAM_ACROSS + 1);
			}
	}
	const update = (t: number): void => {
		for (let k = 0; k <= FOAM_STEPS; k++) {
			const a = BAY.from + (BAY.sweep * k) / FOAM_STEPS;
			const [cx, cz] = [Math.cos(a), Math.sin(a)];
			const ends = Math.min(1, Math.sin((k / FOAM_STEPS) * Math.PI) * 8);
			// The swash runs up the sand and drains back, and its crest travels along the shore.
			const pulse = 0.5 + 0.5 * Math.sin(a * 2.3 - t * 0.5 + noise.fbm2(a * 4, 1.5, 2) * 5);
			const runup = 0.08 + (SWASH_REACH - 0.08) * pulse * (0.6 + 0.4 * noise.fbm2(a * 7, 7.5, 2));
			// The water's height at the band's two edges tilts the sheet with the swell.
			const inner = BAY.radius + FOAM_ON_SAND;
			const outer = BAY.radius - 0.5 * ((reach[k] as number) + FOAM_ON_SAND);
			const waterIn = ocean.heightAt(BAY.x + cx * inner, BAY.z + cz * inner) - SEA_LEVEL;
			const waterOut = ocean.heightAt(BAY.x + cx * outer, BAY.z + cz * outer) - SEA_LEVEL;
			// The lace breaks into threads and gaps along the shore.
			const lace = 0.45 + 0.55 * smoothstep01(noise.fbm2(a * 34 + t * 0.05, 5.5, 2), -0.4, 0.4);
			for (let w = 0; w <= FOAM_ACROSS; w++) {
				const f = w / FOAM_ACROSS;
				const at = k * (FOAM_ACROSS + 1) + w;
				const water = waterIn + (waterOut - waterIn) * f;
				const above = (ground[at] as number) - water;
				// A bright line at the swash's front, a lace sheet over the wet sand that ends at its
				// reach, and a thinner wash that fades over the depth offshore.
				const line = 1 - smoothstep01(Math.abs(above), 0.04, 0.28);
				const sheet = 1 - smoothstep01(above, -0.35, Math.max(0.12, runup));
				const wash = smoothstep01(-above, 0.1, 0.5) * (1 - smoothstep01(-above, 2, 5.5));
				positions[at * 3 + 1] = SEA_LEVEL + Math.max(water, ground[at] as number) + 0.06;
				colors[at * 4] = 1;
				colors[at * 4 + 1] = 1;
				colors[at * 4 + 2] = 1;
				colors[at * 4 + 3] = Math.min(1, ends * lace * (0.95 * line + 0.4 * sheet + 0.3 * wash));
			}
		}
	};
	update(0);
	return {
		// The vertices move in every frame, so the mesh plans no levels.
		mesh: { positions, colors, uvs, indices, computeNormals: true, levels: false },
		positions,
		colors,
		update,
	};
}

/** Makes the sea, and returns the call that keeps its surface and its surf up to date. */
export function createSea(ctx: SketchContext, camera: Camera): { update(): void } {
	// Deep water scatters blue light up from within. The bed fades into that colour as it falls away, so
	// clear water shows no rock or empty space in the deep, and no line where the fade ends.
	ctx.scene.createMesh({
		mesh: ctx.geometry.fromArrays(deepBed()),
		material: ctx.materials.standard({
			vertexColors: true,
			roughness: 0.9,
			metalness: 0,
		}),
		castShadows: false,
		receiveShadows: false,
	});
	ctx.scene.createMesh({
		mesh: ctx.geometry.fromArrays(openSea(0, SEA_REACH, DEEP_FLOOR - DEEP_LIFT + 0.2)),
		material: ctx.materials.standard({
			color: DEEP_COLOR_HEX,
			roughness: 0.9,
			metalness: 0,
			doubleSided: true,
		}),
		castShadows: false,
		receiveShadows: false,
	});
	const detail = OCEAN_DETAIL[ctx.quality.preset];
	const ocean = createOcean(ctx, {
		camera,
		level: SEA_LEVEL,
		bands: BAY_BANDS,
		reach: detail.reach,
		segments: detail.segments,
		foam: CREST_FOAM,
		// The water fades over the last couple of meters of depth, so its edge lies against the bed.
		softness: 2.5,
		reflectionScale: 0.5,
		// The mirror leaves out the surf, which lies on the water and would show only its underside.
		layers: 1,
		// The route's camera always moves, and an old reflection lags behind the boats that it mirrors.
		reflectionEvery: { high: 1, ultra: 1 },
		// Keep that cadence fixed: the governor would trade it for time and the mirror would lag.
		reflectionFollowsBudget: false,
		material: {
			// The clear water lets the bed through; the attenuation gives the sea its own colour.
			color: '#ffffff',
			// Clear Mediterranean water: the shelf's bed shows through as teal, and the deep lifts to navy.
			attenuationColor: '#175a78',
			attenuationDistance: 10,
		},
	});
	const foam = shoreFoam(ocean);
	const lace = foamMap(ctx);
	const foamGeometry = ctx.geometry.fromArrays(foam.mesh);
	const foamMesh = ctx.scene.createMesh({
		mesh: foamGeometry,
		material: ctx.materials.standard({
			map: lace,
			vertexColors: true,
			roughness: 0.9,
			alphaMode: 'blend',
			// The foam and the surf cross each other, so neither hides the other.
			depthWrite: false,
			doubleSided: true,
		}),
		castShadows: false,
		receiveShadows: true,
		// The mirror holds no foam: it lies on the water and shows only its dark underside there.
		layers: INTERIOR_LAYER,
	});
	const surf = breakers(ocean);
	const surfGeometry = ctx.geometry.fromArrays(surf.mesh);
	const surfMesh = ctx.scene.createMesh({
		mesh: surfGeometry,
		material: ctx.materials.standard({
			map: lace,
			vertexColors: true,
			roughness: 0.85,
			alphaMode: 'blend',
			depthWrite: false,
			doubleSided: true,
		}),
		castShadows: false,
		receiveShadows: true,
		// The mirror holds no foam: it lies on the water and shows only its dark underside there.
		layers: INTERIOR_LAYER,
	});
	// The surf's vertices move over the whole bay, so the bounds that the mesh was made with do not
	// hold them. The bounds cover the bay that the crests run across.
	const centre: [number, number, number] = [BAY.x, SEA_LEVEL, BAY.z];
	const radius = BAY.radius + 40;
	foamMesh.setBounds(centre, radius);
	surfMesh.setBounds(centre, radius);
	let read = 0;
	return {
		update() {
			ocean.update();
			const t = ctx.time.now;
			// The crests cross the bay at a few meters a second, so their places follow every frame. The
			// ocean's heights cost a transform of its spectra, so they are read at a slower rate, and the
			// crests keep the height of the place they stood at until the next read.
			const resample = t - read >= HEIGHT_STEP;
			if (resample) read = t;
			surf.update(t, resample);
			surfGeometry.updateVertices('positions', surf.positions);
			surfGeometry.updateVertices('colors', surf.colors);
			if (!resample) return;
			foam.update(t);
			foamGeometry.updateVertices('positions', foam.positions);
			foamGeometry.updateVertices('colors', foam.colors);
		},
	};
}

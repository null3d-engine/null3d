// The sea around the island. Its water comes from the water add-on, as one wide still body whose
// surface the island breaks, so the shore fades against the real ground and thin foam shows where
// the water thins. Everything the scene knows about the sea stays in this module, so a body of
// another kind can take its place by changing this file alone.
import type { SketchContext } from '@null3d/engine';
import { createWater, type WaterShape } from '@null3d/water';
import { INTERIOR_LAYER } from '../../lib/layers';
import { Noise, random } from '../../lib/procedural';
import { BAY, GROUND, SEA_LEVEL, sandyBed } from './island';
import { groundHeight } from './plan';

/** How far the sea reaches from the island's middle, in meters: past the horizon's haze. */
export const SEA_REACH = 40000;
/** The sides of the sea's outline. */
const SIDES = 96;
/** The meters between two lines of the sea's grid: the water is flat, and a fine grid has no use. */
const CELL = 600;
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
const FOAM_ON_SAND = 1.5;
/** The meters of the shore's foam that one copy of its lace covers. */
const FOAM_TILE = 11;

/** The sea's one body. */
const SEA: WaterShape = {
	kind: 'lake',
	shore: Array.from({ length: SIDES }, (_, k) => {
		const bearing = (k / SIDES) * Math.PI * 2;
		return [Math.cos(bearing) * SEA_REACH, Math.sin(bearing) * SEA_REACH] as [number, number];
	}),
	depth: 40,
	shoreWidth: 60,
};

/** A flat ring between two reaches, at a depth under the sea's level. */
function openSea(from: number, to: number, depth: number) {
	const sides = 96;
	const positions: number[] = [];
	const indices: number[] = [];
	for (let k = 0; k <= sides; k++) {
		const bearing = (k / sides) * Math.PI * 2;
		const [x, z] = [Math.cos(bearing), Math.sin(bearing)];
		positions.push(x * from, SEA_LEVEL - depth, z * from);
		positions.push(x * to, SEA_LEVEL - depth, z * to);
		if (k < sides) {
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
 * The breakers across the bay: separate soft crest lines that follow the sand's curve, staggered, whitest
 * close in and gone by the outer bay, with thin lacy foam lying between them. Each is a low hump of foam
 * whose alpha thins at its edges and ends, and the map's lace breaks it up softly.
 */
function surf() {
	const positions: number[] = [];
	const colors: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const next = random(211);
	const noise = new Noise(211);
	const across = 6;
	const crests = 90;
	const lines = [6, 16, 28, 42, 58, 76];
	for (let c = 0; c < crests; c++) {
		// The crests keep to lines a set way off the sand, so they read as breakers coming in.
		const line = c % lines.length;
		const offset = (lines[line] as number) + next() * 3;
		const out = offset / 90;
		const length = 40 + next() * 110 * (1 - out * 0.5);
		const width = (3 + next() * 4) * (1.3 - out * 0.8);
		const strength = (1 - smoothstep01(offset, 30, 90)) * 0.85 + 0.15;
		const r = BAY.radius - offset;
		const sweep = length / r;
		const start = BAY.from + BAY.sweep * (0.05 + next() * 0.9) - sweep / 2;
		const steps = Math.ceil(length / 2.5);
		const first = positions.length / 3;
		for (let k = 0; k <= steps; k++) {
			const t = k / steps;
			const a = start + sweep * t;
			const [cx, cz] = [Math.cos(a), Math.sin(a)];
			const wander = 2.5 * noise.fbm2(a * 11 + c, offset * 0.04, 2);
			const ends = Math.min(1, Math.sin(t * Math.PI) * 1.8);
			const thick = width * (0.6 + 0.4 * ends) * (0.8 + 0.4 * noise.value2(k * 0.3, c));
			for (let w = 0; w <= across; w++) {
				const f = w / across;
				const rr = r - wander - (f - 0.5) * thick;
				const hump = Math.sin(f * Math.PI);
				positions.push(BAY.x + cx * rr, SEA_LEVEL + 0.08 + hump * 0.12 * strength, BAY.z + cz * rr);
				colors.push(1, 1, 1, Math.min(1, hump * ends * strength * 1.1));
				uvs.push((a * r) / 15, rr / 15);
			}
			if (k < steps)
				for (let w = 0; w < across; w++) {
					const at = first + k * (across + 1) + w;
					indices.push(at, at + 1, at + across + 1, at + 1, at + across + 2, at + across + 1);
				}
		}
	}
	return { positions, colors, uvs, indices, computeNormals: true };
}

/**
 * A skin over the seabed from where it starts to fall away: it takes the bed's colour where it begins and
 * the deep's colour by the floor, so the rock fades into the deep with no edge.
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

/**
 * The shore's foam: lace along the bay's sand, thickest at the sand and breaking up over the first meters
 * of water, cut by its map so the water still draws through its gaps.
 */
function shoreFoam() {
	const positions: number[] = [];
	const colors: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const noise = new Noise(431);
	const across = 8;
	const steps = 420;
	for (let k = 0; k <= steps; k++) {
		const a = BAY.from + (BAY.sweep * k) / steps;
		const [cx, cz] = [Math.cos(a), Math.sin(a)];
		const ends = Math.min(1, Math.sin((k / steps) * Math.PI) * 6);
		const reach = FOAM_WIDTH * (0.65 + 0.5 * noise.fbm2(a * 14, 2.5, 3));
		for (let w = 0; w <= across; w++) {
			const f = w / across;
			const r = BAY.radius + FOAM_ON_SAND - f * (reach + FOAM_ON_SAND);
			positions.push(BAY.x + cx * r, SEA_LEVEL + 0.05, BAY.z + cz * r);
			colors.push(1, 1, 1, ends * (1 - f) ** 1.5);
			uvs.push((a * BAY.radius) / FOAM_TILE, r / FOAM_TILE);
		}
		if (k < steps)
			for (let w = 0; w < across; w++) {
				const at = k * (across + 1) + w;
				indices.push(at, at + 1, at + across + 1, at + 1, at + across + 2, at + across + 1);
			}
	}
	return { positions, colors, uvs, indices, computeNormals: true };
}

/** A smooth step from 0 at one value to 1 at another. */
function smoothstep01(v: number, from: number, to: number): number {
	const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
	return t * t * (3 - 2 * t);
}

/** Makes the sea, and returns the call that keeps its reflection up to date. */
export function createSea(ctx: SketchContext): { update(): void } {
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
	ctx.scene.createMesh({
		mesh: ctx.geometry.fromArrays(shoreFoam()),
		material: ctx.materials.standard({
			map: foamMap(ctx),
			vertexColors: true,
			roughness: 0.9,
			alphaMode: 'blend',
			doubleSided: true,
		}),
		castShadows: false,
		receiveShadows: true,
		// The mirror holds no foam: it lies on the water and shows only its dark underside there.
		layers: INTERIOR_LAYER,
	});
	// The foam blends in the moment layer, which draws over the water with no sorting, so its edges stay soft.
	// Its shape stays here with the sea, so another body that makes its own surf replaces it.
	ctx.scene.createMesh({
		mesh: ctx.geometry.fromArrays(surf()),
		material: ctx.materials.standard({
			map: foamMap(ctx),
			vertexColors: true,
			roughness: 0.85,
			alphaMode: 'blend',
			doubleSided: true,
		}),
		castShadows: false,
		receiveShadows: true,
		// The mirror holds no foam: it lies on the water and shows only its dark underside there.
		layers: INTERIOR_LAYER,
	});
	return createWater(ctx, {
		shapes: SEA,
		level: SEA_LEVEL,
		mesh: { cell: CELL },
		// Clear Mediterranean water: the shelf's bed shows through as teal, and the deep lifts to navy.
		ripple: 0.45,
		// The reflection is soft on rippled water, so a coarser one shows no less. It draws every frame at
		// High and Ultra, since a crisp mast steps visibly at a slower cadence while the camera moves.
		// Low keeps the add-on's default of every second frame: a cadence of four still draws a dark
		// sea on the software WebGL2 path, with the held-frame fix in place.
		reflectionScale: 0.5,
		layers: 1,
		reflectionEvery: { high: 1, ultra: 1 },
		// The route's camera always moves, and an old reflection lags behind the boats that it mirrors.
		reflectionFollowsBudget: false,
		softness: 2.5,
		colorAlongView: 1,
		material: {
			// A weak bend: screen-space refraction takes its light from the picture above the water, so a
			// strong one draws a band of the rocks' lit faces around their feet.
			ior: 1.02,
			attenuationColor: '#2b86a8',
			attenuationDistance: 14,
			thickness: 1,
		},
	});
}

// The moor of the sound demo, made in code: low rolling land under a ring of far hills, a ring of
// standing stones in the middle, and a brook that winds across the moor past them. The brook gives
// two things: a flat ribbon of water to draw, and the points along it that its sound comes from.
import { type Mesh, math, quat, type SketchContext } from '@null3d/engine';
import { ringLandArrays } from '../lib/land';

/** How far the land reaches from the stones, in meters: past the farthest strike. */
const LAND_REACH = 3200;
/** How far the brook runs either side of the stones, in meters. */
const BROOK_REACH = 420;
/** The brook's width, in meters. */
const BROOK_WIDTH = 2.6;
/** How far the water lies above the land at the brook's middle line, in meters. */
const WATER_ABOVE = 0.12;

/** The brook's middle line: its z at each x, in meters. It passes the stones on their camera side. */
export const brookZ = (x: number): number => 12 + 7 * Math.sin(x / 31) + 3 * Math.sin(x / 11 + 1);

/** The land's height at a point: low rolls, the brook's shallow bed, and the far ring of hills. */
export function moorHeight(x: number, z: number): number {
	const d = Math.hypot(x, z);
	const roll =
		1.4 * Math.sin(x * 0.021 + 0.7) * Math.cos(z * 0.017) + 0.8 * Math.sin((x + z) * 0.043);
	const bed = 0.5 * Math.exp(-(((z - brookZ(x)) / 4) ** 2)) * (1 - math.smoothstep(d, 300, 500));
	const a = Math.atan2(z, x);
	const hills = 110 + 70 * Math.sin(a * 3 + 1) + 30 * Math.sin(a * 8);
	return roll - bed + math.smoothstep(d, 700, 2600) * hills;
}

/** The land's arrays: dark heather and grass, darker and wetter along the brook. */
function moorArrays() {
	return ringLandArrays({
		far: LAND_REACH,
		rings: 140,
		around: 160,
		spacing: 2.3,
		tile: 4,
		height: moorHeight,
		color: (x, z) => {
			const heather = 0.5 + 0.5 * Math.sin(x * 0.05 + 2) * Math.sin(z * 0.04 - 1);
			const wet = Math.exp(-(((z - brookZ(x)) / 7) ** 2));
			const mix = (grass: number, bloom: number, mud: number) =>
				(grass * (1 - heather) + bloom * heather) * (1 - 0.6 * wet) + mud * 0.6 * wet;
			return [mix(0.12, 0.17, 0.04), mix(0.15, 0.1, 0.05), mix(0.08, 0.11, 0.045)];
		},
	});
}

/** The brook's water: a flat ribbon along its middle line, its triangles facing up. */
function brookArrays() {
	const positions: number[] = [];
	const indices: number[] = [];
	const half = BROOK_WIDTH / 2;
	for (let x = -BROOK_REACH, k = 0; x <= BROOK_REACH; x += 2, k++) {
		const z = brookZ(x);
		const y = moorHeight(x, z) + WATER_ABOVE;
		// The way across the water, square to its course.
		const slope = (brookZ(x + 0.5) - brookZ(x - 0.5)) / 1;
		const across = half / Math.hypot(1, slope);
		positions.push(x + slope * across, y, z - across, x - slope * across, y, z + across);
		if (k > 0) indices.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k);
	}
	return { positions, indices, computeNormals: true };
}

/** The places that the brook's sound comes from: one every `step` meters along its course. */
export function brookPoints(step: number): Float32Array {
	const count = Math.floor((2 * BROOK_REACH) / step) + 1;
	const points = new Float32Array(count * 3);
	for (let k = 0; k < count; k++) {
		const x = -BROOK_REACH + k * step;
		const z = brookZ(x);
		points.set([x, moorHeight(x, z) + WATER_ABOVE, z], k * 3);
	}
	return points;
}

/** The standing stones: nine in a ring, each with its height, its lean and its turn. */
const STONES = Array.from({ length: 9 }, (_, k) => {
	const angle = (k / 9) * Math.PI * 2 + 0.3;
	const radius = 8 + 0.6 * Math.sin(k * 2.3);
	return {
		x: Math.cos(angle) * radius,
		z: Math.sin(angle) * radius,
		height: 2.1 + 1.2 * ((k * 0.618) % 1),
		lean: 0.12 * Math.sin(k * 1.7),
		turn: -angle,
	};
});

/** Builds the moor, the brook's water and the stones, and returns the land, which a click strikes. */
export function buildMoor(ctx: SketchContext): Mesh {
	const { scene, geometry, materials } = ctx;
	const ground = scene.createMesh({
		mesh: geometry.fromArrays(moorArrays()),
		material: materials.standard({ vertexColors: true, roughness: 0.95 }),
	});
	scene.createMesh({
		mesh: geometry.fromArrays(brookArrays()),
		material: materials.standard({ color: '#14202c', roughness: 0.06 }),
	});
	const stone = materials.standard({ color: '#8c877f', roughness: 0.88 });
	for (const { x, z, height, lean, turn } of STONES)
		scene.createMesh({
			mesh: geometry.box({ width: 1.2, height, depth: 0.6 }),
			material: stone,
			position: [x, moorHeight(x, z) + height / 2 - 0.3, z],
			rotation: quat.fromEuler(quat.create(), lean, turn, 0, 'YXZ'),
		});
	return ground;
}

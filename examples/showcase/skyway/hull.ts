// The hover car that both the traffic and the hero car are made from: a hull lofted through four
// sections, with a low canopy. It is built in code once, and every car of the traffic draws it.
import type { MeshGeometry, SketchContext } from '@null3d/engine';

/**
 * A hover car's hull. Its nose points along local +Z, its belly sits just above y = 0, and its
 * canopy rises to about y = 1.1. A shader that paints only the lights can tell the parts apart by
 * their place in this space.
 */
export function carHull(ctx: SketchContext): MeshGeometry {
	const { geometry } = ctx;
	const positions: number[] = [];
	const indices: number[] = [];
	/** Adds a quad as two triangles from four corners, wound from the outside. */
	const quad = (
		a: readonly number[],
		b: readonly number[],
		c: readonly number[],
		d: readonly number[],
	) => {
		const first = positions.length / 3;
		positions.push(...a, ...b, ...c, ...d);
		indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
	};
	// The hull is a loft through four sections: a narrow tail, a wide middle, a wide front and a
	// narrow nose. Each section is a rectangle from the belly to its own roofline.
	const sections = [
		{ z: -2.0, half: 0.74, top: 0.54 },
		{ z: -1.2, half: 0.96, top: 0.84 },
		{ z: 1.2, half: 0.9, top: 0.74 },
		{ z: 2.0, half: 0.52, top: 0.38 },
	];
	const belly = 0.12;
	const corners = (s: (typeof sections)[number]): number[][] => [
		[-s.half, belly, s.z],
		[s.half, belly, s.z],
		[s.half, s.top, s.z],
		[-s.half, s.top, s.z],
	];
	for (let k = 0; k < sections.length - 1; k++) {
		const a = corners(sections[k] as (typeof sections)[number]);
		const b = corners(sections[k + 1] as (typeof sections)[number]);
		quad(a[0], a[1], b[1], b[0]);
		quad(a[3], b[3], b[2], a[2]);
		quad(a[0], b[0], b[3], a[3]);
		quad(a[1], a[2], b[2], b[1]);
	}
	const tail = corners(sections[0] as (typeof sections)[number]);
	const nose = corners(sections[sections.length - 1] as (typeof sections)[number]);
	quad(tail[0], tail[3], tail[2], tail[1]);
	quad(nose[0], nose[1], nose[2], nose[3]);
	// The canopy: a low ridge from the windshield back to the rear deck.
	quad([-0.42, 0.84, 1.0], [0.42, 0.84, 1.0], [0.34, 1.1, 0.1], [-0.34, 1.1, 0.1]);
	quad([-0.34, 1.1, 0.1], [0.34, 1.1, 0.1], [0.36, 1.05, -0.9], [-0.36, 1.05, -0.9]);
	quad([-0.42, 0.84, 1.0], [-0.34, 1.1, 0.1], [-0.36, 1.05, -0.9], [-0.44, 0.8, -1.0]);
	quad([0.42, 0.84, 1.0], [0.44, 0.8, -1.0], [0.36, 1.05, -0.9], [0.34, 1.1, 0.1]);
	// A material with a surface function draws only a mesh that has texture coordinates, whatever
	// the function reads, so the hull carries a simple pair along its side and its height.
	const uvs = new Float32Array((positions.length / 3) * 2);
	for (let k = 0; k < positions.length / 3; k++) {
		uvs[k * 2] = ((positions[k * 3] as number) + 1) * 0.5;
		uvs[k * 2 + 1] = positions[k * 3 + 1] as number;
	}
	return geometry.fromArrays({
		positions: new Float32Array(positions),
		uvs,
		indices: new Uint32Array(indices),
		computeNormals: true,
	});
}

// Branches as generalized cylinders: each branch is a tube along its curved path, with rings of
// vertices whose radius follows the pipe model. The trunk's base flares where it meets the ground.
// Every vertex carries the branch's wind index, its stiffness and the crown's occlusion.
import { MeshBuilder, type PartArrays, type VertexWind } from './builder';
import { type CrownField, occlusionByte } from './crown';
import { type WoodDetail, woodError } from './levels';
import type { Skeleton, SkeletonBranch } from './skeleton';
import type { Species } from './species';

/** The samples that a branch keeps at a detail level: every `step`-th, and always the last. */
function ringsOf(branch: SkeletonBranch, step: number): number[] {
	const samples = branch.points.length / 3;
	const rings: number[] = [];
	for (let i = 0; i < samples; i += step) rings.push(i);
	if (rings[rings.length - 1] !== samples - 1) rings.push(samples - 1);
	return rings;
}

/** The direction of a branch's sample, from the samples either side of it. */
function tangentAt(branch: SkeletonBranch, index: number): [number, number, number] {
	const samples = branch.points.length / 3;
	const a = Math.max(0, index - 1) * 3;
	const b = Math.min(samples - 1, index + 1) * 3;
	const x = (branch.points[b] as number) - (branch.points[a] as number);
	const y = (branch.points[b + 1] as number) - (branch.points[a + 1] as number);
	const z = (branch.points[b + 2] as number) - (branch.points[a + 2] as number);
	const length = Math.hypot(x, y, z);
	return length > 1e-9 ? [x / length, y / length, z / length] : [0, 1, 0];
}

/** The stiffness byte of a level, from its record. */
function stiffnessByte(species: Species, level: number): number {
	const values = species.wind.stiffness;
	const value = values[Math.min(level, values.length - 1)] ?? values[0] ?? 0;
	return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

/**
 * Builds one level's wood: every branch as a tube with the level's rings and sides.
 *
 * @param species The species record.
 * @param skeleton The plant's skeleton.
 * @param detail The level's wood detail.
 * @param crown The crown field, which darkens the wood inside it.
 * @param branchLimit The branches that the wind table names, which the vertex bytes hold.
 * @returns The wood part's arrays, and the largest distance that the level's surface misses by.
 * @category api/vegetation
 */
export function buildWood(
	species: Species,
	skeleton: Skeleton,
	detail: WoodDetail,
	crown: CrownField,
	branchLimit: number,
): { part: PartArrays; error: number } {
	const builder = new MeshBuilder();
	// The tubes' exact size, so the arrays grow once.
	let vertices = 0;
	let triangles = 0;
	for (const branch of skeleton.branches) {
		const rings = ringsOf(branch, detail.ringStep);
		const sides = Math.max(3, Math.round(branch.sides * detail.sideScale));
		vertices += rings.length * sides + 1;
		triangles += (rings.length - 1) * sides * 2 + sides;
	}
	builder.reserve(vertices, triangles);
	let error = 0;
	for (const [branchIndex, branch] of skeleton.branches.entries()) {
		const sides = Math.max(3, Math.round(branch.sides * detail.sideScale));
		const rings = ringsOf(branch, detail.ringStep);
		const wind: VertexWind = {
			branch: Math.min(branchLimit - 1, branchIndex),
			flutter: branch.flutter,
			stiffness: stiffnessByte(species, branch.level),
			occlusion: 0,
		};
		// The branch's first vertex, which its triangles count from.
		const first = builder.vertexCount;
		let along = 0;
		let previousX = Number.NaN;
		let previousY = Number.NaN;
		let previousZ = Number.NaN;
		// The ring's first axis is carried from one ring to the next, so that a branch that passes
		// through the vertical does not twist its tube by half a turn.
		let carriedX = 0;
		let carriedY = 0;
		let carriedZ = 0;
		for (const [r, sample] of rings.entries()) {
			const at = sample * 3;
			const cx = branch.points[at] as number;
			const cy = branch.points[at + 1] as number;
			const cz = branch.points[at + 2] as number;
			if (!Number.isNaN(previousX))
				along += Math.hypot(cx - previousX, cy - previousY, cz - previousZ);
			previousX = cx;
			previousY = cy;
			previousZ = cz;
			// The tangent, the ring's two axes and the radius, worked out without allocation.
			const a = Math.max(0, sample - 1) * 3;
			const b = Math.min(branch.points.length / 3 - 1, sample + 1) * 3;
			let tx = (branch.points[b] as number) - (branch.points[a] as number);
			let ty = (branch.points[b + 1] as number) - (branch.points[a + 1] as number);
			let tz = (branch.points[b + 2] as number) - (branch.points[a + 2] as number);
			const tangentLength = Math.hypot(tx, ty, tz) || 1;
			tx /= tangentLength;
			ty /= tangentLength;
			tz /= tangentLength;
			let sx: number;
			let sy: number;
			let sz: number;
			if (r === 0) {
				sx = -tz;
				sy = 0;
				sz = tx;
				let length = Math.hypot(sx, sy, sz);
				if (length < 1e-6) {
					sx = 1;
					sy = 0;
					sz = 0;
					length = 1;
				}
				sx /= length;
				sy /= length;
				sz /= length;
			} else {
				// The carried axis, made perpendicular to the new tangent again.
				const projection = carriedX * tx + carriedY * ty + carriedZ * tz;
				sx = carriedX - tx * projection;
				sy = carriedY - ty * projection;
				sz = carriedZ - tz * projection;
				let length = Math.hypot(sx, sy, sz);
				if (length < 1e-6) {
					sx = -tz;
					sy = 0;
					sz = tx;
					length = Math.hypot(sx, sy, sz) || 1;
				}
				sx /= length;
				sy /= length;
				sz /= length;
			}
			carriedX = sx;
			carriedY = sy;
			carriedZ = sz;
			// The ring's second axis, so that (side, normal, tangent) is right-handed.
			const nx = ty * sz - tz * sy;
			const ny = tz * sx - tx * sz;
			const nz = tx * sy - ty * sx;
			const radius = branch.radii[sample] as number;
			wind.occlusion = occlusionByte(cx, cy, cz, crown);
			for (let j = 0; j < sides; j++) {
				const angle = (j / sides) * Math.PI * 2;
				const cos = Math.cos(angle);
				const sin = Math.sin(angle);
				const rx = sx * cos + nx * sin;
				const ry = sy * cos + ny * sin;
				const rz = sz * cos + nz * sin;
				builder.vertex(
					cx + rx * radius,
					cy + ry * radius,
					cz + rz * radius,
					rx,
					ry,
					rz,
					j / sides,
					along,
					wind,
				);
			}
		}
		const perRing = sides;
		for (let r = 0; r + 1 < rings.length; r++) {
			for (let j = 0; j < sides; j++) {
				const next = (j + 1) % sides;
				const a = first + r * perRing + j;
				const b = first + r * perRing + next;
				const c = first + (r + 1) * perRing + next;
				const d = first + (r + 1) * perRing + j;
				builder.triangle(a, b, c);
				builder.triangle(a, c, d);
			}
		}
		// A tip cap closes the tube, so a bare twig shows no hole.
		const last = rings[rings.length - 1] as number;
		const tipAt = last * 3;
		const [tx, ty, tz] = tangentAt(branch, last);
		wind.occlusion = occlusionByte(
			branch.points[tipAt] as number,
			branch.points[tipAt + 1] as number,
			branch.points[tipAt + 2] as number,
			crown,
		);
		const tip = builder.vertex(
			(branch.points[tipAt] as number) + tx * 0.01,
			(branch.points[tipAt + 1] as number) + ty * 0.01,
			(branch.points[tipAt + 2] as number) + tz * 0.01,
			tx,
			ty,
			tz,
			0.5,
			along,
			wind,
		);
		const tipRing = first + (rings.length - 1) * perRing;
		for (let j = 0; j < sides; j++) builder.triangle(tipRing + j, tipRing + ((j + 1) % sides), tip);
		const widest = Math.max(...branch.radii);
		error = Math.max(error, woodError(widest, branch.length, sides, rings.length));
	}
	return { part: builder.finish(), error };
}

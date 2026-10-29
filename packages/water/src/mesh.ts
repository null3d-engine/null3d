// The surface's mesh: a strip along a river's middle line, or a grid over a lake's bounds with the
// cells outside its shore left out. Both carry the current in their texture coordinates, so the
// surface shader drifts its ripples and its foam the way the water runs at each point, and the body
// that each vertex belongs to, so the shader knows which pixels of a junction the mesh draws.
import type { MeshArrays } from '@null3d/engine';
import {
	fromShore,
	type LakeShape,
	type RiverShape,
	type WaterBody,
	type WaterShape,
} from './shape';

/** The most meters between two cross sections of a river's mesh. */
const STEP = 2;
/** The cross sections that a river's mesh takes across its width, fine enough for the short waves. */
const ACROSS = 16;
/** The meters between two lines of a lake's mesh grid. */
const CELL = 2;
/**
 * How far past a lake's shore its mesh reaches, in grid cells. A scene's own ground seldom meets the
 * water exactly on the outline, so the surface fades against the bed there rather than ending on
 * the grid's stepped edge.
 */
const SHORE_CELLS = 2;
/** How far past a river's half width its mesh reaches, as a factor, which covers the shore band. */
const REACH = 1.36;

/**
 * How fine a mesh is: the meters along a river, the sections across it, and a lake's grid cell.
 *
 * @category api/water
 */
export interface MeshDetail {
	/** The most meters between two cross sections along a river. It is 2 by default. */
	step?: number;
	/** The sections across a river's width. It is 16 by default. */
	across?: number;
	/** The meters between two lines of a lake's grid. It is 2 by default. */
	cell?: number;
}

/** A mesh's vertices and indices, built into arrays that the add-on fills once. */
interface Builder {
	positions: number[];
	normals: number[];
	uvs: number[];
	uvs1: number[];
	indices: number[];
}

/** A builder with nothing in it. */
function builder(): Builder {
	return { positions: [], normals: [], uvs: [], uvs1: [], indices: [] };
}

/**
 * Adds one vertex and returns its index. The first texture coordinate holds the current's speed and
 * the body's number, counted from 1, which the junction map names as the owner of its texels.
 */
function vertex(
	b: Builder,
	x: number,
	y: number,
	z: number,
	speed: number,
	dx: number,
	dz: number,
	body: number,
): number {
	const index = b.positions.length / 3;
	b.positions.push(x, y, z);
	b.normals.push(0, 1, 0);
	b.uvs.push(speed, body + 1);
	// The current's direction, which the surface function reads from 0 to 1 in each axis.
	b.uvs1.push(dx * 0.5 + 0.5, dz * 0.5 + 0.5);
	return index;
}

/** The mesh arrays that a builder holds. */
function arrays(b: Builder): MeshArrays {
	return {
		positions: new Float32Array(b.positions),
		normals: new Float32Array(b.normals),
		uvs: new Float32Array(b.uvs),
		uvs1: new Float32Array(b.uvs1),
		indices: new Uint32Array(b.indices),
	};
}

/** One cross section of a river's strip. */
interface Section {
	readonly x: number;
	readonly z: number;
	/** The current's direction, as a unit vector. */
	readonly dx: number;
	readonly dz: number;
	readonly halfWidth: number;
}

/** The cross sections of a river, subdivided so that no two lie more than `step` meters apart. */
function sections(shape: RiverShape, step: number): Section[] {
	const sections: Section[] = [];
	const { middle } = shape;
	const width = (index: number) =>
		typeof shape.halfWidth === 'number' ? shape.halfWidth : (shape.halfWidth[index] as number);
	for (let i = 0; i + 1 < middle.length; i++) {
		const [ax, az] = middle[i] as readonly [number, number];
		const [bx, bz] = middle[i + 1] as readonly [number, number];
		const length = Math.hypot(bx - ax, bz - az);
		const dx = (bx - ax) / length;
		const dz = (bz - az) / length;
		const count = Math.max(1, Math.ceil(length / step));
		for (let k = 0; k < count; k++) {
			const share = k / count;
			sections.push({
				x: ax + (bx - ax) * share,
				z: az + (bz - az) * share,
				dx,
				dz,
				halfWidth: width(i) + (width(i + 1) - width(i)) * share,
			});
		}
	}
	const last = middle.length - 1;
	const [lx, lz] = middle[last] as readonly [number, number];
	const [px, pz] = middle[last - 1] as readonly [number, number];
	const length = Math.hypot(lx - px, lz - pz);
	sections.push({
		x: lx,
		z: lz,
		dx: (lx - px) / length,
		dz: (lz - pz) / length,
		halfWidth: width(last),
	});
	return sections;
}

/** The surface's mesh for a river: a strip that follows its middle line, with the current in it. */
function riverMesh(
	shape: RiverShape,
	level: number,
	step: number,
	across: number,
	speed: number,
	body: number,
): MeshArrays {
	const list = sections(shape, step);
	const rows = across + 1;
	const b = builder();
	for (const section of list) {
		// The direction across the current: the current's direction turned a quarter turn.
		const nx = -section.dz;
		const nz = section.dx;
		const reach = section.halfWidth * REACH;
		for (let j = 0; j < rows; j++) {
			const offset = (j / across) * 2 - 1;
			vertex(
				b,
				section.x + nx * offset * reach,
				level,
				section.z + nz * offset * reach,
				speed,
				section.dx,
				section.dz,
				body,
			);
		}
	}
	for (let i = 0; i + 1 < list.length; i++)
		for (let j = 0; j < across; j++) {
			// The vertices run along the river first, then across it, and each triangle faces up.
			const a = i * rows + j;
			b.indices.push(a, a + 1, a + rows, a + 1, a + rows + 1, a + rows);
		}
	return arrays(b);
}

/**
 * The surface's mesh for a lake: a grid over its bounds and a band past them, with the cells that lie
 * outside the band past its shore left out.
 */
function lakeMesh(
	shape: LakeShape,
	body: WaterBody,
	level: number,
	cell: number,
	index: number,
): MeshArrays {
	const reach = SHORE_CELLS * cell;
	const minX = body.minX - reach;
	const minZ = body.minZ - reach;
	const nx = Math.max(1, Math.ceil((body.maxX + reach - minX) / cell));
	const nz = Math.max(1, Math.ceil((body.maxZ + reach - minZ) / cell));
	const dx = (body.maxX + reach - minX) / nx;
	const dz = (body.maxZ + reach - minZ) / nz;
	const b = builder();
	const row = nx + 1;
	// Each grid point that lies over the water, or within the band past the shore.
	const near = new Uint8Array(row * (nz + 1));
	for (let j = 0; j <= nz; j++)
		for (let i = 0; i <= nx; i++) {
			const x = minX + i * dx;
			const z = minZ + j * dz;
			// A lake stills its water, so the surface holds no direction, and the shader ignores both.
			vertex(b, x, level, z, 0, 1, 0, index);
			near[j * row + i] = body.contains(x, z) || fromShore(shape.shore, x, z) < reach ? 1 : 0;
		}
	for (let j = 0; j < nz; j++)
		for (let i = 0; i < nx; i++) {
			// A cell draws when any of its corners lies in the band, so the surface fades against the
			// scene's own bed instead of ending on the grid's line.
			const a = j * row + i;
			if (!near[a] && !near[a + 1] && !near[a + row] && !near[a + row + 1]) continue;
			b.indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
		}
	return arrays(b);
}

/**
 * The surface's mesh for one water body, at the height of its surface. A river's mesh follows its
 * middle line and carries the current in its second texture coordinate for the shader to drift
 * with. A lake's mesh is a grid over its bounds, and a still one. `index` is the body's place in
 * the water's list of bodies.
 */
export function bodyMesh(
	shape: WaterShape,
	body: WaterBody,
	level: number,
	detail: MeshDetail,
	index = 0,
): MeshArrays {
	const step = detail.step ?? STEP;
	const across = detail.across ?? ACROSS;
	const cell = detail.cell ?? CELL;
	if (shape.kind === 'river')
		return riverMesh(shape, level, step, across, shape.speed ?? 0.35, index);
	return lakeMesh(shape, body, level, cell, index);
}

// The surface's mesh: a strip along a river's middle line, or a grid over a lake's bounds with the
// cells outside its shore left out. Both carry the current in their texture coordinates, so the
// surface shader drifts its ripples and its foam the way the water runs at each point.
import type { MeshArrays } from '@null3d/engine';
import type { RiverShape, WaterBody, WaterShape } from './shape';

/** The most meters between two cross sections of a river's mesh. */
const STEP = 2;
/** The cross sections that a river's mesh takes across its width, fine enough for the short waves. */
const ACROSS = 16;
/** The meters between two lines of a lake's mesh grid. */
const CELL = 2;
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

/** Adds one vertex and returns its index. */
function vertex(
	b: Builder,
	x: number,
	y: number,
	z: number,
	speed: number,
	dx: number,
	dz: number,
): number {
	const index = b.positions.length / 3;
	b.positions.push(x, y, z);
	b.normals.push(0, 1, 0);
	b.uvs.push(speed, 0);
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

/** The surface's mesh for a lake: a grid over its bounds, with the cells outside its shore left out. */
function lakeMesh(body: WaterBody, level: number, cell: number): MeshArrays {
	const { minX, maxX, minZ, maxZ } = body;
	const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
	const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
	const dx = (maxX - minX) / nx;
	const dz = (maxZ - minZ) / nz;
	const b = builder();
	// A lake stills its water, so the surface holds no direction, and the shader ignores both.
	for (let j = 0; j <= nz; j++)
		for (let i = 0; i <= nx; i++) vertex(b, minX + i * dx, level, minZ + j * dz, 0, 1, 0);
	const row = nx + 1;
	for (let j = 0; j < nz; j++)
		for (let i = 0; i < nx; i++) {
			// A cell draws when any of its corners lies over the water, so the mesh reaches past the
			// shore and the surface fades there instead of ending on the grid's line.
			const x0 = minX + i * dx;
			const x1 = x0 + dx;
			const z0 = minZ + j * dz;
			const z1 = z0 + dz;
			if (
				!body.contains(x0, z0) &&
				!body.contains(x1, z0) &&
				!body.contains(x0, z1) &&
				!body.contains(x1, z1)
			)
				continue;
			const a = j * row + i;
			b.indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
		}
	return arrays(b);
}

/**
 * The surface's mesh for one water body, at the height of its surface. A river's mesh follows its
 * middle line and carries the current in its second texture coordinate for the shader to drift
 * with. A lake's mesh is a grid over its bounds, and a still one.
 */
export function bodyMesh(
	shape: WaterShape,
	body: WaterBody,
	level: number,
	detail: MeshDetail,
): MeshArrays {
	const step = detail.step ?? STEP;
	const across = detail.across ?? ACROSS;
	const cell = detail.cell ?? CELL;
	if (shape.kind === 'river') return riverMesh(shape, level, step, across, shape.speed ?? 0.35);
	return lakeMesh(body, level, cell);
}

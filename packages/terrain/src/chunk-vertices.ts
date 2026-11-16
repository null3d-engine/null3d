// The vertices of one block: a grid whose heights come from the height field, with a skirt around
// its edge. The add-on's WebAssembly module holds the port that ships, and this file is the
// reference that the port is checked against, which the unit tests run in their own thread. Only
// those tests import it, and the package leaves it out of the tarball.

import type { ChunkShape } from './chunk';
import type { Heightfield } from './heightfield';

/**
 * The offsets of a vertex and of the four points around it that a normal reads, in samples along x
 * then along z: the vertex itself, then one sample each way across and along.
 */
const AROUND_OFFSETS = new Int32Array([0, 0, 1, 0, -1, 0, 0, 1, 0, -1]);

/** The heights of those five points, which a write of a block reuses. */
const AROUND = new Float64Array(5);

/**
 * Writes the heights and normals of a grid of `quads` faces along each side into `positions` and
 * `normals`, three numbers per vertex, for a block whose low corner stands at the world point
 * (`originX`, `originZ`). Each height is the field's at that world point and each normal the
 * ground's slope there, as `heightAt` and `normalAt` give them, and both arrays carry the block's
 * own coordinates from that corner. Allocates nothing.
 */
function writeGridVertices(
	field: Heightfield,
	blockSize: number,
	originX: number,
	originZ: number,
	quads: number,
	positions: Float32Array,
	normals: Float32Array,
): void {
	const { resolution, heights, size } = field;
	const step = size / (resolution - 1);
	const corner = -size / 2;
	const cell = blockSize / quads;
	const last = resolution - 2;
	const around = AROUND;
	const offsets = AROUND_OFFSETS;
	let at = 0;
	for (let row = 0; row <= quads; row++)
		for (let col = 0; col <= quads; col++, at += 3) {
			const x = col * cell;
			const z = row * cell;
			const fx = (originX + x - corner) / step;
			const fz = (originZ + z - corner) / step;
			// The vertex, then the four points one sample each way from it, whose heights give the
			// slope. Reading them in this loop keeps the arithmetic of the whole block in one place.
			for (let k = 0; k < 5; k++) {
				const gx = fx + (offsets[k * 2] as number);
				const gz = fz + (offsets[k * 2 + 1] as number);
				const cx = Math.min(Math.max(Math.floor(gx), 0), last);
				const cz = Math.min(Math.max(Math.floor(gz), 0), last);
				const tx = Math.min(Math.max(gx - cx, 0), 1);
				const tz = Math.min(Math.max(gz - cz, 0), 1);
				const a = heights[cz * resolution + cx] as number;
				const b = heights[cz * resolution + cx + 1] as number;
				const c = heights[(cz + 1) * resolution + cx] as number;
				const d = heights[(cz + 1) * resolution + cx + 1] as number;
				const top = a + (b - a) * tx;
				const bottom = c + (d - c) * tx;
				around[k] = top + (bottom - top) * tz;
			}
			positions[at] = x;
			positions[at + 1] = around[0] as number;
			positions[at + 2] = z;
			// The rise over the run a sample each way, made one unit long. The length is the square
			// root of the squares, because `Math.hypot` of three numbers makes an object of its own.
			const dx = ((around[1] as number) - (around[2] as number)) / (2 * step);
			const dz = ((around[3] as number) - (around[4] as number)) / (2 * step);
			const length = Math.sqrt(dx * dx + 1 + dz * dz);
			normals[at] = -dx / length;
			normals[at + 1] = 1 / length;
			normals[at + 2] = -dz / length;
		}
}

/**
 * Writes the height of the parent block's surface at every vertex of `shape` into `out`, one number
 * per vertex. The parent covers `parentSize` meters from its low corner (`parentX`, `parentZ`) with
 * the same faces along each side, so its surface is the smaller grid's heights, joined by its own
 * triangles. A child block lies in one quadrant of its parent. The skirt copies the height of the
 * ring vertex beside it, `skirt` meters below it. Passing the block's own size and origin as the
 * parent gives the block's own heights, for a block that has no coarser level.
 *
 * The parent's corner heights come from the field at the parent grid's points, as the parent
 * block's own vertices do, so a child whose morph is complete has the parent's surface exactly.
 * Allocates nothing.
 */
export function writeParentHeights(
	field: Heightfield,
	shape: ChunkShape,
	blockSize: number,
	originX: number,
	originZ: number,
	skirt: number,
	parentSize: number,
	parentX: number,
	parentZ: number,
	out: Float32Array,
): void {
	const { quads, ring } = shape;
	const cell = blockSize / quads;
	const parentCell = parentSize / quads;
	// The block's low corner in the parent's own coordinates.
	const offsetX = originX - parentX;
	const offsetZ = originZ - parentZ;
	const grid = (quads + 1) * (quads + 1);
	let at = 0;
	for (let row = 0; row <= quads; row++)
		for (let col = 0; col <= quads; col++, at++) {
			const px = col * cell + offsetX;
			const pz = row * cell + offsetZ;
			const gx = px / parentCell;
			const gz = pz / parentCell;
			// A vertex on the parent's far edge belongs to its last cell, at the cell's far side.
			const cx = Math.min(Math.max(Math.floor(gx), 0), quads - 1);
			const cz = Math.min(Math.max(Math.floor(gz), 0), quads - 1);
			const tx = Math.min(Math.max(gx - cx, 0), 1);
			const tz = Math.min(Math.max(gz - cz, 0), 1);
			const x0 = parentX + cx * parentCell;
			const x1 = x0 + parentCell;
			const z0 = parentZ + cz * parentCell;
			const z1 = z0 + parentCell;
			const h00 = field.heightAt(x0, z0);
			const h10 = field.heightAt(x1, z0);
			const h01 = field.heightAt(x0, z1);
			const h11 = field.heightAt(x1, z1);
			// The parent's faces split each cell from its low corner to its high one, as the block's
			// own grid does, so a point on either side of that diagonal takes that triangle's plane.
			out[at] =
				tx + tz <= 1
					? h00 + (h10 - h00) * tx + (h01 - h00) * tz
					: h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
		}
	// The skirt keeps its depth below the surface that the ring moves to.
	for (let k = 0; k < ring.length; k++) out[grid + k] = (out[ring[k] as number] as number) - skirt;
}

/**
 * Writes the positions and normals of one block into `positions` and `normals`, both holding three
 * numbers per vertex of `shape`. The block stands at the world point (`originX`, `originZ`), covers
 * `blockSize` meters along each side, and its skirt hangs `skirt` meters below its edge.
 */
export function writeChunkVertices(
	field: Heightfield,
	shape: ChunkShape,
	blockSize: number,
	originX: number,
	originZ: number,
	skirt: number,
	positions: Float32Array,
	normals: Float32Array,
): void {
	const { quads, ring } = shape;
	const grid = (quads + 1) * (quads + 1);
	writeGridVertices(field, blockSize, originX, originZ, quads, positions, normals);
	// The skirt: a copy of each ring vertex, dropped by the skirt's depth.
	for (let k = 0; k < ring.length; k++) {
		const source = (ring[k] as number) * 3;
		const target = (grid + k) * 3;
		positions[target] = positions[source] as number;
		positions[target + 1] = (positions[source + 1] as number) - skirt;
		positions[target + 2] = positions[source + 2] as number;
		normals[target] = normals[source] as number;
		normals[target + 1] = normals[source + 1] as number;
		normals[target + 2] = normals[source + 2] as number;
	}
}

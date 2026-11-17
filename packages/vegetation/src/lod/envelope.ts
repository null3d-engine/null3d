// The far envelope: the leaf form's outer surface as one closed body. A closed body has no holes,
// so its covered share cannot thin as the camera pulls back; it stands in the far band only, where
// a plant covers a few pixels and a smooth surface reads as its mass.
//
// The body lofts rings about the crown's middle: each ring's height is a band of the leaf form's
// own points, and each sector's radius is the farthest leaf in that band and sector, so the body's
// silhouette holds the form's outermost leaves at every turn. The rings join as quads and the first
// and last close with fans on one vertex, so every edge stands in exactly two triangles and the
// body has no boundary.
import type { MeshArrays, PlantAsset } from '../asset';
import type { SpeciesKitData } from '../asset';
import { dequantisePosition } from './quantise';

/** How many rings a body lofts between the crown's base and its top. */
const RINGS = 12;
/** How many sectors round the body a ring holds. */
const SECTORS = 24;

/**
 * One closed body of the leaf form's outer surface.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param form The level whose leaves the body encloses: the nearest form by default.
 * @returns The body's mesh, closed at both ends.
 * @category api/vegetation
 */
export function foliageEnvelope(
	kit: SpeciesKitData,
	asset: PlantAsset,
	form: 0 | 1 | 2 = 0,
): MeshArrays {
	const leaves = asset.levels[form]?.parts ?? [];
	// A plant whose foliage is merged into its wood, as the willow's trailing whips are, hides its
	// leaves in the wood part; its body then takes every part, the trunk standing inside it.
	const FOLIAGE = new Set(['foliage', 'cards', 'extras']);
	let foliaged = false;
	for (const part of leaves) if (FOLIAGE.has(part.name)) foliaged = true;
	const points: number[] = [];
	const point: [number, number, number] = [0, 0, 0];
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	let cx = 0;
	let cz = 0;
	let count = 0;
	for (const part of leaves) {
		// The foliage's own parts: its leaves and cards and the extras a plant draws as its crown.
		if (foliaged && !FOLIAGE.has(part.name)) continue;
		const positions = part.arrays.positions;
		for (let i = 0; i < positions.length / 3; i++) {
			dequantisePosition(positions, i, kit.box, point);
			const x = point[0] as number;
			const y = point[1] as number;
			const z = point[2] as number;
			points.push(x, y, z);
			low = Math.min(low, y);
			high = Math.max(high, y);
			cx += x;
			cz += z;
			count++;
		}
	}
	if (count === 0 || !(high > low)) return emptyMesh();
	cx /= count;
	cz /= count;
	const height = high - low;
	// Each ring's radius by sector: the farthest leaf of the band, so the body holds the form's
	// outermost leaves and its silhouette cannot stand inside them.
	const radius = new Float64Array(RINGS * SECTORS);
	for (let i = 0; i < points.length; i += 3) {
		const x = points[i] as number;
		const y = points[i + 1] as number;
		const z = points[i + 2] as number;
		const ring = Math.min(RINGS - 1, Math.max(0, Math.floor(((y - low) / height) * RINGS)));
		const angle = Math.atan2(z - cz, x - cx);
		const sector = Math.min(
			SECTORS - 1,
			Math.max(0, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * SECTORS)),
		);
		const reach = Math.hypot(x - cx, z - cz);
		const at = ring * SECTORS + sector;
		if (reach > (radius[at] as number)) radius[at] = reach;
	}
	// An empty sector takes its neighbours' farthest reach, so a band the leaves miss still closes.
	for (let ring = 0; ring < RINGS; ring++)
		for (let sector = 0; sector < SECTORS; sector++) {
			const at = ring * SECTORS + sector;
			if ((radius[at] as number) > 0) continue;
			let most = 0;
			for (let k = 1; k < SECTORS; k++) {
				const a = ring * SECTORS + ((sector + k) % SECTORS);
				const b = ring * SECTORS + ((sector - k + SECTORS) % SECTORS);
				most = Math.max(most, radius[a] as number, radius[b] as number);
			}
			radius[at] = most;
		}
	const ringVertices = RINGS * SECTORS;
	const vertexCount = ringVertices + 2;
	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const uvs1 = new Float32Array(vertexCount * 2);
	const colors = new Uint8Array(vertexCount * 4);
	for (let ring = 0; ring < RINGS; ring++)
		for (let sector = 0; sector < SECTORS; sector++) {
			const at = ring * SECTORS + sector;
			const angle = ((sector + 0.5) / SECTORS) * 2 * Math.PI - Math.PI;
			const reach = Math.max(1e-4, radius[at] as number);
			const y = low + ((ring + 0.5) / RINGS) * height;
			const x = cx + reach * Math.cos(angle);
			const z = cz + reach * Math.sin(angle);
			const v = at * 3;
			positions[v] = x;
			positions[v + 1] = y;
			positions[v + 2] = z;
			// The body's normal leans out from its axis, the ring's own line.
			const lean = height / RINGS / reach;
			const length = Math.hypot(1, lean);
			const n = at * 3;
			normals[n] = Math.cos(angle) / length;
			normals[n + 1] = 0;
			normals[n + 2] = Math.sin(angle) / length;
			uvs[at * 2] = sector / SECTORS;
			uvs[at * 2 + 1] = ring / RINGS;
			colors[at * 4] = 255;
			colors[at * 4 + 1] = 255;
		}
	// The bottom and top vertices close the body's ends on its own axis.
	const bottom = ringVertices;
	positions[bottom * 3] = cx;
	positions[bottom * 3 + 1] = low;
	positions[bottom * 3 + 2] = cz;
	normals[bottom * 3 + 1] = -1;
	const top = ringVertices + 1;
	positions[top * 3] = cx;
	positions[top * 3 + 1] = high;
	positions[top * 3 + 2] = cz;
	normals[top * 3 + 1] = 1;
	const indices: number[] = [];
	for (let ring = 0; ring < RINGS - 1; ring++)
		for (let sector = 0; sector < SECTORS; sector++) {
			const a = ring * SECTORS + sector;
			const b = ring * SECTORS + ((sector + 1) % SECTORS);
			const c = (ring + 1) * SECTORS + ((sector + 1) % SECTORS);
			const d = (ring + 1) * SECTORS + sector;
			indices.push(a, b, c, a, c, d);
		}
	for (let sector = 0; sector < SECTORS; sector++) {
		const a = sector;
		const b = (sector + 1) % SECTORS;
		indices.push(bottom, b, a);
	}
	const last = (RINGS - 1) * SECTORS;
	for (let sector = 0; sector < SECTORS; sector++) {
		const a = last + sector;
		const b = last + ((sector + 1) % SECTORS);
		indices.push(top, a, b);
	}
	void kit;
	return {
		positions,
		normals,
		uvs,
		uvs1,
		colors,
		indices: new Uint32Array(indices),
	};
}

/** A body of nothing, for a form that draws no leaves. */
function emptyMesh(): MeshArrays {
	return {
		positions: new Float32Array(0),
		normals: new Float32Array(0),
		uvs: new Float32Array(0),
		uvs1: new Float32Array(0),
		colors: new Uint8Array(0),
		indices: new Uint32Array(0),
	};
}

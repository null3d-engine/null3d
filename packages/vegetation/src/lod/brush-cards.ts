// Brush cards: below its finest tier, a piece draws each dense run of its leaves as three crossed
// quads that carry a picture of a run's own leaves, so a bough keeps the cover of its brushes at a
// small share of their triangles. The card bake draws each picture into the card atlas beside the
// prototypes' own cells, as it draws a prototype: two planes along the run, crossed, and one across
// it. Each tier then keeps its wood, stems and buds, and its leaves give way to the quads, laid
// along each run's stem and stretched to its length. A prototype's own cells are baked from its
// leaves, before the quads take their place, so its card at the far levels pictures the leaves.
import type { CardCell, PrototypeArrays } from '../asset';
import type { Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { DETAILS, type Detail, type Vec3 } from '../core/types';
import type { BrushPicture, BrushRun, PrototypeBrushes, UncardedPrototype } from '../leaf/shoot';
import { leafSurface, SURFACE_BRUSH } from '../leaf/writer';
import type { CardAtlas } from '../stages';
import { bakeCards } from './card-bake';
import { CARD_CORNERS } from './cards';

/** The finest tier, which keeps every leaf. */
const FINEST = DETAILS.indexOf('ultra');

/** The self-shade byte of a brush card's vertices: the quads' own picture holds the shade inside. */
const BRUSH_SHADE = 255;

/**
 * Bakes the card atlas of a kit's prototypes and, where a prototype draws brush cards, the pictures
 * its runs draw from, then lays the brush quads over its tiers below the finest.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param detail The mesh tier, which sets the cells' size.
 * @param prototypes The prototypes.
 * @returns The atlas, one cell set per prototype, and the prototypes with their brush cards in
 *   place and their brush data dropped.
 */
export function bakeWithBrushes(
	record: Species,
	manifest: TextureManifest,
	detail: Detail,
	prototypes: readonly UncardedPrototype[],
): { atlas: CardAtlas; cells: readonly CardCell[]; prototypes: UncardedPrototype[] } {
	const pictures: BrushPicture[] = [];
	for (const prototype of prototypes)
		for (const picture of prototype.brushes?.pictures ?? [])
			if (!pictures.includes(picture)) pictures.push(picture);
	if (pictures.length === 0)
		return { ...bakeCards(record, manifest, detail, prototypes), prototypes: [...prototypes] };
	// Each picture is baked as a prototype of its own, after the kit's, so the kit's cells keep
	// their places.
	const extra: UncardedPrototype[] = pictures.map((picture, i) => ({
		index: prototypes.length + i,
		class: 'piece',
		vigor: [0, 1],
		length: picture.length,
		radius: picture.length,
		leaves: 1,
		tiers: [picture.mesh, picture.mesh, picture.mesh, picture.mesh],
	}));
	const baked = bakeCards(record, manifest, detail, [...prototypes, ...extra]);
	const cellOf = (picture: BrushPicture): CardCell =>
		baked.cells[prototypes.length + pictures.indexOf(picture)] as CardCell;
	const out = prototypes.map((prototype): UncardedPrototype => {
		const { brushes, ...rest } = prototype;
		if (!brushes) return prototype;
		const tiers = prototype.tiers.map((mesh, t) =>
			t >= FINEST ? mesh : brushed(mesh, brushes, cellOf, baked.atlas.size),
		) as unknown as UncardedPrototype['tiers'];
		return { ...rest, tiers };
	});
	return { atlas: baked.atlas, cells: baked.cells.slice(0, prototypes.length), prototypes: out };
}

/**
 * A tier's mesh with its leaves given way to brush quads: its wood, stems and buds as they are, and
 * three quads for each run, one for each plane of its picture's cell.
 */
function brushed(
	mesh: PrototypeArrays,
	brushes: PrototypeBrushes,
	cellOf: (picture: BrushPicture) => CardCell,
	size: number,
): PrototypeArrays {
	const vertexCount = mesh.positions.length / 3;
	// The vertices of the triangles that are not leaf, in their order.
	const keep = new Int32Array(vertexCount).fill(-1);
	const kept: number[] = [];
	const indices: number[] = [];
	for (let t = 0; t < mesh.indices.length; t += 3) {
		const a = mesh.indices[t] as number;
		if (leafSurface(mesh.colors[a * 4 + 2] as number)) continue;
		for (let k = 0; k < 3; k++) {
			const v = mesh.indices[t + k] as number;
			if ((keep[v] as number) < 0) {
				keep[v] = kept.length;
				kept.push(v);
			}
			indices.push(keep[v] as number);
		}
	}
	const quads = brushes.runs.length * 3;
	const total = kept.length + quads * 4;
	if (total > 65536)
		throw new Error(
			`@null3d/vegetation: a piece with brush cards holds ${total} vertices, over 65,536`,
		);
	const positions = new Float32Array(total * 3);
	const normals = new Float32Array(total * 3);
	const uvs = new Float32Array(total * 2);
	const uvs1 = new Float32Array(total * 2);
	const colors = new Uint8Array(total * 4);
	const tangents = mesh.tangents ? new Int8Array(total * 4) : undefined;
	kept.forEach((v, i) => {
		positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), i * 3);
		normals.set(mesh.normals.subarray(v * 3, v * 3 + 3), i * 3);
		uvs.set(mesh.uvs.subarray(v * 2, v * 2 + 2), i * 2);
		uvs1.set(mesh.uvs1.subarray(v * 2, v * 2 + 2), i * 2);
		colors.set(mesh.colors.subarray(v * 4, v * 4 + 4), i * 4);
		if (tangents && mesh.tangents) tangents.set(mesh.tangents.subarray(v * 4, v * 4 + 4), i * 4);
	});
	let at = kept.length;
	for (const run of brushes.runs) {
		const picture = brushes.pictures[run.picture];
		if (!picture) continue;
		const cell = cellOf(picture);
		const stretch = run.length / Math.max(1e-6, picture.length);
		for (const plane of cell.planes) {
			const right = toward(run, plane.right, stretch);
			const up = toward(run, plane.up, stretch);
			const normal = unit([
				right[1] * up[2] - right[2] * up[1],
				right[2] * up[0] - right[0] * up[2],
				right[0] * up[1] - right[1] * up[0],
			]);
			const centre = toward(run, plane.centre, stretch);
			const [rx, ry, rw, rh] = plane.front;
			const first = at;
			for (const [sx, sy] of CARD_CORNERS) {
				for (let c = 0; c < 3; c++)
					positions[at * 3 + c] =
						(run.start[c] as number) +
						(centre[c] as number) +
						sx * (right[c] as number) +
						sy * (up[c] as number);
				normals.set(normal, at * 3);
				uvs[at * 2] = (rx + ((sx + 1) / 2) * rw) / size;
				uvs[at * 2 + 1] = (ry + ((sy + 1) / 2) * rh) / size;
				colors[at * 4] = run.bend;
				colors[at * 4 + 1] = run.phase;
				colors[at * 4 + 2] = SURFACE_BRUSH;
				colors[at * 4 + 3] = BRUSH_SHADE;
				at++;
			}
			indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
		}
	}
	return {
		positions,
		normals,
		uvs,
		uvs1,
		colors,
		...(tangents ? { tangents } : {}),
		indices: Uint16Array.from(indices),
	};
}

/** A vector of a picture's frame in the run's: x along its side, y along its stem stretched, z toward its sky. */
function toward(run: BrushRun, v: Readonly<Vec3>, stretch: number): [number, number, number] {
	const x = v[0] as number;
	const y = (v[1] as number) * stretch;
	const z = v[2] as number;
	return [
		run.side[0] * x + run.along[0] * y + run.sky[0] * z,
		run.side[1] * x + run.along[1] * y + run.sky[1] * z,
		run.side[2] * x + run.along[2] * y + run.sky[2] * z,
	];
}

/** A vector at unit length, or straight up where it has none. */
function unit(v: [number, number, number]): [number, number, number] {
	const length = Math.hypot(v[0], v[1], v[2]);
	return length > 1e-9 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 1, 0];
}

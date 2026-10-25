// Two small scenes for the asset tool's two levels-of-detail items, which unit tests hold and
// picture tests draw. A tree proves the leaf-card step: its crown is a list of separate cards, so
// a level keeps a share of them and grows the ones it keeps. A grid proves the texture-coordinate
// weight: its texture repeats across a flat surface, so a level that slides it reports an error.
// `tests/pages/sketches/asset-levels-sketch.ts` draws both files, and
// `packages/cli/src/assets/optimize.test.ts` writes them and holds their bytes.
import { encodePng } from '../../packages/cli/src/png.js';
import { GltfBuilder, type GltfJson } from '../pages/lib/gltf-files.ts';

/** The scenes' source files and the tool's level outputs, from the repository's root. */
export const LEVEL_SCENES = {
	cardTree: 'tests/pages/assets/models/asset-card-tree.glb',
	cardTreeLod: 'tests/pages/assets/models/optimized/levels/asset-card-tree.glb',
	bentGrid: 'tests/pages/assets/models/asset-bent-grid.glb',
	bentGridLod: 'tests/pages/assets/models/optimized/levels/asset-bent-grid.glb',
	/** The texture files of the level outputs. */
	textures: 'tests/pages/assets/models/optimized/levels/textures',
} as const;

/** Cards in the tree's crown, and the side of each: 40 cards, so a level can drop one in two. */
const CARDS = 40;
const CARD = 0.3;
/** The crown's middle height and the radius of the sphere that its cards sit on. */
const CROWN_HEIGHT = 0.95;
const CROWN_RADIUS = 0.42;
/** The trunk's cross-section and height. */
const TRUNK = 0.09;
const TRUNK_HEIGHT = 0.95;

/** Cells across the grid, and how often its texture repeats in each direction. */
const GRID_CELLS = 32;
const GRID_REPEATS = 2;

/** Four blocks of strong color, so a slide of the texture shows where a block's edge moves. */
function blocks(side: number): Uint8Array {
	const data = new Uint8Array(side * side * 4);
	const half = side / 2;
	const colors: [number, number, number][] = [
		[210, 40, 40],
		[40, 170, 70],
		[40, 70, 210],
		[235, 210, 40],
	];
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) {
			const [r, g, b] = colors[(y < half ? 0 : 2) + (x < half ? 0 : 1)] as [number, number, number];
			data.set([r, g, b, 255], (y * side + x) * 4);
		}
	return encodePng({ width: side, height: side, data });
}

/** A quad card: four corners of `size` around `centre`, across `right` and `up`, facing `normal`. */
function card(
	centre: [number, number, number],
	right: [number, number, number],
	up: [number, number, number],
	normal: [number, number, number],
	size: number,
): { positions: number[]; normals: number[]; uvs: number[]; indices: number[] } {
	const half = size / 2;
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	for (const [a, b] of [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
	] as const) {
		positions.push(
			centre[0] + (a * right[0] + b * up[0]) * half,
			centre[1] + (a * right[1] + b * up[1]) * half,
			centre[2] + (a * right[2] + b * up[2]) * half,
		);
		normals.push(...normal);
		uvs.push((a + 1) / 2, (1 - b) / 2);
	}
	return {
		positions,
		normals,
		uvs,
		indices: [0, 1, 2, 0, 2, 3],
	};
}

/**
 * A tree as a separate crown of leaf cards and a trunk, which the tool turns into levels: the
 * crown's cards thin at each level and the ones it keeps grow about their middles.
 */
export function cardTreeGlb(): Uint8Array {
	const b = new GltfBuilder();
	b.json.asset.generator = 'null3D asset tool tests';
	const leaves = b.material({
		name: 'leaves',
		doubleSided: true,
		pbrMetallicRoughness: { baseColorFactor: [0.3, 0.55, 0.16, 1], roughnessFactor: 0.8 },
	});
	const bark = b.material({
		name: 'bark',
		pbrMetallicRoughness: { baseColorFactor: [0.28, 0.2, 0.14, 1], roughnessFactor: 0.9 },
	});

	// The crown: cards spread over a sphere, each turned to face outward, as a leaf crown is.
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let k = 0; k < CARDS; k++) {
		const y = 1 - (2 * (k + 0.5)) / CARDS;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const turn = k * golden;
		const out: [number, number, number] = [ring * Math.cos(turn), y * 0.75, ring * Math.sin(turn)];
		const centre: [number, number, number] = [
			out[0] * CROWN_RADIUS,
			CROWN_HEIGHT + out[1] * CROWN_RADIUS,
			out[2] * CROWN_RADIUS,
		];
		const length = Math.hypot(...out);
		const normal: [number, number, number] = [out[0] / length, out[1] / length, out[2] / length];
		// Two directions across the card, both square to the card's own face.
		const right: [number, number, number] = [-normal[2], 0, normal[0]];
		const rightLength = Math.hypot(...right) || 1;
		right[0] /= rightLength;
		right[2] /= rightLength;
		const up: [number, number, number] = [
			normal[1] * right[2] - normal[2] * right[1],
			normal[2] * right[0] - normal[0] * right[2],
			normal[0] * right[1] - normal[1] * right[0],
		];
		const quad = card(centre, right, up, normal, CARD);
		const first = positions.length / 3;
		positions.push(...quad.positions);
		normals.push(...quad.normals);
		uvs.push(...quad.uvs);
		for (const index of quad.indices) indices.push(first + index);
	}
	const crownPrimitive: GltfJson = {
		attributes: {
			POSITION: b.positions(new Float32Array(positions)),
			NORMAL: b.accessor(new Float32Array(normals), 3),
			TEXCOORD_0: b.accessor(new Float32Array(uvs), 2),
		},
		indices: b.accessor(new Uint16Array(indices), 1),
		material: leaves,
	};

	// The trunk: a smooth open cylinder, from the ground to the crown's middle. Its sides share
	// their vertices and smooth normals, so the tool reads it as one surface and never as cards,
	// which a faceted box's six separate faces would be.
	const sides = 8;
	const rings = 5;
	const trunkPositions: number[] = [];
	const trunkNormals: number[] = [];
	const trunkUvs: number[] = [];
	const trunkIndices: number[] = [];
	for (let r = 0; r < rings; r++)
		for (let s = 0; s < sides; s++) {
			const turn = (s / sides) * Math.PI * 2;
			const [x, z] = [Math.cos(turn), Math.sin(turn)];
			trunkPositions.push(x * TRUNK, (r / (rings - 1)) * TRUNK_HEIGHT, z * TRUNK);
			trunkNormals.push(x, 0, z);
			trunkUvs.push(s / sides, r / (rings - 1));
		}
	for (let r = 0; r < rings - 1; r++)
		for (let s = 0; s < sides; s++) {
			const next = (s + 1) % sides;
			const a = r * sides + s;
			const b = r * sides + next;
			const c = a + sides;
			const d = b + sides;
			trunkIndices.push(a, c, b, b, c, d);
		}
	const trunkPrimitive: GltfJson = {
		attributes: {
			POSITION: b.positions(new Float32Array(trunkPositions)),
			NORMAL: b.accessor(new Float32Array(trunkNormals), 3),
			TEXCOORD_0: b.accessor(new Float32Array(trunkUvs), 2),
		},
		indices: b.accessor(new Uint16Array(trunkIndices), 1),
		material: bark,
	};
	// The crown and the trunk are nodes of their own, each with one material: a mesh of two
	// materials comes back from the loader as a group of one mesh for each, and a group has no
	// level bias to set.
	b.node({ name: 'Crown', mesh: b.mesh([crownPrimitive], 'crown') });
	b.node({ name: 'Trunk', mesh: b.mesh([trunkPrimitive], 'trunk') });
	return b.glb();
}

/**
 * A flat grid of one meter whose texture repeats across it, so a level that drops its vertices
 * slides the texture. Its error shows whether the tool weighs texture coordinates at all.
 */
export function bentGridGlb(): Uint8Array {
	const b = new GltfBuilder();
	b.json.asset.generator = 'null3D asset tool tests';
	b.json.images = [];
	b.json.textures = [];
	b.json.samplers = [{ wrapS: 10497, wrapT: 10497, minFilter: 9987, magFilter: 9729 }];
	const image = b.json.images.push({
		name: 'blocks',
		mimeType: 'image/png',
		bufferView: b.view(blocks(256)),
	});
	const texture = b.json.textures.push({ source: image - 1, sampler: 0 });
	const material = b.material({
		name: 'blocks',
		pbrMetallicRoughness: {
			baseColorTexture: { index: texture - 1 },
			metallicFactor: 0,
			roughnessFactor: 0.9,
		},
	});
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= GRID_CELLS; r++)
		for (let c = 0; c <= GRID_CELLS; c++) {
			const [x, z] = [c / GRID_CELLS - 0.5, r / GRID_CELLS - 0.5];
			positions.push(x, 0, z);
			// The texture repeats across the grid, so neighbouring vertices may name far corners.
			uvs.push(((c / GRID_CELLS) * GRID_REPEATS) % 1, ((r / GRID_CELLS) * GRID_REPEATS) % 1);
		}
	for (let r = 0; r < GRID_CELLS; r++)
		for (let c = 0; c < GRID_CELLS; c++) {
			const at = r * (GRID_CELLS + 1) + c;
			indices.push(
				at,
				at + GRID_CELLS + 1,
				at + 1,
				at + 1,
				at + GRID_CELLS + 1,
				at + GRID_CELLS + 2,
			);
		}
	const normals = new Float32Array(positions.length);
	for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
	const mesh = b.mesh(
		[
			{
				attributes: {
					POSITION: b.positions(new Float32Array(positions)),
					NORMAL: b.accessor(normals, 3),
					TEXCOORD_0: b.accessor(new Float32Array(uvs), 2),
				},
				indices: b.accessor(new Uint16Array(indices), 1),
				material,
			},
		],
		'grid',
	);
	b.node({ name: 'Grid', mesh });
	return b.glb();
}

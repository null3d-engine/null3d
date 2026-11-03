// The cluster test model that the repository keeps, and the step that builds it. A tree of cluster
// patches comes from the asset tool, so a page that draws patches loads a model that the tool
// optimized with `--clusters`. The model is a heightfield of 32,768 triangles: large enough for a
// tree, with one opaque material and no texture, so the file stays small.
//
// The same step writes two trees that the engine's walk test reads (`cluster_cover.rs`): the
// heightfield's, and the tree of a lumpy pebble, a sphere whose surface a scan could give. Each
// file holds the patches' spheres and records alone, because the test checks which patches a
// view draws and needs no triangle.
//
// The build runs the tool in this process, and the tool is deterministic, so
// `bun packages/cli/src/assets/cluster-fixture.ts` writes the same bytes on every machine. Unit
// tests in `clusters.test.ts` check that the committed files match it.
//
// The step sits in the tool's folder because it builds a glTF document, and glTF-Transform is a
// dependency of the tool, not of the tests.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { planClusters } from './clusters.js';
import { DEFAULT_OPTIONS, optimizeModel } from './pipeline.js';

/** The folder of the test models, beside the test pages that load them. */
export const MODELS_DIR = join(import.meta.dirname, '../../../../tests/pages/assets/models');

/** The folder of the trees that the engine's walk test reads. */
export const TREES_DIR = join(
	import.meta.dirname,
	'../../../../crates/null3d-render/tests/fixtures/cluster-trees',
);

/** The model that draws a tree of cluster patches. */
export const CLUSTER_FILE = 'cluster-terrain.glb';

/** The path of the model from a test page, which the dev server serves from this folder. */
export const CLUSTER_PATH = `assets/models/${CLUSTER_FILE}`;

/** The model that draws the root band of a tree and streams the bands below it. */
export const CLUSTER_STAGED_FILE = 'cluster-staged-terrain.glb';

/** The path of the staged model from a test page. */
export const CLUSTER_STAGED_PATH = `assets/models/${CLUSTER_STAGED_FILE}`;

/** The quads along each side of the heightfield: 128 gives 32,768 triangles. */
const SIDE = 128;

/** The height of the ground at a place, in metres: ridges that a scan of a slope could give. */
function height(x: number, z: number): number {
	const a = Math.sin(x * 0.7) * Math.cos(z * 0.53) * 1.4;
	const b = Math.sin(x * 0.19 + 1.3) * Math.sin(z * 0.23) * 3.2;
	const c = Math.sin(x * 2.1 + z * 1.7) * 0.18;
	return a + b + c;
}

/** The heightfield as a document: one mesh of triangles, with an opaque material. */
export function terrainDocument(): Document {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const positions = new Float32Array((SIDE + 1) * (SIDE + 1) * 3);
	const indices = new Uint32Array(SIDE * SIDE * 6);
	let at = 0;
	for (let z = 0; z <= SIDE; z++)
		for (let x = 0; x <= SIDE; x++) {
			const px = (x / SIDE - 0.5) * 40;
			const pz = (z / SIDE - 0.5) * 40;
			positions.set([px, height(px, pz), pz], at);
			at += 3;
		}
	let corner = 0;
	for (let z = 0; z < SIDE; z++)
		for (let x = 0; x < SIDE; x++) {
			const a = z * (SIDE + 1) + x;
			const b = a + 1;
			const c = a + SIDE + 1;
			const d = c + 1;
			indices.set([a, c, b, b, c, d], corner);
			corner += 6;
		}
	const prim = doc
		.createPrimitive()
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer),
		)
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
		.setMaterial(
			doc
				.createMaterial('ground')
				.setBaseColorFactor([0.55, 0.5, 0.42, 1])
				.setRoughnessFactor(0.9)
				.setMetallicFactor(0),
		);
	const mesh = doc.createMesh('terrain').addPrimitive(prim);
	doc.createScene().addChild(doc.createNode('terrain').setMesh(mesh));
	return doc;
}

/** The rings from pole to pole of the pebble, and twice as many segments around: 36,864 triangles. */
const PEBBLE_RINGS = 96;

/** A number from 0 to 1 for a place, from an integer hash, the same for every copy of the place. */
function grain(x: number, y: number, z: number): number {
	let h = Math.imul(Math.round(x * 4096), 0x8da6b343);
	h = Math.imul(h ^ Math.imul(Math.round(y * 4096), 0xd8163841), 0x9e3779b1);
	h = Math.imul(h ^ Math.imul(Math.round(z * 4096), 0xcb1ab31f), 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 0xffffffff;
}

/**
 * A lumpy pebble as a document: a sphere whose radius swells and dents in broad lumps, with a fine
 * grain, as a scanned stone has. Copies of a vertex at the seam and the poles share a place, so
 * they move alike and the surface stays closed.
 */
export function pebbleDocument(): Document {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const segments = PEBBLE_RINGS * 2;
	const row = segments + 1;
	const positions = new Float32Array((PEBBLE_RINGS + 1) * row * 3);
	const indices = new Uint32Array(PEBBLE_RINGS * segments * 6);
	let at = 0;
	for (let r = 0; r <= PEBBLE_RINGS; r++) {
		const phi = (r / PEBBLE_RINGS) * Math.PI;
		for (let s = 0; s <= segments; s++) {
			const theta = ((s % segments) / segments) * Math.PI * 2;
			const x = Math.sin(phi) * Math.cos(theta);
			const y = Math.cos(phi);
			const z = Math.sin(phi) * Math.sin(theta);
			const lumps =
				0.12 * Math.sin(3.1 * x + 1.7) * Math.cos(2.3 * y) +
				0.07 * Math.sin(5.3 * z + 4.1 * x) +
				0.03 * Math.cos(9.7 * y + 7.9 * z);
			const radius = 0.3 * (1 + lumps + 0.006 * grain(x, y, z));
			positions.set([x * radius * 1.3, y * radius * 0.8, z * radius], at);
			at += 3;
		}
	}
	let corner = 0;
	for (let r = 0; r < PEBBLE_RINGS; r++)
		for (let s = 0; s < segments; s++) {
			const a = r * row + s;
			const b = a + 1;
			const c = a + row;
			const d = c + 1;
			indices.set([a, c, b, b, c, d], corner);
			corner += 6;
		}
	const prim = doc
		.createPrimitive()
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer),
		)
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
		.setMaterial(doc.createMaterial('stone').setBaseColorFactor([0.5, 0.48, 0.45, 1]));
	const mesh = doc.createMesh('pebble').addPrimitive(prim);
	doc.createScene().addChild(doc.createNode('pebble').setMesh(mesh));
	return doc;
}

/** The trees that the engine's walk test reads, by their file's name. */
export const TREE_FILES = { 'pebble.bin': pebbleDocument, 'heightfield.bin': terrainDocument };

/**
 * The tree that the tool plans for a document's one mesh, as the walk test reads it: the count of
 * patches and the root's place, then for each patch its sphere's four floats and its record's four
 * integers (first index, index count, parent's place plus one, error's bits), all little-endian.
 */
async function treeFile(doc: Document): Promise<Uint8Array> {
	const plan = [...(await planClusters(doc)).values()][0];
	if (!plan) throw new Error('the tool gave the mesh no tree');
	const patches = plan.patches.length / 4;
	const out = new Uint8Array(8 + patches * 32);
	const view = new DataView(out.buffer);
	view.setUint32(0, patches, true);
	view.setUint32(4, plan.root, true);
	for (let k = 0; k < patches; k++)
		for (let c = 0; c < 4; c++) {
			view.setFloat32(8 + k * 32 + c * 4, plan.bounds[k * 4 + c] as number, true);
			view.setUint32(8 + k * 32 + 16 + c * 4, plan.patches[k * 4 + c] as number, true);
		}
	return out;
}

/** Builds the trees that the engine's walk test reads, by their file's name. */
export async function buildTreeFixtures(): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();
	for (const [name, make] of Object.entries(TREE_FILES)) files.set(name, await treeFile(make()));
	return files;
}

/** Builds the cluster model, as the asset tool writes it. */
export async function buildClusterFixture(): Promise<Uint8Array> {
	return (await buildClusterModel()).glb;
}

/**
 * Builds a model with the tool's options, and checks that the tool gave the terrain a tree. The
 * model's name keys its stage files, so each staged model keeps its own.
 *
 * @param {{ clusters?: boolean, stages?: boolean }} options
 * @param {string} [name]
 */
async function buildTerrain(
	options: { clusters?: boolean; stages?: boolean },
	name = 'terrain.glb',
) {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-cluster-fixture-'));
	try {
		const io = new NodeIO();
		const source = join(folder, name);
		writeFileSync(source, await io.writeBinary(terrainDocument()));
		const model = await optimizeModel(
			source,
			{ ...DEFAULT_OPTIONS, maxTextureSize: 64, ...options },
			() => {
				throw new Error('the heightfield has no texture to encode');
			},
		);
		if (model.report.clusters.meshes === 0) throw new Error('the tool gave the terrain no tree');
		return model;
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
}

/** Builds the cluster model with its report, as the asset tool writes it. */
export async function buildClusterModel() {
	return buildTerrain({ clusters: true }, CLUSTER_FILE);
}

/**
 * Builds the staged cluster model: the model file holds the tree's first band, and each band below
 * it downloads from a file of its own.
 */
export async function buildStagedClusterModel() {
	const model = await buildTerrain({ clusters: true, stages: true }, CLUSTER_STAGED_FILE);
	if (model.stages.size === 0) throw new Error('the tool wrote no band file');
	return model;
}

if (import.meta.main) {
	const bytes = await buildClusterFixture();
	writeFileSync(join(MODELS_DIR, CLUSTER_FILE), bytes);
	console.log(`${CLUSTER_FILE}: ${bytes.byteLength} bytes`);
	const staged = await buildStagedClusterModel();
	writeFileSync(join(MODELS_DIR, CLUSTER_STAGED_FILE), staged.glb);
	console.log(`${CLUSTER_STAGED_FILE}: ${staged.glb.byteLength} bytes`);
	for (const [name, band] of staged.stages) {
		writeFileSync(join(MODELS_DIR, name), band);
		console.log(`${name}: ${band.byteLength} bytes`);
	}
	mkdirSync(TREES_DIR, { recursive: true });
	for (const [name, tree] of await buildTreeFixtures()) {
		writeFileSync(join(TREES_DIR, name), tree);
		console.log(`${name}: ${tree.byteLength} bytes`);
	}
}

// The cluster test model that the repository keeps, and the step that builds it. A tree of cluster
// patches comes from the asset tool, so a page that draws patches loads a model that the tool
// optimized with `--clusters`. The model is a heightfield of 32,768 triangles: large enough for a
// tree, with one opaque material and no texture, so the file stays small.
//
// The build runs the tool in this process, and the tool is deterministic, so
// `bun packages/cli/src/assets/cluster-fixture.ts` writes the same bytes on every machine. A unit
// test in `clusters.test.ts` checks that the committed file matches it.
//
// The step sits in the tool's folder because it builds a glTF document, and glTF-Transform is a
// dependency of the tool, not of the tests.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { DEFAULT_OPTIONS, optimizeModel } from './pipeline.js';

/** The folder of the test models, beside the test pages that load them. */
export const MODELS_DIR = join(import.meta.dirname, '../../../../tests/pages/assets/models');

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
}

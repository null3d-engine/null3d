// The staged-levels test model that the repository keeps, and the step that builds it. Levels come
// from the asset tool, so a page that streams them loads a model that the tool optimized with
// `--lod --stages`: the file holds the coarsest level and the full vertex stream, and each finer
// level downloads from a file of its own.
//
// The model is the cluster fixture's heightfield of 32,768 triangles with one opaque material and
// no texture, so the files stay small. The build runs the tool in this process, and the tool is
// deterministic, so `bun packages/cli/src/assets/staged-fixture.ts` writes the same bytes on every
// machine. A unit test in `levels.test.ts` checks that the committed files match it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { MODELS_DIR, terrainDocument } from './cluster-fixture.js';
import { DEFAULT_OPTIONS, optimizeModel } from './pipeline.js';

/** The model that draws its coarsest level first and streams its finer ones. */
export const STAGED_FILE = 'staged-terrain.glb';

/** The path of the model from a test page, which the dev server serves from this folder. */
export const STAGED_PATH = `assets/models/${STAGED_FILE}`;

/** Builds the staged model with its stage files and its report, as the asset tool writes them. */
export async function buildStagedModel() {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-staged-fixture-'));
	try {
		const io = new NodeIO();
		const source = join(folder, 'terrain.glb');
		writeFileSync(source, await io.writeBinary(terrainDocument()));
		const model = await optimizeModel(
			source,
			{ ...DEFAULT_OPTIONS, lod: true, stages: true, maxTextureSize: 64 },
			() => {
				throw new Error('the heightfield has no texture to encode');
			},
		);
		if (model.stages.size === 0) throw new Error('the tool wrote no stage file');
		return model;
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const model = await buildStagedModel();
	writeFileSync(join(MODELS_DIR, STAGED_FILE), model.glb);
	console.log(`${STAGED_FILE}: ${model.glb.byteLength} bytes`);
	for (const [name, bytes] of model.stages) {
		writeFileSync(join(MODELS_DIR, name), bytes);
		console.log(`${name}: ${bytes.byteLength} bytes`);
	}
}

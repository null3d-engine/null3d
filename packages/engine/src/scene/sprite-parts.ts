// The quad and the material of a new sprite batch (see sprites.ts). The sketch runner hands
// `spriteParts` to the scene, so the scene's own module imports no value from the material and
// mesh modules, and a release build of it keeps none of their error text.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import { meshFromArrays } from './mesh-arrays';
import type { Materials } from './resources';
import type { SpriteOptions, SpriteParts, SpriteValues } from './sprites';

/**
 * The quad of the sprites with anchor `center`: one unit wide and high, in the xy plane, with
 * texture coordinates from 0 at its bottom left to 1 at its top right, and the anchor at the
 * origin. `meshes` holds the quads made so far, by center, which batches with one center share.
 */
function quadMesh(
	core: CoreMemory,
	meshes: Map<string, number>,
	center: readonly [number, number],
	call: string,
): number {
	const [cx, cy] = center;
	const key = `${cx},${cy}`;
	const known = meshes.get(key);
	if (known !== undefined) return known;
	const [left, bottom] = [0 - cx, 0 - cy];
	const [right, top] = [1 - cx, 1 - cy];
	const positions = new Float32Array([
		left,
		bottom,
		0,
		right,
		bottom,
		0,
		right,
		top,
		0,
		left,
		top,
		0,
	]);
	const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
	// Every mesh has normals. The sprite shaders read none, so the quad's face +z.
	const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
	const mesh = core.checkGrowth(
		meshFromArrays(core, { positions, normals, uvs, indices: [0, 1, 2, 0, 2, 3] }, call),
		call,
	);
	meshes.set(key, mesh);
	return mesh;
}

/**
 * Checks the options of `scene.createSprites` and makes the batch's quad, and its material with
 * `materials`. Throws E1108 for an atlas side that is not a whole number from 1 to 2048, and E1203
 * for a center that is not two finite numbers.
 */
export function spriteParts(
	core: CoreMemory,
	materials: Materials,
	quads: Map<string, number>,
	options: SpriteOptions,
	call: string,
): SpriteParts {
	const { columns = 1, rows = 1 } = options.atlas ?? {};
	for (const [name, side] of [
		['columns', columns],
		['rows', rows],
	] as const)
		if (!Number.isInteger(side) || side < 1 || side > C.SPRITE_MAX_ATLAS_SIDE)
			throw new EngineError(
				'E1108',
				`${call}() got ${side} atlas ${name}. An atlas has from 1 to ${C.SPRITE_MAX_ATLAS_SIDE} whole ${name}.`,
			);
	const center = options.center ?? [0.5, 0.5];
	if (DEV && !(Number.isFinite(center[0]) && Number.isFinite(center[1])))
		throw new EngineError('E1203', `${call}() got [${center}] for center.`);
	const material = materials.create<SpriteValues>(
		C.SHADING_SPRITE,
		{
			...options,
			alphaMode: options.alphaMode ?? 'blend',
			doubleSided: true,
			vertexColors: false,
			uvTransform: { repeat: [1 / columns, 1 / rows] },
		},
		`${call}.material`,
	);
	return { mesh: quadMesh(core, quads, center, call), material, columns, rows };
}

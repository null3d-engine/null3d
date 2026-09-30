// When the page asks, raises five engine errors and catches each. It posts each error's code,
// message and name to the page, and whether the sketch sees it as an EngineError. The scene API
// rejects the color itself. The engine core rejects the active count past the batch's capacity,
// and two meshes from arrays: one with an index past its vertices, and one with a texture
// coordinate that is not a number. The sketch makes the last error with the EngineError class that
// it imports. In a production build, the sketch's bundle holds its own copy of the engine's error
// code, apart from the copy in the engine's worker code.
import { defineSketch, EngineError } from '@null3d/engine';
import { type ErrorFields, errorFields, noError } from '../lib/error-fields';

/** Rows in the sketch's instance batch. */
const ROWS = 10;
/** A triangle whose normals the engine computes. */
const TRIANGLE = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], computeNormals: true };

/** The error that a call throws, as the page can receive it. */
function raised(call: () => void): ErrorFields {
	try {
		call();
		return noError('the call did not throw');
	} catch (e) {
		return errorFields(e);
	}
}

export default defineSketch(({ scene, materials, geometry, page }) => {
	const batch = scene.createInstances(geometry.box(), ROWS, {
		material: materials.unlit({ color: '#ffffff' }),
	});
	page.onMessage((name) => {
		if (name !== 'raise') return;
		page.post('raised', [
			raised(() => scene.setBackground('blue-ish')),
			raised(() => batch.setActiveCount(ROWS + 1)),
			raised(() => geometry.fromArrays({ ...TRIANGLE, indices: [0, 1, 3] })),
			raised(() => geometry.fromArrays({ ...TRIANGLE, uvs: [0, 0, 1, 0, Number.NaN, 1] })),
			raised(() => {
				throw new EngineError('E1108', `the sketch asked for row ${ROWS + 1} of ${ROWS}.`);
			}),
		]);
	});
	return {};
});

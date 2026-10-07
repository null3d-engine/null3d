// When the page asks, raises six engine errors and catches each. It posts each error's code,
// message and name to the page, and whether the sketch sees it as an EngineError. The scene API
// rejects the color itself. The engine core rejects the active count past the batch's capacity,
// and two meshes from arrays: one with an index past its vertices, and one with a texture
// coordinate that is not a number. The sketch makes the fifth error with the EngineError class that
// it imports. The core's render graph rejects the last: a scene pass that reads a texture no pass
// writes. In a production build, the sketch's bundle holds its own copy of the engine's error
// code, apart from the copy in the engine's worker code.
// When the page asks for queries, the sketch makes raycasts and overlap queries whose input is not
// finite in 32 bits, which must throw in every build. Then two rays must still find the box ahead
// of them: one with a direction too small to square in 64 bits, and one with a direction too large.
import { defineSketch, EngineError, type RaycastHit } from '@null3d/engine';
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

export default defineSketch(({ scene, materials, geometry, page, render }) => {
	const material = materials.unlit({ color: '#ffffff' });
	const batch = scene.createInstances(geometry.box(), ROWS, { material });
	scene.createMesh({ mesh: geometry.box(), material, position: [0, 3, -10] });
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: [0, 0, 0],
		normal: [0, 0, 0],
		distance: 0,
		triangle: -1,
	};
	const eye = [0, 3, 0];
	page.onMessage((name) => {
		if (name === 'query') {
			page.post('queried', {
				errors: [
					raised(() => scene.raycast(eye, [0, 0, 0], undefined, hit)),
					raised(() => scene.raycastAny([0, Number.NaN, 0], [0, 0, -1])),
					raised(() => scene.raycastAll([0, 3, 1e39], [0, 0, -1], undefined, [])),
					raised(() => scene.overlapBox([0, 0, -Infinity], [1, 1, Infinity], undefined, [])),
					raised(() => scene.overlapBox([-1e39, 0, 0], [1e39, 1, 1], undefined, [])),
					raised(() => scene.overlapSphere([0, 0, 0], 1e39, undefined, [])),
					raised(() =>
						scene.raycastBatch(new Float64Array(7), undefined, { distances: new Float32Array(2) }),
					),
				],
				tiny: scene.raycast(eye, [0, 0, -1e-200], undefined, hit) ? hit.distance : -1,
				huge: scene.raycastAny(eye, [0, 0, -1e300]),
			});
			return;
		}
		if (name !== 'raise') return;
		page.post('raised', [
			raised(() => scene.setBackground('blue-ish')),
			raised(() => batch.setActiveCount(ROWS + 1)),
			raised(() => geometry.fromArrays({ ...TRIANGLE, indices: [0, 1, 3] })),
			raised(() => geometry.fromArrays({ ...TRIANGLE, uvs: [0, 0, 1, 0, Number.NaN, 1] })),
			raised(() => {
				throw new EngineError('E1108', `the sketch asked for row ${ROWS + 1} of ${ROWS}.`);
			}),
			raised(() =>
				render.addPass({
					kind: 'scene',
					name: 'broken',
					camera: scene.createPerspectiveCamera(),
					writes: 'broken-map',
					size: [64, 64],
					reads: ['nothing'],
				}),
			),
		]);
	});
	return {};
});

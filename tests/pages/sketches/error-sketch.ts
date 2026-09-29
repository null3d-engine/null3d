// When the page asks, raises three engine errors and catches each. It posts each error's code,
// message and name to the page, and whether the sketch sees it as an EngineError. The scene API
// rejects the color itself, the engine core rejects the active count past the batch's capacity,
// and the sketch makes the third error with the EngineError class that it imports. In a production
// build, the sketch's bundle holds its own copy of the engine's error code, apart from the copy in
// the engine's worker code.
import { defineSketch, EngineError } from '@null3d/engine';
import { type ErrorFields, errorFields, noError } from '../lib/error-fields';

/** Rows in the sketch's instance batch. */
const ROWS = 10;

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
			raised(() => {
				throw new EngineError('E1108', `the sketch asked for row ${ROWS + 1} of ${ROWS}.`);
			}),
		]);
	});
	return {};
});

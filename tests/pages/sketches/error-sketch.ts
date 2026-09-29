// When the page asks, makes two calls that the scene API rejects, catches each error, and posts its
// code, message and name to the page. The scene API rejects the color itself, and the engine core
// rejects the active count past the batch's capacity.
import { defineSketch } from '@null3d/engine';
import { errorFields } from '../lib/error-fields';

/** Rows in the sketch's instance batch. */
const ROWS = 10;

/** The error that a call throws, as the page can receive it. */
function raised(call: () => void) {
	try {
		call();
		return { code: 'none', message: 'the call did not throw', name: '' };
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
		]);
	});
	return {};
});

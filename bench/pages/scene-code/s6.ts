// S6's shared per-frame code alone: the camera's drive along the route. The city stands still, and
// its loading, culling, picking and labels are each engine's own work, so they are not here.
import { sampleUrl } from '../../../tools/lib/sample-url';
import { createS6, type S6Layout, s6Camera } from '../../scenes/s6';
import { runSceneCodePage } from './harness';

runSceneCodePage('s6', async (options) => {
	const layout = (await (
		await fetch(sampleUrl('sources/city/layout/layout.json'))
	).json()) as S6Layout;
	const data = createS6(layout, options.count ?? undefined);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n: data.count,
		frame(t) {
			s6Camera(data, t, eye, target);
		},
	};
});

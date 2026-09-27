// S1-static's shared per-frame code alone: the camera's flight. Its instances never move.
import { S1_DEFAULT_COUNT, s1StaticCamera } from '../../scenes/spec';
import { runSceneCodePage } from './harness';

runSceneCodePage('s1-static', ({ count }) => {
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n: count ?? S1_DEFAULT_COUNT,
		frame(t) {
			s1StaticCamera(t, eye, target);
		},
	};
});

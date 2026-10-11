// S5's shared per-frame code alone: each character's place and turn on its ring, and the camera's
// orbit. The clips' sampling is each engine's own work, so it is not here.
import { createS5, S5_DEFAULT_COUNT, s5CameraPath, s5CharactersAt } from '../../scenes/s5';
import { runSceneCodePage } from './harness';

runSceneCodePage('s5', (options) => {
	const data = createS5(options.count ?? S5_DEFAULT_COUNT);
	const clock = new Float64Array(1);
	const positions = new Float64Array(data.count * 3);
	const rotations = new Float64Array(data.count * 4);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	const camera = s5CameraPath(data);
	return {
		n: data.count,
		frame(t) {
			clock[0] = t;
			s5CharactersAt(data, clock, positions, rotations);
			camera(t, eye, target);
		},
	};
});

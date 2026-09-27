// S1's shared per-frame code alone: every instance's motion and the orbiting camera.
import { createS1, S1_DEFAULT_COUNT, s1Camera, s1InstanceAt } from '../../scenes/spec';
import { runSceneCodePage } from './harness';

runSceneCodePage('s1', ({ count }) => {
	const n = count ?? S1_DEFAULT_COUNT;
	const data = createS1(n);
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n,
		frame(t) {
			for (let i = 0; i < n; i++) s1InstanceAt(data, i, t, position, rotation);
			s1Camera(t, eye, target);
		},
	};
});

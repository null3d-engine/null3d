// S4's shared per-frame code alone: the vehicles' paths and the camera's. The town never moves.
import { createS4, s4Camera, s4VehiclesAt } from '../../scenes/spec';
import { runSceneCodePage } from './harness';

runSceneCodePage('s4', () => {
	const data = createS4();
	const clock = new Float64Array(1);
	const positions = new Float64Array(data.vehicles * 3);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n: data.count,
		frame(t) {
			clock[0] = t;
			s4VehiclesAt(data, clock, positions);
			s4Camera(t, eye, target);
		},
	};
});

// S4's shared per-frame code alone: the vehicles' paths and the camera's. The town never moves.
import { createS4, s4Camera, s4VehicleAt } from '../../scenes/spec';
import { runSceneCodePage } from './harness';

runSceneCodePage('s4', () => {
	const data = createS4();
	const vehicles = new Float64Array(data.vehicles * 7);
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n: data.count,
		frame(t) {
			for (let i = 0; i < data.vehicles; i++) {
				s4VehicleAt(data, i, t, position, rotation);
				vehicles.set(position, i * 7);
				vehicles.set(rotation, i * 7 + 3);
			}
			s4Camera(t, eye, target);
		},
	};
});

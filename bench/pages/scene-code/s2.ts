// S2's shared per-frame code alone: the turn of every tree's root and the orbiting camera.
import { S2_NODE_COUNT, S2_ROOTS, s2Camera, s2RootRotation } from '../../scenes/spec';
import { runSceneCodePage } from './harness';

runSceneCodePage('s2', () => {
	const turns = new Float64Array(S2_ROOTS);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n: S2_NODE_COUNT,
		frame(t) {
			for (let r = 0; r < S2_ROOTS; r++) turns[r] = s2RootRotation(t, r);
			s2Camera(t, eye, target);
		},
	};
});

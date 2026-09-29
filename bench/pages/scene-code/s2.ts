// S2's shared per-frame code alone: the turn of every tree's root and the orbiting camera.
import {
	S2_NODE_COUNT,
	S2_NODES_PER_TREE,
	s2Camera,
	s2RootRotation,
	s2Trees,
} from '../../scenes/spec';
import { runSceneCodePage } from './harness';

runSceneCodePage('s2', ({ count }) => {
	const trees = s2Trees(count ?? S2_NODE_COUNT);
	const turns = new Float64Array(trees);
	const eye = new Float64Array(3);
	const target = new Float64Array(3);
	return {
		n: trees * S2_NODES_PER_TREE,
		frame(t) {
			for (let r = 0; r < trees; r++) turns[r] = s2RootRotation(t, r);
			s2Camera(t, eye, target);
		},
	};
});

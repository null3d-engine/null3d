// The page of the null3d version of s2; the scene runs in its sketch module.
import { S2_NODE_COUNT, S2_NODES_PER_TREE, s2Trees } from '../../scenes/spec';
import { runNull3dPage } from './harness';

// S2 draws whole trees: the page rounds ?n= up to whole trees and reports the real count.
runNull3dPage(
	's2',
	new URL('./s2-sketch.ts', import.meta.url),
	S2_NODE_COUNT,
	(count) => s2Trees(count) * S2_NODES_PER_TREE,
);

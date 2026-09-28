// The null3d version of S2, the hierarchy: 14 trees of separate meshes whose roots turn every
// frame. Every node is a scene object under its parent; the engine propagates the roots' turns to
// the static children, level by level on its job workers.
import { defineGame, type Mesh } from '@null3d/engine';
import {
	createS2,
	S2_COLORS,
	S2_MESH_COUNT,
	S2_NODE_COUNT,
	s2Camera,
	s2MeshSize,
	s2RootRotation,
} from '../../scenes/spec';
import { followPath, readGameOptions, sceneTime, setUpView } from './game-common';

export default defineGame((context) => {
	const { scene, materials, geometry } = context;
	const options = readGameOptions(import.meta.url);
	const moveCamera = followPath(setUpView(context), s2Camera);
	const data = createS2();
	const meshes = Array.from({ length: S2_MESH_COUNT }, (_, k) => {
		const [width, height, depth] = s2MeshSize(k);
		return geometry.box({ width, height, depth });
	});
	const colors = S2_COLORS.map((color) => materials.standard({ color }));
	const nodes: Mesh[] = [];
	const roots: Mesh[] = [];
	for (let i = 0; i < S2_NODE_COUNT; i++) {
		const mesh = meshes[data.mesh[i] ?? -1];
		const material = colors[data.material[i] ?? -1];
		if (!mesh || !material)
			throw new Error(`S2 node ${i} uses a mesh or material that does not exist`);
		const angle = data.rotationY[i] ?? 0;
		const scale = data.scale[i] ?? 1;
		const parent = nodes[data.parent[i] ?? -1];
		const node = scene.createMesh({
			mesh,
			material,
			parent: parent ?? null,
			position: [
				data.position[i * 3] ?? 0,
				data.position[i * 3 + 1] ?? 0,
				data.position[i * 3 + 2] ?? 0,
			],
			rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
			scale: [scale, scale, scale],
			// Roots turn every frame; the rest never change their local transform.
			dynamic: !parent,
		});
		nodes.push(node);
		if (!parent) roots.push(node);
	}
	const pose = (t: number) => {
		for (let r = 0; r < roots.length; r++) {
			const half = s2RootRotation(t, r) / 2;
			roots[r]?.setRotation(0, Math.sin(half), 0, Math.cos(half));
		}
		moveCamera(t);
	};
	pose(sceneTime(options, context));
	return {
		onUpdate() {
			pose(sceneTime(options, context));
		},
	};
});

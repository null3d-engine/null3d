// The three.js twin of S2, the hierarchy: trees of separate meshes (14 unless `?n=` asks for another
// count) whose roots turn every frame. Every node is a regular Mesh in an Object3D hierarchy, and
// three.js updates the world matrices itself. BatchedMesh, three.js's usual tool for many draws,
// cannot hold a hierarchy, so it does not fit this scene. The page rounds `?n=` up to whole trees and
// reports the real count.
import type * as ThreeModule from 'three';
import {
	createS2,
	S2_COLORS,
	S2_MESH_COUNT,
	S2_NODE_COUNT,
	s2Camera,
	s2MeshSize,
	s2RootRotation,
	s2Trees,
} from '../../scenes/spec';
import { runThreePage } from './harness';

runThreePage('s2', (three, scene, { count }) => {
	const data = createS2(2, s2Trees(count ?? S2_NODE_COUNT));
	const geometries = Array.from(
		{ length: S2_MESH_COUNT },
		(_, k) => new three.BoxGeometry(...s2MeshSize(k)),
	);
	const materials = S2_COLORS.map((color) => new three.MeshStandardMaterial({ color }));
	const nodes: ThreeModule.Mesh[] = [];
	const roots: ThreeModule.Mesh[] = [];
	for (let i = 0; i < data.parent.length; i++) {
		const geometry = geometries[data.mesh[i] ?? -1];
		const material = materials[data.material[i] ?? -1];
		if (!geometry || !material)
			throw new Error(`S2 node ${i} uses a mesh or material that does not exist`);
		const node = new three.Mesh(geometry, material);
		node.position.fromArray(data.position, i * 3);
		node.rotation.y = data.rotationY[i] ?? 0;
		node.scale.setScalar(data.scale[i] ?? 1);
		const parent = nodes[data.parent[i] ?? -1];
		if (parent) {
			// A child's local transform never changes. Following three.js's advice for such objects,
			// its local matrix is composed once; three.js still updates its world matrix each frame.
			node.matrixAutoUpdate = false;
			node.updateMatrix();
			parent.add(node);
		} else {
			scene.add(node);
			roots.push(node);
		}
		nodes.push(node);
	}
	return {
		n: data.parent.length,
		update(t) {
			for (let r = 0; r < roots.length; r++) {
				const root = roots[r];
				if (root) root.rotation.y = s2RootRotation(t, r);
			}
		},
		camera: s2Camera,
	};
});

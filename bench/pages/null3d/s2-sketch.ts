// The null3d version of S2, the hierarchy: trees of separate meshes (14 unless the page asks for
// another count) whose roots turn every frame. Every node is a scene object under its parent; the
// engine propagates the roots' turns to the static children, level by level on its job workers.
// When the page asks for shadows, the sun casts them and every node casts and receives them.
// ?sides=two draws every box see-through and double-sided, so the transparent pass draws each
// box's back faces, then its front faces, and ?sides=one draws both faces in one draw, to time the
// second draw.
import { defineSketch, type Mesh } from '@null3d/engine';
import {
	BACKGROUND,
	createS2,
	S2_COLORS,
	S2_MESH_COUNT,
	s2Camera,
	s2MeshSize,
	s2RootRotation,
	s2Trees,
	VIEW_LIGHTS,
} from '../../scenes/spec';
import { followPath, readCount, readShadows, setUpView } from './sketch-common';

export default defineSketch((context) => {
	const { scene, materials, geometry, time } = context;
	const cascades = readShadows(import.meta.url);
	const moveCamera = followPath(
		setUpView(context, VIEW_LIGHTS, BACKGROUND, { cascades }),
		s2Camera,
	);
	const data = createS2(2, s2Trees(readCount(import.meta.url)));
	const meshes = Array.from({ length: S2_MESH_COUNT }, (_, k) => {
		const [width, height, depth] = s2MeshSize(k);
		return geometry.box({ width, height, depth });
	});
	const sides = new URL(import.meta.url).searchParams.get('sides');
	const seeThrough =
		sides === null
			? {}
			: ({
					opacity: 0.85,
					alphaMode: 'blend',
					doubleSided: true,
					forceSinglePass: sides === 'one',
				} as const);
	const colors = S2_COLORS.map((color) => materials.standard({ color, ...seeThrough }));
	const nodes: Mesh[] = [];
	const roots: Mesh[] = [];
	for (let i = 0; i < data.parent.length; i++) {
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
			castShadows: cascades > 0,
			receiveShadows: cascades > 0,
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
	pose(time.now);
	return {
		onUpdate() {
			pose(time.now);
		},
	};
});

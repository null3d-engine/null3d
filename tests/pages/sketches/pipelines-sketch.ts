// A scene of ten render pipelines for the warm-up test: the lit and unlit materials on quads of
// four vertex formats, and the texture coordinate material on the two formats with coordinates.
// The setup awaits scene.warmUp. On the page's `add` message, the sketch adds a hidden magenta quad
// in a vertex format that no pipeline draws yet, warms the scene up again, then shows the quad and
// posts `warmed`. The page finds the quad by its exact color, so the sketch draws with no tone
// mapping.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import { texCoordsMaterial } from '@null3d/engine/internal';

const QUAD_POSITIONS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
const QUAD_NORMALS = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];

/** A unit quad with texture coordinates when `uvs` is set, and vertex colors when `colors` is. */
function quad(uvs: boolean, colors: boolean, uvs1 = false): MeshArrays {
	return {
		positions: QUAD_POSITIONS,
		normals: QUAD_NORMALS,
		indices: QUAD_INDICES,
		...(uvs && { uvs: [0, 0, 1, 0, 1, 1, 0, 1] }),
		...(uvs1 && { uvs1: [0, 0, 1, 0, 1, 1, 0, 1] }),
		...(colors && { colors: new Float32Array(16).fill(0.5) }),
	};
}

export default defineSketch(async ({ scene, materials, geometry, page, post }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 50 });
	camera.setPosition(0, 0, 8);
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.3, -0.5, -1], color: '#ffffff', intensity: 2 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });

	const lit = materials.standard({ color: '#d0d4dc' });
	const unlit = materials.unlit({ color: '#4080f0' });
	const coordinates = texCoordsMaterial(materials);
	let column = 0;
	const place = (mesh: ReturnType<typeof geometry.fromArrays>, material: typeof lit) => {
		scene.createMesh({ mesh, material, position: [-4.5 + column * 0.9, -0.5, 0] });
		column++;
	};
	for (const [uvs, colors] of [
		[false, false],
		[true, false],
		[false, true],
		[true, true],
	] as const) {
		const mesh = geometry.fromArrays(quad(uvs, colors));
		place(mesh, lit);
		place(mesh, unlit);
		if (uvs) place(mesh, coordinates);
	}
	await scene.warmUp();

	page.onMessage((type) => {
		if (type !== 'add') return;
		const added = scene.createMesh({
			mesh: geometry.fromArrays(quad(false, false, true)),
			material: materials.unlit({ color: '#ff00ff' }),
			position: [-0.5, 1, 0],
		});
		added.setVisible(false);
		void scene.warmUp().then(() => {
			added.setVisible(true);
			page.post('warmed');
		});
	});
});

// The culling spheres that the debug switch draws, over a row of level meshes: each object's mesh
// has levels of detail, so its culling sphere is the sphere that the size rule tests. `?spheres=on`
// turns the spheres on. A few frames in, the sketch reports what the last frame drew, so a switch
// that drew nothing reports zero rather than passing quietly.
import { defineSketch, type MeshArrays } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** True when the sketch module's ?spheres=on switch draws the spheres. */
const WANTED = params.get('spheres') === 'on';
/** The copies of the level mesh, one culling sphere each. */
const COPIES = 5;
/** The frame on which the sketch reports what the frame before it drew. */
const REPORT_FRAME = 5;

/** A sphere of radius 1, with `segments` around and half as many from pole to pole. */
function sphere(segments: number): MeshArrays {
	const rings = Math.max(2, Math.floor(segments / 2));
	const positions: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rings; r++) {
		const polar = (r / rings) * Math.PI;
		for (let s = 0; s <= segments; s++) {
			const turn = (s / segments) * Math.PI * 2;
			positions.push(
				Math.sin(polar) * Math.cos(turn),
				Math.cos(polar),
				Math.sin(polar) * Math.sin(turn),
			);
		}
	}
	for (let r = 0; r < rings; r++)
		for (let s = 0; s < segments; s++) {
			const a = r * (segments + 1) + s;
			const b = a + segments + 1;
			indices.push(a, a + 1, b, b, a + 1, b + 1);
		}
	return { positions, normals: positions, indices };
}

export default defineSketch(({ scene, geometry, materials, debug, page }) => {
	scene.setBackground('#20242c');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.5,
			far: 200,
			position: [0, 2, 8],
			target: [0, 0, -6],
		}),
	);
	scene.createAmbientLight({ color: '#ffffff', intensity: 1 });
	const base = geometry.fromArrays(sphere(24));
	base.setLevels([{ mesh: geometry.fromArrays(sphere(12)), error: 0.1 }], { fade: false });
	const material = materials.standard({ color: '#88aa66', roughness: 0.5 });
	for (let k = 0; k < COPIES; k++)
		scene.createMesh({
			mesh: base,
			material,
			position: [(k - (COPIES - 1) / 2) * 3, 0, -6],
		});
	if (WANTED) debug.cullingSpheres(true);
	let frames = 0;
	return {
		onUpdate() {
			frames += 1;
			if (frames === REPORT_FRAME)
				page.post('spheres', { drawn: debug.cullingSpheresDrawn(), frames });
		},
	};
});

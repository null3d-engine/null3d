// The debug views: a small scene of lit, unlit, see-through and instanced objects, drawn with the
// view that ?view= names. A floor runs from near the camera to past its far plane, so the depth
// view shows every gray, and a see-through box covers two objects, so overdraw shows the layers.
import { type DebugView, defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const view = (params.get('view') ?? 'normals') as DebugView;
// PROBE: floor placements and a floor-only scene for CI experiments.
const FLOORS: Record<string, { height: number; z: number; width: number }> = {
	default: { width: 12, height: 80, z: -30 },
	inside: { width: 6, height: 6, z: -3 },
	front: { width: 12, height: 75, z: -32.5 },
	behind: { width: 12, height: 30, z: -5 },
};
const floor = FLOORS[params.get('floor') ?? 'default'] ?? FLOORS.default!;
const onlyFloor = params.has('only-floor');

export default defineSketch(({ scene, materials, geometry, debug }) => {
	scene.setBackground('#3a5f8a');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.5,
			far: 40,
			position: [0, 3, 7],
			target: [0, 0.5, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.3 });
	scene.createMesh({
		mesh: geometry.plane({ width: floor!.width, height: floor!.height }),
		material: materials.standard({ color: '#7a8b6f' }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		position: [0, 0, floor!.z],
	});
	if (onlyFloor) {
		debug.view(view);
		return {};
	}
	scene.createMesh({
		mesh: geometry.box(),
		material: materials.standard({ color: '#e8554e' }),
		position: [-2, 0.5, 0],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.7, widthSegments: 16, heightSegments: 10 }),
		material: materials.unlit({ color: '#4a8cff' }),
		position: [0, 0.7, -1],
	});
	scene.createMesh({
		mesh: geometry.torus({ radius: 0.6, tube: 0.2 }),
		material: materials.standard({ color: '#f2c14e' }),
		position: [2, 0.8, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 3, height: 1.6, depth: 1 }),
		material: materials.standard({ color: '#ffffff', opacity: 0.4, alphaMode: 'blend' }),
		position: [-1, 0.8, 1.5],
	});
	const cubes = scene.createInstances(geometry.box({ width: 0.4, height: 0.4, depth: 0.4 }), 5, {
		material: materials.standard({ color: '#9b6bd6' }),
	});
	for (let k = 0; k < 5; k++) {
		cubes.positions.set([k - 2, 0.2, -4], k * 3);
		cubes.rotations.set([0, 0, 0, 1], k * 4);
		cubes.scales.set([1, 1, 1], k * 3);
	}
	cubes.markDirty();
	debug.view(view);
	return {};
});

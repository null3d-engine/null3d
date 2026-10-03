// The debug views: a small scene of lit, unlit, see-through and instanced objects, drawn with the
// view that ?view= names. In the shadows view the sun casts shadows, and every object casts and
// receives them: the unlit sphere and the instances show none. A floor runs from below the view's bottom edge to past the camera's far
// plane, so the depth view shows every gray, and a see-through box covers two objects, so overdraw
// shows the layers. The floor starts in front of the camera: SwiftShader, CI's software GPU, takes
// a line's direction from its projected ends before it clips the line. An end behind the camera
// reverses it, and the line fills no pixels, so the wireframe would lose the floor's edges.
import { type DebugView, defineSketch } from '@null3d/engine';

const view = (new URL(import.meta.url).searchParams.get('view') ?? 'normals') as DebugView;

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
	scene.createDirectionalLight({
		direction: [-1, -2, -1],
		intensity: 3,
		castShadows: view === 'shadows',
		shadow: { distance: 40 },
	});
	const shadows = { castShadows: true, receiveShadows: true };
	scene.createAmbientLight({ intensity: 0.3 });
	scene.createMesh({
		mesh: geometry.plane({ width: 12, height: 75 }),
		material: materials.standard({ color: '#7a8b6f' }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		position: [0, 0, -32.5],
		...shadows,
	});
	scene.createMesh({
		mesh: geometry.box(),
		material: materials.standard({ color: '#e8554e' }),
		position: [-2, 0.5, 0],
		...shadows,
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.7, widthSegments: 16, heightSegments: 10 }),
		material: materials.unlit({ color: '#4a8cff' }),
		position: [0, 0.7, -1],
		...shadows,
	});
	scene.createMesh({
		mesh: geometry.torus({ radius: 0.6, tube: 0.2 }),
		material: materials.standard({ color: '#f2c14e' }),
		position: [2, 0.8, 0],
		...shadows,
	});
	scene.createMesh({
		mesh: geometry.box({ width: 3, height: 1.6, depth: 1 }),
		material: materials.standard({ color: '#ffffff', opacity: 0.4, alphaMode: 'blend' }),
		position: [-1, 0.8, 1.5],
		...shadows,
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

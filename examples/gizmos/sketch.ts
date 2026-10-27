// Gizmos: three stone pieces stand on a plinth in a dim gallery, and the mouse or a finger moves,
// turns and scales the piece that is selected. A click selects another piece, and the handles of
// @null3d/controls follow it. The buttons pick what a drag does, as an editor's toolbar does. The
// handles draw over the scene and take the pointer before the camera controls do, so a drag of a
// handle never turns the view.
import { createTransformControls, type GizmoMode } from '@null3d/controls';
import { defineSketch } from '@null3d/engine';
import { torusKnot } from '@null3d/geometry';
import { interact } from '../lib/interact';

/** The mode that each button picks. */
const MODES: Record<string, GizmoMode> = {
	Translate: 'translate',
	Rotate: 'rotate',
	Scale: 'scale',
};

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, page, textures } = ctx;
	scene.setBackground('#151a22');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.6 });
	post.set({
		bloom: { intensity: 0.25, threshold: 1 },
		vignette: { intensity: 0.6 },
		outline: { color: '#ffd400', width: 2 },
	});
	const camera = scene.createPerspectiveCamera({ fov: 40, position: [3.4, 3, 7.2] });
	camera.lookAt(0, 0.95, 0);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.95, 0] });
	scene.createAmbientLight({ color: '#8090b8', intensity: 0.2 });
	scene.createDirectionalLight({ direction: [-1, -2.4, -1.2], intensity: 2.6, castShadows: true });
	scene.createDirectionalLight({ direction: [0.6, -0.4, -1], intensity: 1.1, color: '#8fb4ff' });
	// A warm rim from behind the pieces separates them from the dark hall.
	scene.createDirectionalLight({ direction: [0.3, -0.5, 1], intensity: 0.8, color: '#ffb27a' });
	scene.createSpotLight({
		position: [2.5, 6, 3],
		target: [0, 1, 0],
		range: 20,
		angle: 0.6,
		penumbra: 0.7,
		intensity: 260,
		color: '#ffe7c8',
		castShadows: true,
	});

	// A slate floor with faint rings, and the plinth that the pieces stand on.
	const data = new Uint8Array(32 * 32 * 4).fill(255);
	for (let i = 0; i < 32 * 32; i++) data.fill(96 + ((i * 37) % 23), i * 4, i * 4 + 3);
	const grain = textures.fromData({ width: 32, height: 32, data, wrap: 'repeat', mipmaps: true });
	scene.createMesh({
		mesh: geometry.circle({ radius: 40, segments: 64 }),
		material: materials.standard({
			color: '#3a4048',
			roughness: 0.5,
			map: grain,
			uvTransform: { repeat: [26, 26] },
		}),
		position: [0, -0.02, 0],
		receiveShadows: true,
	});
	const stone = materials.standard({ color: '#727880', roughness: 0.35 });
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 2.4, radiusBottom: 2.5, height: 0.3, radialSegments: 64 }),
		material: stone,
		position: [0, 0.15, 0],
		castShadows: true,
		receiveShadows: true,
	});

	// Three pieces, each with its own look, so that a turn and a scale show on every one.
	const knot = torusKnot({ radius: 0.42, tube: 0.13, tubularSegments: 128, radialSegments: 16 });
	const brass = materials.standard({ color: '#d9a441', metalness: 1, roughness: 0.22 });
	const jade = materials.standard({ color: '#3fae83', roughness: 0.18, clearcoat: 1 });
	const clay = materials.standard({ color: '#d2604e', roughness: 0.55 });
	const pieces = [
		scene.createMesh({
			name: 'knot',
			mesh: geometry.fromArrays(knot),
			material: brass,
			position: [-1.35, 0.8, 0.6],
			castShadows: true,
			dynamic: true,
		}),
		scene.createMesh({
			name: 'sphere',
			mesh: geometry.sphere({ radius: 0.5, widthSegments: 48, heightSegments: 32 }),
			material: jade,
			position: [-0.1, 0.8, 0],
			castShadows: true,
			dynamic: true,
		}),
		scene.createMesh({
			name: 'capsule',
			mesh: geometry.capsule({ radius: 0.3, height: 0.6, capSegments: 8, radialSegments: 24 }),
			material: clay,
			position: [1.25, 0.9, 0.5],
			rotation: [0, 0, 0.382683, 0.92388],
			castShadows: true,
			dynamic: true,
		}),
	];

	// The handles, on the piece that is selected. A click selects another piece.
	const gizmo = createTransformControls(ctx, camera, { mode: 'translate' });
	let selected = 0;
	const select = (index: number) => {
		pieces[selected]?.setOutlined(false);
		selected = index;
		const piece = pieces[index];
		if (!piece) return;
		piece.setOutlined(true);
		gizmo.attach(piece);
	};
	for (const [index, piece] of pieces.entries())
		piece.on('click', () => {
			if (!gizmo.dragging) select(index);
		});
	select(1);

	page.onMessage((type, data) => {
		if (type === 'mode' && MODES[data as string]) gizmo.setMode(MODES[data as string] as GizmoMode);
	});

	return {
		onUpdate(dt) {
			// The handles take the pointer first: a drag of one leaves the camera where it is.
			gizmo.update(dt);
			if (!gizmo.dragging) view.update(dt);
		},
	};
});

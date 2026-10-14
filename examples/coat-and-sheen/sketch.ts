// Clear coat and sheen in a showroom on a rainy night. A candy red car turns on a varnished
// plinth: metal flakes in its paint glitter under a smooth clear coat, which mirrors the room.
// Rain falls around the plinth onto wet cobbles: puddles are a clear coat that a surface function
// sets where the ground dips, darker beneath, with rain rings in the coat's normal. A reflection
// pass mirrors the room in the puddles. A velvet curtain and a velvet seat glow at their edges
// with sheen, and so do the car's tyres, faintly. A blue lamp follows the pointer across the floor.
// The surface functions of the cobbles and the drapes are in surfaces.ts, the car and its paint
// are in car.ts and the rain in rain.ts.
import { defineSketch, math } from '@null3d/engine';
import { interact } from '../lib/interact';
import { createCar } from './car';
import { createRain } from './rain';
import { cobbles, drapes } from './surfaces';

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render, post, time, engine } = ctx;
	scene.setBackground('#07080b');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.7 });
	post.set({ bloom: { intensity: 0.15, threshold: 1.2 }, ao: { radius: 0.4 }, vignette: {} });
	// A portrait screen gets a wider lens from further back, so the whole car fits across it.
	const portrait = engine.viewport.height > engine.viewport.width;
	const camera = scene.createPerspectiveCamera({
		fov: portrait ? 50 : 40,
		position: portrait ? [4.7, 2.5, 9.6] : [3.6, 2.1, 7.4],
		target: [0, 0.8, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.8, 0], groundY: 0 });
	scene.createDirectionalLight({
		direction: [0.45, -0.8, -0.4],
		color: '#ffd9b0',
		intensity: 2.2,
		castShadows: true,
		shadow: { distance: 20 },
	});
	const lamp = scene.createPointLight({
		position: [2, 1.4, 2],
		color: '#5aa9ff',
		intensity: 18,
		range: 9,
		dynamic: true,
	});

	// The floor, wet cobbles in the rain.
	createRain(ctx);
	const puddles = render.addPass({
		kind: 'reflection',
		writes: 'puddles',
		plane: { point: [0, 0, 0] },
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 40 }),
		material: materials.shader({
			wgsl: cobbles,
			color: '#77716a',
			roughness: 0.85,
			textures: { mirror: textures.fromPass(puddles) },
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const varnish = materials.standard({
		color: '#2b160c',
		roughness: 0.6,
		clearcoat: 0.9,
		clearcoatRoughness: 0.12,
	});
	const plinth = scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 1.9, radiusBottom: 2, height: 0.26, radialSegments: 96 }),
		material: varnish,
		position: [0, 0.13, 0],
		dynamic: true,
		castShadows: true,
		receiveShadows: true,
	});
	// A thin bevel round the plinth's top edge, which catches the light.
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 1.86,
			radiusBottom: 1.9,
			height: 0.04,
			radialSegments: 96,
		}),
		material: varnish,
		parent: plinth,
		position: [0, 0.15, 0],
		castShadows: true,
		receiveShadows: true,
	});
	createCar(ctx, scene.createGroup({ parent: plinth, position: [0, 0.17, 0] }));

	// Velvet: a crimson curtain behind, and a teal seat beside the plinth.
	scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 9, widthSegments: 600, heightSegments: 12 }),
		material: materials.shader({
			wgsl: drapes,
			color: '#3d0410',
			roughness: 0.95,
			sheenColor: '#ff6f8a',
			sheenRoughness: 0.35,
			doubleSided: true,
		}),
		position: [-4, 4.5, -3.2],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.8, widthSegments: 64, heightSegments: 32 }),
		material: materials.standard({
			color: '#05312e',
			roughness: 0.9,
			sheenColor: '#7fffe0',
			sheenRoughness: 0.45,
		}),
		position: [2.9, 0.38, -0.6],
		scale: [1, 0.48, 1],
		castShadows: true,
		receiveShadows: true,
	});

	return {
		onUpdate(dt) {
			view.update(dt);
			plinth.setRotationEuler(0, time.now * 0.25, 0);
			// The lamp glides toward the pointed point, a little above the floor.
			const [x, , z] = view.point;
			lamp.setPosition(math.lerp(2, x, view.steering), 1.4, math.lerp(2, z, view.steering));
		},
	};
});

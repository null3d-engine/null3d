// Light through thin surfaces: a garden at golden hour, with the low sun behind broad leaves and
// flowers. Each leaf lets part of the light that reaches its back through to the camera's side, as
// glTF's diffuse transmission does: the sun shows through it in yellow green, its veins let less
// through, and the shadows of the leaves in front fall on it. The petals glow coral the same way.
// A paper lantern with a lamp inside drifts between the plants and glows from within, and the
// leaves near it light up from behind. The pointer moves the lantern.
import { defineSketch, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { CLUMPS, clump, FLOWERS, ground, leafMesh, leafTexture, plant } from './plants';

/** The point that the camera looks at, in the middle of the garden. */
const TARGET = [0, 1.25, -2.6] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	// Golden hour, with the sun low beyond the garden, to the right of the camera's view.
	const day = timeOfDay(17.35, { heading: -Math.PI / 2 + 0.55 });
	const intensity = day.skyIntensity;
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.25 } }, { intensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: intensity * 0.6 });
	scene.setFog({ color: [0.3, 0.2, 0.15], density: 0.006, sunGlow: day.fog.sunGlow * 0.5 });
	post.set({
		exposure: day.exposure * 0.95,
		bloom: { intensity: 0.15, threshold: 1.5 },
		ao: { radius: 0.4 },
		vignette: {},
	});
	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 5000 });
	scene.setActiveCamera(camera);
	// The pointer points at the lantern's height, over the garden.
	const view = interact(ctx, camera, {
		target: TARGET,
		groundY: 1,
		bounds: [-3, 0.6, -4, 3, 1.6, 0],
	});
	scene.createDirectionalLight({
		...day.light,
		castShadows: true,
		shadow: { distance: 16 },
	});
	scene.createAmbientLight({ ...day.ambient, intensity: day.ambient.intensity * 0.6 });

	ground(ctx);

	// Leaves: the sun shows through them in yellow green, less through the veins, which the
	// texture's alpha marks. Each clump takes one of three greens.
	const vein = leafTexture(textures);
	const leaf = (color: string, through: string) =>
		materials.standard({
			map: vein,
			color,
			roughness: 0.5,
			doubleSided: true,
			diffuseTransmission: 0.35,
			diffuseTransmissionColor: through,
			diffuseTransmissionMap: vein,
		});
	const greens = [
		leaf('#e8ffe0', '#a8f03c'),
		leaf('#ffffff', '#c4f450'),
		leaf('#d0f2c0', '#8ee636'),
	];
	const shapes = [leafMesh(geometry, 0.25, 0.7), leafMesh(geometry, 0.12, 1.1)];
	CLUMPS.forEach(([x, z, count, size], k) => {
		const mesh = shapes[k % 2] as (typeof shapes)[number];
		plant(ctx, mesh, greens[k % 3] as (typeof greens)[number], clump(x, z, count, size));
	});

	// Flowers: five coral petals in a cup on a stem, which glow orange against the sun.
	const petal = materials.standard({
		color: '#f2848c',
		roughness: 0.45,
		doubleSided: true,
		diffuseTransmission: 0.7,
		diffuseTransmissionColor: '#ffa060',
	});
	const stem = materials.standard({ color: '#5d8a3a', roughness: 0.7 });
	const stalk = geometry.cylinder({ radiusTop: 0.012, radiusBottom: 0.018, height: 1 });
	for (const [x, y, z] of FLOWERS) {
		scene.createMesh({ mesh: stalk, material: stem, position: [x, y / 2, z], scale: [1, y, 1] });
		plant(ctx, shapes[0], petal, clump(x, z, 6, 0.3, 0.6), y);
	}

	// The paper lantern: a lamp inside a sphere of paper, which lets its light through.
	const paper = materials.standard({
		color: '#e8d2b0',
		roughness: 0.9,
		diffuseTransmission: 0.85,
		diffuseTransmissionColor: '#ff9c4a',
	});
	const iron = materials.standard({ color: '#2b2622', metalness: 0.6, roughness: 0.4 });
	const lantern = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.2, widthSegments: 32, heightSegments: 16 }),
		material: paper,
		scale: [1, 1.25, 1],
		dynamic: true,
	});
	const cap = scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.06, radiusBottom: 0.09, height: 0.06 }),
		material: iron,
		dynamic: true,
	});
	// The lantern hangs on a cord from out of view.
	const cord = scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.004, radiusBottom: 0.004, height: 4 }),
		material: iron,
		dynamic: true,
	});
	const lamp = scene.createPointLight({
		color: '#ffb060',
		intensity: 0.4,
		range: 3,
		dynamic: true,
	});
	const scripted = vec3.create();
	const at = vec3.create();
	return {
		onUpdate(dt) {
			// The camera sways a little from side to side, low under the leaves, toward the sun.
			const sway = 0.3 * Math.sin(time.now * 0.12);
			if (!view.userCamera) {
				camera.setPosition(Math.sin(sway) * 5.5, 0.45, TARGET[2] + Math.cos(sway) * 5.5);
				camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
			}
			view.update(dt);
			// The lantern drifts on a loop between the plants, and the pointer leads it.
			const t = time.now * 0.22;
			vec3.set(scripted, 1.6 * Math.sin(t), 1 + 0.08 * Math.sin(t * 3.1), -2 + 1 * Math.cos(t));
			view.steer(vec3.copy(at, scripted));
			lantern.setPosition(at[0], at[1], at[2]);
			cap.setPosition(at[0], at[1] + 0.26, at[2]);
			cord.setPosition(at[0], at[1] + 2.28, at[2]);
			lamp.setPosition(at[0], at[1], at[2]);
		},
	};
});

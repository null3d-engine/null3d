// Light under the surface: wax, jade and soap by candlelight. Light that enters wax leaves it a
// little further on, redder the further it went, so the candles look soft, their edges glow and the
// shadows on them blur, while their highlights stay sharp. The subsurface blur draws that on the
// High and Ultra presets, from each material's scatter radius and color. Each flame's light also
// enters the pool of wax under it: a small light inside the candle stands for it, and shows through
// the wall as light through a thin surface does, brightest just under the flame. The unlit candle
// glows only from the others' light. A tea light follows the pointer across the table.
import { defineSketch, type Mesh, type PointLight, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { CANDLES, candleMesh, flameMesh, ornaments, room, wickMesh } from './candles';

/** The point that the camera looks at, among the candles. */
const TARGET = [0, 0.16, -0.04] as const;
/** How bright each flame's light is, before its flicker. */
const FLAME_LIGHT = 1.4;
/** How bright the light inside each lit candle is, against its flame's. */
const INNER_SHARE = 0.2;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	scene.setBackground('#070504');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.03 });
	scene.createAmbientLight({ color: '#4a3326', intensity: 0.04 });
	post.set({
		exposure: 0.25,
		bloom: { intensity: 0.18, threshold: 3 },
		ao: { radius: 0.08 },
		vignette: {},
	});
	const camera = scene.createPerspectiveCamera({ fov: 35, near: 0.02, far: 40 });
	scene.setActiveCamera(camera);
	// The pointer leads the tea light across the table.
	const view = interact(ctx, camera, {
		target: TARGET,
		groundY: 0,
		bounds: [-0.45, 0, -0.1, 0.45, 0, 0.35],
	});

	room(ctx);

	// Wax: its light spreads about 3.5 cm under the surface, red furthest, and the light inside a
	// candle shows through its wall.
	const wax = materials.standard({
		color: '#e2c49a',
		roughness: 0.4,
		subsurfaceRadius: 0.035,
		subsurfaceColor: [1, 0.45, 0.22],
		diffuseTransmission: 0.4,
		diffuseTransmissionColor: '#ff9a50',
	});
	const flameLook = materials.standard({
		color: '#000000',
		emissive: '#ffb24a',
		emissiveIntensity: 40,
		fog: false,
	});
	const wickLook = materials.standard({ color: '#1a1410', roughness: 0.8 });
	const flame = flameMesh(geometry);
	const wick = wickMesh(geometry);
	const flames: { mesh: Mesh; light: PointLight; inner: PointLight }[] = [];
	// A flame is a wide light close to the wax, so its shadows would be soft. A point light's are
	// sharp, so the flames cast none, and only the moving tea light does.
	const light = (x: number, y: number, z: number, shadows = false) =>
		scene.createPointLight({
			position: [x, y + 0.04, z],
			color: '#ff9a4c',
			intensity: FLAME_LIGHT,
			range: 3,
			castShadows: shadows,
			dynamic: true,
		});
	for (const [x, z, height, radius, lit] of CANDLES) {
		scene.createMesh({
			mesh: candleMesh(geometry, height, radius),
			material: wax,
			position: [x, 0, z],
			castShadows: true,
			receiveShadows: true,
		});
		if (!lit) continue;
		const top = height - 0.012;
		const inner = scene.createPointLight({
			position: [x, top - 0.03, z],
			color: '#ff8a3c',
			intensity: FLAME_LIGHT * INNER_SHARE,
			range: 0.12,
			dynamic: true,
		});
		scene.createMesh({ mesh: wick, material: wickLook, position: [x, top + 0.006, z] });
		const mesh = scene.createMesh({
			mesh: flame,
			material: flameLook,
			position: [x, top + 0.01, z],
			dynamic: true,
		});
		flames.push({ mesh, light: light(x, top, z), inner });
	}

	ornaments(ctx);

	// The tea light, which the pointer leads.
	const tea = scene.createMesh({
		mesh: candleMesh(geometry, 0.025, 0.022),
		material: wax,
		castShadows: true,
		receiveShadows: true,
		dynamic: true,
	});
	const teaFlame = scene.createMesh({ mesh: flame, material: flameLook, dynamic: true });
	const teaLight = light(0, 0.03, 0, true);
	const scripted = vec3.create();
	const at = vec3.create();
	return {
		onUpdate(dt) {
			const t = time.now;
			if (!view.userCamera) {
				const turn = 0.45 * Math.sin(t * 0.1);
				camera.setPosition(Math.sin(turn) * 0.95, 0.34, TARGET[2] + Math.cos(turn) * 0.95);
				camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
			}
			view.update(dt);
			// Each flame flickers on its own rhythm, and its light with it.
			flames.forEach(({ mesh, light: lamp, inner }, k) => {
				const flicker = 0.9 + 0.1 * Math.sin(t * 13 + k * 2.1) * Math.sin(t * 7.3 + k);
				mesh.setScale(1, flicker, 1);
				lamp.setIntensity(FLAME_LIGHT * flicker);
				inner.setIntensity(FLAME_LIGHT * INNER_SHARE * flicker);
			});
			vec3.set(scripted, 0.3 * Math.sin(t * 0.25), 0, 0.2 + 0.08 * Math.cos(t * 0.25));
			view.steer(vec3.copy(at, scripted));
			tea.setPosition(at[0], 0, at[2]);
			teaFlame.setPosition(at[0], 0.023, at[2]);
			teaLight.setPosition(at[0], 0.06, at[2]);
		},
	};
});

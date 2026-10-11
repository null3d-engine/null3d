// Far from the origin: a tray of 2 cm keys and a spinning brass wheel on a desk, 1,000 km from the
// origin, seen from 40 cm by a camera that circles them. A 32-bit float steps by 6 cm at that
// distance, so world positions in 32-bit floats would pile the keys onto each other and shake the
// view. The engine keeps each object relative to its grid cell instead, and draws every position
// relative to the camera. The keys stay 1 cm apart, their shadows stay sharp and the view stays
// steady. A label over the wheel gives the camera's distance from the origin to the millimeter.
import type { Material, MeshGeometry, MeshOptions, Vec3 } from '@null3d/engine';
import { defineSketch, math, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The scene's place: the center of the grid cell 977 cells of 1,024 m along x. */
const SITE: Vec3 = [977 * 1024, 0, 0];
/** Keys along each side of the tray. */
const KEYS = 8;
/** The distance between the centers of neighboring keys: 2 cm keys with 1 cm gaps. */
const PITCH = 0.03;
/** Spokes on the wheel. */
const SPOKES = 12;
/** The camera's distance from the tray's middle, its height, and its downward tilt in radians. */
const CIRCLE = 0.4;
const HEIGHT = 0.22;
const TILT = 0.5;
/** Where the camera's view meets the tray, along the line from the middle to the camera. */
const REACH = CIRCLE - HEIGHT / Math.tan(TILT);
/** The desk's warm dark, for the background and the fog that hides the desk's edge. */
const ROOM = '#17120e';

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, ui, page, time } = ctx;
	scene.setBackground(ROOM);
	scene.setFog({ color: ROOM, density: 1.5 });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 1 });
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, ao: { radius: 0.01 }, vignette: {} });
	const sun = { direction: [-1, -1.5, -0.7], color: '#ffe0c0', intensity: 2.5 } as const;
	scene.createDirectionalLight({ ...sun, castShadows: true, shadow: { distance: 2 } });

	// Children take the cell of their root object, and keep their places under it to a fraction
	// of a millimeter.
	const site = scene.createGroup({ position: SITE });
	// Orbit controls need a camera whose parents do not turn, so the script circles the camera itself.
	const lens = { fov: 45, near: 0.005, far: 50, parent: site };
	const camera = scene.createPerspectiveCamera({ ...lens, position: [0, HEIGHT, CIRCLE] });
	scene.setActiveCamera(camera);
	const look = vec3.create();
	const view = interact(ctx, camera, { target: look, minDistance: 0.05, maxDistance: 3 });
	const solid = { parent: site, castShadows: true, receiveShadows: true };
	const part = (mesh: MeshGeometry, material: Material, at: Vec3, more?: Partial<MeshOptions>) =>
		scene.createMesh({ mesh, material, position: at, ...solid, ...more });
	const flat = { rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] } as const;

	// Walnut: lines of grain that wave along the board, and a little noise in each texel.
	math.seed(6);
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	for (let i = 0; i < 64 * 64; i++) {
		const across = (i >> 6) + 2 * Math.sin(((i % 64) * Math.PI) / 32);
		const shade = (0.8 + 0.12 * Math.sin((across * Math.PI) / 4)) * math.randFloat(0.92, 1);
		data.fill(shade * 255, i * 4, i * 4 + 3);
	}
	const grain = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: 64, height: 64, data, ...grain });
	const uvTransform = { repeat: [8, 8] } as const;
	const walnut = materials.standard({ map, color: '#6e4429', uvTransform, doubleSided: true });
	part(geometry.plane({ width: 4, height: 4 }), walnut, [0, -0.011, 0], flat);
	const steel = { metalness: 1, roughness: 0.3 };
	const tray = geometry.box({ width: 0.3, height: 0.01, depth: 0.3 });
	part(tray, materials.standard({ color: '#4a4f58', ...steel }), [0, -0.005, 0]);
	// Keys of pale plastic, with a dark row at each end and one orange key.
	const key = geometry.box({ width: 0.02, height: 0.01, depth: 0.02 });
	const keyColors = ['#ece6da', '#3a3d44', '#ff7a3c'].map((color) =>
		materials.standard({ color, roughness: 0.55 }),
	);
	for (let i = 0; i < KEYS * KEYS; i++) {
		const column = i % KEYS;
		const row = Math.floor(i / KEYS);
		const shade = i === 0 ? 2 : row === 0 || row === KEYS - 1 ? 1 : 0;
		const at: Vec3 = [(column - (KEYS - 1) / 2) * PITCH, 0.005, (row - (KEYS - 1) / 2) * PITCH];
		part(key, keyColors[shade], at);
	}

	// A brass wheel of spokes 4 mm thick turns on a steel axle above the tray.
	const brass = materials.standard({ color: '#e0b060', metalness: 1, roughness: 0.2 });
	const axle = geometry.cylinder({ radiusTop: 0.002, radiusBottom: 0.002, height: 0.07 });
	part(axle, materials.standard({ color: '#d0d4d8', ...steel }), [0, 0.035, 0]);
	const wheel = scene.createGroup({ parent: site, position: [0, 0.07, 0], dynamic: true });
	const spoke = geometry.box({ width: 0.004, height: 0.012, depth: 0.05 });
	for (let k = 0; k < SPOKES; k++) {
		const angle = (k / SPOKES) * Math.PI * 2;
		const rotation = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] as const;
		part(spoke, brass, [Math.sin(angle) * 0.03, 0, Math.cos(angle) * 0.03], {
			rotation,
			parent: wheel,
		});
	}
	const rim = geometry.torus({ radius: 0.055, tube: 0.004, tubularSegments: 64 });
	part(rim, brass, [0, 0, 0], { ...flat, parent: wheel });
	// A green light on the tray's corner, bright enough to bloom.
	const led = materials.standard({ emissive: '#39ff88', emissiveIntensity: 6 });
	part(geometry.sphere({ radius: 0.003 }), led, [0.135, 0.002, 0.135], { castShadows: false });

	// The readout floats over the wheel. Its text changes a few times a second, not every frame.
	ui.trackLabel(wheel, 'distance', { offset: [0, 0.05, 0] });
	const where = vec3.create();
	const meters = new Intl.NumberFormat('en-US', {
		minimumFractionDigits: 3,
		maximumFractionDigits: 3,
	});
	let shownAt = -1;

	return {
		onUpdate(dt) {
			// The camera circles the tray and looks down at it, at the point where the controls take over.
			const turn = time.now * 0.3;
			if (!view.userCamera) {
				camera.setPosition(Math.sin(turn) * CIRCLE, HEIGHT, Math.cos(turn) * CIRCLE);
				camera.setRotationEuler(-TILT, turn, 0, 'YXZ');
			}
			vec3.set(look, Math.sin(turn) * REACH, 0, Math.cos(turn) * REACH);
			view.update(dt);
			wheel.setRotationEuler(0, -time.now * 0.8, 0);
			if (time.now - shownAt < 0.25) return;
			shownAt = time.now;
			// The camera's place under the site, added to the site's place in JavaScript's 64-bit numbers.
			camera.getPosition(where);
			const distance = Math.hypot(SITE[0] + where[0], SITE[1] + where[1], SITE[2] + where[2]);
			page.post('label', { id: 'distance', text: `${meters.format(distance)} m from the origin` });
		},
	};
});

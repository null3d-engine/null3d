// Objects and parents: six crates ride a turntable on a studio stage, and each one in turn steps
// off for 3 seconds. setParent with keepWorld moves a crate between the table and the stage
// without moving it in the world, as three.js's attach does. A crate on the table turns with it; a
// crate on the stage stays where it stepped off. The table's turn and each crate's spin come from
// the sketch time. The crates share one panel texture made in code, in six materials: wood, brushed
// steel, copper, gold, red paint and blue lacquer. A spot light casts their shadows, and the built-in
// room environment gives the metals something to reflect.
import { defineSketch, math } from '@null3d/engine';
import { interact } from '../lib/interact';

const CRATES = 6;
/** Seconds between two crates stepping off, and how long each stays off. */
const STAGGER = 1;
const OFF = 3;
/** The table's turn, and each crate's spin on the table, in radians per second. */
const TURN = 0.6;
const SPIN = 1.5;
/** Texels along each side of the panel texture. */
const SIZE = 64;
/** The studio's dark gray, for the background and the fog that hides the stage's edge. */
const STUDIO = '#15171c';

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	scene.setBackground(STUDIO);
	scene.setFog({ color: STUDIO, curve: 'exp2', density: 0.035 });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.7 });
	post.set({ bloom: { intensity: 0.25, threshold: 1 }, ao: { radius: 0.4 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 4.5, 8.5],
		target: [0, 0.3, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.3, 0], maxPolarAngle: Math.PI * 0.48 });
	// A warm key light that casts the shadows, and a cool rim light from behind.
	const key = { range: 30, angle: 0.55, penumbra: 0.6, target: [0, 0, 0] } as const;
	scene.createSpotLight({
		...key,
		position: [-5, 9, 5],
		intensity: 1400,
		color: '#ffe2c4',
		castShadows: true,
	});
	scene.createSpotLight({ ...key, position: [4, 6, -7], intensity: 300, color: '#9cc4ff' });

	const stage = { castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: materials.standard({ color: '#2a2d33', roughness: 0.35, doubleSided: true }),
		position: [0, -0.01, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const table = scene.createGroup({ name: 'table', dynamic: true });
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 3, radiusBottom: 3.1, height: 0.3, radialSegments: 64 }),
		material: materials.standard({ color: '#33363d', roughness: 0.2 }),
		parent: table,
		position: [0, 0.15, 0],
		...stage,
	});
	// A ring of light around the table's foot, bright enough to bloom.
	scene.createMesh({
		mesh: geometry.torus({ radius: 3.12, tube: 0.025, radialSegments: 8, tubularSegments: 128 }),
		material: materials.standard({ color: '#000000', emissive: '#ffb36b', emissiveIntensity: 6 }),
		position: [0, 0.04, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	// Panels: planks of grain in a darker frame, in gray, so that each material gives the color.
	math.seed(11);
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const planks = Array.from({ length: 5 }, () => math.randFloat(0.75, 1));
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const frame = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y) < 6;
			const plank = Math.floor(((y - 6) / (SIZE - 12)) * 5);
			const seam = (y - 6) % 10.4 < 0.8;
			const grain = 0.88 + 0.12 * Math.sin(y * 2.3 + Math.sin(x * 0.2 + plank) * 1.2);
			const shade = frame ? 0.62 : seam ? 0.35 : planks[plank] * grain;
			data.fill(shade * math.randFloat(0.94, 1) * 255, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
		}
	const look = { colorSpace: 'srgb', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: SIZE, height: SIZE, data, ...look });
	const finishes = [
		{ color: '#c08a52', roughness: 0.8 },
		{ color: '#c8ccd2', metalness: 1, roughness: 0.35 },
		{ color: '#e09a6c', metalness: 1, roughness: 0.25 },
		{ color: '#f2c14e', metalness: 1, roughness: 0.15 },
		{ color: '#b3261e', roughness: 0.3 },
		{ color: '#1f5fa8', roughness: 0.1 },
	];
	const crate = geometry.box({ width: 0.7, height: 0.7, depth: 0.7 });
	const crates = finishes.map((finish, k) => {
		const angle = (k / CRATES) * Math.PI * 2;
		return scene.createMesh({
			name: `crate ${k}`,
			mesh: crate,
			material: materials.standard({ map, ...finish }),
			parent: table,
			position: [Math.sin(angle) * 2.2, 0.65, Math.cos(angle) * 2.2],
			dynamic: true,
			...stage,
		});
	});
	const onTable = crates.map(() => true);

	return {
		onUpdate(dt) {
			const t = time.now;
			table.setRotationEuler(0, TURN * t, 0);
			for (let k = 0; k < CRATES; k++) {
				// A crate spins on its own axis, relative to its parent: on the stage that adds the
				// table's turn, so the spin goes on without a jump when the crate steps off.
				crates[k].setRotationEuler(0, (onTable[k] ? SPIN : SPIN + TURN) * t, 0);
				// Each crate steps off in its turn, and again once every crate has had its turn.
				const since = t - k * STAGGER;
				const off = since >= 0 && since % (STAGGER * CRATES) < OFF;
				if (off === !onTable[k]) continue;
				onTable[k] = !off;
				crates[k].setParent(off ? null : table, { keepWorld: true });
			}
			view.update(dt);
		},
	};
});

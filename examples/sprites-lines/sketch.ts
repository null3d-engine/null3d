// Sprites and lines: a fountain of 2,000 sparks, each a sprite that faces the camera, in one batch
// that blends by adding light. Each spark rises, falls and fades from yellow to red, from a formula
// of the time, so the sketch writes the batch's arrays with no call per spark. A lit helix of wide
// lines in world units winds around the fountain, and dashes in screen pixels run around a ring on
// the ground. The sprites' soft dot is a texture made from data.
import { color, defineSketch, math } from '@null3d/engine';

const SPARKS = 2000;
/** How long a spark flies, in seconds, and the pull of gravity. */
const LIFE = 1.5;
const GRAVITY = 6;
/** Points along the helix, and its turns. */
const HELIX = 240;
const TURNS = 5;
/** Points around the dashed ring. */
const RING = 128;

export default defineSketch(async ({ scene, geometry, materials, textures, time }) => {
	scene.setBackground('#0a0c14');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 3, 7.5],
		target: [0, 1.6, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -1.5, -1], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.4 });
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 3.2, radiusBottom: 3.2, height: 0.1, radialSegments: 64 }),
		material: materials.standard({ color: '#1c2130' }),
		position: [0, -0.05, 0],
	});

	// A soft dot: white, with an alpha that falls from the center to the edge.
	const SIZE = 32;
	const dot = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const r = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) / (SIZE / 2);
			dot[(y * SIZE + x) * 4 + 3] = 255 * Math.max(0, 1 - r) ** 2;
		}
	}
	const map = textures.fromData({ width: SIZE, height: SIZE, format: 'rgba8unorm', data: dot });
	const sparks = await scene.createSprites({
		count: SPARKS,
		map,
		blending: 'additive',
		dynamic: true,
	});
	// Each spark's launch: its delay within a life, and its speed along x, y and z.
	const launch = new Float32Array(SPARKS * 4);
	for (let i = 0; i < SPARKS; i++) {
		const angle = math.randFloat(0, Math.PI * 2);
		const out = math.randFloat(0.4, 1.6);
		launch.set(
			[
				math.randFloat(0, LIFE),
				Math.cos(angle) * out,
				math.randFloat(4.5, 5.5),
				Math.sin(angle) * out,
			],
			i * 4,
		);
	}

	// The helix: wide lit lines in world units, from teal at the bottom to violet at the top.
	const helix = new Float32Array(HELIX * 3);
	const shades = new Float32Array(HELIX * 3);
	const low = color.fromHex([0, 0, 0], '#2ec4b6');
	const high = color.fromHex([0, 0, 0], '#9b5de5');
	for (let i = 0; i < HELIX; i++) {
		const t = i / (HELIX - 1);
		const angle = t * TURNS * Math.PI * 2;
		helix.set([Math.cos(angle) * 1.9, t * 3.2, Math.sin(angle) * 1.9], i * 3);
		for (let c = 0; c < 3; c++) shades[i * 3 + c] = math.lerp(low[c], high[c], t);
	}
	await scene.createLines({
		positions: helix,
		colors: shades,
		width: 0.06,
		worldUnits: true,
		lit: true,
	});

	// The ring: a dashed loop on the ground, 3 CSS pixels wide, whose dashes run around it.
	const ring = new Float32Array(RING * 3);
	for (let i = 0; i < RING; i++) {
		const angle = (i / RING) * Math.PI * 2;
		ring.set([Math.cos(angle) * 2.8, 0.02, Math.sin(angle) * 2.8], i * 3);
	}
	const dashes = await scene.createLines({
		positions: ring,
		mode: 'loop',
		width: 3,
		color: '#ffd166',
		dashed: true,
		dashSize: 0.3,
		gapSize: 0.2,
	});
	const dashValues = { dashOffset: 0 };

	const heat = [0, 0, 0];
	const yellow = color.fromHex([0, 0, 0], '#ffe08a');
	const red = color.fromHex([0, 0, 0], '#ff4b1f');
	return {
		onUpdate() {
			const { positions, sizes, colors } = sparks;
			for (let i = 0; i < SPARKS; i++) {
				const age = (time.now + launch[i * 4]) % LIFE;
				const fade = age / LIFE;
				positions[i * 3] = launch[i * 4 + 1] * age;
				positions[i * 3 + 1] = 0.2 + launch[i * 4 + 2] * age - 0.5 * GRAVITY * age * age;
				positions[i * 3 + 2] = launch[i * 4 + 3] * age;
				sizes[i * 2] = sizes[i * 2 + 1] = 0.2 * (1 - 0.6 * fade);
				for (let c = 0; c < 3; c++) heat[c] = math.lerp(yellow[c], red[c], fade);
				colors.set(heat, i * 4);
				colors[i * 4 + 3] = 1 - fade;
			}
			dashValues.dashOffset = -time.now * 0.6;
			dashes.material.set(dashValues);
		},
	};
});

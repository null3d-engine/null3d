// Depth of field and focal length: a low shot across a chess endgame, at the real size of a board.
// The focus racks between a near pawn and the far king: the depth of field finds the distance of
// a point in the world in each frame, as a camera's autofocus does. Meanwhile a dolly zoom runs:
// the lens goes from 35 to 85 mm while the camera backs away, so the board keeps its size and the
// string lights behind it swell into wide discs of light. The blur takes the camera's focal
// length, so it always matches the framing.
import { defineSketch, type MeshOptions, math, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** A square's side, in metres, and the seconds of each focus and of each dolly zoom. */
const SQUARE = 0.055;
const [RACK, DOLLY] = [4, 16];
/**
 * Each kind of piece (pawn, rook, queen, king) as parts of five numbers, in centimetres: a shape
 * (0 a drum, 1 a tapered drum, 2 a ball, 3 a box), its height above the board, and its scale.
 */
const PIECES = [
	[1, 1.9, 1, 2.4, 1, 2, 3.4, 0.85, 0.85, 0.85],
	[0, 2.3, 1.1, 3.2, 1.1, 0, 4.1, 1.35, 0.8, 1.35],
	[1, 2.8, 1.2, 4.4, 1.2, 2, 5.2, 0.9, 0.9, 0.9, 2, 6.2, 0.3, 0.3, 0.3],
	[1, 3, 1.25, 4.8, 1.25, 0, 5.6, 0.9, 0.5, 0.9, 3, 6.5, 0.25, 1, 0.25, 3, 6.4, 0.7, 0.25, 0.25],
];
/** The endgame: each piece's kind, side (0 white, 1 black), file and rank, from 0. */
const GAME = [
	3, 0, 6, 0, 1, 0, 1, 0, 0, 0, 3, 2, 0, 0, 6, 1, 0, 0, 1, 3, 3, 1, 4, 7, 2, 1, 2, 5, 0, 1, 5, 6, 0,
	1, 6, 5, 0, 1, 0, 4,
];
/** The warm lamp over the board, and the point that the camera looks at. */
const LAMP = { position: [-0.6, 0.9, 0.5], target: [0, 0, 0], range: 4, angle: 0.6 } as const;
const SUBJECT = [0, 0.03, -0.05] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, time } = ctx;
	scene.setBackground('#0a0807');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.35 });
	scene.setFog({ color: '#0a0807', density: 0.25 });
	post.set({ bloom: { intensity: 0.3, threshold: 1 }, ao: { radius: 0.05 }, vignette: {} });
	post.set({ dof: { aperture: 1.8, maxBlur: 0.03 } });
	// Low draws no depth of field by default: ask for a few taps there.
	const taps = () => quality.settings.dofSamples === 0 && quality.set({ dofSamples: 16 });
	taps();
	quality.onChange(taps);
	scene.createSpotLight({
		...LAMP,
		color: '#ffd9a8',
		intensity: 6,
		penumbra: 0.6,
		castShadows: true,
	});
	scene.createAmbientLight({ color: '#ffb070', intensity: 0.1 });
	const camera = scene.createPerspectiveCamera({ near: 0.01, far: 50, position: [0, 0.1, 0.4] });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: SUBJECT, groundY: 0.01, surfaces: true });

	// The board: walnut and maple squares with a fine grain, in a darker frame, on a table.
	const data = new Uint8Array(128 * 128 * 4).fill(255);
	for (let y = 0; y < 128; y++)
		for (let x = 0; x < 128; x++) {
			const grain = 0.93 + 0.07 * Math.sin(y * 1.7 + Math.sin(x * 0.2) * 2);
			const [r, g, b] = ((x >> 4) + (y >> 4)) % 2 ? [96, 58, 36] : [226, 196, 150];
			data.set([r * grain, g * grain, b * grain], (y * 128 + x) * 4);
		}
	const look = { colorSpace: 'srgb', mipmaps: true, anisotropy: 8 } as const;
	const squares = textures.fromData({ width: 128, height: 128, data, ...look });
	const box = geometry.box();
	const part = (options: Partial<MeshOptions> & Pick<MeshOptions, 'material'>) =>
		scene.createMesh({ mesh: box, castShadows: true, receiveShadows: true, ...options });
	const wood = (color: string) => materials.standard({ color, roughness: 0.35 });
	const [board, rim] = [8 * SQUARE, 8.8 * SQUARE];
	const checks = materials.standard({ map: squares, roughness: 0.3 });
	part({ material: checks, position: [0, 0.005, 0], scale: [board, 0.01, board] });
	part({ material: wood('#3a2416'), position: [0, 0.004, 0], scale: [rim, 0.008, rim] });
	part({ material: wood('#2a1a10'), position: [0, -0.01, -0.3], scale: [2.4, 0.02, 1.6] });

	// The pieces, from the generator shapes, in glossy ivory and ebony, each on a round foot.
	const shapes = [
		geometry.cylinder({ radialSegments: 32 }),
		geometry.cylinder({ radiusTop: 0.45, radialSegments: 32 }),
		geometry.sphere({ radius: 1, widthSegments: 32, heightSegments: 16 }),
		box,
	];
	const ivory = materials.standard({ color: '#efe4cc', roughness: 0.25 });
	const ebony = materials.standard({ color: '#151417', roughness: 0.12 });
	const at = (file: number, rank: number) => [(file - 3.5) * SQUARE, 0.01, (3.5 - rank) * SQUARE];
	for (let p = 0; p < GAME.length; p += 4) {
		const [x, y, z] = at(GAME[p + 2], GAME[p + 3]);
		const material = GAME[p + 1] ? ebony : ivory;
		const foot = [x, y + 0.003, z] as const;
		part({ mesh: shapes[0], material, position: foot, scale: [0.016, 0.006, 0.016] });
		const parts = PIECES[GAME[p]];
		for (let k = 0; k < parts.length; k += 5) {
			const [shape, h, sx, sy, sz] = parts.slice(k, k + 5).map((v, i) => (i ? v / 100 : v));
			part({ mesh: shapes[shape], material, position: [x, y + h, z], scale: [sx, sy, sz] });
		}
	}

	// String lights far behind the board: small and bright, so the blur turns them into discs.
	const bulb = materials.standard({ color: '#000000', emissive: '#ffb45c', emissiveIntensity: 12 });
	const dot = geometry.sphere({ radius: 0.008 });
	for (let k = 0; k < 40; k++) {
		const u = k / 39;
		const sag = 0.05 + 0.2 * (2 * u - 1) ** 2;
		const position = [-1.4 + 2.8 * u, sag, -1.6 - 0.4 * Math.sin(u * 9)] as const;
		part({ mesh: dot, material: bulb, position, castShadows: false });
	}

	const [near, far, focus, eye] = [at(3, 2), at(4, 7), vec3.create(), vec3.create()];
	const lens = { dof: { focusPoint: focus } };
	return {
		onUpdate(dt) {
			const t = time.now;
			if (!view.userCamera) {
				// The dolly zoom: the camera backs away as the lens grows, by the same factor.
				const mm = 35 + 50 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / DOLLY));
				camera.setFocalLength(mm);
				const [turn, away] = [0.25 * Math.sin(t * 0.2), 0.42 * (mm / 35)];
				vec3.set(eye, Math.sin(turn) * away, 0.02 + 0.03 * (mm / 35), Math.cos(turn) * away);
				vec3.add(eye, eye, SUBJECT);
				camera.setPosition(eye[0], eye[1], eye[2]);
				camera.lookAt(SUBJECT[0], SUBJECT[1], SUBJECT[2]);
			}
			view.update(dt);
			// The focus racks between the pawn and the king, with a smooth pull between them.
			const rack = math.smoothstep(Math.sin((Math.PI * t) / RACK), -0.6, 0.6);
			vec3.lerp(focus, near, far, rack);
			focus[1] += 0.03;
			view.steer(focus);
			post.set(lens);
		},
	};
});

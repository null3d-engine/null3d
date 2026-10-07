// The masked materials' scene (bench/scenes/alpha-mask.ts), which the parity test also draws with
// three.js: cards cut by vertex alpha at three cutoffs, lit and unlit, and a batch of tilted cards,
// all drawn with MSAA. ?mode=coverage keeps alpha to coverage on, as masks have it by default, and
// ?mode=hash draws the cards with the alpha hash. ?shadows makes the sun cast shadows, so the cards
// cut the holes of their masks into their shadows on the floor and the wall, and adds two cards cut
// by their map.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	cardMesh,
	MASK_BOXES,
	MASK_CAMERA,
	MASK_CARDS,
	MASK_MAP_CARDS,
	MASK_MODES,
	MASK_SHADOWS,
	MASK_TILE,
	type MaskMode,
	STRIPE_SIZE,
	SUN,
	stripeTexels,
	turnAboutX,
} from '../../../bench/scenes/alpha-mask';

const asked = new URL(import.meta.url).searchParams.get('mode') ?? 'mask';
if (!(MASK_MODES as readonly string[]).includes(asked)) throw new Error(`unknown mode ${asked}`);
const MODE = asked as MaskMode;
const switches = new URL(import.meta.url).searchParams;
/** True when the sun casts shadows. */
const SHADOWS = switches.has('shadows');
/**
 * True when the ring cards cast too. three.js's shadows ignore vertex alpha, so its twin's ring
 * cards cast none, and the parity test turns them off here with ?ringShadows=off.
 */
const RING_SHADOWS = SHADOWS && switches.get('ringShadows') !== 'off';

/** The alpha options of a card's material at `cutoff`, in the sketch's mode. */
function alphaOptions(cutoff: number) {
	if (MODE === 'hash') return { alphaMode: 'hash' } as const;
	// Alpha to coverage is on by default; the plain mask turns it off, as three.js's alphaTest.
	return { alphaMode: 'mask', alphaCutoff: cutoff, alphaToCoverage: MODE === 'coverage' } as const;
}

export default defineSketch(({ scene, materials, geometry, post, textures }) => {
	// The three.js twin draws with no tone mapping, three.js's default.
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	const { cascades, mapSize, distance } = MASK_SHADOWS;
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
		castShadows: SHADOWS,
		...(SHADOWS && { shadow: { cascades, mapSize, distance } }),
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	const { fov, near, far, position, target } = MASK_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));

	for (const { size, position: center, color } of MASK_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color }),
			position: center,
			castShadows: false,
			receiveShadows: SHADOWS,
		});
	}

	const card = geometry.fromArrays(cardMesh());
	for (const { lit, cutoff, position: center, rotation } of MASK_CARDS) {
		// Double-sided cards cast from both faces, whichever faces the sun.
		const options = { vertexColors: true, doubleSided: SHADOWS, ...alphaOptions(cutoff) } as const;
		const mesh = scene.createMesh({
			mesh: card,
			material: lit ? materials.standard(options) : materials.unlit(options),
			position: center,
			castShadows: RING_SHADOWS,
			receiveShadows: false,
		});
		mesh.setRotationEuler(rotation[0], rotation[1], rotation[2]);
	}

	// With shadows, two more cards whose map cuts their shape, and so their shadows.
	const stripes = SHADOWS
		? textures.fromData({
				width: STRIPE_SIZE,
				height: STRIPE_SIZE,
				data: stripeTexels(),
				mipmaps: true,
				colorSpace: 'srgb',
			})
		: undefined;
	for (const { lit, cutoff, position: center, rotation } of SHADOWS ? MASK_MAP_CARDS : []) {
		const options = { map: stripes, doubleSided: true, ...alphaOptions(cutoff) } as const;
		const mesh = scene.createMesh({
			mesh: card,
			material: lit ? materials.standard(options) : materials.unlit(options),
			position: center,
			castShadows: true,
			receiveShadows: false,
		});
		mesh.setRotationEuler(rotation[0], rotation[1], rotation[2]);
	}

	const tiles = scene.createInstances(card, MASK_TILE.positions.length, {
		material: materials.standard({ vertexColors: true, ...alphaOptions(MASK_TILE.cutoff) }),
	});
	const turn = turnAboutX(MASK_TILE.tilt);
	const { scale } = MASK_TILE;
	for (const [k, center] of MASK_TILE.positions.entries()) {
		tiles.positions.set(center, k * 3);
		tiles.rotations.set(turn, k * 4);
		tiles.scales.set([scale, scale, scale], k * 3);
	}
	tiles.markDirty();
	return {};
});

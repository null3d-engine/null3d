// The smallest case of a sprite batch with an origin: eight cards in a row, one per frame of a four
// column, two row atlas whose cells are flat colors, standing around an origin far from the world's.
// Every card must show its own cell, so the eight cards must draw eight colors. `?origin=off` draws
// the same cards at their world positions with no origin on the batch, which must change nothing
// about the colors the cards show.
import { color, defineSketch } from '@null3d/engine';

/** The point the cards stand around, far from the world's origin. */
const ORIGIN = [400, 0, -250] as const;
/** The texels on each side of an atlas cell. */
const CELL = 8;
/** One flat sRGB color per frame, from frame 0 to the last. */
export const FRAME_COLORS = [
	'#e03020',
	'#20b040',
	'#2040e0',
	'#e0d020',
	'#e020e0',
	'#20e0e0',
	'#f08020',
	'#808080',
] as const;
/** The cards: one per frame. */
const COUNT = FRAME_COLORS.length;
/** The distance between neighbouring cards, in world units. */
const SPACING = 2.4;
/** The side of every card, in world units. */
const SIZE = 2;
/** How far the camera stands in front of the cards. */
const DISTANCE = 18;

const withOrigin = new URL(import.meta.url).searchParams.get('origin') !== 'off';

export default defineSketch(async (ctx) => {
	const { scene, textures, post } = ctx;
	// No tone curve, so a card's pixel keeps the atlas color's value.
	post.set({ toneMapping: 'none' });
	scene.setBackground('#000000');

	const eye: [number, number, number] = [ORIGIN[0], ORIGIN[1], ORIGIN[2] + DISTANCE];
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			position: eye,
			target: [ORIGIN[0], ORIGIN[1], ORIGIN[2]],
		}),
	);

	// The atlas: two rows of four cells, each filled with its frame's color.
	const columns = 4;
	const rows = Math.ceil(COUNT / columns);
	const width = columns * CELL;
	const height = rows * CELL;
	const data = new Uint8Array(width * height * 4);
	const rgb = [0, 0, 0];
	FRAME_COLORS.forEach((hex, frame) => {
		color.fromHex(rgb, hex);
		const left = (frame % columns) * CELL;
		// Data rows run from the bottom up, and the cells count from the top left.
		const bottom = (rows - 1 - Math.floor(frame / columns)) * CELL;
		for (let y = 0; y < CELL; y++)
			for (let x = 0; x < CELL; x++) {
				const at = ((bottom + y) * width + left + x) * 4;
				data[at] = Math.round((rgb[0] ?? 0) * 255);
				data[at + 1] = Math.round((rgb[1] ?? 0) * 255);
				data[at + 2] = Math.round((rgb[2] ?? 0) * 255);
				data[at + 3] = 255;
			}
	});
	const map = textures.fromData({
		width,
		height,
		data,
		colorSpace: 'srgb',
		wrap: 'clamp',
	});

	const cards = await scene.createSprites({
		count: COUNT,
		map,
		atlas: { columns, rows },
		center: [0.5, 0.5],
		...(withOrigin ? { origin: ORIGIN } : {}),
	});
	const white = [0, 0, 0];
	color.fromHex(white, '#ffffff');
	for (let k = 0; k < COUNT; k++) {
		const [x, y, z] = withOrigin
			? [(k - (COUNT - 1) / 2) * SPACING, 0, 0]
			: [ORIGIN[0] + (k - (COUNT - 1) / 2) * SPACING, ORIGIN[1], ORIGIN[2]];
		cards.positions.set([x, y, z], k * 3);
		cards.sizes.set([SIZE, SIZE], k * 2);
		cards.colors.set([white[0] ?? 0, white[1] ?? 0, white[2] ?? 0, 1], k * 4);
		cards.frames[k] = k;
	}
	cards.markDirty();
	// The camera and the cards never move, so every frame is the same picture.
	return {};
});

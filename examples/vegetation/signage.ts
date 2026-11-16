// A wooden signboard for each plant in the meadow: a board with the species' name painted on it over
// two posts, standing beside the plant's foot so a viewer reads what they are looking at. The name is
// drawn on a canvas and uploaded as the board's texture, so no font file ships with the page.
import type { SketchContext } from '@null3d/engine';

/** Metres across the board, and its height. */
const BOARD = [7.2, 3.4] as const;
/** Metres from the ground to the board's centre. */
const BOARD_HEIGHT = 4.2;
/** Metres apart the two posts stand. */
const POST_SPREAD = 2.6;
/** Metres the post's radius. */
const POST_RADIUS = 0.16;

/** The wood's colours: the board, its frame, and the paint on it. */
const WOOD = '#6b4a2f';
const FRAME = '#4a3220';
const PAINT = '#f2e6cf';

/**
 * Draws a name onto a board's picture: the common name in a large serif, the Latin below it in a
 * smaller italic, on a wood panel with a darker frame.
 *
 * @param texels The picture's width and height in texels.
 * @param name The species' common name.
 * @param latin The species' Latin name.
 * @returns The picture, four channels a texel, its first row at the bottom.
 */
function paintSign(texels: readonly [number, number], name: string, latin: string): Uint8Array {
	const [width, height] = texels;
	// A sketch may run in a worker, where the page has no document, so the picture is drawn on an
	// offscreen canvas.
	const canvas =
		typeof OffscreenCanvas === 'undefined'
			? Object.assign(document.createElement('canvas'), { width, height })
			: new OffscreenCanvas(width, height);
	const paint = canvas.getContext('2d') as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!paint) throw new Error('the sign needs a canvas to paint on');
	paint.fillStyle = FRAME;
	paint.fillRect(0, 0, width, height);
	const inset = Math.round(height * 0.07);
	paint.fillStyle = WOOD;
	paint.fillRect(inset, inset, width - 2 * inset, height - 2 * inset);
	// The grain: a few darker strokes, so the panel reads as wood and not as flat paint.
	paint.strokeStyle = 'rgba(40, 24, 12, 0.25)';
	paint.lineWidth = Math.max(1, Math.round(height * 0.012));
	for (let k = 0; k < 9; k++) {
		const y = inset + ((k + 0.5) * (height - 2 * inset)) / 9;
		paint.beginPath();
		paint.moveTo(inset, y);
		paint.bezierCurveTo(
			width * 0.35,
			y - height * 0.03,
			width * 0.65,
			y + height * 0.03,
			width - inset,
			y,
		);
		paint.stroke();
	}
	paint.fillStyle = PAINT;
	paint.textAlign = 'center';
	paint.textBaseline = 'middle';
	const titleSize = Math.round(height * 0.3);
	paint.font = `600 ${titleSize}px Georgia, "Times New Roman", serif`;
	paint.fillText(name, width / 2, height * 0.4, width * 0.86);
	paint.font = `italic ${Math.round(height * 0.17)}px Georgia, "Times New Roman", serif`;
	paint.fillText(latin, width / 2, height * 0.7, width * 0.8);
	const pixels = paint.getImageData(0, 0, width, height).data;
	// The picture's rows run from the bottom, and the canvas' from the top.
	const flipped = new Uint8Array(pixels.length);
	const row = width * 4;
	for (let y = 0; y < height; y++)
		flipped.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
	return flipped;
}

/**
 * Stands a signboard beside a plant: a painted board on two posts, its face toward the camera's
 * starting side.
 *
 * @param ctx The sketch's context.
 * @param name The species' common name.
 * @param latin The species' Latin name.
 * @param at The ground point beside the plant, at the sign's centre.
 */
export function plantSign(
	ctx: SketchContext,
	name: string,
	latin: string,
	at: readonly [number, number],
): void {
	const { scene, textures, materials, geometry } = ctx;
	const picture = textures.fromData({
		width: 512,
		height: 256,
		colorSpace: 'srgb',
		data: paintSign([512, 256], name, latin),
	});
	// The painted face and a plain wooden back, so the name is not read backwards from behind.
	scene.createMesh({
		mesh: geometry.plane({ width: BOARD[0], height: BOARD[1] }),
		material: materials.standard({ map: picture, roughness: 0.8 }),
		position: [at[0], BOARD_HEIGHT, at[1] + 0.01],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: BOARD[0], height: BOARD[1] }),
		material: materials.standard({ color: [0.13, 0.085, 0.05], roughness: 0.9 }),
		position: [at[0], BOARD_HEIGHT, at[1] - 0.01],
		rotation: [0, 1, 0, 0],
		castShadows: true,
		receiveShadows: true,
	});
	const post = materials.standard({ color: [0.16, 0.11, 0.07], roughness: 0.9 });
	for (const side of [-1, 1]) {
		scene.createMesh({
			mesh: geometry.cylinder({
				radiusTop: POST_RADIUS,
				radiusBottom: POST_RADIUS,
				height: BOARD_HEIGHT,
			}),
			material: post,
			position: [at[0] + side * POST_SPREAD, BOARD_HEIGHT / 2, at[1] - 0.05],
			castShadows: true,
			receiveShadows: true,
		});
	}
}

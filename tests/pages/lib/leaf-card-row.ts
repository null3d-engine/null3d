// Three leaf cards that face the camera at three distances, which the coverage measurement reads.
// A card is the same square of the leaf atlas at every distance, so the share of its own box that
// its leaves cover is the atlas's own coverage: a level whose leaves thinned would show a smaller
// share the further a card stands. The cards stand on the picture where their boxes do not meet.
import type { SketchContext } from '@null3d/engine';
import { bakePlantAtlases, plantMaterial } from '@null3d/vegetation';
import { PLANT_CARD } from './plant-card';

/** The camera that frames the cards: its place, the point that it looks at and its field of view. */
export const CAMERA = { position: [0, 0, -10], target: [0, 0, 0], fov: 40 } as const;

/** The cards' middles, in meters, and the size of each card. They stand apart, so no two boxes meet. */
export const CARDS = [
	{ at: [0, 0, 2], size: 2 },
	{ at: [-4, 0, 14], size: 2 },
	{ at: [-12, 0, 38], size: 2 },
] as const;

/** The background that the cards stand against, which every pixel that a leaf covers differs from. */
export const BACKGROUND = '#000000';

/**
 * Draws the three leaf cards, each a plane of the leaf atlas's cluster material, against a black
 * background with no light, so every pixel is either the leaf's colour or nothing.
 *
 * @param ctx The sketch's context.
 */
export function addLeafCardRow(ctx: SketchContext): void {
	const { scene } = ctx;
	scene.setBackground(BACKGROUND);
	const atlases = bakePlantAtlases(ctx);
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: 'cluster-a',
		color: [1, 1, 1],
	});
	// The material takes no light of its own, so the cards stand in the light of the sky alone.
	scene.createAmbientLight({ intensity: 1 });
	const mesh = ctx.geometry.fromArrays(PLANT_CARD);
	for (const card of CARDS)
		scene.createMesh({
			mesh,
			material: leaves,
			position: [card.at[0], card.at[1], card.at[2]],
			scale: [card.size, card.size, 1],
		});
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: 0.1,
		far: 200,
		position: [CAMERA.position[0], CAMERA.position[1], CAMERA.position[2]],
		target: [CAMERA.target[0], CAMERA.target[1], CAMERA.target[2]],
	});
	scene.setActiveCamera(camera);
}

/** A rectangle of a picture, in pixels. */
export interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/**
 * The rectangle that one card covers on a picture: a card faces the camera square on, so its four
 * corners project into a rectangle.
 *
 * @param index Which card of `CARDS`.
 * @param width The picture's width in pixels.
 * @param height The picture's height in pixels.
 * @returns The box's edges in pixels.
 */
export function cardBox(index: number, width: number, height: number): Box {
	const card = CARDS[index] as { at: readonly [number, number, number]; size: number };
	const [cx, cy, cz] = CAMERA.position;
	const [x, y, z] = card.at;
	const depth = z - cz;
	const halfHeight = depth * Math.tan((CAMERA.fov * Math.PI) / 360);
	const halfWidth = halfHeight * (width / height);
	// The camera looks down +z with the world's up, so its right-hand direction is -x.
	const across = -((x - cx) / halfWidth);
	const atX = (across * 0.5 + 0.5) * width;
	const atY = (0.5 - ((y - cy) / halfHeight) * 0.5) * height;
	const half = card.size / 2;
	const px = (half / halfWidth) * 0.5 * width;
	const py = (half / halfHeight) * 0.5 * height;
	return {
		left: Math.round(atX - px),
		top: Math.round(atY - py),
		right: Math.round(atX + px),
		bottom: Math.round(atY + py),
	};
}

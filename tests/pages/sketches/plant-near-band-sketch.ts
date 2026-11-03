// A stand of grown oaks, drawn black on a white sky from one spot of a walk through it, for the near
// band test (tests/image/plant-near-band.spec.ts). ?step= picks the spot. ?draw= picks what draws:
// `split`, the plant core's own hand-over, where each near copy draws real shoots inside its split
// and its cards beyond; `shoots`, the near pool's shoots and no cards; or `cards`, the cards alone
// with no near pool. The test holds that every pixel which both the shoots and the cards cover is
// covered by the hand-over too, so the shell where they meet never shows sky.
//
// The near pool follows a fixed eye, so its task settles at setup and the held frame draws its
// answer. The sketch posts the pool's figures as `near`: the copies and triangles it draws, the
// triangle budget it holds them to and the split distance.
import { type Camera, defineSketch } from '@null3d/engine';
import {
	createNearPool,
	growPlant,
	type PlantCopies,
	placePlants,
	plantMaterials,
	prepareSpecies,
} from '@null3d/vegetation';
import { nearOak } from '../../../packages/vegetation/src/render/near-oak.fixture';

const params = new URL(import.meta.url).searchParams;
const DRAW = params.get('draw') ?? 'split';
const STEP = Number(params.get('step') ?? 0);

/** Where the oaks stand: x, z, turn in radians, scale and variant. */
const STAND: readonly (readonly [number, number, number, number, number])[] = [
	[0, 0, 0, 1, 0],
	[19, 6, 1.9, 0.95, 1],
	[-15, 17, 3.4, 1.05, 0],
	[31, -11, 0.6, 1, 1],
	[7, 29, 4.4, 0.9, 0],
	[-27, -13, 2.6, 1.1, 1],
];

/**
 * The walk: from under the first oak's crown, out past its edge between two oaks, to a spot where
 * the band's edge crosses several crowns. Each is an eye and the point it looks at.
 */
const WALK: readonly (readonly [
	readonly [number, number, number],
	readonly [number, number, number],
])[] = [
	[
		[2, 1.7, 3],
		[14, 8, 10],
	],
	[
		[9, 1.7, -6],
		[-8, 7, 14],
	],
	[
		[-4, 1.7, -24],
		[12, 6, 6],
	],
];

/** The vertical field of view in degrees, and the render height that the switches are measured at. */
const FOV = 60;
const VIEW_HEIGHT = 1080;

export default defineSketch(async (ctx) => {
	const { scene } = ctx;
	if (!['split', 'shoots', 'cards'].includes(DRAW))
		throw new Error(`?draw=${DRAW} is not split, shoots or cards.`);
	const spot = WALK[STEP];
	if (!spot)
		throw new Error(`?step=${STEP} is not a spot of the walk: give 0 to ${WALK.length - 1}.`);
	const [eye, target] = spot;
	scene.setBackground('#ffffff');
	const camera: Camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.05,
		far: 2000,
		position: [...eye],
		target: [...target],
	});
	scene.setActiveCamera(camera);

	const kit = await prepareSpecies(ctx, nearOak());
	const assets = await Promise.all(
		[0, 1].map((variant) => growPlant(kit, { seed: 11, variant, near: true })),
	);
	const copies: PlantCopies = {
		count: STAND.length,
		position: Float32Array.from(STAND.flatMap(([x, z]) => [x, 0, z])),
		turn: Float32Array.from(STAND.map((s) => s[2])),
		scale: Float32Array.from(STAND.map((s) => s[3])),
		variant: Uint8Array.from(STAND.map((s) => s[4])),
	};
	const matte = plantMaterials(ctx, kit, { matte: true });
	const materials =
		DRAW === 'shoots'
			? {
					...matte,
					cards: ctx.materials.unlit({
						color: '#000000',
						opacity: 0,
						alphaMode: 'mask',
						alphaCutoff: 0.5,
					}),
				}
			: matte;
	// The pool follows the walk's eye, which stands still, so its task settles here.
	const near =
		DRAW === 'cards'
			? undefined
			: createNearPool(ctx, {
					camera: {
						getWorldPosition(out) {
							out[0] = eye[0];
							out[1] = eye[1];
							out[2] = eye[2];
						},
					},
				});
	const placed = placePlants(ctx, kit, assets, copies, {
		materials,
		...(near && { near }),
		view: { height: VIEW_HEIGHT, fov: FOV },
		castShadows: false,
	});
	if (near) {
		near.update();
		await near.settled();
	}
	ctx.page.post('near', {
		draw: DRAW,
		step: STEP,
		preset: ctx.quality.preset,
		split: placed.split,
		copies: near?.copies ?? 0,
		triangles: near?.triangles ?? 0,
		budget: near?.budget ?? 0,
		detail: near?.detail ?? kit.detail,
	});
	return near ? { onUpdate: () => near.update() } : {};
});

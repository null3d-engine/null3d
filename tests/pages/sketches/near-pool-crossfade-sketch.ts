// A change of grant in the scene's budget of real pieces, drawn at one moment of its crossfade. Two
// copies of the Scots pine stand side by side, and the near pool may grant one of them its pieces.
// The eye first stands by the left copy, which takes its pieces and settles; then it stands by the
// right copy, the pool moves the grant, and the frame draws `fade` of the way through the quarter
// second in which the left copy's pieces fade out and the right copy's fade in, each copy's first
// card level crossing the other way. `fade=before` draws the right-hand eye before the pool hands
// out again, and `fade=after` once the crossfade has settled.
import { defineSketch } from '@null3d/engine';
import {
	createNearPool,
	growPlant,
	loadSpecies,
	placePlants,
	plantMaterials,
	prepareSpecies,
} from '@null3d/vegetation';

/**
 * The view the copies are placed for: the High preset's tallest, where the pine's pieces draw to
 * about seven metres, so a camera between the two copies stands inside both switches.
 */
const VIEW = { height: 2160, fov: 60 } as const;

/** The camera's lens, in degrees. */
const FOV = 60;

/**
 * Where the copies stand, and where the pool's eye stands by each: a few metres nearer the one than
 * the other, past the metre a held grant keeps.
 */
const COPIES = [
	[-2.4, 0, 7],
	[2.4, 0, 7],
] as const;
const EYES = [
	[-2.4, 1.7, 5],
	[2.4, 1.7, 5],
] as const;

/** Seconds a crossfade takes, as the pool runs it. */
const FADE = 0.25;

export default defineSketch(async (ctx) => {
	const { scene } = ctx;
	scene.setBackground('#000000');
	scene.createAmbientLight({ intensity: 1 });
	const params = new URL(import.meta.url).searchParams;
	const fade = params.get('fade') ?? 'after';

	const module = await loadSpecies('scots-pine');
	const kit = await prepareSpecies(ctx, module, { detail: 'low', placeholders: 'missing' });
	const asset = await growPlant(kit, { seed: 11, variant: 0, near: true });
	const materials = plantMaterials(ctx, kit, {});

	// The pool reads where the eye stands and the time from the script, not from a frame.
	const eye: number[] = [...EYES[0]];
	let now = 0;
	const pool = createNearPool(ctx, {
		camera: {
			getWorldPosition(out) {
				out[0] = eye[0] as number;
				out[1] = eye[1] as number;
				out[2] = eye[2] as number;
			},
		},
		copies: 1,
		clock: () => now,
	});
	placePlants(
		ctx,
		kit,
		[asset],
		{
			count: COPIES.length,
			position: Float32Array.from(COPIES.flat()),
			turn: new Float32Array(COPIES.length),
			scale: new Float32Array(COPIES.length).fill(1),
			variant: new Uint8Array(COPIES.length),
		},
		{ materials, view: VIEW, ...(fade === 'static' ? {} : { near: pool }), castShadows: false },
	);
	// The left copy takes its pieces, and they settle.
	pool.update();
	now = 1;
	pool.update();
	// The eye stands by the right copy; the pool moves the grant and the crossfade runs.
	eye.splice(0, 3, ...EYES[1]);
	if (fade !== 'before') {
		now = 10;
		pool.update();
		now = 10 + (fade === 'after' ? 1 : Number(fade)) * FADE;
		pool.update();
	}
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.1,
		far: 500,
		position: [0, 2, 3],
		target: [0, 4, 7],
	});
	scene.setActiveCamera(camera);
	console.log(
		`crossfade ${fade}: the pool grants ${pool.copies} copies, ${pool.triangles} triangles`,
	);
});

// The garden's camera route and its lens, and the cloud's counts on the signpost. The route opens
// and closes on the view of the whole glade. The label follows the budget that the preset and the
// governor give the cloud.
import type { PerspectiveCamera, SketchContext } from '@null3d/engine';
import type { Splats } from '@null3d/splats';
import { type CameraBounds, type Cinematic, createCinematic } from '../lib/cinematic';
import { lensSettings } from '../lib/dslr-lens';
import { gardenHeight } from './cloud';
import { SHOTS, WIDE_LOOK } from './route';

/** Where the Manual camera may go: around the glade, above the moss and below the mountains. */
export const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, 0],
	focus: 14,
	focusHeight: [0.5, 5],
	distance: 24,
};

/** The scene that the route drives, and the cloud whose counts the label names. */
export interface GardenHudOptions {
	/** The camera, whose lens the route changes and which the route moves. */
	camera: PerspectiveCamera;
	/** The cloud, whose counts the label names. */
	splats: Splats;
	/** The splats in the whole cloud, which the signpost's label names. */
	total: number;
	/** The lens's focal length in millimetres. */
	focalLength: number;
	/** True when the scene's address asks for the lens at its start, as `?dslr` does. */
	dslr: boolean;
}

/** The garden's camera route and its lens. */
export interface GardenHud {
	/**
	 * Moves the route and the lens. Call each frame, before the scene moves the camera that the
	 * cloud reads.
	 */
	update(dt: number): void;
	/** Names the cloud's counts on the signpost, when they changed or the interval passed. */
	label(now: number): void;
}

/** Builds the garden's route, its lens and the cloud's label. */
export function createHud(ctx: SketchContext, options: GardenHudOptions): GardenHud {
	const { camera, splats, total, focalLength, dslr } = options;
	const { post, page } = ctx;
	const target: [number, number, number] = [WIDE_LOOK[0], WIDE_LOOK[1], WIDE_LOOK[2]];
	const film: Cinematic = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		bounds: { ...BOUNDS, ground: gardenHeight },
		hud: false,
	});
	const lens = lensSettings(target);
	if (dslr) {
		camera.setFocalLength(focalLength);
		post.set(lens);
	}

	// The cloud's figures, which the signpost's label names.
	let posted = 0;
	let lastDrawn = -1;
	const name = () => {
		const drawn = splats.drawn;
		if (drawn === lastDrawn) return;
		lastDrawn = drawn;
		page.post('label', {
			id: 'scan',
			text: `${total.toLocaleString('en-US')} splats · ${drawn.toLocaleString('en-US')} drawn`,
		});
	};
	name();

	return {
		update(dt) {
			film.update(dt);
			if (dslr) post.set(lens);
		},
		label(now) {
			if (now - posted > 0.3) {
				posted = now;
				name();
			}
		},
	};
}

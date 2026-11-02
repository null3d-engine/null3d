// The showroom's camera route and its lens. The route takes the car's loop, opens and settles on the
// configurator with the car beside it, turns around the car in the studio, follows it out to the
// street, watches it turn and comes back in front of it as it returns. The studio's shadow range
// follows the camera, so its shadows keep the car while the camera draws back down the street.
import type { DirectionalLight, PerspectiveCamera, SketchContext } from '@null3d/engine';
import { type CameraBounds, type Cinematic, createCinematic } from '../lib/cinematic';
import { lensSettings } from '../lib/dslr-lens';
import { createShadowRange, type ShadowReach } from '../lib/shadow-range';
import { SHOTS } from './shots';

/** Where the Manual camera may go: over the studio and the street, above the road. */
const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, -4],
	focus: 20,
	focusHeight: [0.6, 5],
	distance: 28,
};

/** The scene that the route drives, and the lens that its focus follows. */
export interface ShowroomHudOptions {
	/** The camera, whose lens the route changes. */
	camera: PerspectiveCamera;
	/** The sun, whose shadow range follows the camera. */
	sun: DirectionalLight;
	/** The studio's shadow range, which the route refits as the camera moves. */
	shadowReach: ShadowReach;
	/** The point that the lens focuses on, which the scene keeps on the car. */
	target: [number, number, number];
	/** The lens's focal length in millimetres. */
	focalLength: number;
	/** True starts with the lens on. */
	dslr?: boolean;
}

/** The showroom's camera route and its lens. */
export interface ShowroomHud {
	/** Moves the route and the shadow range. Call each frame, before the scene moves the focus. */
	update(dt: number): void;
	/** Gives the lens's post settings to the frame, once the focus has moved to the car. */
	lens(): void;
}

/** Builds the showroom's route and lens, and fits its shadows to the opening pose. */
export function createHud(ctx: SketchContext, options: ShowroomHudOptions): ShowroomHud {
	const { camera, sun, shadowReach, target, focalLength, dslr = false } = options;
	const { post } = ctx;
	const shadows = createShadowRange(sun, camera, shadowReach);
	const film: Cinematic = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		bounds: { ...BOUNDS, ground: () => 0 },
		hud: false,
	});
	const lens = lensSettings(target);
	if (dslr) {
		camera.setFocalLength(focalLength);
		post.set(lens);
	}
	shadows.fit();
	return {
		update(dt) {
			shadows.fit();
			film.update(dt);
		},
		lens() {
			if (dslr) post.set(lens);
		},
	};
}

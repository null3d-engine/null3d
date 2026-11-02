// The showroom's HUD and its camera route: the shared sky, fog, environment, shadow and lens
// switches, the studio's own ambient occlusion and bloom, and the route that the Auto camera plays.
// The route takes the car's loop, opens and settles on the configurator with the car beside it, turns
// around the car in the studio, follows it out to the street, watches it turn and comes back in front
// of it as it returns.
import type { DirectionalLight, PerspectiveCamera, SketchContext } from '@null3d/engine';
import { type CameraBounds, type Cinematic, createCinematic } from '../lib/cinematic';
import { createShowcaseEffects, type ShadowReach } from '../lib/showcase-effects';
import type { Stage } from '../lib/stage';
import { SHOTS } from './shots';

/** Where the Manual camera may go: over the studio and the street, above the road. */
const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, -4],
	focus: 20,
	focusHeight: [0.6, 5],
	distance: 28,
};

/** The scene that the HUD drives, and the lens that its focus follows. */
export interface ShowroomHudOptions {
	/** The camera, whose lens the HUD changes. */
	camera: PerspectiveCamera;
	/** The sun, whose contact shadows the HUD switches. */
	sun: DirectionalLight;
	/** The stage, which owns the sky, the fog and the environment switches. */
	stage: Stage;
	/** The studio's shadow range, which the HUD refits as the camera moves. */
	shadowReach: ShadowReach;
	/** The point that the lens focuses on, which the scene keeps on the car. */
	target: [number, number, number];
	/** The camera's vertical field of view in degrees, and the lens's focal length in millimetres. */
	fov: number;
	focalLength: number;
}

/** The showroom's HUD and its camera route. */
export interface ShowroomHud {
	/** Moves the route and the controls. Call each frame, before the scene moves the focus. */
	update(dt: number, now: number): void;
	/** Gives the lens's post settings to the frame, once the focus has moved to the car. */
	lens(): void;
}

/** Builds the showroom's controls and its route, and fits its shadows to the opening pose. */
export function createHud(ctx: SketchContext, options: ShowroomHudOptions): ShowroomHud {
	const { camera, sun, stage, shadowReach, target, fov, focalLength } = options;
	const { post } = ctx;
	let film: Cinematic;
	const controls = createShowcaseEffects(ctx, {
		camera,
		sun,
		shadowReach,
		stage,
		start: {
			sky: true,
			fog: true,
			environment: true,
			shadows: true,
			contact: true,
			ao: true,
			bloom: true,
			dof: false,
			exposure: false,
			vignette: true,
		},
		supported: {
			atmosphere: ['sky', 'fog'],
			lighting: ['shadows', 'contact', 'ao', 'environment'],
			post: ['bloom', 'dof', 'exposure', 'vignette'],
		},
		apply(id, on) {
			switch (id) {
				case 'contact':
					sun.setShadow({ contactDistance: on ? 0.25 : 0 });
					break;
				case 'ao':
					post.set({ ao: on ? { radius: 0.7 } : false });
					break;
				case 'bloom':
					post.set({ bloom: on ? { intensity: 0.45, threshold: 1 } : false });
					break;
			}
		},
		mood: (next) => stage.set(next),
		hour: (hours) => stage.setHour(hours),
		film: () => film,
		fov,
		focalLength,
		focus: target,
	});
	film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		groups: controls.groups,
		bounds: { ...BOUNDS, ground: () => 0 },
	});
	controls.fitShadows();
	return {
		update(dt, now) {
			controls.update(now);
			film.update(dt);
		},
		lens() {
			const lens = controls.lens();
			if (lens) post.set(lens);
		},
	};
}

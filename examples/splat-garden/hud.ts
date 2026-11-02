// The garden's HUD and its camera route: the shared effect switches, the Full detail switch that
// caps the splat draw, the cloud's counts on the signpost, and the route that Auto plays. A new
// quality preset moves the splat budget, which the cap follows, and the route opens and closes on the
// view of the whole glade.
import type { DirectionalLight, PerspectiveCamera, SketchContext } from '@null3d/engine';
import type { Splats } from '@null3d/splats';
import { type CameraBounds, type Cinematic, createCinematic } from '../lib/cinematic';
import { createShowcaseEffects } from '../lib/showcase-effects';
import type { Stage } from '../lib/stage';
import { gardenHeight } from './cloud';
import { SHOTS, WIDE_LOOK } from './route';

/** Where the Manual camera may go: around the glade, above the moss and below the mountains. */
export const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, 0],
	focus: 14,
	focusHeight: [0.5, 5],
	distance: 24,
};

/** The scene that the HUD drives, and the cloud whose counts it names. */
export interface GardenHudOptions {
	/** The camera, whose lens the HUD changes and which the route moves. */
	camera: PerspectiveCamera;
	/** The sun, whose shadows the shared switches reach. */
	sun: DirectionalLight;
	/** The stage, which owns the sky, the fog and the environment switches. */
	stage: Stage;
	/** The cloud, whose budget the Full detail switch caps. */
	splats: Splats;
	/** The splats in the whole cloud, which the signpost's label names. */
	total: number;
	/** The camera's vertical field of view in degrees, and the DSLR lens's focal length. */
	fov: number;
	focalLength: number;
	/** True when the scene's address asks for the lens at its start, as `?dslr` does. */
	dslr: boolean;
}

/** The garden's HUD and its camera route. */
export interface GardenHud {
	/**
	 * Moves the route and the controls, and follows a preset change with the splat budget. Call each
	 * frame, before the scene moves the camera that the cloud reads.
	 */
	update(dt: number, now: number): void;
	/** Names the cloud's counts on the signpost, when they changed or the interval passed. */
	label(now: number): void;
}

/** Builds the garden's controls, its route and the cloud's label. */
export function createHud(ctx: SketchContext, options: GardenHudOptions): GardenHud {
	const { camera, sun, stage, splats, total, fov, focalLength, dslr } = options;
	const { post, page } = ctx;
	/** True while the cloud draws the preset's whole budget. */
	let fullDetail = true;
	/** The budget that the add-on reported at the last change, so a preset change resets the cap. */
	let lastBudget = splats.feature.settings.drawn as number;
	/** Caps the draw at the preset's budget, or at a quarter of it. */
	const applyBudget = (): void => {
		const budget = Math.floor(splats.feature.settings.drawn as number);
		lastBudget = budget;
		splats.setBudget(fullDetail ? budget : Math.max(1, Math.floor(budget / 4)));
	};
	let film: Cinematic;
	page.onMessage((name) => {
		if (name !== 'splats') return;
		fullDetail = !fullDetail;
		applyBudget();
		film.refresh();
	});

	const target: [number, number, number] = [WIDE_LOOK[0], WIDE_LOOK[1], WIDE_LOOK[2]];
	const controls = createShowcaseEffects(ctx, {
		camera,
		sun,
		stage,
		start: {
			sky: true,
			fog: true,
			environment: true,
			bloom: false,
			dof: false,
			exposure: false,
			vignette: false,
		},
		supported: {
			atmosphere: ['sky', 'fog'],
			lighting: ['environment'],
			post: ['bloom', 'dof', 'exposure', 'vignette'],
		},
		extra: () => [
			{
				name: 'splats',
				title: 'Splats',
				radio: false,
				buttons: [
					{
						id: 'detail',
						label: 'Full detail',
						tip: 'Draw every splat that the preset allows. Off draws a quarter, so the levels of detail show.',
						active: fullDetail,
					},
				],
			},
		],
		apply(id, on) {
			if (id === 'bloom')
				post.set({ bloom: on ? { blend: 'add', intensity: 0.7, threshold: 1.2 } : false });
		},
		mood: (picked) => stage.set(picked),
		hour: (hours) => stage.setHour(hours),
		film: () => film,
		fov,
		focalLength,
		focus: target,
		dslr,
	});
	film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		groups: controls.groups,
		bounds: { ...BOUNDS, ground: gardenHeight },
	});

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
		update(dt, now) {
			controls.update(now);
			film.update(dt);
			const lens = controls.lens();
			if (lens) post.set(lens);
			// A preset change moves the budget, which the cap follows.
			if ((splats.feature.settings.drawn as number) !== lastBudget) applyBudget();
		},
		label(now) {
			if (now - posted > 0.3) {
				posted = now;
				name();
			}
		},
	};
}

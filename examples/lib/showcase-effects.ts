// The controls of a showcase scene: the effect switches, the "DSLR" lens, the HUD groups and the
// message router that the page's buttons reach. Both scenes answer a pick the same way, so the shared
// part lives here once and a scene gives only its own values: the effects it starts with, the ids each
// group shows, what its own effects do, and how its mood is chosen.
//
// The shared switches reach the stage for the sky, the fog and the environment light, the sun for the
// shadows, the camera and the post pass for the lens, and the post pass for automatic exposure and the
// vignette. Everything else, such as a scene's snow, light shafts, ambient occlusion or bloom, goes to
// the scene's own `apply`.
import type {
	DirectionalLight,
	PerspectiveCamera,
	QualityPreset,
	SketchContext,
} from '@null3d/engine';
import type { Cinematic } from './cinematic';
import {
	ATMOSPHERE,
	type HudGroup,
	LIGHTING,
	POST,
	QUALITY,
	radioGroup,
	TIME_BUTTONS,
	TIME_MARKS,
	toggleGroup,
} from './controls';
import { isMood, type Stage } from './stage';

/** How a showcase scene's controls are made. */
export interface ShowcaseEffectsOptions {
	/** The camera: the lens changes its focal length, and turns its fov back when the lens goes off. */
	camera: PerspectiveCamera;
	/** The scene's sun: the shadows switch casts them or not. */
	sun: DirectionalLight;
	/** The scene's stage, which owns the sky, the fog and the environment light switches. */
	stage: Stage;
	/** The effects that start on, with every id that the scene answers. */
	start: Readonly<Record<string, boolean>>;
	/** The ids each group of the HUD shows, in the order of the lists in `controls.ts`. */
	supported: {
		atmosphere: readonly string[];
		lighting: readonly string[];
		post: readonly string[];
	};
	/** The scene's own answer to an effect that is not one of the shared ones. */
	apply(id: string, on: boolean): void;
	/** The scene's own choice of a mood, such as the look its caustics and its air take. */
	mood(mood: import('./stage').Mood): void;
	/** The scene's own answer to a new hour from the slider, such as the look its air takes. */
	hour(hours: number): void;
	/** The scene's route player, which the router drives and refreshes. */
	film(): Cinematic;
	/** The fov the camera holds with no lens, and the focal length of the lens. */
	fov: number;
	focalLength: number;
	/** The point that the lens focuses on, which the scene keeps up to date. */
	focus: readonly number[];
	/** True when the scene's address asks for the lens at its start, as `?dslr` does. */
	dslr?: boolean;
}

/** The controls of a showcase scene. */
export interface ShowcaseEffects {
	/** The state of each effect button, by id. */
	readonly on: Readonly<Record<string, boolean>>;
	/** Turns an effect on or off, as its HUD button does. */
	set(id: string, on: boolean): void;
	/** The HUD's groups, in the order that the panel shows them. */
	groups(): readonly HudGroup[];
	/** The post settings of the lens while it is on, or null while it is off. */
	lens(): Record<string, unknown> | null;
	/** Sends the controls to the page while Auto moves the hour, so its slider follows. Call each frame. */
	update(t: number): void;
}

/** The aperture and blur of the lens, which both scenes share. */
const DSLR_LENS = { aperture: 1.8, maxBlur: 0.025 };

/**
 * Makes a scene's controls and wires them to the page's buttons. Every pick re-posts the HUD, so the
 * buttons show the state that the scene's own answer left.
 */
export function createShowcaseEffects(
	ctx: SketchContext,
	options: ShowcaseEffectsOptions,
): ShowcaseEffects {
	const { page, post, quality } = ctx;
	const { camera, sun, stage, start, supported, apply, mood, hour, film, fov, focalLength, focus } =
		options;
	const on: Record<string, boolean> = { ...start };
	// The level of detail starts off, so every mesh draws at its fullest until the Quality tab turns
	// it on; a threshold of 0 picks every mesh's base level. The switch turns it on again at the
	// preset's own threshold, or at a default threshold when the page started with it off.
	let lodThreshold = quality.settings.lodThreshold || 1;
	if (quality.settings.lodThreshold > 0) void quality.set({ lodThreshold: 0 });
	// The stage starts with every part on, so a part that the scene starts with off must be turned
	// off now; the HUD state and the scene then agree, and the button reads the scene's real state.
	for (const part of ['sky', 'fog', 'environment'] as const)
		if (start[part] === false) {
			stage.show(part, false);
			apply(part, false);
		}
	const settings = { dof: { ...DSLR_LENS, focusPoint: focus } };

	/** The time of the last controls post that Auto asked for. */
	let postedAt = Number.NEGATIVE_INFINITY;
	/** Turns the lens on or off: a long lens wide open, or the scene's own fov. */
	const setLens = (lit: boolean): void => {
		on.dof = lit;
		if (lit) camera.setFocalLength(focalLength);
		else camera.setFov(fov);
		post.set(lit ? settings : { dof: false });
	};

	const set = (id: string, lit: boolean): void => {
		on[id] = lit;
		switch (id) {
			case 'sky':
			case 'fog':
			case 'environment':
				// The stage writes the look every frame, so it owns these three switches. A scene may
				// hang its own haze on the fog switch, such as the mist over its water.
				stage.show(id, lit);
				apply(id, lit);
				break;
			case 'shadows':
				sun.setCastShadows(lit);
				break;
			case 'dof':
				setLens(lit);
				break;
			case 'exposure':
				post.set({ autoExposure: lit ? {} : false });
				break;
			case 'vignette':
				post.set({ vignette: lit ? {} : false });
				break;
			default:
				apply(id, lit);
		}
	};

	if (options.dslr) setLens(true);

	page.onMessage((name, value) => {
		const picked = String(value);
		if (name === 'camera') film().select(picked);
		else if (name === 'hour') {
			hour(Number(value));
			film().refresh();
		} else if (name === 'mood' && isMood(value)) {
			mood(value);
			film().refresh();
		} else if (name === 'atmosphere' || name === 'lighting' || name === 'post') {
			set(picked, !(on[picked] ?? false));
			film().refresh();
		} else if (name === 'quality') {
			const lod = quality.settings.lodThreshold > 0;
			if (picked === 'lod') {
				if (lod) lodThreshold = quality.settings.lodThreshold;
				void quality.set({ lodThreshold: lod ? 0 : lodThreshold });
			} else {
				// A preset gives every setting its own value, so the switch keeps the new preset's
				// threshold for its next turn on, and stays off when it was off.
				void quality.setPreset(picked as QualityPreset);
				lodThreshold = quality.settings.lodThreshold || lodThreshold;
				if (!lod) void quality.set({ lodThreshold: 0 });
			}
			film().refresh();
		}
	});

	return {
		on,
		set,
		groups: (): readonly HudGroup[] => [
			{
				name: 'hour',
				title: 'Time of day',
				radio: false,
				buttons: TIME_BUTTONS.map((option) => ({
					id: option.id,
					label: option.label,
					tip: option.tip,
					// The slider posts hours; the two buttons beside it pick a mood instead.
					name: 'mood',
					active: option.id === 'Auto' ? stage.auto : stage.mood === 'Studio',
				})),
				slider: {
					min: 0,
					max: 24,
					step: 0.05,
					value: stage.hours,
					live: stage.auto,
					marks: TIME_MARKS,
					tip: 'Slide to any hour of the day. Auto moves it by itself and loops.',
				},
			},
			toggleGroup(
				'atmosphere',
				'Atmosphere',
				ATMOSPHERE,
				supported.atmosphere,
				(id) => on[id] ?? false,
			),
			toggleGroup('lighting', 'Lighting', LIGHTING, supported.lighting, (id) => on[id] ?? false),
			toggleGroup('post', 'Post', POST, supported.post, (id) => on[id] ?? false),
			{
				...radioGroup('quality', 'Quality', QUALITY, quality.preset),
				// The level of detail is a quality setting, and a threshold of 0 draws every mesh at
				// its fullest, which is what turning it off means.
				extras: [
					{
						id: 'lod',
						label: 'LOD',
						tip: 'Draw simpler meshes in the distance. Off draws every mesh at its fullest.',
						active: quality.settings.lodThreshold > 0,
					},
				],
			},
		],
		lens: () => (on.dof ? settings : null),
		update(t) {
			// Auto moves the hour, so the page's slider follows it; a fixed hour posts nothing.
			if (!stage.auto || t - postedAt < 0.15) return;
			postedAt = t;
			film().refresh();
		},
	};
}

// The control model of a showcase scene: the groups of buttons that its HUD shows, and the shared
// lists of the standard groups. A scene builds a `HudModel` from its own state and posts it with the
// `hud` message; `examples/lib/hud.ts` draws it in the page. Each button names the message its group
// posts and the value it posts, so a scene answers its own state without the page knowing it.

/** One button of the controls. */
export interface HudButton {
	/** The value that the button posts to the sketch, and its name in its group. */
	id: string;
	/** The label that the button shows. */
	label: string;
	/** True for the chosen button of a radio group, or an effect that is on. */
	active: boolean;
	/** A keyboard hint, shown as a badge, for a button that a key also works. */
	key?: string;
	/** What the button does, alone, with no input device named. */
	tip: string;
}

/** One group of the controls, drawn as a card. */
export interface HudGroup {
	/** The message name that the group's buttons post. */
	name: string;
	/** The group's title, such as `Camera`. */
	title: string;
	/** True for a radio group, where one button is chosen; false for a row of toggles. */
	radio: boolean;
	/** The group's buttons, in the order that they show. */
	buttons: readonly HudButton[];
}

/** The whole controls model of a scene. */
export interface HudModel {
	groups: readonly HudGroup[];
}

/** One option of a radio group or a toggle: a label and a device-neutral tip. */
export interface HudOption {
	id: string;
	label: string;
	tip: string;
	key?: string;
}

/** The camera modes. `Auto` follows the scene's route; `Manual` hands the camera to the user. */
export const CAMERA_OPTIONS: readonly HudOption[] = [
	{ id: 'Auto', label: 'Auto', tip: 'The camera flies a cinematic route made for this scene.' },
	{
		id: 'Manual',
		label: 'Manual',
		tip: 'Take over the camera and move through the scene yourself.',
		key: 'C',
	},
];

/** The times of day that the showcase HUD offers, with `Auto` easing through them and looping. */
export const TIMES_OF_DAY: readonly HudOption[] = [
	{
		id: 'Auto',
		label: 'Auto',
		tip: 'Ease through the times of day and loop, each cross-fading into the next.',
	},
	{ id: 'Dawn', label: 'Dawn', tip: 'First light: a low sun and a warm sky.' },
	{ id: 'Morning', label: 'Morning', tip: 'A high, clear morning sun.' },
	{ id: 'Midday', label: 'Midday', tip: 'The sun overhead and the shortest shadows.' },
	{ id: 'Afternoon', label: 'Afternoon', tip: 'A warm, lowering sun.' },
	{ id: 'Golden', label: 'Golden', tip: 'The golden hour: a long, amber sun.' },
	{ id: 'Dusk', label: 'Dusk', tip: 'Blue hour: the sun just below the horizon.' },
	{ id: 'Night', label: 'Night', tip: 'Moonlight, a navy sky and the moon\u2019s own light.' },
];

/** The atmosphere effects. A scene shows only the ones it can support. */
export const ATMOSPHERE: readonly HudOption[] = [
	{ id: 'sky', label: 'Sky', tip: 'Draw the physical sky and light the scene from it.' },
	{ id: 'fog', label: 'Fog', tip: 'Haze that thickens with distance, for depth.' },
	{ id: 'shafts', label: 'Light shafts', tip: 'Visible shafts of light through the haze.' },
	{ id: 'snow', label: 'Snow', tip: 'Snow that falls through the scene.' },
	{ id: 'fireflies', label: 'Fireflies', tip: 'Drifting firefly lights over the banks.' },
];

/** The lighting effects. */
export const LIGHTING: readonly HudOption[] = [
	{ id: 'shadows', label: 'Shadows', tip: 'The sun or the moon casts shadows.' },
	{
		id: 'contact',
		label: 'Contact',
		tip: 'Contact shadows ground small objects where they meet a surface.',
	},
	{ id: 'ao', label: 'AO', tip: 'Ambient occlusion darkens the creases and corners.' },
	{
		id: 'environment',
		label: 'Environment',
		tip: 'Light the scene from the sky, so reflections match it.',
	},
];

/** The post effects that the showcase scenes offer. */
export const POST: readonly HudOption[] = [
	{ id: 'bloom', label: 'Bloom', tip: 'A soft glow around bright lights.' },
	{ id: 'dof', label: 'Depth of field', tip: 'A lens that blurs the near and far planes.' },
	{
		id: 'exposure',
		label: 'Exposure',
		tip: 'Auto exposure: the scene adapts to bright and dark places.',
	},
	{ id: 'grading', label: 'Grading', tip: 'A colour grade and tone curve over the frame.' },
	{ id: 'vignette', label: 'Vignette', tip: 'Darken the edges of the frame.' },
	{ id: 'outlines', label: 'Outlines', tip: 'Draw ink outlines around objects.' },
];

/** The quality presets, which the page's engine answers. */
export const QUALITY: readonly HudOption[] = [
	{ id: 'low', label: 'Low', tip: 'The lightest preset.' },
	{ id: 'medium', label: 'Medium', tip: 'A balanced preset.' },
	{ id: 'high', label: 'High', tip: 'The preset most showcase scenes start at.' },
	{ id: 'ultra', label: 'Ultra', tip: 'Every effect at its best, for a desktop GPU.' },
];

/** A radio group: one button is chosen, and each posts the group's name and its own id. */
export function radioGroup(
	name: string,
	title: string,
	options: readonly HudOption[],
	active: string,
): HudGroup {
	return {
		name,
		title,
		radio: true,
		buttons: options.map((option) => {
			const button: HudButton = {
				id: option.id,
				label: option.label,
				tip: option.tip,
				active: option.id === active,
			};
			if (option.key !== undefined) button.key = option.key;
			return button;
		}),
	};
}

/**
 * A row of toggles: each posts the group's name and its own id, and the scene flips its own state.
 * Only the options that the scene supports are shown.
 */
export function toggleGroup(
	name: string,
	title: string,
	options: readonly HudOption[],
	supported: readonly string[],
	on: (id: string) => boolean,
): HudGroup {
	return {
		name,
		title,
		radio: false,
		buttons: options
			.filter((option) => supported.includes(option.id))
			.map((option) => ({
				id: option.id,
				label: option.label,
				tip: option.tip,
				active: on(option.id),
			})),
	};
}

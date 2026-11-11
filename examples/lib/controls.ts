// The control model of a showcase scene: the groups of buttons that its HUD shows, and the shared
// lists of the standard groups. A scene builds a `HudModel` from its own state and posts it with the
// `hud` message; `examples/lib/hud.ts` draws it in the page. Each button names the message its group
// posts and the value it posts, so a scene answers its own state without the page knowing it.

import type { QualityPreset } from '@null3d/engine';

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
	/** The message that the button posts, when it is not its group's name. */
	name?: string;
	/** True when the button cannot be used now; its reason says why. */
	disabled?: boolean;
	/** Why the button is disabled, in plain words. The HUD shows it when the button has focus. */
	reason?: string;
}

/** A slider of one value, with labels at key points along it. */
export interface HudSlider {
	/** The lowest value, the highest value and the step between them. */
	min: number;
	max: number;
	step: number;
	/** The value now. */
	value: number;
	/** True while the value moves by itself, as the hour does in Auto. */
	live: boolean;
	/** The labels under the track, each at its own value. */
	marks: readonly { at: number; label: string }[];
	/** What the slider sets, alone, with no input device named. */
	tip: string;
	/** A dial that the slider draws as instead of a track, for a value that wraps round. */
	dial?: HudDial;
}

/**
 * A slider drawn as a round dial, for a value that wraps round from its highest to its lowest, as
 * the hour does past midnight. The lowest value sits at the bottom and the values run clockwise, so
 * an hour dial has noon at the top. A readout beside the dial shows the value as a clock time and
 * the name of the span it falls in.
 */
export interface HudDial {
	/** The colors of the ring at points round it, by value, as hex. */
	colors: readonly (readonly [number, string])[];
	/** The names that the readout gives the value, each with the values it spans; a span may wrap. */
	names: readonly (readonly [string, number, number])[];
	/** A name that stands in for the value while the value does not apply, which dims the dial. */
	off?: string;
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
	/** A slider above the buttons, for a group that sets one continuous value. */
	slider?: HudSlider;
	/** Toggles below the buttons, for a group whose row is a choice and which also has switches. */
	extras?: readonly HudButton[];
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
	/** The lightest quality preset at which the option works, when a preset can disable it. */
	minPreset?: QualityPreset;
}

/** Says why an option cannot be used now, or returns undefined when it can. */
export type Unavailable = (option: HudOption) => string | undefined;

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

/** The times of day that the HUD labels along its hour slider. */
export const TIME_MARKS: readonly { at: number; label: string }[] = [
	{ at: 6.2, label: 'Dawn' },
	{ at: 9, label: 'Morning' },
	{ at: 12, label: 'Midday' },
	{ at: 15, label: 'Afternoon' },
	{ at: 17.6, label: 'Golden' },
	{ at: 18.4, label: 'Dusk' },
	{ at: 23, label: 'Night' },
];

/**
 * The sky's color round the hour dial, from midnight through dawn's pink and noon's blue to the
 * golden hour, dusk's violet and night again.
 */
export const TIME_SKY: readonly (readonly [number, string])[] = [
	[0, '#0a1230'],
	[4, '#101a40'],
	[5.2, '#2b2457'],
	[6.2, '#e2735f'],
	[7.5, '#f4b26a'],
	[9, '#f6d98a'],
	[10.5, '#9ccff0'],
	[12, '#6db6f7'],
	[15, '#8ec6ea'],
	[16.5, '#f2c27a'],
	[17.6, '#ff9a3d'],
	[18.4, '#c05673'],
	[19.3, '#5b3a86'],
	[20.5, '#23285a'],
	[23, '#0d1534'],
	[24, '#0a1230'],
];

/** The names the hour dial's readout gives each hour, with the hours each spans. */
export const TIME_NAMES: readonly (readonly [string, number, number])[] = [
	['Midnight', 23.5, 0.5],
	['Night', 0.5, 5],
	['Dawn', 5, 7.5],
	['Morning', 7.5, 10.5],
	['Midday', 10.5, 13.5],
	['Afternoon', 13.5, 16.8],
	['Golden', 16.8, 18],
	['Dusk', 18, 20.5],
	['Night', 20.5, 23.5],
];

/**
 * The buttons beside the hour dial. Auto moves the hour by itself and loops; the studio is not an
 * hour but a backdrop and a key light of its own, and Auto never passes through it. Each turns on
 * with a press and off with the next.
 */
export const TIME_BUTTONS: readonly HudOption[] = [
	{
		id: 'Auto',
		label: 'Auto',
		tip: 'Move the hour by itself, across the whole day and round again. Press again to hold the hour.',
	},
	{
		id: 'Studio',
		label: 'Studio',
		tip: 'A studio backdrop: the scene under a soft key light, for a look at the model. Press again for the sky.',
	},
];

/** The atmosphere effects. A scene shows only the ones it can support. */
export const ATMOSPHERE: readonly HudOption[] = [
	{ id: 'sky', label: 'Sky', tip: 'Draw the physical sky and light the scene from it.' },
	{ id: 'fog', label: 'Fog', tip: 'Haze that thickens with distance, for depth.' },
	{
		id: 'shafts',
		label: 'Light shafts',
		tip: 'Visible shafts of light through the haze.',
		minPreset: 'high',
	},
	{ id: 'snow', label: 'Snow', tip: 'Snow that falls through the scene.' },
	{ id: 'rain', label: 'Rain', tip: 'Rain that falls through the scene.' },
	{
		id: 'storm',
		label: 'Storm',
		tip: 'Heavy weather: full cloud, thicker fog and driving rain.',
	},
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
	{
		id: 'ao',
		label: 'AO',
		tip: 'Ambient occlusion darkens the creases and corners.',
		minPreset: 'high',
	},
	{
		id: 'environment',
		label: 'Environment',
		tip: 'Light the scene from the sky, so reflections match it.',
	},
];

/** The post effects that the showcase scenes offer. */
export const POST: readonly HudOption[] = [
	{ id: 'bloom', label: 'Bloom', tip: 'A soft glow around bright lights.' },
	{
		id: 'dof',
		label: 'Depth of field',
		tip: 'A lens that blurs the near and far planes.',
		minPreset: 'medium',
	},
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
	unavailable?: Unavailable,
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
			addReason(button, unavailable?.(option));
			return button;
		}),
	};
}

/**
 * A row of toggles: each posts the group's name and its own id, and the scene flips its own state.
 * Only the options that the scene supports are shown. An option that the scene supports but that
 * needs a heavier quality preset stays, disabled, with the reason.
 */
export function toggleGroup(
	name: string,
	title: string,
	options: readonly HudOption[],
	supported: readonly string[],
	on: (id: string) => boolean,
	unavailable?: Unavailable,
): HudGroup {
	return {
		name,
		title,
		radio: false,
		buttons: options
			.filter((option) => supported.includes(option.id))
			.map((option) => {
				const button: HudButton = {
					id: option.id,
					label: option.label,
					tip: option.tip,
					active: on(option.id),
				};
				addReason(button, unavailable?.(option));
				return button;
			}),
	};
}

/** Marks a button disabled with its reason. */
function addReason(button: HudButton, reason: string | undefined): void {
	if (reason === undefined) return;
	button.disabled = true;
	button.reason = reason;
}

/** The position of a preset in the HUD's order, from the lightest to the heaviest. */
function presetRank(preset: QualityPreset): number {
	return QUALITY.findIndex((option) => option.id === preset);
}

/** The label that the HUD shows for a preset. */
function presetLabel(preset: QualityPreset): string {
	return QUALITY.find((option) => option.id === preset)?.label ?? preset;
}

/** The names of the presets from `from` to the heaviest, such as "High or Ultra". */
function presetNames(from: QualityPreset): string {
	const names = QUALITY.filter(
		(option) => presetRank(option.id as QualityPreset) >= presetRank(from),
	).map((option) => option.label);
	if (names.length <= 1) return names[0] ?? presetLabel(from);
	return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

/** Why a preset that the GPU path cannot run is disabled. */
export function presetCapReason(preset: QualityPreset, highest: QualityPreset): string | undefined {
	if (presetRank(preset) <= presetRank(highest)) return undefined;
	return `${presetLabel(preset)} is not available. This device is held to ${presetLabel(highest)}, and the heavier presets need a graphics processor that this browser does not offer.`;
}

/**
 * Why a feature that needs a heavier preset is disabled: the device cannot reach that preset, or
 * the preset in use is lighter than the one the feature needs.
 */
export function presetFeatureReason(
	option: HudOption,
	current: QualityPreset,
	highest: QualityPreset,
): string | undefined {
	const needed = option.minPreset;
	if (needed === undefined || presetRank(current) >= presetRank(needed)) return undefined;
	const names = presetNames(needed);
	if (presetRank(highest) < presetRank(needed))
		return `Needs ${names}. This device is held to ${presetLabel(highest)}.`;
	return `Needs ${names}. Choose a higher quality preset.`;
}

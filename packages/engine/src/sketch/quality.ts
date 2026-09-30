// The sketch's quality API, `ctx.quality`: the preset that the engine runs, the settings in use,
// changes to them, and a notice when they change. The page chooses the preset and gives the
// settings their first values. A sketch changes the settings that can change during play, and the
// engine applies each change from the next frame on. A change of preset changes every setting,
// including those fixed while a preset runs, so the first frame after it waits for its new
// pipelines, as the first frame of the engine does.

import type { PresetCheck } from '../quality/check';
import {
	checkSettings,
	LIVE_SETTINGS,
	presetArgument,
	presetIndex,
	presetSettings,
	type QualityPreset,
	type QualitySettings,
	SKETCH_SETTINGS,
} from '../quality/presets';

/** The preset and the settings that the page starts a sketch with. */
export interface QualityStart {
	preset: QualityPreset;
	settings: QualitySettings;
	/** The settings that the page's options give, which every preset keeps. */
	options: Partial<QualitySettings>;
	/** The GPU path's highest preset, which caps the presets that `setPreset` gets. */
	highest: QualityPreset;
	/**
	 * Present when the engine checks the preset after its first frame. `fps` is the frame rate that
	 * the ?fps= switch holds, which caps the check's target.
	 */
	check?: { fps?: number };
}

/** What the page learns after each change: the preset, the settings, and the check's result. */
export interface QualityUpdate {
	preset: QualityPreset;
	settings: QualitySettings;
	check?: PresetCheck;
}

/**
 * The quality preset and settings, as a sketch reads and changes them through `ctx.quality`.
 *
 * @category api/quality
 */
export interface Quality {
	/** The preset that the engine runs. */
	readonly preset: QualityPreset;
	/**
	 * The settings in use: the preset's values, with the values of the page's options and the
	 * changes that `set` made.
	 */
	readonly settings: Readonly<QualitySettings>;
	/**
	 * Changes settings from the next frame on. It takes the settings that can change during play,
	 * each with a value that the setting takes, and throws E1213 for any other setting or value. A
	 * setting that it does not get keeps its value.
	 */
	set(settings: Partial<QualitySettings>): void;
	/**
	 * Switches to another preset at a point that the sketch picks, such as a menu or a loading
	 * screen. Every setting takes the new preset's value, apart from those that the page's options
	 * give. The GPU path caps the preset, as it caps the page's choice. The promise resolves once
	 * the engine has drawn a frame at the new preset with all of its pipelines built. Until then
	 * the last frame stays on screen, and the sketch's frames wait. A name that is no preset throws
	 * E1213.
	 */
	setPreset(preset: QualityPreset): Promise<void>;
	/**
	 * Calls `handler` at the start of the first frame after the settings change. Returns a function
	 * that removes the handler.
	 */
	onChange(handler: (quality: Quality) => void): () => void;
}

/** No change since the frame that last asked. */
export const NO_CHANGE = 0;
/** A change of settings, which the change handlers hear of. */
export const SETTINGS_CHANGE = 1;
/** A change of preset, whose frames wait for their pipelines. */
export const PRESET_CHANGE = 2;

/**
 * The sketch's quality API. `apply` gives the page the preset and the settings after each change.
 * `settle` resolves once a frame after a change of preset has drawn with all of its pipelines.
 */
export class SketchQuality implements Quality {
	preset: QualityPreset;
	readonly settings: QualitySettings;
	readonly handlers = new Set<(quality: Quality) => void>();
	/** The change that the next frame's handlers hear of. */
	private change = NO_CHANGE;
	/** True from a change of preset until the next frame records. */
	private restart = false;
	private readonly options: Partial<QualitySettings>;
	private readonly highest: QualityPreset;

	constructor(
		start: QualityStart,
		private readonly apply: (update: QualityUpdate) => void,
		private readonly settle: () => Promise<void> = () => Promise.resolve(),
	) {
		this.preset = start.preset;
		this.settings = { ...start.settings };
		this.options = start.options;
		this.highest = start.highest;
	}

	set(settings: Partial<QualitySettings>): void {
		checkSettings('quality.set()', settings, LIVE_SETTINGS);
		const current = this.settings as unknown as Record<string, unknown>;
		let changed = false;
		for (const [name, value] of Object.entries(settings)) {
			if (value === undefined || current[name] === value) continue;
			current[name] = value;
			changed = true;
		}
		if (!changed) return;
		this.change = Math.max(this.change, SETTINGS_CHANGE);
		this.report();
	}

	setPreset(preset: QualityPreset): Promise<void> {
		const wanted = presetArgument(preset);
		const next = presetIndex(wanted) > presetIndex(this.highest) ? this.highest : wanted;
		const settings = presetSettings(next, this.options);
		const current = this.settings as unknown as Record<string, unknown>;
		const same =
			next === this.preset &&
			SKETCH_SETTINGS.every((name) => current[name] === settings[name as keyof QualitySettings]);
		if (same) return Promise.resolve();
		this.preset = next;
		Object.assign(this.settings, settings);
		this.change = PRESET_CHANGE;
		this.restart = true;
		this.report();
		return this.settle();
	}

	onChange(handler: (quality: Quality) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/** Gives the page the preset and a copy of the settings, and the check's result when given. */
	report(check?: PresetCheck): void {
		this.apply({ preset: this.preset, settings: { ...this.settings }, check });
	}

	/**
	 * The change since the frame that last asked, once, for the handlers of a frame that runs the
	 * sketch: `NO_CHANGE`, `SETTINGS_CHANGE` or `PRESET_CHANGE`.
	 */
	takeChange(): number {
		const change = this.change;
		this.change = NO_CHANGE;
		return change;
	}

	/** True once after a change of preset, for the first frame that records after it. */
	takeRestart(): boolean {
		const restart = this.restart;
		this.restart = false;
		return restart;
	}
}

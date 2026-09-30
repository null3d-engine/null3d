// The sketch's quality API, `ctx.quality`: the preset that the engine runs, the settings in use,
// changes to them, and a notice when they change. The page chooses the preset and gives the
// settings their first values. A change of a setting that can change during play applies from the
// next frame on. A change of preset, or of a setting fixed while a preset runs, restarts the
// preset: the first frame after it waits for its new pipelines, as the first frame of the engine
// does, and the change resolves once the thread that draws has taken that frame. A setting that the
// sketch chose itself keeps its value when the engine's preset check lowers the preset.

import type { PresetCheck } from '../quality/check';
import {
	checkSettings,
	LIVE_SETTINGS,
	lowered,
	presetArgument,
	presetIndex,
	presetSettings,
	type QualityPreset,
	type QualitySettingName,
	type QualitySettings,
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
 * Applies a change on the sketch's thread and tells the page of it. `changed` names the settings
 * that took new values.
 */
export type ApplyQuality = (update: QualityUpdate, changed: readonly QualitySettingName[]) => void;

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
	 * Changes settings. It takes the settings that `settings` lists, each with a value that the
	 * setting takes, and throws E1213 for any other setting or value. A setting that it does not
	 * get keeps its value. A setting that changes during play applies from the next frame on, and
	 * the promise resolves at once. A setting fixed while a preset runs makes the change wait as
	 * `setPreset` does: the last frame stays on screen until the engine has drawn a frame with
	 * the new settings and all of its pipelines built, and then the promise resolves.
	 */
	set(settings: Partial<QualitySettings>): Promise<void>;
	/**
	 * Switches to another preset at a point that the sketch picks, such as a menu or a loading
	 * screen. Every setting takes the new preset's value, apart from those that the page's options
	 * give, including the settings that `set` changed. The GPU path caps the preset, as it caps the
	 * page's choice. The promise resolves once
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
/** A change of settings that apply during play, which the change handlers hear of. */
export const LIVE_CHANGE = 1;
/** A change of preset, or of a setting fixed while a preset runs, whose frames wait for pipelines. */
export const RESTART_CHANGE = 2;

/**
 * The sketch's quality API. `apply` applies each change. `settle` resolves once the thread that
 * draws has taken the first frame after a restart, with all of its pipelines built.
 */
export class SketchQuality implements Quality {
	preset: QualityPreset;
	readonly settings: QualitySettings;
	readonly handlers = new Set<(quality: Quality) => void>();
	/** The change that the next frame's handlers hear of. */
	private change = NO_CHANGE;
	/** True from a restart until the next frame records. */
	private restart = false;
	/** The settings that the sketch chose itself since the preset it last asked for. */
	private readonly owned = new Set<QualitySettingName>();
	private readonly options: Partial<QualitySettings>;
	private readonly highest: QualityPreset;

	constructor(
		start: QualityStart,
		private readonly apply: ApplyQuality,
		private readonly settle: () => Promise<void> = () => Promise.resolve(),
	) {
		this.preset = start.preset;
		this.settings = { ...start.settings };
		this.options = start.options;
		this.highest = start.highest;
	}

	set(settings: Partial<QualitySettings>): Promise<void> {
		checkSettings('quality.set()', settings);
		for (const [name, value] of Object.entries(settings))
			if (value !== undefined) this.owned.add(name as QualitySettingName);
		return this.update(this.preset, settings);
	}

	setPreset(preset: QualityPreset): Promise<void> {
		const wanted = presetArgument(preset);
		const next = presetIndex(wanted) > presetIndex(this.highest) ? this.highest : wanted;
		this.owned.clear();
		return this.update(next, presetSettings(next, this.options));
	}

	/**
	 * Counts a setting as the sketch's own choice, for a call that sets it outside `set`, such as
	 * a texture upload budget below the setting's range.
	 */
	own(name: QualitySettingName): void {
		this.owned.add(name);
	}

	/**
	 * The preset check's step to the next lighter preset. The settings that the page's options give,
	 * and those that the sketch chose itself, keep their values.
	 */
	lower(): Promise<void> {
		const next = lowered(this.preset, 1);
		const kept: Record<string, unknown> = { ...this.options };
		const current = this.settings as unknown as Record<string, unknown>;
		for (const name of this.owned) kept[name] = current[name];
		return this.update(next, presetSettings(next, kept as Partial<QualitySettings>));
	}

	onChange(handler: (quality: Quality) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/** Tells the page of the preset and the settings, with the check's result when given. */
	report(check?: PresetCheck): void {
		this.apply({ preset: this.preset, settings: { ...this.settings }, check }, []);
	}

	/**
	 * The change since the frame that last asked, once, for the handlers of a frame that runs the
	 * sketch: `NO_CHANGE`, `LIVE_CHANGE` or `RESTART_CHANGE`.
	 */
	takeChange(): number {
		const change = this.change;
		this.change = NO_CHANGE;
		return change;
	}

	/** True once after a restart, for the first frame that records after it. */
	takeRestart(): boolean {
		const restart = this.restart;
		this.restart = false;
		return restart;
	}

	/**
	 * Moves to `preset` with the values in `settings`, and applies the settings that change. A new
	 * preset, or a new value of a setting that is not live, restarts the preset.
	 */
	private update(preset: QualityPreset, settings: Partial<QualitySettings>): Promise<void> {
		const current = this.settings as unknown as Record<string, unknown>;
		const changed: QualitySettingName[] = [];
		let restart = preset !== this.preset;
		for (const [name, value] of Object.entries(settings)) {
			if (value === undefined || current[name] === value) continue;
			current[name] = value;
			changed.push(name as QualitySettingName);
			if (!LIVE_SETTINGS.includes(name as QualitySettingName)) restart = true;
		}
		if (!restart && changed.length === 0) return Promise.resolve();
		this.preset = preset;
		this.change = restart ? RESTART_CHANGE : Math.max(this.change, LIVE_CHANGE);
		if (restart) this.restart = true;
		this.apply({ preset, settings: { ...this.settings } }, changed);
		return restart ? this.settle() : Promise.resolve();
	}
}

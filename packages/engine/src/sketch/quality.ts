// The sketch's quality API, `ctx.quality`: the preset that the engine runs, the settings in use,
// changes to them, and a notice when they change. The page chooses the preset and gives the
// settings their first values. A sketch changes the settings that can change during play, and the
// engine applies each change from the next frame on.

import { checkSettings, type QualityPreset, type QualitySettings } from '../quality/presets';

/** The preset and the settings that the page starts a sketch with. */
export interface QualityStart {
	preset: QualityPreset;
	settings: QualitySettings;
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
	 * Calls `handler` at the start of the first frame after the settings change. Returns a function
	 * that removes the handler.
	 */
	onChange(handler: (quality: Quality) => void): () => void;
}

/** The sketch's quality API. `apply` gives the page the settings after each change. */
export class SketchQuality implements Quality {
	readonly preset: QualityPreset;
	readonly settings: QualitySettings;
	readonly handlers = new Set<(quality: Quality) => void>();
	private changed = false;

	constructor(
		start: QualityStart,
		private readonly apply: (settings: QualitySettings) => void,
	) {
		this.preset = start.preset;
		this.settings = { ...start.settings };
	}

	set(settings: Partial<QualitySettings>): void {
		checkSettings('quality.set()', settings);
		const current = this.settings as unknown as Record<string, unknown>;
		let changed = false;
		for (const [name, value] of Object.entries(settings)) {
			if (value === undefined || current[name] === value) continue;
			current[name] = value;
			changed = true;
		}
		if (!changed) return;
		this.changed = true;
		this.apply({ ...this.settings });
	}

	onChange(handler: (quality: Quality) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/** True once for each change of the settings, at the first frame that asks after it. */
	takeChange(): boolean {
		const changed = this.changed;
		this.changed = false;
		return changed;
	}
}

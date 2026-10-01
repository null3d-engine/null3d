// The sketch's quality API, `ctx.quality`: the preset that the engine runs, the settings in use,
// changes to them, and a notice when they change. The page chooses the preset and gives the
// settings their first values. A sketch changes the settings that can change during play, and the
// engine applies each change from the next frame on.

import { EngineError } from '../errors/engine-error';
import {
	checkSettings,
	LIVE_SETTINGS,
	type QualityPreset,
	type QualitySettingName,
	type QualitySettings,
} from '../quality/presets';

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
	 * The render scale that the engine draws the scene at: the part of the canvas's width and
	 * height, from `minRenderScale` to `maxRenderScale`. The engine lowers it when frames take too
	 * long and raises it again when they have time to spare. A change of the range applies to the
	 * frame being drawn.
	 */
	readonly renderScale: number;
	/**
	 * Changes settings from the next frame on. It takes the settings that can change during play,
	 * each with a value that the setting takes, and throws E1213 for any other setting or value, or
	 * for a `minRenderScale` above `maxRenderScale`. A setting that it does not get keeps its value.
	 */
	set(settings: Partial<QualitySettings>): void;
	/**
	 * Calls `handler` at the start of the first frame after the settings change. Returns a function
	 * that removes the handler.
	 */
	onChange(handler: (quality: Quality) => void): () => void;
}

/** Applies the settings after a change. `changed` names the settings that took new values. */
export type ApplySettings = (
	settings: QualitySettings,
	changed: readonly QualitySettingName[],
) => void;

/**
 * The sketch's quality API. `apply` applies the settings after each change, and `scale` reads the
 * render scale.
 */
export class SketchQuality implements Quality {
	readonly preset: QualityPreset;
	readonly settings: QualitySettings;
	readonly handlers = new Set<(quality: Quality) => void>();
	private changed = false;

	constructor(
		start: QualityStart,
		private readonly apply: ApplySettings,
		private readonly scale: () => number = () => 1,
	) {
		this.preset = start.preset;
		this.settings = { ...start.settings };
	}

	get renderScale(): number {
		return this.scale();
	}

	set(settings: Partial<QualitySettings>): void {
		checkSettings('quality.set()', settings, LIVE_SETTINGS);
		const lowest = settings.minRenderScale ?? this.settings.minRenderScale;
		const highest = settings.maxRenderScale ?? this.settings.maxRenderScale;
		if (lowest > highest)
			throw new EngineError(
				'E1213',
				`quality.set() would give minRenderScale ${lowest}, above maxRenderScale ${highest}. Give both in one call to change them together.`,
			);
		const current = this.settings as unknown as Record<string, unknown>;
		const changed: QualitySettingName[] = [];
		for (const [name, value] of Object.entries(settings)) {
			if (value === undefined || current[name] === value) continue;
			current[name] = value;
			changed.push(name as QualitySettingName);
		}
		if (changed.length === 0) return;
		this.changed = true;
		this.apply({ ...this.settings }, changed);
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

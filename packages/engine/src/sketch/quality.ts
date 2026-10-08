// The sketch's quality API, `ctx.quality`: the preset that the engine runs, the settings in use,
// changes to them, and a notice when they change. The page chooses the preset and gives the
// settings their first values. A change of a setting that can change during play applies from the
// next frame on. A change of preset, or of a setting fixed while a preset runs, restarts the
// preset: the first frame after it waits for its new pipelines, as the first frame of the engine
// does, and the change resolves once the thread that draws has taken that frame. The settings fixed
// while a preset runs keep the values that the engine started with, as the page's options do, until
// the thread that draws can change them. A setting that the sketch chose itself keeps its value
// when the engine's preset check lowers the preset. A sketch's own systems register budgets, whose
// scale the frame-budget governor lowers with its other steps.

import { EngineError } from '../errors/engine-error';
import type { PresetCheck } from '../quality/check';
import { budgetScale, budgetSteps } from '../quality/governor';
import {
	capTextureMemory,
	checkSettings,
	LIVE_SETTINGS,
	lowered,
	presetArgument,
	presetIndex,
	presetSettings,
	type QualityPreset,
	type QualitySettingName,
	type QualitySettings,
	startValues,
} from '../quality/presets';
import type { TextureMemory } from '../scene/textures';

/** The preset and the settings that the page starts a sketch with. */
export interface QualityStart {
	preset: QualityPreset;
	settings: QualitySettings;
	/** The settings that the page's options give, which every preset keeps. */
	options: Partial<QualitySettings>;
	/** The GPU path's highest preset, which caps the presets that `setPreset` gets. */
	highest: QualityPreset;
	/**
	 * The most texture memory in MiB that a preset gives on this kind of device, unless the page's
	 * options give the texture memory. Without it, there is no cap.
	 */
	textureCapMiB?: number;
	/**
	 * Present when the engine checks the preset after its first frame. `fps` is the frame rate that
	 * the ?fps= switch holds, which caps the check's target.
	 */
	check?: { fps?: number };
}

/** The texture memory of a sketch quality without textures, as tests make it. */
const NO_TEXTURE_MEMORY: TextureMemory = {
	bytes: 0,
	budgetBytes: 0,
	droppedLevels: 0,
	droppedTextures: 0,
};

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
 * What the frame-budget governor has lowered, in `quality.governor`. It lowers the render scale
 * first, which `quality.renderScale` reports, then the shadow settings and bloom's size here.
 *
 * @category api/quality
 */
export interface QualityGovernor {
	/**
	 * The steps past the render scale that the governor has taken: 0 while the shadow settings and
	 * bloom's size apply as set. Each step lowers the frame's cost after the render scale has reached
	 * `minRenderScale`, so a sketch can lighten its own work too, such as its particles.
	 */
	readonly steps: number;
	/**
	 * How often each far shadow cascade draws now: `settings.farCascadeInterval`, or up to twice as
	 * long for each of the governor's steps, at most every 8th frame. While
	 * `settings.followMovingCasters` is false, the governor takes no such step.
	 */
	readonly farCascadeInterval: number;
	/** The shadow filter that shadows draw with now: `settings.shadowFilter`, or 3 after the last step. */
	readonly shadowFilter: 3 | 5;
	/**
	 * The texels on the short side of bloom's largest level now: `settings.bloomSize`, or half as
	 * many after the governor's step that follows the shadow steps, while bloom is on. The glow keeps
	 * its size.
	 */
	readonly bloomSize: number;
	/**
	 * The size of ambient occlusion's targets now: `settings.aoScale`, or half as large after the
	 * governor's last step while ambient occlusion draws.
	 */
	readonly aoScale: number;
}

/**
 * A system of the sketch's own that the frame-budget governor scales, as `quality.setBudget` gets
 * it.
 *
 * @category api/quality
 */
export interface QualityBudgetOptions {
	/**
	 * The system's name, such as `'ai'` or `'particles'`. A second budget with the same name
	 * replaces the first.
	 */
	name: string;
	/**
	 * The time in ms that the system may take in each frame at full quality: a number above 0. The
	 * engine does not measure the system. It scales this time into the budget's `ms`.
	 */
	ms: number;
	/** The lowest scale that the governor gives the system, from 0 to 1. The default is 0. */
	min?: number;
	/**
	 * Called with the budget's scale when the budget is set, and again at the start of each frame
	 * after the governor moves it.
	 */
	onScale?: (scale: number) => void;
}

/**
 * A budget that `quality.setBudget` registered: the scale that the frame-budget governor gives the
 * system now.
 *
 * @category api/quality
 */
export interface QualityBudget {
	/** The system's name. */
	readonly name: string;
	/**
	 * The scale from `min` to 1 that the system runs at now: 1 at full quality. The governor lowers
	 * it in steps of 0.25 when frames take too long, and raises it again when they have time to
	 * spare.
	 */
	readonly scale: number;
	/** The time in ms that the system may take in each frame now: the budget's `ms` times `scale`. */
	readonly ms: number;
	/**
	 * Removes the budget: the governor stops lowering the system, and `onScale` is not called again.
	 * The scale keeps its last value.
	 */
	remove(): void;
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
	 * What the frame-budget governor has lowered below `settings`. When frames take too long, the
	 * governor lowers the render scale, then the shadow settings, then bloom's size, one step at a
	 * time. The `onChange` handlers run after each of those steps, but not after a step of the
	 * render scale. Hold mode has no governor, so it draws with the settings as set.
	 */
	readonly governor: QualityGovernor;
	/**
	 * The GPU memory that textures take, against `settings.textureMemoryMiB`, and the mip levels
	 * that the engine dropped to stay under it. The `onChange` handlers run after the engine drops
	 * levels or asks for them again.
	 */
	readonly textureMemory: TextureMemory;
	/**
	 * Changes settings from the next frame on, and resolves at once. It takes the settings that
	 * change during play, each with a value that the setting takes, and throws E1213 for any other
	 * setting or value, or for a `minRenderScale` above `maxRenderScale`. A setting that it does not
	 * get keeps its value.
	 */
	set(settings: Partial<QualitySettings>): Promise<void>;
	/**
	 * Switches to another preset at a point that the sketch picks, such as a menu or a loading
	 * screen. Every setting that changes during play takes the new preset's value, including the
	 * settings that `set` changed, apart from those that the page's options give. The settings
	 * fixed when the engine starts, such as `antialias`, keep their values. The GPU path caps the
	 * preset, as it caps the page's choice. The promise resolves once
	 * the engine has drawn a frame at the new preset with all of its pipelines built. Until then
	 * the last frame stays on screen, and the sketch's frames wait. A name that is no preset throws
	 * E1213.
	 */
	setPreset(preset: QualityPreset): Promise<void>;
	/**
	 * Registers a budget for a system of the sketch's own, such as its AI or its particles, and
	 * returns it. The frame-budget governor gives every budget one scale from 0 to 1, each no lower
	 * than its `min`. When frames take too long, the governor lowers the scale by 0.25 before each
	 * step of the render scale, so the system scales down before the render scale reaches its floor.
	 * It raises the scale again in the reverse order. A budget with the name of another replaces it.
	 * Options that the call does not take throw E1213.
	 */
	setBudget(options: QualityBudgetOptions): QualityBudget;
	/**
	 * Calls `handler` at the start of the first frame after the settings change. Returns a function
	 * that removes the handler.
	 */
	onChange(handler: (quality: Quality) => void): () => void;
}

/** A registered budget, which the sketch's budgets scale. */
class Budget implements QualityBudget {
	scale = 1;
	min = 0;
	full = 0;
	onScale: ((scale: number) => void) | undefined;

	constructor(
		readonly name: string,
		private readonly budgets: GameBudgets,
	) {}

	get ms(): number {
		return this.full * this.scale;
	}

	remove(): void {
		this.budgets.remove(this);
	}
}

/**
 * The sketch's budgets for its own systems, which share the governor's steps of the budgets' scale.
 * `changes` counts each change of the steps that they allow, so the frame loop gives the governor
 * the new count. `follow` moves each budget to the governor's steps.
 */
export class GameBudgets {
	/** The governor's steps of the budgets' scale that the budgets follow now. */
	level = 0;
	/** The steps that the budgets allow: those down to the lowest of their floors. */
	steps = 0;
	/** Counts each change of `steps`. */
	changes = 0;
	private readonly budgets = new Map<string, Budget>();

	/** Registers or replaces the budget that `options` give, and calls its `onScale`. */
	set(options: QualityBudgetOptions): QualityBudget {
		const call = 'quality.setBudget()';
		if (typeof options !== 'object' || options === null)
			throw new EngineError('E1213', `${call} got ${String(options)}, which is not an object.`);
		const { name, ms, min = 0, onScale } = options;
		if (typeof name !== 'string' || name === '')
			throw new EngineError(
				'E1213',
				`${call} got the name ${typeof name === 'string' ? '""' : String(name)}, which is not a name of one character or more.`,
			);
		if (typeof ms !== 'number' || !(ms > 0) || !Number.isFinite(ms))
			throw new EngineError(
				'E1213',
				`${call} got ms ${String(ms)}, which is not a number above 0.`,
			);
		if (typeof min !== 'number' || !(min >= 0 && min <= 1))
			throw new EngineError(
				'E1213',
				`${call} got min ${String(min)}, which is not a number from 0 to 1.`,
			);
		if (onScale !== undefined && typeof onScale !== 'function')
			throw new EngineError('E1213', `${call} got an onScale that is not a function.`);
		const budget = this.budgets.get(name) ?? new Budget(name, this);
		this.budgets.set(name, budget);
		budget.full = ms;
		budget.min = min;
		budget.onScale = onScale;
		budget.scale = budgetScale(this.level, min);
		this.count();
		onScale?.(budget.scale);
		return budget;
	}

	/** Removes `budget`, unless a budget of the same name replaced it. */
	remove(budget: Budget): void {
		if (this.budgets.get(budget.name) !== budget) return;
		this.budgets.delete(budget.name);
		this.count();
	}

	/**
	 * Moves the budgets to `level`, the governor's steps of their scale, and calls the `onScale` of
	 * each whose scale changed. `report` gets each error that one throws.
	 */
	follow(level: number, report: (error: unknown) => void): void {
		this.level = level;
		for (const budget of this.budgets.values()) {
			const scale = budgetScale(level, budget.min);
			if (scale === budget.scale) continue;
			budget.scale = scale;
			try {
				budget.onScale?.(scale);
			} catch (error) {
				report(error);
			}
		}
	}

	/** Works out the steps that the budgets allow, and counts a change of them. */
	private count(): void {
		let steps = 0;
		for (const budget of this.budgets.values()) steps = Math.max(steps, budgetSteps(budget.min));
		if (steps === this.steps) return;
		this.steps = steps;
		this.changes++;
	}
}

/** No change since the frame that last asked. */
export const NO_CHANGE = 0;
/** A change of settings that apply during play, which the change handlers hear of. */
export const LIVE_CHANGE = 1;
/** A change of preset, or of a setting fixed while a preset runs, whose frames wait for pipelines. */
export const RESTART_CHANGE = 2;

/**
 * The sketch's quality API. `apply` applies each change. `settle` resolves once the thread that
 * draws has taken the first frame after a restart, with all of its pipelines built. `scale` reads
 * the render scale.
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
	/**
	 * The settings that every preset keeps: those that the page's options give, and those fixed
	 * when the engine starts, at their start values.
	 */
	private readonly options: Partial<QualitySettings>;
	private readonly highest: QualityPreset;
	private readonly textureCapMiB: number;

	readonly governor: QualityGovernor;
	/** The sketch's budgets for its own systems. */
	readonly budgets = new GameBudgets();

	/**
	 * `governor` reports the governor's steps. Without it, the settings apply as set, as in hold
	 * mode. `textureMemory` reports the textures' memory.
	 */
	constructor(
		start: QualityStart,
		private readonly apply: ApplyQuality,
		private readonly settle: () => Promise<void> = () => Promise.resolve(),
		private readonly scale: () => number = () => 1,
		governor?: QualityGovernor,
		readonly textureMemory: TextureMemory = NO_TEXTURE_MEMORY,
	) {
		this.preset = start.preset;
		this.settings = { ...start.settings };
		const kept: Record<string, unknown> = { ...start.options };
		for (const [name, value] of Object.entries(startValues(start.settings))) kept[name] ??= value;
		this.options = kept as Partial<QualitySettings>;
		this.highest = start.highest;
		this.textureCapMiB = start.textureCapMiB ?? Number.POSITIVE_INFINITY;
		const { settings } = this;
		this.governor = governor ?? {
			steps: 0,
			get farCascadeInterval() {
				return settings.farCascadeInterval;
			},
			get shadowFilter() {
				return settings.shadowFilter;
			},
			get bloomSize() {
				return settings.bloomSize;
			},
			get aoScale() {
				return settings.aoScale;
			},
		};
	}

	get renderScale(): number {
		return this.scale();
	}

	set(settings: Partial<QualitySettings>): Promise<void> {
		checkSettings('quality.set()', settings, LIVE_SETTINGS);
		const lowest = settings.minRenderScale ?? this.settings.minRenderScale;
		const highest = settings.maxRenderScale ?? this.settings.maxRenderScale;
		if (lowest > highest)
			throw new EngineError(
				'E1213',
				`quality.set() would give minRenderScale ${lowest}, above maxRenderScale ${highest}. Give both in one call to change them together.`,
			);
		for (const [name, value] of Object.entries(settings))
			if (value !== undefined) this.owned.add(name as QualitySettingName);
		return this.update(this.preset, settings);
	}

	setPreset(preset: QualityPreset): Promise<void> {
		const wanted = presetArgument(preset);
		const next = presetIndex(wanted) > presetIndex(this.highest) ? this.highest : wanted;
		this.owned.clear();
		return this.update(next, this.presetValues(next, this.options));
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
		return this.update(next, this.presetValues(next, kept as Partial<QualitySettings>));
	}

	/** The settings of `preset`, with `kept`'s values, under the device's texture memory cap. */
	private presetValues(preset: QualityPreset, kept: Partial<QualitySettings>): QualitySettings {
		return capTextureMemory(presetSettings(preset, kept), kept, this.textureCapMiB);
	}

	setBudget(options: QualityBudgetOptions): QualityBudget {
		return this.budgets.set(options);
	}

	onChange(handler: (quality: Quality) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/**
	 * Tells the change handlers of a step of the governor's shadow settings, or of the texture
	 * memory budget's drops, at the next frame.
	 */
	governed(): void {
		this.change = Math.max(this.change, LIVE_CHANGE);
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

// The live link between the sketch's quality and the add-on features of one add-on. Each feature's
// declared settings are resolved for the preset and the GPU path in use, its budget joins the
// sketch's budgets so that the frame-budget governor's steps reach the feature, and its figures
// travel to the page, where the stats overlay shows them beside the engine's own. The host follows a
// change of preset, of the sketch's settings and of the governor's budget scale, and calls a
// feature's quality callback whenever one of its own values changes.
//
// The code runs on the sketch's thread, where the add-on's code runs. It allocates when a value
// changes, never in a frame.

import { EngineError } from '../errors/engine-error';
import { presetIndex, type QualityPreset } from '../quality/presets';
import { FEATURE_STATS_MESSAGE } from '../shared/feature-stats';
import type { Tier } from '../shared/tier';
import type { Quality, QualityBudget } from '../sketch/quality';
import {
	type FeatureDescription,
	FeatureRegistry,
	type FeatureSetting,
	type FeatureStats,
	type FeatureValue,
	featureSettingValue,
	governedValue,
} from './features';

/**
 * What a feature host reads, and where its figures go.
 *
 * @category api/features
 */
export interface FeatureHostOptions {
	/** The sketch's `quality`, which gives the preset, the settings and the budgets' scale. */
	readonly quality: Quality;
	/** The GPU path, which picks a setting's WebGL2 values where it gives them. */
	readonly tier?: Tier;
	/**
	 * The sketch's channel to the page, which carries the figures to the stats overlay. A host
	 * without it keeps its figures to itself.
	 */
	readonly page?: { post(type: string, data?: unknown): void };
}

/** One add-on feature in a host: its resolved values and its budget's state. */
interface Hosted {
	readonly feature: FeatureDescription;
	/** The budget that the governor steps, or undefined without a declared budget. */
	budget: QualityBudget | undefined;
	/** The preset that the budget's full time was registered for. */
	preset: QualityPreset;
	/** The feature's settings, resolved for the preset, the GPU path and the budget's scale. */
	readonly settings: Record<string, FeatureValue>;
	/** What the quality callback reads, which holds the same settings object. */
	readonly quality: {
		settings: Record<string, FeatureValue>;
		budgetScale: number;
		budgetMs: number;
	};
	budgetScale: number;
	/** The figures as the overlay reads them, rebuilt when a value changes. */
	stats: FeatureStats;
	/** True once the quality callback heard of this feature's values. */
	announced: boolean;
}

/** The name of the budget that a feature registers with the sketch's quality. */
function budgetName(feature: string): string {
	return `feature:${feature}`;
}

/**
 * A feature that a host registered: the values that its own code reads in each frame, and the
 * figures that the stats overlay shows.
 *
 * @category api/features
 */
export interface FeatureHandle {
	/** The feature's name. */
	readonly name: string;
	/**
	 * The feature's own settings, as the engine resolved them now. Read a value by its name in each
	 * frame: the object stays the same and its values change in place.
	 */
	readonly settings: Readonly<Record<string, FeatureValue>>;
	/** The budget's share of full quality, from 0 to 1, or 1 without a budget. */
	readonly budgetScale: number;
	/** The time in ms that the feature may take in each frame now, or 0 without a budget. */
	readonly budgetMs: number;
	/** The feature's figures, as the stats overlay shows them. */
	readonly stats: FeatureStats;
	/** Removes the feature and its budget. It does not call the feature's `destroy`. */
	remove(): void;
}

/**
 * One add-on's features, kept in step with the sketch's quality. `add` registers a feature, resolves
 * its settings for the preset and the GPU path in use, and registers its budget with the sketch's
 * budgets, so that the frame-budget governor's steps reach it. The host calls the feature's `quality`
 * callback when a value changes, and reports the features' figures to the page's stats overlay.
 *
 * Call `destroy` when the add-on stops, so that its budgets and its change handler go away.
 *
 * @category api/features
 */
export class FeatureHost {
	private readonly registry = new FeatureRegistry();
	private readonly hosted = new Map<string, Hosted>();
	private readonly forget: () => void;
	private figures: readonly FeatureStats[] = Object.freeze([]);
	private stopped = false;

	/** Starts following the sketch's quality. */
	constructor(private readonly options: FeatureHostOptions) {
		this.forget = options.quality.onChange(() => this.follow());
	}

	/**
	 * Checks a description, registers it, and returns the feature's handle. Throws E1223 for a
	 * description that `defineFeature` refuses, and for a feature or output name that another
	 * feature of this host has.
	 */
	add(description: FeatureDescription): FeatureHandle {
		if (this.stopped)
			throw new EngineError(
				'E1223',
				'FeatureHost.add() ran after the host stopped. Make a new host for a new feature.',
			);
		const feature = this.registry.add(description);
		const { quality } = this.options;
		const hosted: Hosted = {
			feature,
			budget: undefined,
			preset: quality.preset,
			settings: {},
			quality: { settings: {}, budgetScale: 1, budgetMs: 0 },
			budgetScale: 1,
			stats: figuresOf(feature, {}, 1, 0),
			announced: false,
		};
		hosted.quality.settings = hosted.settings;
		this.hosted.set(feature.name, hosted);
		if (feature.budget) this.registerBudget(hosted, feature.budget);
		this.update(hosted);
		if (!hosted.announced) this.announce(hosted);
		this.report();
		return this.handleOf(hosted);
	}

	/** Removes the feature `name` and its budget. Returns false when the host has no such feature. */
	remove(name: string): boolean {
		const hosted = this.hosted.get(name);
		if (hosted === undefined) return false;
		hosted.budget?.remove();
		this.hosted.delete(name);
		this.registry.remove(name);
		this.report();
		return true;
	}

	/** The handle of the feature `name`, or undefined. */
	get(name: string): FeatureHandle | undefined {
		const hosted = this.hosted.get(name);
		return hosted === undefined ? undefined : this.handleOf(hosted);
	}

	/** The features of this host, in the order that they were added. */
	features(): readonly FeatureHandle[] {
		const handles: FeatureHandle[] = [];
		for (const name of this.hosted.keys()) {
			const handle = this.get(name);
			if (handle) handles.push(handle);
		}
		return handles;
	}

	/** The features' figures, as the stats overlay shows them. */
	get stats(): readonly FeatureStats[] {
		return this.figures;
	}

	/** Stops following the sketch's quality and removes every budget. */
	destroy(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.forget();
		for (const hosted of this.hosted.values()) hosted.budget?.remove();
		this.hosted.clear();
		this.figures = Object.freeze([]);
		this.options.page?.post(FEATURE_STATS_MESSAGE, this.figures);
	}

	/** A handle over one hosted feature, which reads the values that the host keeps current. */
	private handleOf(hosted: Hosted): FeatureHandle {
		const { name } = hosted.feature;
		const host = this;
		return Object.freeze({
			name,
			get settings() {
				return hosted.settings;
			},
			get budgetScale() {
				return hosted.budgetScale;
			},
			get budgetMs() {
				return hosted.quality.budgetMs;
			},
			get stats() {
				return hosted.stats;
			},
			remove() {
				host.remove(name);
			},
		});
	}

	/** Registers the feature's budget for the preset in use, or updates its full time. */
	private registerBudget(hosted: Hosted, budget: NonNullable<FeatureDescription['budget']>): void {
		const { name } = hosted.feature;
		const ms = budget.presets[presetIndex(hosted.preset)] as number;
		const registered = this.options.quality.setBudget({
			name: budgetName(name),
			ms,
			min: budget.min ?? 0,
			onScale: (scale) => {
				if (hosted.budgetScale === scale) return;
				hosted.budgetScale = scale;
				this.update(hosted);
				this.report();
			},
		});
		hosted.budget = registered;
		hosted.budgetScale = registered.scale;
	}

	/**
	 * Follows a change of the preset or of the sketch's settings, and reports the figures afresh:
	 * the memory that a feature reports can change with the sketch's own settings.
	 */
	private follow(): void {
		if (this.stopped) return;
		const { preset } = this.options.quality;
		for (const hosted of this.hosted.values()) {
			const { budget } = hosted.feature;
			if (budget && hosted.preset !== preset) {
				hosted.preset = preset;
				this.registerBudget(hosted, budget);
			}
			this.update(hosted);
		}
		this.report();
	}

	/**
	 * Resolves a feature's settings for the preset, the GPU path and the budget's scale, and calls
	 * its quality callback when one of them changed.
	 */
	private update(hosted: Hosted): void {
		const { quality } = this.options;
		const { feature } = hosted;
		// A feature without a budget keeps the full share, which the governor never moves.
		const scale = hosted.budgetScale;
		const full =
			feature.budget === undefined
				? 0
				: (feature.budget.presets[presetIndex(quality.preset)] as number);
		let changed = false;
		const rows = feature.settings;
		if (rows !== undefined)
			for (const name of Object.keys(rows)) {
				const setting: FeatureSetting | undefined = rows[name];
				if (setting === undefined) continue;
				const value = governedValue(
					setting,
					featureSettingValue(setting, quality.preset, this.options.tier),
					scale,
				);
				if (hosted.settings[name] !== value) {
					hosted.settings[name] = value;
					changed = true;
				}
			}
		if (hosted.quality.budgetScale !== scale || hosted.quality.budgetMs !== full * scale) {
			hosted.quality.budgetScale = scale;
			hosted.quality.budgetMs = full * scale;
			changed = true;
		}
		hosted.stats = figuresOf(feature, hosted.settings, full, full * scale);
		if (changed) this.announce(hosted);
	}

	/** Calls the feature's quality callback with the values that the engine resolved. */
	private announce(hosted: Hosted): void {
		const { quality } = this.options;
		hosted.announced = true;
		hosted.feature.quality?.(quality.preset, quality.settings, hosted.quality);
	}

	/** Sends the features' figures to the stats overlay. */
	private report(): void {
		const figures: FeatureStats[] = [];
		for (const hosted of this.hosted.values()) figures.push(hosted.stats);
		this.figures = Object.freeze(figures);
		this.options.page?.post(FEATURE_STATS_MESSAGE, this.figures);
	}
}

/** A feature's figures, from its resolved settings and its budget's times. */
function figuresOf(
	feature: FeatureDescription,
	settings: Readonly<Record<string, FeatureValue>>,
	budgetMs: number,
	allowedMs: number,
): FeatureStats {
	const { memory } = feature;
	return Object.freeze({
		name: feature.name,
		settings: Object.freeze({ ...settings }),
		gpuMs: null,
		bytes: memory === undefined ? null : memory(),
		budgetMs: feature.budget === undefined ? null : budgetMs,
		allowedMs: feature.budget === undefined ? null : allowedMs,
	});
}

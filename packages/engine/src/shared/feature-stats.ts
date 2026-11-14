// The sketch message that carries an add-on feature's figures to the page, where the stats overlay
// shows them. The feature host sends its add-on's newest list whenever a figure changes, and the
// page keeps one list for each add-on, so two add-ons show side by side. The module holds the name
// and the merge alone; the feature code stays with the add-on that declares it.

import type { FeatureStats } from '../scene/features';

/** The sketch message name that carries the features' figures to the page. */
export const FEATURE_STATS_MESSAGE = 'null3d:feature-stats';

/** One add-on's figures, as its host sends them: the add-on's name and its features'. */
export interface FeatureStatsMessage {
	/** The add-on's name, which keeps its rows apart from another add-on's. */
	readonly addon: string;
	/** The add-on's features' figures, in the order that they were added. */
	readonly features: readonly FeatureStats[];
}

/**
 * Keeps the newest list of each add-on that reports figures in `lists`, and returns every add-on's
 * figures together. A message with no features removes that add-on's rows, so an add-on that stops
 * leaves another add-on's rows in place. A message of another shape changes nothing.
 */
export function mergeFeatureStats(
	lists: Map<string, readonly FeatureStats[]>,
	message: unknown,
): readonly FeatureStats[] {
	const data = message as Partial<FeatureStatsMessage> | null;
	if (typeof data === 'object' && data !== null) {
		if (typeof data.addon === 'string' && Array.isArray(data.features)) {
			if (data.features.length === 0) lists.delete(data.addon);
			else lists.set(data.addon, data.features as readonly FeatureStats[]);
		}
	}
	const figures: FeatureStats[] = [];
	for (const features of lists.values()) for (const figure of features) figures.push(figure);
	return figures;
}

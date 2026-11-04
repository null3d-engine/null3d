// The page keeps one list of figures for each add-on that reports them, so two add-ons show side
// by side and an add-on that stops keeps the other's rows.
import { describe, expect, it } from 'bun:test';
import type { FeatureStats } from '../scene/features';
import { mergeFeatureStats } from './feature-stats';

/** One feature's figures, named and with the rest empty. */
function figure(name: string): FeatureStats {
	return {
		name,
		settings: {},
		gpuMs: null,
		scope: [],
		bytes: null,
		budgetMs: null,
		allowedMs: null,
	};
}

describe('the add-on feature figures of the page', () => {
	it('keeps each add-on’s figures, and gives every add-on’s together', () => {
		const lists = new Map<string, readonly FeatureStats[]>();
		mergeFeatureStats(lists, { addon: 'water', features: [figure('water')] });
		const both = mergeFeatureStats(lists, {
			addon: 'splats',
			features: [figure('splats')],
		});
		expect(both.map((one) => one.name)).toEqual(['water', 'splats']);
	});

	it('replaces an add-on’s figures with its newest list', () => {
		const lists = new Map<string, readonly FeatureStats[]>();
		mergeFeatureStats(lists, { addon: 'water', features: [figure('water')] });
		const newest = mergeFeatureStats(lists, {
			addon: 'water',
			features: [figure('water'), figure('foam')],
		});
		expect(newest.map((one) => one.name)).toEqual(['water', 'foam']);
	});

	it('removes only the add-on that stopped', () => {
		const lists = new Map<string, readonly FeatureStats[]>();
		mergeFeatureStats(lists, { addon: 'water', features: [figure('water')] });
		mergeFeatureStats(lists, { addon: 'splats', features: [figure('splats')] });
		const left = mergeFeatureStats(lists, { addon: 'water', features: [] });
		expect(left.map((one) => one.name)).toEqual(['splats']);
	});

	it('leaves the figures alone for a message of another shape', () => {
		const lists = new Map<string, readonly FeatureStats[]>();
		mergeFeatureStats(lists, { addon: 'water', features: [figure('water')] });
		expect(mergeFeatureStats(lists, null).map((one) => one.name)).toEqual(['water']);
		expect(mergeFeatureStats(lists, [figure('other')]).map((one) => one.name)).toEqual(['water']);
	});
});

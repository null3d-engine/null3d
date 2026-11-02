// The configurator's model: four pages of choices, a tap that moves one page's choice on, and the
// option that each page shows. The tablet and the car builder read the same model.
import { describe, expect, it } from 'bun:test';
import {
	choice,
	cycle,
	isConfigPage,
	NEXT,
	PAGES,
	PREV,
	START_CONFIG,
	TABS,
	tabletAction,
	VALUE,
} from './config';

describe('the showroom configurator', () => {
	it('offers paint, wheels, trim and lights, each with options', () => {
		expect(PAGES.map((page) => page.id)).toEqual(['paint', 'wheels', 'trim', 'lights']);
		for (const page of PAGES) {
			expect(page.options.length).toBeGreaterThan(1);
			expect(new Set(page.options.map((option) => option.label)).size).toBe(page.options.length);
			expect(new Set(page.options.map((option) => option.value)).size).toBe(page.options.length);
		}
	});

	it('moves one page on and leaves the others alone', () => {
		const next = cycle(START_CONFIG, 'paint', 1);
		expect(next.paint).toBe(1);
		expect(next.wheels).toBe(START_CONFIG.wheels);
		expect(next.trim).toBe(START_CONFIG.trim);
		expect(next.lights).toBe(START_CONFIG.lights);
	});

	it('wraps at both ends of a page', () => {
		const count = PAGES[0]?.options.length ?? 0;
		expect(cycle({ ...START_CONFIG, paint: 0 }, 'paint', -1).paint).toBe(count - 1);
		expect(cycle({ ...START_CONFIG, paint: count - 1 }, 'paint', 1).paint).toBe(0);
	});

	it('shows an option of the page for every configuration', () => {
		for (const page of PAGES)
			for (let index = 0; index < page.options.length; index++)
				expect(choice({ ...START_CONFIG, [page.id]: index }, page.id)).toBe(
					page.options[index] as (typeof page.options)[number],
				);
	});

	it('knows the names of its pages', () => {
		expect(isConfigPage('paint')).toBe(true);
		expect(isConfigPage('spoiler')).toBe(false);
		expect(isConfigPage(undefined)).toBe(false);
	});

	it('reads a tap on each tab as a page, and a tap on the value or an arrow as a step', () => {
		for (const tab of TABS)
			expect(tabletAction({ x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 })).toEqual({
				kind: 'page',
				page: tab.page,
			});
		const middle = (rect: typeof PREV) => ({
			x: rect.x + rect.width / 2,
			y: rect.y + rect.height / 2,
		});
		expect(tabletAction(middle(PREV))).toEqual({ kind: 'step', step: -1 });
		expect(tabletAction(middle(NEXT))).toEqual({ kind: 'step', step: 1 });
		expect(tabletAction(middle(VALUE))).toEqual({ kind: 'step', step: 1 });
		expect(tabletAction({ x: 5, y: 5 })).toBeNull();
	});
});

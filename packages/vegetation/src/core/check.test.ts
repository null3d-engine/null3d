import { describe, expect, it } from 'bun:test';
import { record as template } from '../species/_template/record';
import { capProblems, capsFor, MODEL_CAPS } from './caps';
import { checkSpecies, speciesProblems } from './check';
import type { Species } from './record';

describe('the record check', () => {
	it('passes the template', () => {
		expect(speciesProblems(template)).toEqual([]);
		expect(checkSpecies(template)).toBe(template);
	});

	it('names every problem at once', () => {
		const broken = {
			...template,
			id: 'Bad Id',
			variants: 9,
			envelope: undefined,
			size: { ...template.size, height: { mean: 1, spread: 2 } },
			lod: { ...template.lod, woodOrders: [1, 2] },
		} as unknown as Species;
		const problems = speciesProblems(broken);
		expect(problems.some((p) => p.startsWith("id 'Bad Id'"))).toBe(true);
		expect(problems.some((p) => p.startsWith('variants is 9'))).toBe(true);
		expect(problems.some((p) => p.includes('needs an envelope'))).toBe(true);
		expect(problems.some((p) => p.startsWith('size.height can draw'))).toBe(true);
		expect(problems.some((p) => p.startsWith('lod.woodOrders'))).toBe(true);
		expect(() => checkSpecies(broken)).toThrow(/cannot grow/);
	});

	it('holds a budget to its model caps, and lets the owner name larger downloads', () => {
		const greedy: Species = {
			...template,
			lod: { ...template.lod, budget: { ...template.lod.budget, lod1Triangles: 200_000 } },
		};
		expect(capProblems(greedy)).toHaveLength(1);
		expect(capsFor(template)).toBe(MODEL_CAPS.tree);
		expect(capsFor({ ...template, id: 'silver-birch' }).downloadBytes).toBe(1_300_000);
	});
});

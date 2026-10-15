import { describe, expect, it } from 'bun:test';
import {
	FIRST_USE_DOWNLOADS,
	firstUsePage,
	firstUseProblems,
	manifestFeatures,
} from './first-use-docs';

describe('the page of shaders that load on first use', () => {
	it('describes every feature of the shader manifest, and no other', () => {
		expect(firstUseProblems(manifestFeatures(process.cwd()))).toEqual([]);
	});

	it('reports a feature without a description, and a description without a feature', () => {
		const described = Object.keys(FIRST_USE_DOWNLOADS).filter((name) => name !== 'bloom');
		const problems = firstUseProblems([...described, 'mirrors']);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain("'mirrors'");
		expect(problems[1]).toContain("'bloom'");
	});

	it('gives each feature a row with the name that preload takes', () => {
		const page = firstUsePage(['bloom', 'skinning']);
		expect(page).toContain("| `'bloom'` | when `post.set` turns bloom on |");
		expect(page).toContain("| `'skinning'` |");
		expect(page).toContain('status: generated');
	});
});

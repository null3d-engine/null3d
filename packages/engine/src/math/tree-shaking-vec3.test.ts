// A sketch that imports one math helper gets that helper alone: the bundler keeps the helpers that
// a module calls and drops the rest. This builds one small sketch for production, as the Vite
// plugin does, and reads which helpers the bundle holds.
import { describe, expect, it } from 'bun:test';
import { bundle, helpersIn } from './tree-shaking.ts';

describe('the math helpers', () => {
	it('reach a bundle only when a module calls them', async () => {
		const code = await bundle(`
			import { vec3 } from '@null3d/engine';
			export const sum = vec3.add(vec3.create(), [1, 2, 3], [4, 5, 6]);
		`);
		expect(helpersIn(code)).toEqual(['vec3', 'vec3.add', 'vec3.create']);
	}, 60_000);
});

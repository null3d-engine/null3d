// A sketch that calls helpers of two modules brings only the helpers that those calls reach, and
// the helpers those helpers use. This builds one small sketch for production and reads the bundle.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { bundle, helpersIn } from '../../../../tests/lib/tree-shaking-build.ts';

describe('the math helpers', () => {
	it(
		'bring along only the helpers that the called ones use',
		async () => {
			const code = await bundle(`
			import { math, quat } from '@null3d/engine';
			export const turn = quat.lookAt(quat.create(), [0, 0, 0], [1, 2, 3]);
			export const r = math.randFloat(-1, 1);
		`);
			expect(helpersIn(code)).toEqual([
				'math',
				'math.randFloat',
				'math.random',
				'math.randomState',
				'quat',
				'quat.create',
				'quat.fromMat4',
				'quat.lookAt',
			]);
		},
		scaledBudget(60_000),
	);
});

// A sketch that calls helpers of two modules brings only the helpers that those calls reach, and
// the helpers those helpers use. A helper that turns by an angle brings its own shared
// implementation and no other. This builds one small sketch for production and reads the bundle.
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
			export const spin = quat.setAxisAngle(quat.create(), [0, 1, 0], 0.5);
			export const r = math.randFloat(-1, 1);
			export const eased = math.damp(0, 1, 4, 0.1);
		`);
			expect(helpersIn(code)).toEqual([
				'create-math',
				'create-math.makeDamp',
				'create-math.makeSetAxisAngle',
				'math',
				'math.damp',
				'quat',
				'quat.create',
				'quat.fromMat4',
				'quat.lookAt',
				'quat.setAxisAngle',
				'random',
				'random.randFloat',
				'random.random',
				'random.randomState',
			]);
		},
		scaledBudget(60_000),
	);
});

import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import type { ErrorCode } from '../errors/fixes';
import { ERROR_FIXES } from '../errors/fixes';
import { FOG_KIND_EXP2, FOG_KIND_LINEAR, FOG_KIND_NONE } from '../generated/core';
import { fromHex } from '../math/color';
import type { CoreGlue } from '../shared/core';
import { type FogOptions, setSceneFog } from './fog';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A core that records each fog it gets: the kind, the linear color, near, far and density. */
function fakeGlue() {
	const calls: number[][] = [];
	const glue = { setFog: (...values: number[]) => calls.push(values) };
	return { calls, glue: glue as unknown as CoreGlue };
}

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

const GREY = [...fromHex([0, 0, 0], 0x808890)];

describe('setFog', () => {
	test('gives the core each kind of fog with its linear color and values', () => {
		const { calls, glue } = fakeGlue();
		setSceneFog(glue, { type: 'linear', color: 0x808890, near: 10, far: 80 });
		setSceneFog(glue, { type: 'exp2', color: '#808890', density: 0.03 });
		setSceneFog(glue, null);
		expect(calls).toEqual([
			[FOG_KIND_LINEAR, ...GREY, 10, 80, 0],
			[FOG_KIND_EXP2, ...GREY, 0, 0, 0.03],
			[FOG_KIND_NONE, 0, 0, 0, 0, 0, 0],
		]);
	});

	test("uses three.js's defaults for the values it leaves out", () => {
		const { calls, glue } = fakeGlue();
		setSceneFog(glue, { type: 'linear', color: 0x808890 });
		setSceneFog(glue, { type: 'exp2', color: 0x808890 });
		expect(calls).toEqual([
			[FOG_KIND_LINEAR, ...GREY, 1, 1000, 0],
			[FOG_KIND_EXP2, ...GREY, 0, 0, 0.00025],
		]);
	});

	test('throws for values that give no fog, and changes nothing', () => {
		const { calls, glue } = fakeGlue();
		const cases: [FogOptions, ErrorCode, string][] = [
			[
				{ type: 'linear', color: 0, near: 50, far: 50 },
				'E1108',
				'setFog() got the near distance 50 and the far distance 50.',
			],
			[{ type: 'linear', color: 0, far: Number.NaN }, 'E1203', 'setFog() got NaN for far'],
			[{ type: 'exp2', color: 0, density: -0.1 }, 'E1108', 'setFog() got the density -0.1'],
			[{ type: 'exp2', color: 0, density: Infinity }, 'E1203', 'setFog() got Infinity'],
			[
				{ type: 'fog', color: 0 } as unknown as FogOptions,
				'E1108',
				'setFog() got the fog type "fog".',
			],
			[{ type: 'exp2', color: 'grey' }, 'E1204', 'setFog() got the color "grey"'],
		];
		for (const [fog, code, message] of cases) {
			const error = thrown(() => setSceneFog(glue, fog));
			expect(error.code).toBe(code);
			expect(error.message).toStartWith(`${code}: ${message}`);
		}
		expect(calls).toHaveLength(0);
	});
});

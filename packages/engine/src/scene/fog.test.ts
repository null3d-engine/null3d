import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import type { ErrorCode } from '../errors/fixes';
import { ERROR_FIXES } from '../errors/fixes';
import {
	FOG_CURVE_EXP2,
	FOG_CURVE_EXPONENTIAL,
	FOG_CURVE_LINEAR,
	FOG_CURVE_NONE,
} from '../generated/core';
import { fromHex } from '../math/color';
import type { CoreGlue } from '../shared/core';
import { type FogOptions, setSceneFog } from './fog';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/**
 * A core that records each fog it gets: the curve, the linear color, the density, near, far, the
 * height, the height falloff, the sun glow and its exponent.
 */
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
	test('gives the core each curve with its linear color and values', () => {
		const { calls, glue } = fakeGlue();
		setSceneFog(glue, { color: 0x808890, density: 0.02, height: 4, heightFalloff: 0.5 });
		setSceneFog(glue, { curve: 'linear', color: 0x808890, near: 10, far: 80, sunGlow: 0.3 });
		setSceneFog(glue, { curve: 'exp2', color: '#808890', density: 0.03, sunGlowExponent: 32 });
		setSceneFog(glue, null);
		expect(calls).toEqual([
			[FOG_CURVE_EXPONENTIAL, ...GREY, 0.02, 1, 1000, 4, 0.5, 0, 8],
			[FOG_CURVE_LINEAR, ...GREY, 0.01, 10, 80, 0, 0, 0.3, 8],
			[FOG_CURVE_EXP2, ...GREY, 0.03, 1, 1000, 0, 0, 0, 32],
			[FOG_CURVE_NONE, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		]);
	});

	test('takes exponential fog of the same thickness at every height, with no glow, by default', () => {
		const { calls, glue } = fakeGlue();
		setSceneFog(glue, { color: 0x808890 });
		expect(calls).toEqual([[FOG_CURVE_EXPONENTIAL, ...GREY, 0.01, 1, 1000, 0, 0, 0, 8]]);
	});

	test('throws for values that give no fog, and changes nothing', () => {
		const { calls, glue } = fakeGlue();
		const cases: [FogOptions, ErrorCode, string][] = [
			[
				{ curve: 'linear', color: 0, near: 50, far: 50 },
				'E1108',
				'setFog() got the near distance 50 and the far distance 50.',
			],
			[{ curve: 'linear', color: 0, far: Number.NaN }, 'E1203', 'setFog() got NaN for far'],
			[{ color: 0, density: -0.1 }, 'E1108', 'setFog() got the density -0.1'],
			[{ curve: 'exp2', color: 0, density: Infinity }, 'E1203', 'setFog() got Infinity'],
			[{ color: 0, heightFalloff: -1 }, 'E1108', 'setFog() got the height falloff -1'],
			[{ color: 0, height: Number.NaN }, 'E1203', 'setFog() got NaN for height'],
			[{ color: 0, sunGlow: -0.5 }, 'E1108', 'setFog() got the sun glow -0.5'],
			[{ color: 0, sunGlowExponent: 0 }, 'E1108', 'setFog() got the sun glow exponent 0'],
			[
				{ curve: 'fog', color: 0 } as unknown as FogOptions,
				'E1108',
				'setFog() got the curve "fog".',
			],
			[
				{ type: 'linear', color: 0 } as unknown as FogOptions,
				'E1108',
				'setFog() got a type option.',
			],
			[{ color: 'grey' }, 'E1204', 'setFog() got the color "grey"'],
		];
		for (const [fog, code, message] of cases) {
			const error = thrown(() => setSceneFog(glue, fog));
			expect(error.code).toBe(code);
			expect(error.message).toStartWith(`${code}: ${message}`);
		}
		expect(calls).toHaveLength(0);
	});
});

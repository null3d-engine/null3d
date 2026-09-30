import { beforeEach, describe, expect, test } from 'bun:test';
import type { Described } from '../errors/checks';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	checkFov,
	checkNearFar,
	checkOrthographicSize,
	checkSize,
	newCamera,
	type OrthographicSize,
	orthographicView,
	setViewHeight,
} from './lens';

beforeEach(() => setErrorFixes(ERROR_FIXES));

const MAP: Described = { describe: () => '"Map" (slot 5)' };

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

describe('orthographicView', () => {
	test('gives a height whose width follows the canvas, 2 by default as in three.js', () => {
		expect(orthographicView({})).toEqual({ height: 2, width: 0, centerX: 0, centerY: 0 });
		expect(orthographicView({ height: 50 })).toEqual({
			height: 50,
			width: 0,
			centerX: 0,
			centerY: 0,
		});
	});

	test("keeps three.js's edges as a fixed size around a center", () => {
		expect(orthographicView({ left: -8, right: 8, top: 4.5, bottom: -4.5 })).toEqual({
			height: 9,
			width: 16,
			centerX: 0,
			centerY: 0,
		});
		// A view with its origin at the bottom left corner, as 2D overlays often set it.
		expect(orthographicView({ left: 0, right: 640, top: 360, bottom: 0 })).toEqual({
			height: 360,
			width: 640,
			centerX: 320,
			centerY: 180,
		});
	});
});

describe('setViewHeight', () => {
	test('leaves a width that follows the canvas following it', () => {
		const view = orthographicView({ height: 10 });
		setViewHeight(view, 4);
		expect(view).toEqual({ height: 4, width: 0, centerX: 0, centerY: 0 });
	});

	test('scales a view from edges about its center, as three.js zooms', () => {
		const view = orthographicView({ left: 0, right: 640, top: 360, bottom: 0 });
		// three.js's zoom of 2 halves the view about its center: 160 to 480 by 90 to 270.
		setViewHeight(view, 180);
		expect(view).toEqual({ height: 180, width: 320, centerX: 320, centerY: 180 });
	});
});

describe('camera checks', () => {
	const orthographicProblem = (size: OrthographicSize) =>
		thrown(() => checkOrthographicSize('createOrthographicCamera', size, newCamera('Map')));

	test('accept a height, four edges, or neither', () => {
		for (const size of [{}, { height: 0.5 }, { left: -1, right: 1, top: 1, bottom: -1 }])
			expect(() => checkOrthographicSize('createOrthographicCamera', size, MAP)).not.toThrow();
	});

	test('refuse a height with edges, and edges without the rest', () => {
		const both = orthographicProblem({ height: 4, left: -2, right: 2, top: 2, bottom: -2 });
		expect(both.code).toBe('E1108');
		expect(both.message).toContain(
			'createOrthographicCamera() got a height and edges on "Map". Give the height, or give left, right, top and bottom.',
		);
		const some = orthographicProblem({ left: -2, right: 2, top: 2 });
		expect(some.code).toBe('E1203');
		expect(some.message).toContain('got undefined for bottom on "Map"');
	});

	test('refuse a view with no size, or turned inside out', () => {
		expect(orthographicProblem({ height: 0 }).message).toContain(
			'got the height 0 on "Map", which is not above 0.',
		);
		expect(orthographicProblem({ height: Number.NaN }).code).toBe('E1203');
		expect(orthographicProblem({ left: 1, right: -1, top: 1, bottom: -1 }).message).toContain(
			'got the left edge 1 and the right edge -1 on "Map". The right edge must be above the left one.',
		);
		expect(orthographicProblem({ left: -1, right: 1, top: -1, bottom: 1 }).message).toContain(
			'The top edge must be above the bottom one.',
		);
		const zoom = thrown(() => checkSize('setOrthoHeight', 'height', -3, MAP));
		expect(zoom.code).toBe('E1108');
		expect(newCamera(undefined).describe()).toBe('a new camera');
	});

	test('let an orthographic near plane lie behind the camera, but not a perspective one', () => {
		expect(() => checkNearFar('setNearFar', -100, 100, false, MAP)).not.toThrow();
		const behind = thrown(() => checkNearFar('setNearFar', 0, 100, true, MAP));
		expect(behind.code).toBe('E1108');
		expect(behind.message).toContain(
			`setNearFar() got the near distance 0 on "Map" (slot 5). A perspective camera's near plane must be in front of it, above 0.`,
		);
		for (const perspective of [true, false]) {
			const reversed = thrown(() => checkNearFar('setNearFar', 10, 10, perspective, MAP));
			expect(reversed.message).toContain('The far distance must be above the near one.');
		}
		expect(
			thrown(() => checkNearFar('setNearFar', 1, Number.POSITIVE_INFINITY, true, MAP)).code,
		).toBe('E1203');
	});

	test('keep the field of view between 0 and 180 degrees', () => {
		expect(() => checkFov('setFov', 50, MAP)).not.toThrow();
		for (const degrees of [0, 180, -20])
			expect(thrown(() => checkFov('setFov', degrees, MAP)).message).toContain(
				`setFov() got the field of view ${degrees} on "Map" (slot 5), outside 0 to 180 degrees.`,
			);
	});
});

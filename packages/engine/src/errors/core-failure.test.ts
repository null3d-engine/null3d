import { beforeEach, describe, expect, test } from 'bun:test';
import * as C from '../generated/core';
import { ERRORS } from './codes';
import { type CoreErrors, coreFailure, QUEUED_CHANGE } from './core-failure';
import { EngineError, setErrorFixes } from './engine-error';
import { ERROR_FIXES } from './fixes';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A core that reports one failure: its code and two detail numbers. */
function failedCore(code: number, a = 0, b = 0): CoreErrors {
	return { lastErrorCode: () => code, lastErrorDetail: (index) => (index === 0 ? a : b) };
}

/** The part of an error's message before its fix: what the error table's examples show. */
function detail(error: EngineError): string {
	return error.message.slice(0, error.message.indexOf(` ${ERROR_FIXES[error.code]}`));
}

describe('failures of calls', () => {
	test('name the full store, and what it holds', () => {
		const messages = [
			coreFailure(failedCore(1102, 1, C.LIMIT_MAX_OBJECTS), 'createGroup'),
			coreFailure(failedCore(1102, 2, 256), 'createInstances'),
			coreFailure(failedCore(1102, 9, 4), 'createMesh'),
		].map(detail);
		expect(messages).toEqual([
			`E1102: createGroup() failed: the scene already holds ${C.LIMIT_MAX_OBJECTS} objects.`,
			'E1102: createInstances() failed: the batch table already holds 256 batches.',
			'E1102: createMesh() failed: the store already holds 4 items.',
		]);
	});

	test('name the keys of a clip that passes the limit, against the limit', () => {
		expect(
			detail(coreFailure(failedCore(1218, 5, 32_640_032), 'assets.loadGltf', 'the clip "Wave"')),
		).toBe(
			'E1218: assets.loadGltf() on the clip "Wave" failed: the clip would hold 32,640,032 keys (its frames times its tracks), more than the 4,194,304 that one clip may hold.',
		);
	});

	test("give a call's name parentheses, and a name in words none", () => {
		expect(detail(coreFailure(failedCore(1501, 4), 'materials.standard'))).toBe(
			'E1501: materials.standard() failed: the material table is full.',
		);
		expect(detail(coreFailure(failedCore(1501, 1, 4096), 'the frame'))).toBe(
			"E1501: the frame failed: the frame's commands pass the 4,096 MB that its draw list can hold.",
		);
	});

	test('state the cap of GPU skinning that a frame passed', () => {
		expect(detail(coreFailure(failedCore(1501, 12, 1024), 'the frame'))).toBe(
			'E1501: the frame failed: the skinned vertices of the characters in the scene pass the 1,024 MB that GPU skinning holds on this device.',
		);
		expect(detail(coreFailure(failedCore(1501, 13, 32), 'the frame'))).toBe(
			'E1501: the frame failed: the skinned meshes fill more than 32 mesh pages, the most that GPU skinning reads.',
		);
	});
});

test('failures of queued changes name the change and the slot of the object', () => {
	const failures: [code: number, a: number, b: number][] = [
		[1101, 7, 120],
		[1103, 0x7fffffff, 0],
		[1104, 9, 12],
		[1105, 42, 0],
		[1106, 7, 0],
		[1107, 7, 0],
	];
	const messages = failures.map(([code, a, b]) =>
		detail(coreFailure(failedCore(code, a, b), QUEUED_CHANGE)),
	);
	expect(messages).toEqual([
		'E1101: a queued change named an object (slot 7), which was destroyed in frame 120.',
		'E1103: a queued change got an object that is not from this engine.',
		'E1104: a queued change on an object (slot 9) would put it under its own descendant (slot 12).',
		'E1105: the engine core received command 42.',
		'E1106: a queued change named an object (slot 7), which the engine never created.',
		'E1107: the object in slot 7 was created twice.',
	]);
});

test('the error table shows messages as the engine prints them', () => {
	const printed: [keyof typeof ERRORS, EngineError][] = [
		['E1102', coreFailure(failedCore(1102, 1, C.LIMIT_MAX_OBJECTS), 'createMesh')],
		['E1103', coreFailure(failedCore(1501, 6, 3), 'createInstances')],
		['E1104', coreFailure(failedCore(1104, 9, 12), QUEUED_CHANGE)],
		['E1106', coreFailure(failedCore(1106, 7), QUEUED_CHANGE)],
		['E1107', coreFailure(failedCore(1107, 7), QUEUED_CHANGE)],
		['E1108', coreFailure(failedCore(1108, 1200, 1000), 'setActiveCount')],
		['E1501', coreFailure(failedCore(1501, 4), 'materials.standard')],
	];
	for (const [code, error] of printed) {
		expect(error).toBeInstanceOf(EngineError);
		expect(detail(error)).toBe(ERRORS[code].example);
	}
});

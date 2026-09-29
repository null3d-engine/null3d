import { beforeEach, describe, expect, it } from 'bun:test';
import { startError } from '../page/engine';
import { checkNumber, checkVector, DEV } from './checks';
import { ERRORS } from './codes';
import { type CoreErrors, coreFailure } from './core-failure';
import { EngineError, isErrorCode, setErrorFixes } from './engine-error';
import { ERROR_FIXES, type ErrorCode } from './fixes';

const DOCS = 'https://github.com/null3d-engine/null3d/blob/main/docs/errors/';

/** Where a thread keeps its table of fixes: on its global object, under a registered symbol. */
const FIXES_KEY = Symbol.for('null3d.errorFixes');

/**
 * A second copy of the error module in this thread, as a production build gives the sketch worker:
 * one copy in the engine's worker code, and one in the sketch's bundle. Bun loads a path with a
 * query as a module of its own.
 */
async function secondCopy(): Promise<typeof import('./engine-error')> {
	return await import(`${import.meta.dirname}/engine-error.ts?second-copy`);
}

/** A core that reports one failure: its code and two detail numbers. */
function failedCore(code: number, a = 0, b = 0): CoreErrors {
	return { lastErrorCode: () => code, lastErrorDetail: (index) => (index === 0 ? a : b) };
}

// Each thread sets the table before it raises an error: the page its own, a worker the page's copy.
beforeEach(() => setErrorFixes(ERROR_FIXES));

describe('EngineError', () => {
	it('carries its code, the fix and a link to the code page', () => {
		const error = new EngineError('E1203', 'setPosition() got NaN for x on "Player" (slot 12).');
		expect(error.code).toBe('E1203');
		expect(
			error.message.startsWith(
				'E1203: setPosition() got NaN for x on "Player" (slot 12). Check the value',
			),
		).toBe(true);
		expect(error.message).toContain('/docs/errors/E1203.md');
		expect(error.docs.endsWith('/docs/errors/E1203.md')).toBe(true);
		expect(error).toBeInstanceOf(Error);
	});

	it("ends each code's message with the code's fix and docs page, from a worker's copy too", () => {
		const message = (code: ErrorCode) => new EngineError(code, 'what failed.').message;
		const expected = (code: ErrorCode) =>
			`${code}: what failed. ${ERRORS[code].fix} See ${DOCS}${code}.md`;
		const codes = Object.keys(ERRORS) as ErrorCode[];
		for (const code of codes) expect(message(code)).toBe(expected(code));
		// A worker holds a copy of the page's table, as a message to the worker carries it.
		setErrorFixes(structuredClone(ERROR_FIXES));
		for (const code of codes) expect(message(code)).toBe(expected(code));
	});

	it('leaves the fix out of the message on a thread without a table of fixes', () => {
		delete (globalThis as Record<symbol, unknown>)[FIXES_KEY];
		try {
			expect(new EngineError('E1108', 'what failed.').message).toBe(
				`E1108: what failed. See ${DOCS}E1108.md`,
			);
			expect(isErrorCode('E1108')).toBe(false);
		} finally {
			setErrorFixes(ERROR_FIXES);
		}
	});

	it('uses codes whose examples start with the code', () => {
		for (const [code, entry] of Object.entries(ERRORS))
			expect(entry.example.startsWith(`${code}: `)).toBe(true);
	});

	it('is not an Error with the same name and code, nor any other value', () => {
		const lookalike = Object.assign(new Error('E1108: what failed.'), {
			name: 'EngineError',
			code: 'E1108',
		});
		const values: unknown[] = [lookalike, { name: 'EngineError', code: 'E1108' }, null, 'E1108'];
		for (const value of values) expect(value instanceof EngineError).toBe(false);
	});

	it('keeps the usual check for a subclass', () => {
		class SketchError extends EngineError {}
		expect(new SketchError('E1108', 'what failed.') instanceof EngineError).toBe(true);
		expect(new SketchError('E1108', 'what failed.') instanceof SketchError).toBe(true);
		expect(new EngineError('E1108', 'what failed.') instanceof SketchError).toBe(false);
	});
});

describe('a second copy of the error module in the thread', () => {
	it('makes errors that every copy sees as EngineErrors', async () => {
		const copy = await secondCopy();
		expect(copy.EngineError).not.toBe(EngineError);
		expect(new copy.EngineError('E1108', 'what failed.') instanceof EngineError).toBe(true);
		expect(new EngineError('E1108', 'what failed.') instanceof copy.EngineError).toBe(true);
	});

	it('finds the table of fixes that the other copy set', async () => {
		const copy = await secondCopy();
		expect(new copy.EngineError('E1108', 'what failed.').message).toBe(
			`E1108: what failed. ${ERROR_FIXES.E1108} See ${DOCS}E1108.md`,
		);
		expect(copy.isErrorCode('E1108')).toBe(true);
	});
});

describe('the error table', () => {
	it("joins every code's docs with its fix, in one order", () => {
		expect(Object.keys(ERRORS)).toEqual(Object.keys(ERROR_FIXES));
		for (const [code, entry] of Object.entries(ERRORS))
			expect(entry.fix).toBe(ERROR_FIXES[code as ErrorCode]);
	});

	it('knows its own codes and nothing else', () => {
		for (const code of Object.keys(ERROR_FIXES)) expect(isErrorCode(code)).toBe(true);
		for (const code of ['E9999', 'E1', 'toString', 'constructor'])
			expect(isErrorCode(code)).toBe(false);
	});
});

describe('failures the engine core reports', () => {
	it('name the call and the details', () => {
		const error = coreFailure(failedCore(1108, 1200, 1000), 'setActiveCount');
		expect(error.code).toBe('E1108');
		expect(error.message).toBe(
			`E1108: setActiveCount() got 1200, above the limit of 1000. ${ERROR_FIXES.E1108} See ${DOCS}E1108.md`,
		);
	});

	it('keep a code of the table without its own wording, and turn any other code into E1105', () => {
		expect(coreFailure(failedCore(1405), 'createEngine').message).toStartWith(
			'E1405: createEngine() failed in the engine core with code 1405.',
		);
		const unknown = coreFailure(failedCore(4242), 'createEngine');
		expect(unknown.code).toBe('E1105');
		expect(unknown.message).toStartWith(
			'E1105: createEngine() failed in the engine core with code 4242.',
		);
	});
});

describe('errors a worker reports while it starts', () => {
	it('keep the code and the full message of an engine error', () => {
		const inWorker = new EngineError('E1402', 'the threaded engine core lacks isThreadedBuild.');
		const error = startError('render', inWorker.message);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe('E1402');
		expect(error.message).toBe(inWorker.message);
		expect(error.docs).toBe(inWorker.docs);
	});

	it('become E1405, naming the worker, for any other failure', () => {
		for (const message of ['no WebGPU adapter', 'E9999: not a code of the table']) {
			const error = startError('render', message);
			expect(error.code).toBe('E1405');
			expect(error.message).toBe(
				`E1405: the render worker did not start: ${message}. ${ERROR_FIXES.E1405} See ${DOCS}E1405.md`,
			);
		}
	});
});

describe('development checks', () => {
	const player = { describe: () => '"Player" (slot 12)' };

	it('throw E1203 for NaN and Infinity, naming the component and the object', () => {
		expect(() => checkVector('setPosition', player, 0, Number.NaN, 0)).toThrow(
			'E1203: setPosition() got NaN for y on "Player" (slot 12).',
		);
		expect(() => checkVector('setRotation', player, 0, 0, 0, Number.POSITIVE_INFINITY)).toThrow(
			'got Infinity for w',
		);
		expect(() => checkNumber('setFov', 'fov', Number.NaN, player)).toThrow('got NaN for fov');
	});

	it('accept finite numbers', () => {
		expect(() => checkVector('setPosition', player, 1, -2, 3.5)).not.toThrow();
		expect(() => checkNumber('setFov', 'fov', 60, player)).not.toThrow();
	});

	it('are on when no bundler has defined the development constant', () => {
		expect(DEV).toBe(true);
	});
});

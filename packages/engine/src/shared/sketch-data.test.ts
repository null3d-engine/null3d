import { describe, expect, it } from 'bun:test';
import { EngineError } from '../errors/engine-error';
import { MAX_SKETCH_DATA_BYTES, sketchDataText } from './sketch-data';

/** What `sketchDataText` throws for `data`. */
function refusal(data: unknown): EngineError {
	try {
		sketchDataText(data);
	} catch (error) {
		expect(error).toBeInstanceOf(EngineError);
		return error as EngineError;
	}
	throw new Error('the data passed');
}

describe('the start data of a sketch', () => {
	it('gives no text for no data', () => {
		expect(sketchDataText(undefined)).toBeUndefined();
	});

	it('keeps plain JSON data exactly', () => {
		const data = {
			stop: 'city',
			level: 3,
			ratio: -0.25,
			dark: true,
			path: [1, [2, null]],
			none: null,
		};
		expect(JSON.parse(sketchDataText(data) as string)).toEqual(data);
		expect(sketchDataText('hero')).toBe('"hero"');
		expect(sketchDataText(0)).toBe('0');
		expect(sketchDataText(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
	});

	it('leaves out a property whose value is undefined, as JSON does', () => {
		expect(sketchDataText({ stop: undefined, level: 2 })).toBe('{"level":2}');
	});

	it('refuses values that JSON would change, and names where they sit', () => {
		expect(refusal({ when: new Date(0) }).code).toBe('E1213');
		expect(refusal({ when: new Date(0) }).message).toContain('sketchData.when is a Date');
		expect(refusal({ list: [1, undefined] }).message).toContain('sketchData.list[1] is undefined');
		expect(refusal({ a: { b: Number.NaN } }).message).toContain('sketchData.a.b is NaN');
		expect(refusal(Number.POSITIVE_INFINITY).message).toContain('sketchData is Infinity');
		expect(refusal({ f: () => 1 }).message).toContain('sketchData.f is a function');
		expect(refusal({ n: 1n }).message).toContain('sketchData.n is a bigint');
		expect(refusal(new Map()).message).toContain('sketchData is a Map');
		expect(refusal({ bytes: new Uint8Array(2) }).message).toContain('is a Uint8Array');
	});

	it('refuses data that holds itself', () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(refusal(loop).message).toContain('sketchData.self is an object that holds it');
	});

	it('takes one object twice where neither holds the other', () => {
		const shared = { x: 1 };
		expect(sketchDataText({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
	});

	it('refuses data over the size limit', () => {
		expect(sketchDataText('a'.repeat(MAX_SKETCH_DATA_BYTES - 2))).toBeDefined();
		const error = refusal('a'.repeat(MAX_SKETCH_DATA_BYTES));
		expect(error.code).toBe('E1213');
		expect(error.message).toContain('over the limit of 65,536');
	});
});

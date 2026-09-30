import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	BuildNames,
	decodeMappings,
	nameColumnBefore,
	originalFrame,
	type Segment,
} from './source-names';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encodes segments as a source map's mappings, the way a bundler writes them. */
function encodeMappings(lines: Segment[][]): string {
	const state = [0, 0, 0, 0, 0];
	const vlq = (value: number) => {
		let rest = value < 0 ? (-value << 1) | 1 : value << 1;
		let text = '';
		do {
			const digit = rest & 31;
			rest >>>= 5;
			text += BASE64[rest > 0 ? digit | 32 : digit];
		} while (rest > 0);
		return text;
	};
	return lines
		.map((segments) => {
			state[0] = 0;
			return segments
				.map((segment) =>
					segment
						.map((field, i) => {
							const text = vlq((field as number) - (state[i] as number));
							state[i] = field as number;
							return text;
						})
						.join(''),
				)
				.join(',');
		})
		.join(';');
}

/**
 * A built line as a minifier writes it, with its source map: a shortened function `a` from the
 * sketch runner, whose own name was `frame`, then a method `replay`, whose name stays, from the
 * WebGPU backend.
 */
const LINE = 'function a(e){return e+1}class K{replay(t){return t}}';
const SEGMENTS: Segment[] = [
	[0, 0, 10, 0],
	[9, 0, 10, 16, 0],
	[33, 1, 40, 2],
	[39, 1, 40, 8],
];
const SOURCES = [
	'../../../packages/engine/src/sketch/runner.ts',
	'../../../packages/engine/src/webgpu/backend.ts',
];

describe('decodeMappings', () => {
	it('reads each line of segments back, fields carried from line to line', () => {
		const lines: Segment[][] = [SEGMENTS, [], [[4, 1, 41, 0], [12]]];
		expect(decodeMappings(encodeMappings(lines))).toEqual(lines);
		expect(decodeMappings('AAAA;;IACA,Q')).toEqual([[[0, 0, 0, 0]], [], [[4, 0, 1, 0], [12]]]);
	});

	it('refuses a character that is not base64', () => {
		expect(() => decodeMappings('AA!A')).toThrow('not base64');
	});
});

describe('nameColumnBefore', () => {
	it('finds the whole name that ends just before the parameters', () => {
		expect(nameColumnBefore(LINE, 'a', 10)).toBe(9);
		expect(nameColumnBefore(LINE, 'replay', 39)).toBe(33);
		expect(nameColumnBefore('let ab=1,b=(x)=>x', 'b', 11)).toBe(9);
		expect(nameColumnBefore(LINE, 'missing', 20)).toBe(-1);
	});
});

describe('originalFrame', () => {
	const file = {
		lines: [LINE],
		segments: [SEGMENTS],
		sources: SOURCES.map((source) => source.replace('../../..', '')),
		names: ['frame'],
	};
	const url = (source: string) => `http://localhost:1${source}`;

	it("gives a shortened function its own name and every function its source's address", () => {
		const frame = { functionName: 'a', url: 'x', lineNumber: 0, columnNumber: 10 };
		expect(originalFrame(frame, file, url)).toEqual({
			functionName: 'frame',
			url: 'http://localhost:1/packages/engine/src/sketch/runner.ts',
			lineNumber: 0,
			columnNumber: 10,
		});
		const method = { functionName: 'replay', url: 'x', lineNumber: 0, columnNumber: 39 };
		expect(originalFrame(method, file, url)).toMatchObject({
			functionName: 'replay',
			url: 'http://localhost:1/packages/engine/src/webgpu/backend.ts',
		});
	});

	it('leaves a frame the map does not cover as it is', () => {
		const outside = { functionName: 'b', url: 'x', lineNumber: 3, columnNumber: 0 };
		expect(originalFrame(outside, file, url)).toBe(outside);
		const noPlace = { functionName: 'a', url: 'x' };
		expect(originalFrame(noPlace, file, url)).toBe(noPlace);
	});
});

describe('BuildNames', () => {
	const build = mkdtempSync(join(tmpdir(), 'null3d-names-'));
	mkdirSync(join(build, 'bench/assets'), { recursive: true });
	writeFileSync(join(build, 'bench/assets/sketch-worker-AbCd1234.js'), LINE);
	writeFileSync(
		join(build, 'bench/assets/sketch-worker-AbCd1234.js.map'),
		JSON.stringify({ sources: SOURCES, names: ['frame'], mappings: encodeMappings([SEGMENTS]) }),
	);
	afterAll(() => rmSync(build, { recursive: true, force: true }));
	const names = new BuildNames(build);
	const frame = (url: string) => ({ functionName: 'a', url, lineNumber: 0, columnNumber: 10 });

	it('names frames of the build served at its root or under a load address', () => {
		for (const path of ['', '/__null3d/load/warm/k'])
			expect(
				names.name(frame(`http://localhost:1${path}/bench/assets/sketch-worker-AbCd1234.js`)),
			).toMatchObject({
				functionName: 'frame',
				url: 'http://localhost:1/packages/engine/src/sketch/runner.ts',
			});
	});

	it("leaves the browser's functions, the core and files without a map as they are", () => {
		for (const url of ['', 'wasm://wasm/null3d-1a2b', 'http://localhost:1/bench/assets/none.js'])
			expect(names.name(frame(url))).toEqual(frame(url));
	});
});

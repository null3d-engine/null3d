// Names the functions of a production build in the profiles of Chrome's debugging protocol. A
// production build bundles and minifies the engine: each function sits in a bundled file under a
// short name. The build's source maps give each function its source file and its own name back, so
// a tool can tell the engine's code from the rest and name each place by function and file, as the
// development pages do. Everything here is pure, apart from reading the build's files.
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parseLoadPath } from '../../tests/lib/load-routes.ts';
import type { CallFrame } from './devtools';

/** A source map, as a build writes it beside each file. */
export interface SourceMap {
	sources: string[];
	names?: string[];
	mappings: string;
}

/**
 * One segment of a source map: the column in the built line, then, when the segment maps to a
 * source, the source's index, its line and column, and the index of the original name.
 */
export type Segment = [number, number?, number?, number?, number?];

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...BASE64].map((char, value) => [char, value]));

/** Decodes a source map's mappings into the segments of each built line. */
export function decodeMappings(mappings: string): Segment[][] {
	const lines: Segment[][] = [];
	// The fields after the column carry on from line to line; the column starts afresh each line.
	const state = [0, 0, 0, 0, 0];
	for (const line of mappings.split(';')) {
		const segments: Segment[] = [];
		state[0] = 0;
		for (const text of line.split(',')) {
			if (text === '') continue;
			const fields: number[] = [];
			let value = 0;
			let shift = 0;
			for (const char of text) {
				const digit = DIGIT.get(char);
				if (digit === undefined)
					throw new Error(`a source map holds "${char}", which is not base64`);
				value += (digit & 31) << shift;
				if (digit & 32) {
					shift += 5;
					continue;
				}
				const field = fields.length;
				state[field] = (state[field] ?? 0) + (value & 1 ? -(value >>> 1) : value >>> 1);
				fields.push(state[field] as number);
				value = 0;
				shift = 0;
			}
			segments.push(fields as Segment);
		}
		lines.push(segments);
	}
	return lines;
}

/** A built file: its lines and its source map's segments, sources and names. */
export interface BuiltFile {
	lines: string[];
	segments: Segment[][];
	/** Each source's path, from the build's root. */
	sources: string[];
	names: string[];
}

/**
 * The last segment of a line that starts at or before `column`, or the line's first segment. A
 * line's segments come in the order of their columns.
 */
function segmentAt(segments: readonly Segment[], column: number): Segment | undefined {
	let low = 0;
	let high = segments.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if ((segments[middle] as Segment)[0] <= column) low = middle;
		else high = middle - 1;
	}
	return segments[low];
}

const IDENTIFIER = /[\w$]/;

/**
 * The column where the last whole use of `name` before `column` starts on a built line, or -1. V8
 * places a function just after its name, at the start of its parameters.
 */
export function nameColumnBefore(line: string, name: string, column: number): number {
	for (let at = line.lastIndexOf(name, column - name.length); at >= 0; ) {
		const before = line[at - 1] ?? '';
		const after = line[at + name.length] ?? '';
		if (!IDENTIFIER.test(before) && !IDENTIFIER.test(after)) return at;
		at = at > 0 ? line.lastIndexOf(name, at - 1) : -1;
	}
	return -1;
}

/**
 * A function of a built file as its source names it: its source file, and its own name where the
 * build shortened it. V8 gives a function's place as the line and column where its parameters
 * start, and its name as the build wrote it. A frame the map does not cover stays as it is.
 */
export function originalFrame<T extends CallFrame>(
	frame: T,
	file: BuiltFile,
	sourceUrl: (source: string) => string,
): T {
	const { lineNumber, columnNumber } = frame;
	if (lineNumber === undefined || columnNumber === undefined) return frame;
	const segments = file.segments[lineNumber] ?? [];
	const at = segmentAt(segments, columnNumber);
	const source = at?.[1] === undefined ? undefined : file.sources[at[1]];
	if (source === undefined) return frame;
	let functionName = frame.functionName;
	const line = file.lines[lineNumber] ?? '';
	const nameAt = functionName ? nameColumnBefore(line, functionName, columnNumber) : -1;
	const atName = nameAt < 0 ? undefined : segmentAt(segments, nameAt);
	const named = atName?.[0] === nameAt ? atName[4] : undefined;
	if (named !== undefined) functionName = file.names[named] ?? functionName;
	return { ...frame, functionName, url: sourceUrl(source) };
}

/**
 * Names the functions of the production build in `buildDir`, which a server serves at its root or
 * under a load address. Each built file that a frame's address names is read once with its map,
 * from the build's folder. A frame of any other script, of the engine core or of the browser stays
 * as it is. A source's address is its path from the repository's root, on the frame's server, as
 * the dev server would give it.
 */
export class BuildNames {
	private readonly files = new Map<string, BuiltFile | undefined>();

	constructor(private readonly buildDir: string) {}

	/** The built file at a path in the build, with its map, or undefined without one. */
	private file(path: string): BuiltFile | undefined {
		if (this.files.has(path)) return this.files.get(path);
		const built = join(this.buildDir, path);
		let file: BuiltFile | undefined;
		if (existsSync(built) && existsSync(`${built}.map`)) {
			const map = JSON.parse(readFileSync(`${built}.map`, 'utf8')) as SourceMap;
			// A map's sources climb out of the build's folder to the root, so above the root they stop.
			const dir = posix.dirname(`/${path}`);
			file = {
				lines: readFileSync(built, 'utf8').split('\n'),
				segments: decodeMappings(map.mappings),
				sources: map.sources.map((source) => posix.resolve(dir, source)),
				names: map.names ?? [],
			};
		}
		this.files.set(path, file);
		return file;
	}

	/** A frame as the source names it, with its source's address on the frame's server. */
	name<T extends CallFrame>(frame: T): T {
		if (!/^https?:/.test(frame.url)) return frame;
		const url = new URL(frame.url);
		const file = this.file(parseLoadPath(url.pathname)?.path ?? url.pathname.slice(1));
		return file ? originalFrame(frame, file, (source) => `${url.origin}${source}`) : frame;
	}
}

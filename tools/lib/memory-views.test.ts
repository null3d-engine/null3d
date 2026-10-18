import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { ACCESSOR_MODULE, memoryViewProblems } from './memory-views.ts';

/** The folder of the fake engine sources. */
const ROOT = '/engine/src';

/** A small accessor module, as the engine's own declares its classes. */
const ACCESSOR = `
export interface ViewHolder { dropViews(): void; }
export class MemoryViews {
	constructor(readonly memory: WebAssembly.Memory) {}
	f32(address: number, length: number): Float32Array { return new Float32Array(this.memory.buffer, address, length); }
	holdViews(holder: ViewHolder): void {}
}
`;

/** The problems of the fake engine with the module `code` beside the accessor, by line. */
function problemsOf(code: string): string[] {
	const files = new Map([
		[`${ROOT}/${ACCESSOR_MODULE}`, ACCESSOR],
		[`${ROOT}/scene/code.ts`, code],
		[
			`${ROOT}/scene/code.test.ts`,
			'export const memory = new WebAssembly.Memory({ initial: 1 }).buffer;',
		],
	]);
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
		strict: true,
		noEmit: true,
	};
	const host = ts.createCompilerHost(options);
	const read = host.getSourceFile.bind(host);
	host.getSourceFile = (name, language) => {
		const text = files.get(name);
		return text === undefined ? read(name, language) : ts.createSourceFile(name, text, language);
	};
	host.fileExists = (name) => files.has(name) || ts.sys.fileExists(name);
	host.readFile = (name) => files.get(name) ?? ts.sys.readFile(name);
	host.directoryExists = (folder) =>
		[...files.keys()].some((name) => name.startsWith(`${folder}/`)) ||
		ts.sys.directoryExists(folder);
	const program = ts.createProgram([...files.keys()], options, host);
	return memoryViewProblems(program, ROOT).map(
		({ file, line, problem }) => `${file.slice(ROOT.length + 1)}:${line} ${problem.split(' ')[0]}`,
	);
}

describe('the check of views of the shared memory', () => {
	test("finds code that reads a memory's buffer outside the accessor, however it names it", () => {
		const problems = problemsOf(`
const memory = new WebAssembly.Memory({ initial: 1 });
export const a = new Uint8Array(memory.buffer);
const kept = { memory };
export const b = new Uint8Array(kept.memory['buffer']);
const { buffer } = memory;
export const c = buffer;
let maybe: WebAssembly.Memory | undefined;
export const d = maybe?.buffer.byteLength;
`);
		expect(problems).toEqual([
			'scene/code.ts:3 reads',
			'scene/code.ts:5 reads',
			'scene/code.ts:6 takes',
			'scene/code.ts:9 reads',
		]);
	});

	test("finds a view made around the buffer of the accessor's view", () => {
		const problems = problemsOf(`
import { MemoryViews } from '../shared/memory-views';
export function copy(views: MemoryViews, bytes: Uint8Array): void {
	new Uint8Array(views.f32(0, 4).buffer, 0, 16).set(bytes);
}
`);
		expect(problems).toEqual(['scene/code.ts:4 reads']);
	});

	test('finds a class that keeps views without dropping them when the memory grows', () => {
		const problems = problemsOf(`
import { MemoryViews, type ViewHolder } from '../shared/memory-views';
export class Keeps {
	private rows = this.views.f32(0, 4);
	private more = new Float32Array(0);
	constructor(private readonly views: MemoryViews) {}
	refresh(): void {
		this.more = this.views.f32(16, 4);
		this.more ??= this.views.f32(32, 4);
	}
}
export class Holds implements ViewHolder {
	private rows = new Float32Array(0);
	constructor(private readonly views: MemoryViews) {
		views.holdViews(this);
	}
	dropViews(): void {}
	refresh(): void {
		this.rows = this.views.f32(0, 4);
	}
}
export function transient(views: MemoryViews): number {
	return views.f32(0, 4)[0] ?? 0;
}
`);
		expect(problems).toEqual([
			'scene/code.ts:4 keeps',
			'scene/code.ts:8 keeps',
			'scene/code.ts:9 keeps',
		]);
	});

	test('finds a class that marks a needed dropViews as internal', () => {
		const problems = problemsOf(`
import { MemoryViews, type ViewHolder } from '../shared/memory-views';
export class Holds implements ViewHolder {
	private rows = new Float32Array(0);
	constructor(private readonly views: MemoryViews) {
		views.holdViews(this);
	}
	/** @internal Forgets the rows. */
	dropViews(): void {}
}
`);
		expect(problems).toEqual(['scene/code.ts:9 ViewHolder']);
	});

	test('leaves the accessor module and test files alone', () => {
		expect(problemsOf('export const nothing = 0;')).toEqual([]);
	});
});

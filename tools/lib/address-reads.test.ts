import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { addressReadProblems } from './address-reads.ts';

/** The folder of the fake engine sources. */
const ROOT = '/engine/src';

/** The slot constants the fake code reads, as `Slot` gives them, on the first eight lines. */
const SLOT_DECL = [
	'const Slot = {',
	'\tDrawListAddress0: 9,',
	'\tDrawListWords0: 11,',
	'\tJobsWakeAddress: 28,',
	'\tJobsYieldAddress: 36,',
	'\tFramesTaken: 1,',
	'\tRunning: 2,',
	'};',
].join('\n');

/** A slot read without `>>> 0`, on the first line of a file that does not declare the slots. */
const BAD = 'export const bad = Atomics.load(new Int32Array(40), Slot.DrawListAddress0);';

/** The problems of the fake engine with the sources `sources`, as `file:line`. */
function problemsFor(sources: Record<string, string>): string[] {
	const files = new Map(
		Object.entries(sources).map(([name, code]) => [`${ROOT}/${name}`, `${SLOT_DECL}\n${code}`]),
	);
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
	return addressReadProblems(program, ROOT).map(
		({ file, line }) => `${file.slice(ROOT.length + 1)}:${line}`,
	);
}

/** The problems of the fake engine with one checked module `code`. */
const problemsOf = (code: string): string[] => problemsFor({ 'page/code.ts': code });

describe('the check of address reads from signed arrays', () => {
	test('refuses an address read without >>> 0, however it is read', () => {
		const problems = problemsOf(
			[
				'const slots = new Int32Array(40);',
				'export const a = Atomics.load(slots, Slot.DrawListAddress0);',
				'export const b = Atomics.load(slots, Slot.DrawListAddress0 + 1);',
				'export const c = slots[Slot.JobsWakeAddress];',
				'export const d = Atomics.load(slots, Slot.JobsYieldAddress) / 4;',
			].join('\n'),
		);
		expect(problems).toEqual([
			'page/code.ts:10',
			'page/code.ts:11',
			'page/code.ts:12',
			'page/code.ts:13',
		]);
	});

	test('accepts an address converted with >>> 0 at the read site', () => {
		const problems = problemsOf(
			[
				'const slots = new Int32Array(40);',
				'export const a = (Atomics.load(slots, Slot.DrawListAddress0) >>> 0) / 4;',
				'const wake = Atomics.load(slots, Slot.JobsWakeAddress) >>> 0;',
				'export function stop(): number { return wake; }',
			].join('\n'),
		);
		expect(problems).toEqual([]);
	});

	test('leaves ordinary integer reads alone', () => {
		const problems = problemsOf(
			[
				'const slots = new Int32Array(40);',
				'export const a = Atomics.load(slots, Slot.FramesTaken);',
				'export const b = Atomics.load(slots, Slot.DrawListWords0 + 1);',
				'export const c = slots[Slot.Running];',
				'export const d = Atomics.store(slots, Slot.JobsWakeAddress, 1);',
			].join('\n'),
		);
		expect(problems).toEqual([]);
	});

	test('leaves a read from an unsigned array alone', () => {
		const problems = problemsOf(
			[
				'const words = new Uint32Array(40);',
				'export const a = Atomics.load(words, Slot.DrawListAddress0);',
			].join('\n'),
		);
		expect(problems).toEqual([]);
	});

	test('leaves test files alone', () => {
		expect(problemsFor({ 'page/code.test.ts': BAD })).toEqual([]);
		expect(problemsFor({ 'page/code.ts': BAD })).toEqual(['page/code.ts:9']);
	});
});

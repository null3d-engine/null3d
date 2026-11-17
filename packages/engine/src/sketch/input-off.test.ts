// The notes that a development build gives a sketch that relies on input while the page started the
// engine with `input: false`: each kind once, naming the option, and none in a release build. The
// scenario runs in a Bun process of its own for each build, because the development constant is
// fixed when the engine's modules load.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkAddonVersion, onAddonChecked, VERSION } from '../shared/version';
import { INPUT_OFF_NOTES, InputOffNotes, noteInputReads } from './input-off';
import type { InputOffResult } from './input-off-scenario';

/** Runs the scenario with the development checks on or off, and returns what it said. */
function scenarioIn(development: boolean): InputOffResult {
	const scenario = join(import.meta.dirname, 'input-off-scenario.ts');
	const code = `const { inputOffNotes } = await import(${JSON.stringify(scenario)});
console.log(JSON.stringify(inputOffNotes()));`;
	const run = Bun.spawnSync([
		process.execPath,
		'--define',
		`__NULL3D_DEV__=${development}`,
		'-e',
		code,
	]);
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
	return JSON.parse(run.stdout.toString()) as InputOffResult;
}

describe('the notes of input that the page does not write', () => {
	test('each names the option, and a kind is said once', () => {
		const said: string[] = [];
		const notes = new InputOffNotes((note) => said.push(note));
		notes.note('read');
		notes.note('controls');
		notes.note('read');
		notes.note('events');
		notes.note('controls');
		expect(said).toEqual([INPUT_OFF_NOTES.read, INPUT_OFF_NOTES.controls, INPUT_OFF_NOTES.events]);
		for (const note of said) expect(note).toContain('input: false');
	});

	test('a read of ctx.input says its note at the first read, and gives the same reader', () => {
		const said: string[] = [];
		const notes = new InputOffNotes((note) => said.push(note));
		const reader = { isDown: () => false };
		const context = { input: reader, time: 0 };
		noteInputReads(context, notes);
		expect(said).toEqual([]);
		expect(context.input).toBe(reader);
		const { input } = context;
		expect(input).toBe(reader);
		expect(said).toEqual([INPUT_OFF_NOTES.read]);
		// The property keeps its place among the context's keys.
		expect(Object.keys(context)).toEqual(['input', 'time']);
	});

	test('a development build says that objects get no pointer event, once for two handlers', () => {
		const { said, heard } = scenarioIn(true);
		expect(said).toEqual([INPUT_OFF_NOTES.events]);
		// The handler hears the add-on that checked while it listened, and not the one after.
		expect(heard).toEqual(['@null3d/controls']);
	});

	test('a release build says nothing and keeps no record of add-ons', () => {
		expect(scenarioIn(false)).toEqual({ said: [], heard: [] });
	});

	test("a second copy of the version module in the thread reaches the first copy's record", async () => {
		// A production build gives the sketch's thread two copies: one in the engine's code and one in
		// the sketch's bundle. Bun loads a path with a query as a module of its own.
		const record = Symbol.for('null3d.addonsChecked');
		const thread = globalThis as { [record]?: unknown };
		const before = thread[record];
		delete thread[record];
		try {
			const copy = (await import(
				`${import.meta.dirname}/../shared/version.ts?second-copy`
			)) as typeof import('../shared/version');
			expect(copy.checkAddonVersion).not.toBe(checkAddonVersion);
			const heard: string[] = [];
			const stop = onAddonChecked((name) => heard.push(name));
			copy.checkAddonVersion('@null3d/controls', VERSION);
			stop();
			expect(heard).toEqual(['@null3d/controls']);
			// A handler that the second copy adds later hears what the first copy recorded.
			checkAddonVersion('@null3d/water', VERSION);
			const late: string[] = [];
			copy.onAddonChecked((name) => late.push(name))();
			expect(late).toEqual(['@null3d/controls', '@null3d/water']);
		} finally {
			if (before === undefined) delete thread[record];
			else thread[record] = before;
		}
	});
});

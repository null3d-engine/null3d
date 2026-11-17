// The notes that a development build gives a sketch that relies on input while the page started the
// engine with `input: false`: each kind once, naming the option, and none in a release build. The
// scenario runs in a Bun process of its own for each build, because the development constant is
// fixed when the engine's modules load.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
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
		const { said, controls } = scenarioIn(true);
		expect(said).toEqual([INPUT_OFF_NOTES.events]);
		expect(controls).toBe(true);
	});

	test('a release build says nothing and keeps no list of add-ons', () => {
		expect(scenarioIn(false)).toEqual({ said: [], controls: false });
	});
});

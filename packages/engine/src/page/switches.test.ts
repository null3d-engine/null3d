import { describe, expect, it } from 'bun:test';
import { parseSwitches } from './switches';

describe('parseSwitches', () => {
	it('leaves every choice to the engine when the address has no switch', () => {
		expect(parseSwitches('')).toEqual({
			gpu: 'auto',
			threads: true,
			renderOnMain: false,
			latency: undefined,
			copyUploads: false,
			depth: undefined,
			fps: undefined,
			jobs: undefined,
			memoryMiB: undefined,
			preset: undefined,
			hold: undefined,
			bench: false,
		});
	});

	it('reads ?bench with or without a value', () => {
		expect(parseSwitches('?bench').bench).toBe(true);
		expect(parseSwitches('?gpu=webgl2&bench=1').bench).toBe(true);
	});

	it('keeps the text of ?hold for the engine to check, and an empty text for a bare ?hold', () => {
		expect(parseSwitches('?hold=1.5').hold).toBe('1.5');
		expect(parseSwitches('?gpu=webgl2&hold').hold).toBe('');
		expect(parseSwitches('?hold=soon').hold).toBe('soon');
	});

	it('reads the job worker count and the memory maximum as whole numbers', () => {
		const switches = parseSwitches('?gpu=webgl2&latency=low&jobs=4&memory=2048');
		expect(switches).toMatchObject({ gpu: 'webgl2', latency: 'low', jobs: 4, memoryMiB: 2048 });
		expect(parseSwitches('?jobs=1&memory=256')).toMatchObject({ jobs: 1, memoryMiB: 256 });
		expect(parseSwitches('?jobs=255').jobs).toBe(255);
	});

	it('ignores counts and sizes that are not whole numbers above 0', () => {
		for (const value of ['0', '-2', '1.5', 'many', '', 'Infinity']) {
			const switches = parseSwitches(`?jobs=${value}&memory=${value}`);
			expect([value, switches.jobs, switches.memoryMiB]).toEqual([value, undefined, undefined]);
		}
	});

	it('ignores a job worker count above the most the engine core runs', () => {
		expect(parseSwitches('?jobs=256').jobs).toBeUndefined();
	});

	it('reads a frame rate above 0, with decimals', () => {
		expect(parseSwitches('?fps=59.94').fps).toBe(59.94);
		expect(parseSwitches('?fps=0').fps).toBeUndefined();
	});

	it('reads the WebGL2 depth mode, and ignores a mode it does not know', () => {
		expect(parseSwitches('?gpu=webgl2&depth=standard').depth).toBe('standard');
		expect(parseSwitches('?depth=reversed-gl').depth).toBe('reversed-gl');
		expect(parseSwitches('?depth=reversed').depth).toBe('reversed');
		expect(parseSwitches('?depth=log').depth).toBeUndefined();
	});

	it('reads the quality preset, and ignores a name that is no preset', () => {
		for (const preset of ['low', 'medium', 'high', 'ultra'] as const)
			expect(parseSwitches(`?preset=${preset}`).preset).toBe(preset);
		for (const value of ['auto', 'Low', 'epic', ''])
			expect(parseSwitches(`?preset=${value}`).preset).toBeUndefined();
	});
});

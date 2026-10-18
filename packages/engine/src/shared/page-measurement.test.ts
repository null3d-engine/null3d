import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { addMeasurementRelease, measureWithEveryThread } from './page-measurement';

describe('measureWithEveryThread', () => {
	it('holds every release while the measurement runs, and ends each when it settles', async () => {
		const log: string[] = [];
		const remove = addMeasurementRelease(() => {
			log.push('release');
			return () => log.push('end');
		});
		let answer: (value: number) => void = () => {};
		const pending = measureWithEveryThread(
			() =>
				new Promise<number>((resolve) => {
					answer = resolve;
				}),
		);
		expect(log).toEqual(['release']);
		answer(5);
		expect(await pending).toBe(5);
		expect(log).toEqual(['release', 'end']);
		// A refusal ends the releases too, and so does a measurement that throws at once.
		await expect(
			measureWithEveryThread(() => Promise.reject(new Error('refused'))),
		).rejects.toThrow('refused');
		await expect(
			measureWithEveryThread(() => {
				throw new Error('not here');
			}),
		).rejects.toThrow('not here');
		expect(log).toEqual(['release', 'end', 'release', 'end', 'release', 'end']);
		remove();
		await measureWithEveryThread(() => Promise.resolve(1));
		expect(log).toHaveLength(6);
	});
});

// A guard: a measurement of the page's memory that does not go through `measureWithEveryThread`
// waits on blocked job workers, and the page can stop answering for minutes.
describe("the page's memory measurements", () => {
	it('all go through measureWithEveryThread', () => {
		const root = join(import.meta.dir, '../../../..');
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const name of readdirSync(dir)) {
				if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue;
				const path = join(dir, name);
				if (statSync(path).isDirectory()) walk(path);
				else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) files.push(path);
			}
		};
		for (const dir of ['packages/engine/src', 'examples', 'tests/pages', 'tests/image', 'bench'])
			walk(join(root, dir));
		const calls = files.flatMap((path) =>
			readFileSync(path, 'utf8')
				.split('\n')
				.filter((line) => /\.call\(performance\)|measureUserAgentSpecificMemory\(/.test(line))
				.map((line) => `${path.slice(root.length + 1)}: ${line.trim()}`),
		);
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.filter((call) => !call.includes('measureWithEveryThread('))).toEqual([]);
	});
});

// Which job workers take the on-demand loader's tasks: the ones the page says run, less the first
// while another runs, because with two or more job workers the first stays in the job loop for the
// frames. A worker that the page leaves out takes no task, and a task sent to it would wait for
// good.
import { describe, expect, test } from 'bun:test';
import { taskTakers } from './task-host';

describe('taskTakers', () => {
	test('takes the workers below the asked count, less the first while another runs', () => {
		expect(taskTakers([0, 1, 2, 3], 2)).toEqual([1]);
		expect(taskTakers([0, 1, 2, 3], 4)).toEqual([1, 2, 3]);
		expect(taskTakers([0, 1], 2)).toEqual([1]);
	});

	test('keeps the first worker when it is the only one that runs', () => {
		expect(taskTakers([0], 2)).toEqual([0]);
		expect(taskTakers([0], 1)).toEqual([0]);
		expect(taskTakers([2], 4)).toEqual([2]);
	});

	test('leaves out a worker that did not start', () => {
		expect(taskTakers([0, 1, 3, 4], 4)).toEqual([1, 3]);
		expect(taskTakers([1], 2)).toEqual([1]);
		expect(taskTakers([0], 2)).toEqual([0]);
		expect(taskTakers([], 2)).toEqual([]);
	});

	test('counts every worker the thread asked for before the page says which run', () => {
		expect(taskTakers(undefined, 2)).toEqual([1]);
		expect(taskTakers(undefined, 1)).toEqual([0]);
		expect(taskTakers(undefined, 0)).toEqual([]);
	});
});

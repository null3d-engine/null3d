import { describe, expect, it } from 'bun:test';
import { OP_CREATE_COMPUTE_PIPELINE, OP_CREATE_RENDER_PIPELINE } from '../generated/gpu';
import { EarlyBuilds, operandsAfterId, PIPELINE_LIST_LIMIT, PipelineListing } from './early-builds';

const RENDER = OP_CREATE_RENDER_PIPELINE;
const COMPUTE = OP_CREATE_COMPUTE_PIPELINE;

/** A create command's operands with its id first, as a draw list holds them. */
const command = (id: number, ...operands: number[]) => Uint32Array.of(id, ...operands);

/** A render pipeline's nine operands after its id, from its template and permutation. */
const renderOperands = (template: number, permutation: number) => [
	template,
	permutation,
	1,
	2,
	1,
	0,
	3,
	0,
	0,
];

/** Waits for the promise callbacks that resolved builds run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the pipeline listing', () => {
	it('lists each create command as its op and its operands after the id', () => {
		const listing = new PipelineListing();
		listing.add(RENDER, command(7, ...renderOperands(3, 5)), 0);
		listing.add(COMPUTE, command(9, 4, 6), 0);
		expect(Array.from(listing.take() ?? [])).toEqual([
			RENDER,
			...renderOperands(3, 5),
			COMPUTE,
			4,
			6,
		]);
	});

	it('reads the operands at the command place in a longer list', () => {
		const listing = new PipelineListing();
		const words = Uint32Array.of(0xff, 0xff, 12, ...renderOperands(8, 1));
		listing.add(RENDER, words, 2);
		expect(Array.from(listing.take() ?? [])).toEqual([RENDER, ...renderOperands(8, 1)]);
	});

	it('gives its list once, and none for a frame that created no pipeline', () => {
		const listing = new PipelineListing();
		expect(listing.take()).toBeUndefined();
		const after = new PipelineListing();
		after.add(COMPUTE, command(1, 2, 3), 0);
		expect(after.take()).toBeDefined();
		after.add(COMPUTE, command(1, 2, 3), 0);
		expect(after.take()).toBeUndefined();
	});

	it('lists commands of equal operands once', () => {
		const listing = new PipelineListing();
		listing.add(COMPUTE, command(1, 4, 6), 0);
		listing.add(COMPUTE, command(2, 4, 6), 0);
		expect(Array.from(listing.take() ?? [])).toEqual([COMPUTE, 4, 6]);
	});

	it('stops at its limit', () => {
		const listing = new PipelineListing();
		for (let k = 0; k < PIPELINE_LIST_LIMIT + 10; k++) listing.add(COMPUTE, command(k, k, 0), 0);
		expect(listing.take()?.length).toBe(PIPELINE_LIST_LIMIT * (1 + operandsAfterId(COMPUTE)));
	});
});

describe('the early builds', () => {
	const list = Uint32Array.of(RENDER, ...renderOperands(3, 5), COMPUTE, 4, 6);

	it('starts each listed build with its operands after a zero id', async () => {
		const started: number[][] = [];
		const builds = new EarlyBuilds<string>(list, (op, operands) => {
			started.push([op, ...operands]);
			return Promise.resolve(`pipeline ${op}`);
		});
		expect(started).toEqual([
			[RENDER, 0, ...renderOperands(3, 5)],
			[COMPUTE, 0, 4, 6],
		]);
		expect(builds.startedCount).toBe(2);
		await settle();
		const render = builds.take(RENDER, command(11, ...renderOperands(3, 5)), 0);
		expect(render?.pipeline).toBe(`pipeline ${RENDER}`);
		// A build leaves the list when a command takes it.
		expect(builds.take(RENDER, command(12, ...renderOperands(3, 5)), 0)).toBeUndefined();
		builds.stop();
	});

	it('gives a command a build that is still running, which resolves to its pipeline', async () => {
		let finish: (pipeline: string) => void = () => {};
		const builds = new EarlyBuilds<string>(
			Uint32Array.of(COMPUTE, 4, 6),
			() => new Promise((resolve) => (finish = resolve)),
		);
		const taken = builds.take(COMPUTE, command(2, 4, 6), 0);
		expect(taken?.pipeline).toBeUndefined();
		finish('late');
		expect(await taken?.done).toBe('late');
	});

	it('leaves no build for a command whose listed build failed, so the command meets the error', async () => {
		const builds = new EarlyBuilds<string>(Uint32Array.of(COMPUTE, 4, 6), () =>
			Promise.reject(new Error('no such shader')),
		);
		await settle();
		expect(builds.take(COMPUTE, command(2, 4, 6), 0)).toBeUndefined();
	});

	it('takes no build for a command with other operands', async () => {
		const builds = new EarlyBuilds<string>(list, () => Promise.resolve('built'));
		await settle();
		expect(builds.take(RENDER, command(1, ...renderOperands(3, 6)), 0)).toBeUndefined();
		expect(builds.take(COMPUTE, command(1, 4, 7), 0)).toBeUndefined();
		builds.stop();
	});

	it('starts a build whose shader arrives later, and none whose command came first', async () => {
		let ready = false;
		const starts: number[] = [];
		const builds = new EarlyBuilds<string>(list, (op) => {
			if (!ready) return undefined;
			starts.push(op);
			return Promise.resolve('built');
		});
		expect(starts).toEqual([]);
		// The compute command comes before its shader: it builds its own pipeline.
		expect(builds.take(COMPUTE, command(3, 4, 6), 0)).toBeUndefined();
		ready = true;
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(starts).toEqual([RENDER]);
		builds.stop();
	});

	it('drops a listed build that cannot build here, without trying again', async () => {
		let calls = 0;
		const builds = new EarlyBuilds<string>(Uint32Array.of(COMPUTE, 4, 6), () => {
			calls++;
			throw new Error('unknown template');
		});
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(calls).toBe(1);
		expect(builds.startedCount).toBe(0);
	});

	it('builds a pipeline that a list names twice once', () => {
		let starts = 0;
		new EarlyBuilds<string>(Uint32Array.of(COMPUTE, 4, 6, COMPUTE, 4, 6), () => {
			starts++;
			return Promise.resolve('built');
		});
		expect(starts).toBe(1);
	});

	it('reads whole commands only, and stops at an unknown op', () => {
		const starts: number[] = [];
		new EarlyBuilds<string>(
			Uint32Array.of(COMPUTE, 4, 6, 99, 1, 2, COMPUTE, 5),
			(_op, operands) => {
				starts.push(operands[1] as number);
				return null;
			},
		);
		expect(starts).toEqual([4]);
	});

	it('stops waiting, and forgets the builds that no command took', async () => {
		let starts = 0;
		const builds = new EarlyBuilds<string>(list, (op) => {
			if (op === RENDER) return undefined;
			starts++;
			return Promise.resolve('built');
		});
		builds.stop();
		expect(builds.take(COMPUTE, command(1, 4, 6), 0)).toBeUndefined();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(starts).toBe(1);
	});
});

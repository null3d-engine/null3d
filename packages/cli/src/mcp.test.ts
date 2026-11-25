import { describe, expect, it } from 'bun:test';
import { UsageError } from './args.js';
import { handleTool, parseMcpArgs } from './mcp.js';

/** The answers that a fake session gives, by call. */
const ANSWERS = {
	objects: { objects: [], count: 0, truncated: false },
	object: { name: 'cr', slot: 7 },
	setObject: { name: 'cr', slot: 7 },
	setMaterial: { name: 'cr', slot: 7 },
	stats: { presentedFps: 60, drawCalls: 12 },
	errors: { errors: ['E1203: a sketch error'], count: 1 },
	graph: { graph: 'digraph frame { opaque -> bloom }' },
	setQuality: { preset: 'high' },
	info: { tier: 'webgpu', preset: 'high', renderScale: 1 },
	capture: { png: 'iVBORw0KGgo=', bytes: 8 },
};

/** A session that the tests drive without a browser. */
interface FakeSession {
	calls: [string, unknown][];
	gpus: string[];
	inspect(call: string, args?: unknown): Promise<unknown>;
	errors(): Promise<{ errors: string[]; warnings: string[] }>;
	setGpu(tier: string): Promise<void>;
	close(): Promise<void>;
}

/**
 * A session that records each call and answers from `answers`, or throws where the answer is an
 * Error.
 */
function fakeSession(answers: Record<string, unknown> = ANSWERS): FakeSession {
	const calls: [string, unknown][] = [];
	const gpus: string[] = [];
	return {
		calls,
		gpus,
		async inspect(call, args) {
			calls.push([call, args]);
			const answer = answers[call];
			if (answer instanceof Error) throw answer;
			return answer;
		},
		async errors() {
			return { errors: ['a console error'], warnings: ['a console warning'] };
		},
		async setGpu(tier) {
			gpus.push(tier);
		},
		async close() {},
	};
}

/** The parsed JSON of a tool's first text item. */
async function json(
	session: FakeSession,
	name: string,
	args: Record<string, unknown> = {},
): Promise<unknown> {
	const result = await handleTool(session, name, args);
	expect(result.isError).toBeUndefined();
	const text = result.content[0] as { type: 'text'; text: string };
	return JSON.parse(text.text);
}

/** What parsing `args` throws, as the message a person sees. */
function mistake(args: string[]): string {
	try {
		parseMcpArgs(args);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`${args.join(' ')} parsed without a mistake`);
}

describe('parseMcpArgs', () => {
	it('reads the defaults', () => {
		expect(parseMcpArgs([])).toEqual({
			page: '/',
			gpu: undefined,
			size: [1280, 720],
			timeoutMs: 60_000,
			url: undefined,
			connect: undefined,
			help: false,
		});
	});

	it('reads a page, a GPU path, a size and a timeout', () => {
		expect(
			parseMcpArgs([
				'--page',
				'other.html',
				'--gpu',
				'webgl2',
				'--size',
				'640x480',
				'--timeout',
				'5',
			]),
		).toMatchObject({
			page: '/other.html',
			gpu: 'webgl2',
			size: [640, 480],
			timeoutMs: 5000,
		});
	});

	it('takes a dev server address or a debugging endpoint, but not both', () => {
		expect(parseMcpArgs(['--url', 'https://localhost:5174']).url).toBe('https://localhost:5174');
		expect(parseMcpArgs(['--connect', 'http://127.0.0.1:9222']).connect).toBe(
			'http://127.0.0.1:9222',
		);
		expect(
			mistake(['--url', 'https://localhost:5174', '--connect', 'http://127.0.0.1:9222']),
		).toContain('alternatives');
	});

	it('refuses a bad size, GPU path, address or timeout', () => {
		expect(mistake(['--size', '1280'])).toContain('--size takes a width and a height');
		expect(mistake(['--gpu', 'vulkan'])).toBe('--gpu takes webgpu, compat, webgl2, not "vulkan"');
		expect(mistake(['--url', 'ftp://localhost'])).toContain('--url takes an http or https address');
		expect(mistake(['--timeout', '0'])).toContain('--timeout takes a number of seconds above 0');
	});
});

describe('handleTool', () => {
	it('lists objects with the filter and the limit', async () => {
		const session = fakeSession();
		expect(await json(session, 'list_objects', { filter: 'gull', limit: 5 })).toEqual(
			ANSWERS.objects,
		);
		expect(session.calls).toEqual([['objects', { filter: 'gull', limit: 5 }]]);
	});

	it('reads one object', async () => {
		const session = fakeSession();
		expect(await json(session, 'get_object', { object: '#7' })).toEqual(ANSWERS.object);
		expect(session.calls).toEqual([['object', { selector: '#7' }]]);
	});

	it('passes only the transform fields that the call names', async () => {
		const session = fakeSession();
		await json(session, 'set_transform', {
			object: 'cr',
			position: [1, 2, 3],
			visible: false,
			rotation: [0, 0, 0, 1],
			scale: undefined,
		});
		expect(session.calls).toEqual([
			[
				'setObject',
				{ selector: 'cr', position: [1, 2, 3], visible: false, rotation: [0, 0, 0, 1] },
			],
		]);
	});

	it('passes only the material values that the call names', async () => {
		const session = fakeSession();
		await json(session, 'set_material', {
			object: 'cr',
			color: '#ff0000',
			roughness: 0.4,
			metalness: undefined,
		});
		expect(session.calls).toEqual([
			['setMaterial', { selector: 'cr', values: { color: '#ff0000', roughness: 0.4 } }],
		]);
	});

	it('returns a capture as an image and a line of text', async () => {
		const session = fakeSession();
		const result = await handleTool(session, 'capture');
		expect(result.content[0]).toEqual({
			type: 'text',
			text: 'Captured a PNG of the current frame: 8 bytes.',
		});
		expect(result.content[1]).toEqual({
			type: 'image',
			data: 'iVBORw0KGgo=',
			mimeType: 'image/png',
		});
	});

	it('combines the engine errors with the console log', async () => {
		const session = fakeSession();
		expect(await json(session, 'errors')).toEqual({
			engine: ['E1203: a sketch error'],
			console: ['a console error'],
			warnings: ['a console warning'],
		});
	});

	it('returns the render graph as DOT text', async () => {
		const session = fakeSession();
		const result = await handleTool(session, 'render_graph');
		expect(result.content[0]).toEqual({
			type: 'text',
			text: 'digraph frame { opaque -> bloom }',
		});
	});

	it('switches the GPU path and reads the new info', async () => {
		const session = fakeSession();
		expect(await json(session, 'set_gpu', { tier: 'webgl2' })).toEqual({
			reloaded: true,
			tier: 'webgl2',
			info: ANSWERS.info,
		});
		expect(session.gpus).toEqual(['webgl2']);
	});

	it('reports a failed call as an error result', async () => {
		const session = fakeSession({ ...ANSWERS, object: new Error('there is no object "cr"') });
		const result = await handleTool(session, 'get_object', { object: 'cr' });
		expect(result.isError).toBe(true);
		expect((result.content[0] as { type: 'text'; text: string }).text).toContain(
			'there is no object "cr"',
		);
	});

	it('refuses a tool that it does not have', async () => {
		const result = await handleTool(fakeSession(), 'delete_everything');
		expect(result.isError).toBe(true);
		expect((result.content[0] as { type: 'text'; text: string }).text).toContain(
			'there is no "delete_everything" tool',
		);
	});
});

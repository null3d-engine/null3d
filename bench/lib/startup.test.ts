import { describe, expect, it } from 'bun:test';
import { ENGINE_MODES, type EngineMode } from '../../tests/lib/engine-checks.ts';
import { loadSteps, parseArgs, stepLoad, stepUrl } from '../startup.ts';
import {
	groupSamples,
	judgeLoad,
	type LoadSample,
	loadSample,
	STARTUP_LEGEND,
	type StartupResult,
	startupProblems,
	startupTable,
} from './startup.ts';

const [PIPELINED, LOW, SINGLE] = ENGINE_MODES as readonly EngineMode[] as [
	EngineMode,
	EngineMode,
	EngineMode,
];

/** A load's result as the engine test page and the server report it. */
function result(frameDoneMs: number, overrides: Partial<StartupResult> = {}): StartupResult {
	return {
		ok: true,
		createEngineAtMs: 100,
		mode: {
			build: 'threaded',
			latency: 'pipelined',
			sketchThread: 'worker',
			renderThread: 'render-worker',
			jobWorkers: 8,
		},
		capabilities: { tier: 'webgl2' },
		stats: {
			load: {
				probeMs: 50,
				coreMs: 200,
				engineStartMs: 300,
				firstFrameMs: frameDoneMs - 20,
				firstFrameDoneMs: frameDoneMs,
			},
		},
		downloads: { requests: 12, bytes: 102_400, files: [] },
		...overrides,
	};
}

describe('a startup load', () => {
	it("places the engine's own times on the page's timeline", () => {
		expect(loadSample(result(600))).toEqual({
			tier: 'webgl2',
			scriptMs: 100,
			probeMs: 150,
			coreMs: 300,
			readyMs: 400,
			frameMs: 580,
			frameDoneMs: 600,
			requests: 12,
			bytes: 102_400,
		});
		expect(loadSample(result(600, { downloads: undefined }))).toBeUndefined();
	});

	it('passes a load in its mode with every time and the downloads', () => {
		expect(startupProblems(result(600), PIPELINED)).toEqual([]);
	});

	it('fails a load in another mode, or without its times or downloads', () => {
		expect(startupProblems(result(600), SINGLE)).toEqual([
			'loaded the threaded build',
			'ran pipelined latency',
			'ran the sketch on worker, expected main',
			'drew on render-worker, expected main',
		]);
		const bare: StartupResult = { ok: true, mode: result(1).mode };
		expect(startupProblems(bare, PIPELINED)).toEqual([
			'the page did not say when it called createEngine',
			'the probe, core or engine start time is missing',
			'the first frame times are missing',
			'the server counted no requests for the load',
		]);
		const noRequests = result(600, { downloads: { requests: 0, bytes: 0, files: [] } });
		expect(startupProblems(noRequests, PIPELINED)).toEqual([
			'the server counted no requests for the load',
		]);
	});

	it('gives a sample only to a load without problems, and a failed page its error', () => {
		expect(judgeLoad(result(600), PIPELINED)).toEqual({
			problems: [],
			sample: loadSample(result(600)),
		});
		expect(judgeLoad(result(600), LOW).sample).toBeUndefined();
		expect(judgeLoad({ ok: false, error: 'no result within 60 s' }, LOW)).toEqual({
			problems: ['no result within 60 s'],
			sample: undefined,
		});
		expect(judgeLoad({ ok: false }, LOW).problems).toEqual(['the page failed without a message']);
	});
});

describe('the startup table', () => {
	const sample = (frameDoneMs: number, requests: number, tier = 'webgl2'): LoadSample => ({
		...(loadSample(result(frameDoneMs)) as LoadSample),
		requests,
		tier,
	});

	it('groups loads by their labels in the order they first appear', () => {
		const groups = groupSamples([
			{ labels: ['pipelined', 'cold'], sample: sample(600, 12) },
			{ labels: ['pipelined', 'warm'], sample: sample(300, 1) },
			{ labels: ['pipelined', 'cold'], sample: undefined },
			{ labels: ['pipelined', 'cold'], sample: sample(700, 13) },
		]);
		expect(groups.map(({ labels, samples }) => [labels.join(' '), samples.length])).toEqual([
			['pipelined cold', 2],
			['pipelined warm', 1],
		]);
	});

	it('gives the medians of each group, and marks a group without a good load', () => {
		const lines = startupTable(
			['Thread mode', 'Load'],
			[
				{
					labels: ['pipelined', 'cold'],
					samples: [sample(600, 12), sample(900, 13), sample(700, 12)],
				},
				{ labels: ['pipelined', 'warm'], samples: [sample(300, 1), sample(400, 2, 'webgpu')] },
				{ labels: ['single-threaded', 'cold'], samples: [] },
			],
		);
		expect(lines).toEqual([
			'| Thread mode | Load | GPU | Loads | Script, ms | Probe, ms | Core, ms | Ready, ms | Frame, ms | Frame done, ms | Requests | KB |',
			'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
			'| pipelined | cold | webgl2 | 3 | 100 | 150 | 300 | 400 | 680 | 700 | 12 | 100.0 |',
			'| pipelined | warm | webgl2, webgpu | 2 | 100 | 150 | 300 | 400 | 330 | 350 | 1.5 | 100.0 |',
			'| single-threaded | cold | - | 0 | - | - | - | - | - | - | - | - |',
		]);
		expect(STARTUP_LEGEND[0]).toStartWith('Each time is a median, in milliseconds from navigation');
	});
});

describe('bench:startup', () => {
	it('measures what it always has without --android, and the whole phone protocol with it', () => {
		expect(parseArgs([])).toEqual({
			runs: 3,
			gpu: 'webgpu',
			modes: [PIPELINED],
			loads: ['cold'],
			networks: ['slow-4g'],
			switches: '',
			android: false,
		});
		expect(parseArgs(['--android'])).toEqual({
			runs: 5,
			gpu: 'auto',
			modes: [...ENGINE_MODES],
			loads: ['cold', 'warm'],
			networks: ['slow-4g', 'full'],
			switches: '',
			android: true,
		});
		expect(
			parseArgs([
				'--',
				'--runs',
				'5',
				'--modes',
				'low-latency,single-threaded',
				'--switches',
				'jobs=4',
			]),
		).toMatchObject({ runs: 5, modes: [LOW, SINGLE], switches: 'jobs=4' });
		expect(parseArgs(['--modes', 'all', '--network', 'full']).modes).toHaveLength(
			ENGINE_MODES.length,
		);
		expect(() => parseArgs(['--runs', '0'])).toThrow('--runs: use a whole number of at least 1');
		expect(() => parseArgs(['--gpu', 'metal'])).toThrow('--gpu: use auto, webgpu, webgl2');
		expect(() => parseArgs(['--loads', 'hot'])).toThrow('--loads: use some of cold, warm');
		expect(() => parseArgs(['--network', '3g'])).toThrow('--network: use some of slow-4g, full');
		expect(() => parseArgs(['--modes', 'fast'])).toThrow('--modes: use some of pipelined');
		expect(parseArgs(['--switches', 'display-check=off']).switches).toBe('display-check=off');
		expect(() => parseArgs(['--switches', '?jobs=4'])).toThrow(
			'--switches: give page switches without the ?',
		);
		expect(() => parseArgs(['--runs'])).toThrow('--runs needs a value');
		expect(() => parseArgs(['--fast'])).toThrow('unknown option --fast');
	});

	it('fills the cache first, then makes every load once per run', () => {
		const options = parseArgs(['--android', '--runs', '2', '--modes', 'pipelined,low-latency']);
		const steps = loadSteps(options).map(
			({ mode, kind, network, run }) => `${run} ${network} ${mode.name} ${kind}`,
		);
		expect(steps).toEqual([
			'0 full pipelined warm',
			'0 full low latency warm',
			...[1, 2].flatMap((run) =>
				['slow-4g', 'full'].flatMap((network) =>
					['pipelined', 'low latency'].flatMap((mode) =>
						['cold', 'warm'].map((kind) => `${run} ${network} ${mode} ${kind}`),
					),
				),
			),
		]);
		expect(loadSteps(parseArgs([])).map(({ run }) => run)).toEqual([1, 2, 3]);
	});

	it("gives each cold load its own address, and warm loads their mode's", () => {
		const options = parseArgs(['--android']);
		const cold = { mode: LOW, kind: 'cold', network: 'slow-4g', run: 2 } as const;
		const warm = { mode: LOW, kind: 'warm', network: 'full', run: 1 } as const;
		expect(stepLoad(cold, 's')).toEqual({ kind: 'cold', key: 's.low-latency-slow-4g-2' });
		expect(stepLoad(warm, 's')).toEqual({ kind: 'warm', key: 's.low-latency' });
		expect(stepLoad({ ...warm, run: 0 }, 's')).toEqual(stepLoad(warm, 's'));
		expect(stepUrl('http://localhost:5175', cold, options, 's')).toBe(
			'http://localhost:5175/__null3d/load/cold/s.low-latency-slow-4g-2/tests/pages/engine.html?seconds=0.2&latency=low',
		);
		const mac = parseArgs(['--switches', 'jobs=2']);
		expect(stepUrl('', { ...cold, mode: PIPELINED }, mac, 's')).toBe(
			'/__null3d/load/cold/s.pipelined-slow-4g-2/tests/pages/engine.html?gpu=webgpu&seconds=0.2&jobs=2',
		);
	});
});

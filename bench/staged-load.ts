// Times a page that loads a staged model: the navigation to the first draw, the bytes that arrive
// before it, and the share that the stage files take of the whole download. It compares a load
// with every stage against one with the loader's level limit of 1, which draws the level or band
// that the file holds and downloads no stage. Each load is cold on a throttled connection, so no
// cache holds any file and the browser compiles the core and the scripts from scratch.
//
// The page reports the time from navigation to its first draw, and asks the load server for what
// it sent up to that moment. It then polls the server until the downloads stop, so the share of
// the download that arrived after the first picture is the stage files' own.
//
// From the repository root, in a quiet window through the job queue:
//   QUIET_OK=1 zsh .internal/coordination/heavy.sh bun bench/staged-load.ts
// Options:
//   --runs <n>        loads of each kind: 3
//   --gpu <path>      webgpu or webgl2: webgpu
//   --network <name>  slow-4g or full: slow-4g
//   --clusters        load the staged model of a cluster tree instead of a mesh's levels
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChromium } from '../packages/cli/src/browser.js';
import { refuseBackgroundPriority } from '../tests/lib/app-window.ts';
import { type Downloads, type Load, loadPath } from '../tests/lib/load-routes.ts';
import { buildStartupPages, prepareLoads, STARTUP_PAGES_DIR } from '../tests/lib/load-server.ts';
import { DEBUG_PORT, PREVIEW_PORT, REPO_ROOT, startPreview } from '../tests/lib/server.ts';
import { refuseInQuietWindow } from '../tools/lib/quiet-window.ts';
import { DevTools, limitWorkerNetworks, pageResultOf } from './lib/devtools';
import { median } from './lib/report';

/** The page that loads a staged model and reports its first draw and downloads. */
const PAGE = 'tests/pages/staged-start.html';

/** How long a load may take before the tool gives up on it. */
const LOAD_TIMEOUT_MS = 180_000;
const POLL_MS = 200;

/** The networks a load can run on: Chrome's Slow 4G profile, at 90% of its rates, or no limit. */
const NETWORKS = {
	'slow-4g': {
		label: 'Slow 4G',
		conditions: {
			offline: false,
			latency: 562.5,
			downloadThroughput: ((1.4 * 1_000_000) / 8) * 0.9,
			uploadThroughput: ((675 * 1000) / 8) * 0.9,
		},
	},
	full: {
		label: 'full speed',
		conditions: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
	},
} as const;
type Network = keyof typeof NETWORKS;

/** A load's kinds: every stage, or the file's own level alone. */
const KINDS = ['all', 'limited'] as const;
type Kind = (typeof KINDS)[number];

/** What the page reports about one load. */
interface StagedStart {
	ok: boolean;
	error?: string;
	tier: string;
	/** Time from navigation start to the first drawn frame, in milliseconds. */
	firstFrameMs: number;
	/** What the server sent up to the first draw. */
	before: Downloads;
	/** What the server sent up to the last download the page saw. */
	total: Downloads;
	/** The level limit that the load gave the loader, or 0 for every stage. */
	max: number;
}

/** One load's figures, with the two shares worked out from them. */
interface Row {
	kind: Kind;
	run: number;
	sample?: StagedStart;
	problem?: string;
}

/** The options of a run, as the command line gives them. */
interface Options {
	runs: number;
	gpu: 'webgpu' | 'webgl2';
	network: Network;
	clusters: boolean;
}

/** The options that a command line names. */
function parseArgs(args: readonly string[]): Options {
	const options: Options = { runs: 3, gpu: 'webgpu', network: 'slow-4g', clusters: false };
	for (let k = 0; k < args.length; k++) {
		const arg = args[k] as string;
		const value = () => {
			const next = args[++k];
			if (next === undefined) throw new Error(`${arg} takes a value`);
			return next;
		};
		if (arg === '--runs') options.runs = Number(value());
		else if (arg === '--gpu') options.gpu = value() as Options['gpu'];
		else if (arg === '--network') options.network = value() as Network;
		else if (arg === '--clusters') options.clusters = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(
				'usage: bun bench/staged-load.ts [--runs n] [--gpu webgpu|webgl2] [--network slow-4g|full] [--clusters]',
			);
			process.exit(0);
		} else throw new Error(`unknown option ${arg}`);
	}
	if (!Number.isInteger(options.runs) || options.runs < 1)
		throw new Error(`--runs takes a whole number from 1, not ${options.runs}`);
	if (options.gpu !== 'webgpu' && options.gpu !== 'webgl2')
		throw new Error(`--gpu takes webgpu or webgl2, not ${options.gpu}`);
	if (!(options.network in NETWORKS))
		throw new Error(
			`--network takes ${Object.keys(NETWORKS).join(' or ')}, not ${options.network}`,
		);
	return options;
}

/** The model that a kind of run loads, in the build that the load server serves. */
function modelOf(clusters: boolean): string {
	return `tests/pages/assets/models/${
		clusters ? 'cluster-staged-terrain.glb' : 'staged-terrain.glb'
	}`;
}

/**
 * Copies the staged models and their stage files into the build, which a page names by address and
 * Vite does not copy. The server compresses a file when a load first asks for it, so a copy is
 * served as any other file of the build.
 */
function copyStagedModels(): void {
	const model = /^(?:cluster-)?staged-terrain\.(?:glb|m\d+\.(?:lod|p\d+\.band)\d+\.bin)$/;
	const from = join(REPO_ROOT, 'tests/pages/assets/models');
	const to = join(STARTUP_PAGES_DIR, 'tests/pages/assets/models');
	mkdirSync(to, { recursive: true });
	for (const name of readdirSync(from))
		if (model.test(name)) copyFileSync(join(from, name), join(to, name));
}

/**
 * The bytes of the stage files that the model names, read from its own JSON in the build. A model
 * of the tool's makes each file's bytes part of what it names, so no download is needed for this.
 */
function stageBytesOf(clusters: boolean): number {
	const file = readFileSync(join(STARTUP_PAGES_DIR, modelOf(clusters)));
	const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const json = JSON.parse(
		new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))),
	) as {
		nodes?: {
			extras?: {
				NULL3D_stages?: { levels?: { bytes?: number }[]; bands?: { bytes?: number }[] };
			};
		}[];
	};
	let total = 0;
	for (const node of json.nodes ?? []) {
		const staged = node.extras?.NULL3D_stages;
		for (const stage of [...(staged?.levels ?? []), ...(staged?.bands ?? [])])
			total += stage.bytes ?? 0;
	}
	return total;
}

/** A cold load's address: its own key, so no cache holds any of its files. */
function loadOf(kind: Kind, run: number, session: string): Load {
	return { kind: 'cold', key: `${session}.${kind}-${run}` };
}

/** The address of the page for a load. */
function pageUrl(base: string, load: Load, options: Options, kind: Kind): string {
	const query = `gpu=${options.gpu}${options.clusters ? '&clusters' : ''}${kind === 'limited' ? '&max=1' : ''}`;
	return `${base}${loadPath(load, `${PAGE}?${query}`)}`;
}

/** Loads a page in a fresh browser on a network, and waits for its result. */
async function measure(
	base: string,
	load: Load,
	options: Options,
	kind: Kind,
): Promise<StagedStart> {
	refuseBackgroundPriority();
	const browser = await launchChromium({
		channel: 'chrome',
		args: ['--enable-unsafe-webgpu', `--remote-debugging-port=${DEBUG_PORT}`],
	});
	try {
		const devtools = await DevTools.connect(DEBUG_PORT);
		try {
			const { targetId } = await devtools.send<{ targetId: string }>('Target.createTarget', {
				url: 'about:blank',
			});
			try {
				const { sessionId } = await devtools.send<{ sessionId: string }>('Target.attachToTarget', {
					targetId,
					flatten: true,
				});
				await devtools.send('Network.enable', {}, sessionId);
				await devtools.send(
					'Network.emulateNetworkConditions',
					NETWORKS[options.network].conditions,
					sessionId,
				);
				// Chrome applies a page's network limit to a worker's own requests only once the
				// Network domain is on in that worker. The sketch worker downloads the stages.
				const stopWatching =
					options.network === 'full' ? undefined : await limitWorkerNetworks(devtools, sessionId);
				let result: StagedStart;
				try {
					await devtools.send(
						'Page.navigate',
						{ url: pageUrl(base, load, options, kind) },
						sessionId,
					);
					result = await pageResultOf<StagedStart>(devtools, sessionId, LOAD_TIMEOUT_MS, POLL_MS);
				} finally {
					stopWatching?.();
				}
				if (!result.ok) throw new Error(`the page failed: ${result.error ?? 'without a message'}`);
				if (!(result.firstFrameMs > 0) || !result.before || !result.total)
					throw new Error('the page reported no first draw or downloads');
				return result;
			} finally {
				await devtools.send('Target.closeTarget', { targetId }).catch(() => {});
			}
		} finally {
			devtools.close();
		}
	} finally {
		await browser.close();
	}
}

/** Bytes as people read them. */
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** The share that the bytes after the first picture take of the whole download. */
function laterShare(sample: StagedStart): number {
	const later = Math.max(0, sample.total.bytes - sample.before.bytes);
	return sample.total.bytes > 0 ? later / sample.total.bytes : 0;
}

/** One row of the table. */
function rowLine(row: Row): string {
	const name = row.kind === 'limited' ? 'level limit 1' : 'every stage';
	if (!row.sample) return `FAIL  ${name}, run ${row.run}: ${row.problem ?? 'no result'}`;
	const { firstFrameMs, before, total } = row.sample;
	return `${name}, run ${row.run}: first draw at ${firstFrameMs.toFixed(0)} ms, ${kb(before.bytes)} before it, ${kb(total.bytes)} in all, ${(laterShare(row.sample) * 100).toFixed(1)}% after it`;
}

/** The medians of each kind's samples. */
function summary(rows: readonly Row[], options: Options): string[] {
	const lines: string[] = [];
	for (const kind of KINDS) {
		const samples = rows
			.filter((row) => row.kind === kind && row.sample)
			.map((row) => row.sample as StagedStart);
		if (samples.length === 0) continue;
		const name = kind === 'limited' ? 'level limit 1' : 'every stage';
		lines.push(
			`${name}: first draw at ${median(samples.map((s) => s.firstFrameMs)).toFixed(0)} ms, ${kb(median(samples.map((s) => s.before.bytes)))} before it, ${kb(median(samples.map((s) => s.total.bytes)))} in all, ${median(samples.map((s) => laterShare(s) * 100)).toFixed(1)}% after it, stage files ${kb(stageBytesOf(options.clusters))}, of ${samples.length} loads`,
		);
	}
	return lines;
}

async function main(): Promise<void> {
	refuseInQuietWindow('The staged load run');
	const options = parseArgs(process.argv.slice(2));
	buildStartupPages();
	copyStagedModels();
	const preview = await startPreview(STARTUP_PAGES_DIR, PREVIEW_PORT, `/${PAGE}`);
	const base = preview.url;
	try {
		await prepareLoads(base, ['startup']);
		const session = `staged-${Date.now().toString(36)}`;
		const rows: Row[] = [];
		for (let run = 0; run < options.runs; run++)
			for (const kind of KINDS) {
				try {
					const sample = await measure(base, loadOf(kind, run, session), options, kind);
					rows.push({ kind, run, sample });
				} catch (error) {
					rows.push({
						kind,
						run,
						problem: error instanceof Error ? error.message : String(error),
					});
				}
				console.log(rowLine(rows[rows.length - 1] as Row));
			}
		console.log('');
		for (const line of summary(rows, options)) console.log(line);
		const failed = rows.filter((row) => !row.sample).length;
		if (failed > 0) {
			console.error(`${failed} of ${rows.length} loads failed`);
			process.exitCode = 1;
		}
	} finally {
		preview.stop();
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}

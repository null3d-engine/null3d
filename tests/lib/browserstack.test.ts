import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudRuns, parseCloudArgs, pickDevices, runnerArgs } from '../devices-cloud.ts';
import { parseArgs } from '../real-browsers.ts';
import {
	ACCEPT_SSL_SCRIPT,
	type AutomateBrowser,
	type AutomatePlan,
	automateApi,
	capabilities,
	certificateScript,
	deviceProblems,
	IDLE_TIMEOUT_SECONDS,
	KEY_FILE,
	PROCEED_SCRIPT,
	parallelSessions,
	readCredentials,
	redactor,
	USER_FILE,
} from './browserstack.ts';
import { CLOUD_DEVICES, type CloudDevice, cloudDevice } from './browserstack-devices.ts';
import { browserNamedBy } from './device-record.ts';

const device = (runner: string) => cloudDevice(runner) as CloudDevice;

describe('readCredentials', () => {
	let home: string;
	afterEach(() => rmSync(home, { recursive: true, force: true }));
	const write = (name: string, text: string, mode = 0o600) => {
		writeFileSync(join(home, name), text);
		chmodSync(join(home, name), mode);
	};

	it('reads and trims the username and the access key', () => {
		home = mkdtempSync(join(tmpdir(), 'bs-home-'));
		write(USER_FILE, '  someone_ab12\n');
		write(KEY_FILE, 'key123\n');
		expect(readCredentials(home)).toEqual({ user: 'someone_ab12', key: 'key123' });
	});

	it('says which file is missing, empty, or readable by others, and never quotes a value', () => {
		home = mkdtempSync(join(tmpdir(), 'bs-home-'));
		expect(() => readCredentials(home)).toThrow(`put it in ~/${USER_FILE}, then run chmod 600`);
		write(USER_FILE, 'someone_ab12');
		expect(() => readCredentials(home)).toThrow(
			`no BrowserStack access key: put it in ~/${KEY_FILE}`,
		);
		write(KEY_FILE, ' \n');
		expect(() => readCredentials(home)).toThrow(`~/${KEY_FILE} is empty`);
		write(KEY_FILE, 'key123', 0o644);
		expect(() => readCredentials(home)).toThrow(`run chmod 600 ~/${KEY_FILE}`);
	});
});

describe('redactor', () => {
	it('removes the key, the username and the encoded pair from a text', () => {
		const credentials = { user: 'someone_ab12', key: 'key-abc-123' };
		const encoded = Buffer.from('someone_ab12:key-abc-123').toString('base64');
		expect(redactor(credentials)(`someone_ab12 key-abc-123 Basic ${encoded}`)).toBe(
			'*** *** Basic ***',
		);
	});
});

describe('capabilities', () => {
	const names = { build: 'null3D 20261003-120000-smoke', session: 'bsiphone17-safari' };

	it('asks for a real phone with its system, through BrowserStack Local, with the longest idle time and interactive debugging', () => {
		expect(capabilities(device('bsiphone17-safari'), names)).toEqual({
			browserName: 'safari',
			acceptInsecureCerts: true,
			'bstack:options': {
				deviceName: 'iPhone 17',
				osVersion: '26',
				realMobile: 'true',
				local: 'true',
				projectName: 'null3D',
				buildName: 'null3D 20261003-120000-smoke',
				sessionName: 'bsiphone17-safari',
				idleTimeout: IDLE_TIMEOUT_SECONDS,
				interactiveDebugging: 'true',
				video: 'true',
				consoleLogs: 'info',
				acceptInsecureCerts: 'true',
			},
		});
		expect(IDLE_TIMEOUT_SECONDS).toBe(300);
	});

	it("names Samsung Internet by Automate's name, and adds the tunnel's identifier when given", () => {
		const caps = capabilities(device('bsgalaxys25-samsung'), {
			...names,
			localIdentifier: 'tunnel-1',
		});
		expect(caps.browserName).toBe('samsung');
		expect(caps['bstack:options']).toMatchObject({
			deviceName: 'Samsung Galaxy S25',
			osVersion: '15.0',
			localIdentifier: 'tunnel-1',
		});
	});

	it('asks a desktop for its system and browser version, with no device', () => {
		const caps = capabilities(device('bsmacsequoia-safari'), names);
		expect(caps).toMatchObject({ browserName: 'safari', browserVersion: '18.4' });
		const options = caps['bstack:options'] as Record<string, unknown>;
		expect(options).toMatchObject({ os: 'OS X', osVersion: 'Sequoia' });
		expect(options.deviceName).toBeUndefined();
		expect(options.realMobile).toBeUndefined();
		expect(capabilities(device('bswin11-chrome'), names)).toMatchObject({
			browserVersion: 'latest',
		});
	});

	it('holds no credentials', () => {
		const text = JSON.stringify(CLOUD_DEVICES.map((d) => capabilities(d, names)));
		expect(text).not.toMatch(/userName|accessKey|user|key/i);
	});

	it("passes the certificate warning with BrowserStack's command in Safari and on iOS, and with the warning page's link in Edge on Android", () => {
		expect(certificateScript(device('bsiphone17-chromium'))).toBe(ACCEPT_SSL_SCRIPT);
		expect(certificateScript(device('bsmacsequoia-safari'))).toBe(ACCEPT_SSL_SCRIPT);
		expect(certificateScript(device('bsgalaxys25-edge'))).toBe(PROCEED_SCRIPT);
		expect(certificateScript(device('bswin11-edge'))).toBeUndefined();
		expect(certificateScript(device('bsgalaxys25-chrome'))).toBeUndefined();
	});
});

describe('the device cloud list', () => {
	it('names each runner once, as bs<device>-<browser>, and the name says its browser', () => {
		const names = CLOUD_DEVICES.map((d) => d.runner);
		expect(new Set(names).size).toBe(names.length);
		for (const d of CLOUD_DEVICES) {
			expect(d.runner).toMatch(new RegExp(`^bs[a-z0-9]+-${d.browser}$`));
			expect(browserNamedBy(d.runner)).toBeDefined();
		}
	});

	it('gives each phone and tablet a device and each desktop a browser version', () => {
		for (const d of CLOUD_DEVICES) {
			const mobile = d.os === 'android' || d.os === 'ios';
			expect(d.device !== undefined).toBe(mobile);
			expect(d.browserVersion !== undefined).toBe(!mobile);
		}
	});

	it("holds tiers A and B, without the guide's Firefox on Windows", () => {
		expect(CLOUD_DEVICES.filter((d) => d.tier === 'A')).toHaveLength(10);
		expect(CLOUD_DEVICES.filter((d) => d.tier === 'B')).toHaveLength(12);
	});
});

/** An Automate list that has every device of the cloud list, as browsers.json gives it. */
const LISTED: AutomateBrowser[] = CLOUD_DEVICES.map((d) =>
	d.device
		? {
				os: d.os,
				os_version: d.osVersion,
				browser: d.os === 'ios' ? 'iphone' : 'android',
				browser_version: null,
				device: d.device,
				real_mobile: true,
			}
		: {
				os: d.os,
				os_version: d.osVersion,
				browser: d.browser,
				browser_version: d.browserVersion === 'latest' ? '154.0' : `${d.browserVersion}.1`,
				device: null,
				real_mobile: null,
			},
);

describe('deviceProblems', () => {
	it('finds every device of the list in a list that has them all', () => {
		expect(deviceProblems(CLOUD_DEVICES, LISTED)).toEqual([]);
	});

	it('names a device that Automate lacks, with the near names it has', () => {
		const listed = LISTED.filter((entry) => entry.device !== 'Google Pixel 10').concat({
			os: 'android',
			os_version: '16.0',
			browser: 'android',
			browser_version: null,
			device: 'Google Pixel 10 Pro',
			real_mobile: true,
		});
		expect(deviceProblems([device('bspixel10-chrome')], listed)).toEqual([
			'bspixel10-chrome: Automate has no real Google Pixel 10 on android; near names: Google Pixel 10 Pro 16.0',
		]);
	});

	it('names the system versions Automate has for a device on another version', () => {
		const listed = LISTED.map((entry) =>
			entry.device === 'iPhone 16' ? { ...entry, os_version: '19' } : entry,
		);
		expect(deviceProblems([device('bsiphone16-safari')], listed)).toEqual([
			'bsiphone16-safari: Automate has iPhone 16 on ios 19, not 18',
		]);
	});

	it('names a desktop browser version that Automate lacks', () => {
		const listed = LISTED.map((entry) =>
			entry.os === 'OS X' ? { ...entry, browser_version: '18.3' } : entry,
		);
		expect(deviceProblems([device('bsmacsequoia-safari')], listed)).toEqual([
			'bsmacsequoia-safari: Automate has safari 18.3 on OS X Sequoia, not 18.4',
		]);
		expect(deviceProblems([device('bswin11-edge')], [])).toEqual([
			'bswin11-edge: Automate has no Windows 11',
		]);
	});

	it('refuses a browser that Automate does not offer on the system', () => {
		const odd = { ...device('bsiphone17-safari'), browser: 'firefox' as const };
		expect(deviceProblems([odd], LISTED)).toEqual([
			'bsiphone17-safari: Automate offers no firefox on ios; it offers safari, chromium',
		]);
	});
});

describe('parallelSessions', () => {
	const plan: AutomatePlan = {
		automate_plan: 'Automate Mobile',
		parallel_sessions_running: 1,
		parallel_sessions_max_allowed: 5,
	};

	it('takes the free sessions of the plan, or fewer when asked', () => {
		expect(parallelSessions(plan)).toBe(4);
		expect(parallelSessions(plan, 2)).toBe(2);
		expect(parallelSessions(plan, 9)).toBe(4);
	});

	it('refuses a run when every session is in use', () => {
		expect(() => parallelSessions({ ...plan, parallel_sessions_running: 5 })).toThrow(
			'all 5 parallel sessions of the Automate Mobile plan are in use',
		);
	});
});

describe('automateApi', () => {
	const credentials = { user: 'someone_ab12', key: 'key-abc-123' };
	let server: ReturnType<typeof Bun.serve> | undefined;
	afterEach(() => server?.stop(true));

	it('reads the plan, marks a session with its reason, and sends the credentials as a header', async () => {
		const seen: { method: string; path: string; body: string; auth: string | null }[] = [];
		server = Bun.serve({
			port: 0,
			async fetch(request) {
				const path = new URL(request.url).pathname;
				seen.push({
					method: request.method,
					path,
					body: await request.text(),
					auth: request.headers.get('authorization'),
				});
				if (path.endsWith('/plan.json'))
					return Response.json({
						automate_plan: 'Automate Mobile',
						parallel_sessions_running: 0,
						parallel_sessions_max_allowed: 2,
					});
				return Response.json({ automation_session: { status: 'failed' } });
			},
		});
		const api = automateApi(credentials, `http://localhost:${server.port}/automate`);
		expect((await api.plan()).parallel_sessions_max_allowed).toBe(2);
		await api.mark('abc', false, 'x'.repeat(400));
		expect(seen[1]).toMatchObject({ method: 'PUT', path: '/automate/sessions/abc.json' });
		expect(JSON.parse(seen[1]?.body ?? '')).toEqual({ status: 'failed', reason: 'x'.repeat(255) });
		const auth = `Basic ${Buffer.from('someone_ab12:key-abc-123').toString('base64')}`;
		expect(seen.every((s) => s.auth === auth && !s.path.includes('key-abc-123'))).toBe(true);
	});

	it('says that BrowserStack refused the credentials, and cleans other errors', async () => {
		let status = 401;
		server = Bun.serve({
			port: 0,
			fetch: () => new Response(`denied for someone_ab12 key-abc-123`, { status }),
		});
		const api = automateApi(credentials, `http://localhost:${server.port}/automate`);
		await expect(api.browsers()).rejects.toThrow('BrowserStack refused the credentials');
		status = 500;
		const error = await api.browsers().catch((e: Error) => e.message);
		expect(error).toContain('answered /browsers.json with 500: denied for *** ***');
	});
});

describe('devices:cloud', () => {
	it('reads the tiers, the runners, the parallel limit, the plan, and the options it passes on', () => {
		expect(parseCloudArgs([])).toEqual({ tiers: ['A'], plan: 'smoke', check: false, passOn: [] });
		expect(
			parseCloudArgs([
				'--tier',
				'a,B',
				'--parallel',
				'2',
				'--plan',
				'checks',
				'--check',
				'--',
				'--only',
				'x',
			]),
		).toEqual({
			tiers: ['A', 'B'],
			parallel: 2,
			plan: 'checks',
			check: true,
			passOn: ['--only', 'x'],
		});
		expect(() => parseCloudArgs(['--tier', 'C'])).toThrow('--tier: use A, B');
		expect(parseCloudArgs(['--part', '2/3']).part).toEqual({ index: 2, count: 3 });
		expect(() => parseCloudArgs(['--part', '4/3'])).toThrow('--part: use <i>/<n>');
		expect(() => parseCloudArgs(['--parallel', '0'])).toThrow('--parallel');
		expect(() => parseCloudArgs(['--allow-no-webgpu'])).toThrow(
			"put the device runner's options after --",
		);
	});

	it('picks a tier, or the runners that --only names from any tier', () => {
		expect(pickDevices({ tiers: ['A'] }).map((d) => d.tier)).toEqual(Array(10).fill('A'));
		expect(
			pickDevices({ tiers: ['A'], only: ['bswin11-edge', 'bsiphone17-safari'] }).map(
				(d) => d.runner,
			),
		).toEqual(['bsiphone17-safari', 'bswin11-edge']);
		expect(() => pickDevices({ tiers: ['A'], only: ['bsnokia-chrome'] })).toThrow(
			'has no runner bsnokia-chrome',
		);
	});

	it('splits the picked devices into parts in the list order, every device in one part', () => {
		const all = pickDevices({ tiers: ['A'] }).map((d) => d.runner);
		const parts = [1, 2, 3].map((index) =>
			pickDevices({ tiers: ['A'], part: { index, count: 3 } }).map((d) => d.runner),
		);
		expect(parts.map((part) => part.length)).toEqual([3, 3, 4]);
		expect(parts.flat()).toEqual(all);
		expect(
			pickDevices({ tiers: ['A'], only: all.slice(0, 2), part: { index: 2, count: 2 } }).map(
				(d) => d.runner,
			),
		).toEqual(all.slice(1, 2));
	});

	it('runs the devices that need core WebGPU apart from those that may lack it', () => {
		const runs = cloudRuns(pickDevices({ tiers: ['A'] }));
		expect(runs.map((run) => [run.allowNoWebgpu, run.devices.map((d) => d.runner)])).toEqual([
			[
				false,
				[
					'bsiphone17-safari',
					'bsiphone18pro-safari',
					'bsipadpro13-safari',
					'bsgalaxys25-chrome',
					'bsgalaxys25-samsung',
					'bspixel10-chrome',
					'bspixel9-chrome',
				],
			],
			[true, ['bsiphone16-safari', 'bsgalaxytaba9plus-chrome', 'bswin11-chrome']],
		]);
	});

	it("expects no WebGPU on Automate's Windows machines, which have no GPU, and runs no Firefox there", () => {
		const windows = CLOUD_DEVICES.filter((d) => d.os === 'Windows');
		expect(windows.map((d) => [d.runner, d.allowNoWebgpu])).toEqual([
			['bswin11-chrome', true],
			['bswin11-edge', true],
		]);
	});

	it('gives the device runner the plan, the runners, the limit and the build, which it accepts', () => {
		const [run] = cloudRuns([device('bsiphone16-safari')]);
		const args = runnerArgs(run!, { plan: 'smoke', passOn: ['--only', 'capabilities'] }, 3, 'b 1');
		expect(args.slice(1)).toEqual([
			'--plan',
			'smoke',
			'--allow-no-webgpu',
			'--cloud',
			'bsiphone16-safari',
			'--parallel',
			'3',
			'--cloud-build',
			'b 1',
			'--only',
			'capabilities',
		]);
		expect(parseArgs(args.slice(1))).toMatchObject({
			plan: 'smoke',
			missing: { webgpu: true },
			cloud: ['bsiphone16-safari'],
			parallel: 3,
			cloudBuild: 'b 1',
			only: ['capabilities'],
		});
	});

	it('refuses a cloud runner that the list lacks, and the scale search', () => {
		expect(() => parseArgs(['--cloud', 'bsnokia-chrome'])).toThrow('has no runner bsnokia-chrome');
		expect(() => parseArgs(['--plan', 'scale', '--cloud', 'bspixel10-chrome'])).toThrow(
			'--cloud runs fixed plans only',
		);
	});
});

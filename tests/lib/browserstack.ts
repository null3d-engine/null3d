// BrowserStack Automate: the account's credentials, the capabilities of a session on one device of
// the device list, and the REST calls that read the account's plan and its devices and mark a
// session passed or failed. The username and access key come from two files in the home folder,
// and travel only in an Authorization header. Every text that leaves this module for a log goes
// through the account's redactor first.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type CloudDevice, isMobile } from './browserstack-devices.ts';
import { CloudSessions } from './cloud-sessions.ts';
import { webDriver } from './webdriver.ts';

/** BrowserStack's WebDriver hub, which starts Automate sessions. */
export const HUB_URL = 'https://hub-cloud.browserstack.com/wd/hub';
/** BrowserStack's REST API for Automate. */
export const API_URL = 'https://api.browserstack.com/automate';
/** The project that the sessions belong to on BrowserStack's dashboard. */
export const PROJECT_NAME = 'null3D';
/** The longest idle time that Automate allows between two commands, in seconds. */
export const IDLE_TIMEOUT_SECONDS = 300;
/** The longest reason text that the driver sends with a session's status. */
const REASON_LENGTH = 255;

export interface Credentials {
	user: string;
	key: string;
}

/** The files that hold the account's username and access key, under the home folder. */
export const USER_FILE = '.browserstack-user';
export const KEY_FILE = '.browserstack';

/**
 * Reads the account's username and access key from their files in `home`. Each file must exist,
 * hold a value, and be readable by its owner only.
 */
export function readCredentials(home = homedir()): Credentials {
	const read = (name: string, what: string) => {
		const path = join(home, name);
		let mode: number;
		try {
			mode = statSync(path).mode;
		} catch {
			throw new Error(`no BrowserStack ${what}: put it in ~/${name}, then run chmod 600 ~/${name}`);
		}
		if ((mode & 0o077) !== 0)
			throw new Error(`~/${name} can be read by other users: run chmod 600 ~/${name}`);
		const value = readFileSync(path, 'utf8').trim();
		if (!value) throw new Error(`~/${name} is empty: put the BrowserStack ${what} in it`);
		return value;
	};
	return { user: read(USER_FILE, 'username'), key: read(KEY_FILE, 'access key') };
}

/** The Authorization header for the account. */
export const authHeaders = ({ user, key }: Credentials) => ({
	authorization: `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`,
});

/** Removes the account's access key, username and Authorization value from a text. */
export function redactor(credentials: Credentials): (text: string) => string {
	const secrets = [
		credentials.key,
		authHeaders(credentials).authorization.slice('Basic '.length),
		credentials.user,
	].filter((secret) => secret.length >= 4);
	return (text) => secrets.reduce((clean, secret) => clean.replaceAll(secret, '***'), text);
}

/** What a session's capabilities name besides the device. */
export interface SessionNames {
	/** The build that groups a run's sessions on the dashboard. */
	build: string;
	/** The session's name: the runner's name. */
	session: string;
	/** The tunnel's identifier, when BrowserStack Local runs with one. */
	localIdentifier?: string;
	/** Whether the cloud keeps the session's network log, as a HAR file. */
	networkLogs?: boolean;
}

/**
 * The W3C capabilities of a session on one device of the list, through BrowserStack Local. They
 * accept the dev server's own certificate, keep the session through the longest idle time, and
 * record video and the console. They hold no credentials: those go in the Authorization header.
 */
export function capabilities(device: CloudDevice, names: SessionNames): Record<string, unknown> {
	const mobile = isMobile(device);
	return {
		browserName: device.browser,
		...(!mobile && { browserVersion: device.browserVersion ?? 'latest' }),
		acceptInsecureCerts: true,
		'bstack:options': {
			...(mobile
				? { deviceName: device.device, osVersion: device.osVersion, realMobile: 'true' }
				: { os: device.os, osVersion: device.osVersion }),
			local: 'true',
			...(names.localIdentifier && { localIdentifier: names.localIdentifier }),
			projectName: PROJECT_NAME,
			buildName: names.build,
			sessionName: names.session,
			idleTimeout: IDLE_TIMEOUT_SECONDS,
			interactiveDebugging: 'true',
			video: 'true',
			consoleLogs: 'info',
			...(names.networkLogs && { networkLogs: 'true' }),
			acceptInsecureCerts: 'true',
		},
	};
}

/**
 * Whether a session's browser shows its own warning for the dev server's certificate, which only
 * BrowserStack's acceptSsl command passes: Safari, and every browser on iOS.
 */
export const needsAcceptSsl = (device: CloudDevice) =>
	device.os === 'ios' || device.browser === 'safari';

/** The command that passes the certificate warning in Safari and on iOS, run after each load. */
export const ACCEPT_SSL_SCRIPT = 'browserstack_executor: {"action": "acceptSsl"}';

/** The account's Automate plan, as `plan.json` gives it. */
export interface AutomatePlan {
	automate_plan: string;
	parallel_sessions_running: number;
	parallel_sessions_max_allowed: number;
	team_parallel_sessions_max_allowed?: number;
	queued_sessions?: number;
	queued_sessions_max_allowed?: number;
}

/** One system, browser and device that `browsers.json` lists. */
export interface AutomateBrowser {
	os: string;
	os_version: string;
	browser: string;
	browser_version: string | null;
	device: string | null;
	real_mobile: boolean | null;
}

/** BrowserStack's details of a session, of which the driver prints the dashboard link. */
export interface SessionDetails {
	browser_url?: string;
	status?: string;
}

/** The REST calls of the Automate API that the driver makes. */
export interface AutomateApi {
	plan(): Promise<AutomatePlan>;
	browsers(): Promise<AutomateBrowser[]>;
	session(id: string): Promise<SessionDetails>;
	/** Marks a session passed or failed, with a reason, also after the session ended. */
	mark(id: string, passed: boolean, reason: string): Promise<void>;
}

/** The Automate API for an account, at `base`, with errors cleaned by the account's redactor. */
export function automateApi(
	credentials: Credentials,
	base = API_URL,
	fetchFn: typeof fetch = fetch,
): AutomateApi {
	const redact = redactor(credentials);
	const call = async <T>(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<T> => {
		let response: Response;
		try {
			response = await fetchFn(`${base}${path}`, {
				method,
				headers: { 'content-type': 'application/json', ...authHeaders(credentials) },
				...(body !== undefined && { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(60_000),
			});
		} catch (e) {
			throw new Error(redact(`BrowserStack's API did not answer ${path}: ${(e as Error).message}`));
		}
		const text = await response.text();
		if (response.status === 401)
			throw new Error(
				`BrowserStack refused the credentials in ~/${USER_FILE} and ~/${KEY_FILE} for ${path}`,
			);
		if (!response.ok)
			throw new Error(
				redact(
					`BrowserStack's API answered ${path} with ${response.status}: ${text.slice(0, 300)}`,
				),
			);
		return JSON.parse(text) as T;
	};
	const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}.json`;
	return {
		plan: () => call<AutomatePlan>('GET', '/plan.json'),
		browsers: () => call<AutomateBrowser[]>('GET', '/browsers.json'),
		session: async (id) =>
			(await call<{ automation_session?: SessionDetails }>('GET', sessionPath(id)))
				.automation_session ?? {},
		mark: async (id, passed, reason) => {
			await call('PUT', sessionPath(id), {
				status: passed ? 'passed' : 'failed',
				reason: reason.slice(0, REASON_LENGTH),
			});
		},
	};
}

/**
 * How many sessions to run at once: the number asked for, at most the plan's free sessions. Throws
 * when every session of the plan is in use.
 */
export function parallelSessions(plan: AutomatePlan, asked?: number): number {
	const free = plan.parallel_sessions_max_allowed - plan.parallel_sessions_running;
	if (free < 1)
		throw new Error(
			`all ${plan.parallel_sessions_max_allowed} parallel sessions of the ${plan.automate_plan} plan are in use; end them on BrowserStack's dashboard, or wait`,
		);
	return Math.min(asked ?? free, free);
}

/** Whether a listed browser version is the one a device asks for, such as 18.4 for 18.4 or 18.4.1. */
const versionMatches = (listed: string | null, asked: string | undefined) =>
	asked === undefined ||
	asked === 'latest' ||
	listed === asked ||
	(listed?.startsWith(`${asked}.`) ?? false);

/** The browsers that Automate offers on real phones and tablets, by system. */
const MOBILE_BROWSERS: Readonly<Record<string, readonly string[]>> = {
	android: ['chrome', 'samsung', 'edge', 'firefox'],
	ios: ['safari', 'chromium'],
};

/**
 * What is wrong with these devices against the Automate list, as one line for each device that it
 * lacks, with the nearest names that it has. Empty when the list has every device.
 */
export function deviceProblems(
	devices: readonly CloudDevice[],
	listed: readonly AutomateBrowser[],
): string[] {
	const problems: string[] = [];
	const lower = (text: string | null | undefined) => (text ?? '').toLowerCase();
	for (const device of devices) {
		const os = lower(device.os);
		if (isMobile(device)) {
			if (!MOBILE_BROWSERS[os]?.includes(device.browser)) {
				problems.push(
					`${device.runner}: Automate offers no ${device.browser} on ${device.os}; it offers ${MOBILE_BROWSERS[os]?.join(', ')}`,
				);
				continue;
			}
			const sameOs = listed.filter((entry) => lower(entry.os) === os && entry.real_mobile);
			if (
				sameOs.some(
					(entry) => entry.device === device.device && entry.os_version === device.osVersion,
				)
			)
				continue;
			const versions = sameOs
				.filter((entry) => entry.device === device.device)
				.map((entry) => entry.os_version);
			const model = lower(device.device).split(' ').slice(-2).join(' ');
			const near = [
				...new Set(
					sameOs
						.filter((entry) => lower(entry.device).includes(model))
						.map((entry) => `${entry.device} ${entry.os_version}`),
				),
			].slice(0, 6);
			problems.push(
				versions.length > 0
					? `${device.runner}: Automate has ${device.device} on ${device.os} ${versions.join(', ')}, not ${device.osVersion}`
					: `${device.runner}: Automate has no real ${device.device} on ${device.os}${near.length > 0 ? `; near names: ${near.join(', ')}` : ''}`,
			);
			continue;
		}
		const sameOs = listed.filter(
			(entry) => lower(entry.os) === os && entry.os_version === device.osVersion,
		);
		if (sameOs.length === 0) {
			problems.push(`${device.runner}: Automate has no ${device.os} ${device.osVersion}`);
			continue;
		}
		const browsers = sameOs.filter((entry) => lower(entry.browser) === device.browser);
		if (!browsers.some((entry) => versionMatches(entry.browser_version, device.browserVersion)))
			problems.push(
				browsers.length > 0
					? `${device.runner}: Automate has ${device.browser} ${browsers.map((entry) => entry.browser_version).join(', ')} on ${device.os} ${device.osVersion}, not ${device.browserVersion}`
					: `${device.runner}: Automate has no ${device.browser} on ${device.os} ${device.osVersion}`,
			);
	}
	return problems;
}

/**
 * The session manager for a run on BrowserStack Automate: its sessions belong to `build`, and go
 * through the BrowserStack Local tunnel that `localIdentifier` names, or the account's only one.
 */
export function browserStackSessions(
	devices: readonly CloudDevice[],
	credentials: Credentials,
	names: Omit<SessionNames, 'session'>,
	log: (line: string) => void = console.log,
): CloudSessions {
	const api = automateApi(credentials);
	const driver = webDriver(HUB_URL, authHeaders(credentials), redactor(credentials));
	return new CloudSessions(
		new Map(devices.map((device) => [device.runner, device])),
		driver,
		{
			capabilities: (device, session) => capabilities(device, { ...names, session }),
			needsAcceptSsl,
			acceptSslScript: ACCEPT_SSL_SCRIPT,
			link: async (id) => (await api.session(id)).browser_url,
			mark: api.mark,
		},
		log,
	);
}

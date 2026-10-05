import { afterEach, describe, expect, it } from 'bun:test';
import {
	ACCEPT_SSL_SCRIPT,
	authHeaders,
	capabilities,
	certificateScript,
	redactor,
} from './browserstack.ts';
import { type CloudDevice, cloudDevice } from './browserstack-devices.ts';
import {
	type CloudAccount,
	CloudSessions,
	deviceText,
	STATUS_SCRIPT,
	UNANSWERED_POLLS,
} from './cloud-sessions.ts';
import { type WebDriver, WebDriverError, webDriver } from './webdriver.ts';

const CREDENTIALS = { user: 'tester-user-1', key: 'secret-access-key-123' };

/** One request that the fake WebDriver server received. */
interface Received {
	method: string;
	path: string;
	body: Record<string, unknown> | undefined;
	authorization: string | null;
}

/**
 * A fake WebDriver server: it opens sessions, records each command, answers scripts with the
 * status line it holds, and answers `invalid session id` for a session it was told to drop.
 */
function fakeHub(options: { refuseSessions?: boolean; failNavigate?: boolean } = {}) {
	const received: Received[] = [];
	const live = new Set<string>();
	let count = 0;
	let status = 'bsiphone17-safari: waiting for a run';
	const answer = (value: unknown, httpStatus = 200) =>
		Response.json({ value }, { status: httpStatus });
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname.replace(/^\/wd\/hub/, '');
			const text = await request.text();
			received.push({
				method: request.method,
				path,
				body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined,
				authorization: request.headers.get('authorization'),
			});
			if (path === '/session' && request.method === 'POST') {
				if (options.refuseSessions)
					return answer(
						{
							error: 'session not created',
							message: `no device for ${CREDENTIALS.user} with key ${CREDENTIALS.key}`,
						},
						500,
					);
				const id = `session-${++count}`;
				live.add(id);
				return answer({ sessionId: id, capabilities: {} });
			}
			const [, , id = '', command] = path.split('/');
			if (!live.has(id))
				return answer({ error: 'invalid session id', message: 'the session ended' }, 404);
			if (request.method === 'DELETE') {
				live.delete(id);
				return answer(null);
			}
			if (command === 'url') {
				if (options.failNavigate)
					return answer({ error: 'unknown error', message: 'no page' }, 500);
				return answer(null);
			}
			if (command === 'execute') return answer(status);
			return answer({ error: 'unknown command', message: path }, 404);
		},
	});
	return {
		url: `http://localhost:${server.port}/wd/hub`,
		received,
		drop: (id: string) => live.delete(id),
		setStatus: (text: string) => {
			status = text;
		},
		stop: () => server.stop(true),
	};
}

let hub: ReturnType<typeof fakeHub> | undefined;
afterEach(() => hub?.stop());

/** Sessions on the fake hub, with an account that records the marks and logs to `lines`. */
function sessionsOn(
	fake: ReturnType<typeof fakeHub>,
	lines: string[],
	marks: unknown[] = [],
	pollMs = 60_000,
	wrap: (driver: WebDriver) => WebDriver = (driver) => driver,
) {
	const devices = new Map(
		['bsiphone17-safari', 'bspixel10-chrome'].map((name) => [
			name,
			cloudDevice(name) as CloudDevice,
		]),
	);
	const account: CloudAccount = {
		capabilities: (device, runner) => capabilities(device, { build: 'build-1', session: runner }),
		certificateScript,
		link: async (id) => `https://automate.example/sessions/${id}`,
		mark: async (id, passed, reason) => {
			marks.push({ id, passed, reason });
		},
	};
	const driver = webDriver(fake.url, authHeaders(CREDENTIALS), redactor(CREDENTIALS));
	return new CloudSessions(devices, wrap(driver), account, (line) => lines.push(line), pollMs);
}

const PAGE = 'https://bs-local.com:3001/tests/pages/runner.html?listen&runner=bsiphone17-safari';

describe('CloudSessions', () => {
	it('opens a session on the device, loads the page, passes the certificate warning on iOS, and ends it', async () => {
		hub = fakeHub();
		const lines: string[] = [];
		const sessions = sessionsOn(hub, lines);
		expect(await sessions.open('bsiphone17-safari', PAGE)).toBe(true);
		const [create, navigate, accept] = hub.received;
		expect(create?.path).toBe('/session');
		const caps = (create!.body!.capabilities as { alwaysMatch: Record<string, unknown> })
			.alwaysMatch;
		expect(caps).toEqual(
			capabilities(cloudDevice('bsiphone17-safari') as CloudDevice, {
				build: 'build-1',
				session: 'bsiphone17-safari',
			}),
		);
		expect(navigate).toMatchObject({
			method: 'POST',
			path: '/session/session-1/url',
			body: { url: PAGE },
		});
		expect(accept?.body?.script).toBe(ACCEPT_SSL_SCRIPT);
		expect(
			hub.received.every((r) => r.authorization === authHeaders(CREDENTIALS).authorization),
		).toBe(true);
		expect(lines).toContain(
			'bsiphone17-safari: session https://automate.example/sessions/session-1',
		);
		await sessions.close('bsiphone17-safari');
		expect(hub.received.at(-1)).toMatchObject({ method: 'DELETE', path: '/session/session-1' });
		expect(lines.at(-1)).toBe('bsiphone17-safari: session ended');
		await sessions.close('bsiphone17-safari');
		expect(hub.received.filter((r) => r.method === 'DELETE')).toHaveLength(1);
	});

	it('sends no certificate command to Chrome on Android, whose capability accepts the certificate', async () => {
		hub = fakeHub();
		const sessions = sessionsOn(hub, []);
		expect(await sessions.open('bspixel10-chrome', PAGE)).toBe(true);
		expect(hub.received.map((r) => r.path)).toEqual(['/session', '/session/session-1/url']);
		await sessions.closeAll();
	});

	it('polls the session, prints the runner page status when it changes, and keeps quiet when not', async () => {
		hub = fakeHub();
		const lines: string[] = [];
		const sessions = sessionsOn(hub, lines);
		await sessions.open('bspixel10-chrome', PAGE);
		hub.setStatus('bspixel10-chrome: 3 passed, 0 failed, 47 left; now shaders');
		await sessions.poll('bspixel10-chrome');
		await sessions.poll('bspixel10-chrome');
		const polls = hub.received.filter((r) => r.body?.script === STATUS_SCRIPT);
		expect(polls).toHaveLength(2);
		expect(lines.filter((line) => line.includes('47 left'))).toHaveLength(1);
		await sessions.closeAll();
	});

	it('polls by itself, which keeps an idle session open', async () => {
		hub = fakeHub();
		const sessions = sessionsOn(hub, [], [], 20);
		await sessions.open('bspixel10-chrome', PAGE);
		await Bun.sleep(110);
		const count = () => hub!.received.filter((r) => r.body?.script === STATUS_SCRIPT).length;
		expect(count()).toBeGreaterThanOrEqual(2);
		await sessions.closeAll();
		// A poll sent just before the session closed may still arrive; none starts after it.
		await Bun.sleep(40);
		const polls = count();
		await Bun.sleep(100);
		expect(count()).toBe(polls);
	});

	it('counts a session that the cloud ended as lost, and sends it nothing more than the end command', async () => {
		hub = fakeHub();
		const lines: string[] = [];
		const sessions = sessionsOn(hub, lines);
		await sessions.open('bspixel10-chrome', PAGE);
		expect(sessions.lost('bspixel10-chrome')).toBe(false);
		hub.drop('session-1');
		await sessions.poll('bspixel10-chrome');
		expect(sessions.lost('bspixel10-chrome')).toBe(true);
		expect(lines.at(-1)).toContain('the cloud ended the session');
		const before = hub.received.length;
		await sessions.poll('bspixel10-chrome');
		await sessions.close('bspixel10-chrome');
		expect(hub.received.slice(before).map(({ method }) => method)).toEqual(['DELETE']);
		expect(lines.at(-1)).toContain('the cloud ended the session');
		expect(sessions.summary()).toEqual([
			expect.stringContaining(
				'bspixel10-chrome: https://automate.example/sessions/session-1 (the cloud ended it early',
			),
		]);
	});

	it('keeps a session whose status reads go unanswered a few times, and counts it lost after that', async () => {
		hub = fakeHub();
		const lines: string[] = [];
		let silent = false;
		const sessions = sessionsOn(hub, lines, [], 60_000, (driver) => ({
			...driver,
			execute: (id, script) =>
				silent
					? Promise.reject(
							new WebDriverError('no answer', 'POST execute: The operation timed out.'),
						)
					: driver.execute(id, script),
		}));
		await sessions.open('bspixel10-chrome', PAGE);
		silent = true;
		for (let i = 1; i < UNANSWERED_POLLS; i++) await sessions.poll('bspixel10-chrome');
		expect(sessions.lost('bspixel10-chrome')).toBe(false);
		expect(lines.at(-1)).toContain(`no answer to the status read, ${UNANSWERED_POLLS - 1} of`);
		silent = false;
		await sessions.poll('bspixel10-chrome');
		silent = true;
		for (let i = 1; i < UNANSWERED_POLLS; i++) await sessions.poll('bspixel10-chrome');
		expect(sessions.lost('bspixel10-chrome')).toBe(false);
		await sessions.poll('bspixel10-chrome');
		expect(sessions.lost('bspixel10-chrome')).toBe(true);
		expect(lines.at(-1)).toContain('the cloud ended the session: POST execute');
		// The cloud still holds a session that stopped answering, so it gets the end command.
		await sessions.close('bspixel10-chrome');
		expect(hub.received.at(-1)?.method).toBe('DELETE');
		expect(lines.at(-1)).toBe('bspixel10-chrome: session ended');
	});

	it('counts an answer whose body timed out as no answer, not as a lost session', async () => {
		const timeout = () =>
			Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
		const driver = webDriver(
			'https://hub.example',
			{},
			(text) => text,
			(async () =>
				({
					ok: true,
					status: 200,
					text: timeout,
				}) as unknown as Response) as unknown as typeof fetch,
		);
		const error = await driver.execute('session-1', 'return 1').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(WebDriverError);
		expect((error as WebDriverError).code).toBe('no answer');
		expect((error as WebDriverError).message).toContain('The operation timed out.');
	});

	it('reports a session the cloud refused, without the credentials that the error quoted', async () => {
		hub = fakeHub({ refuseSessions: true });
		const lines: string[] = [];
		const sessions = sessionsOn(hub, lines);
		expect(await sessions.open('bspixel10-chrome', PAGE)).toBe(false);
		expect(lines.at(-1)).toContain(
			'the cloud did not open a session: POST /session: session not created',
		);
		expect(lines.join('\n')).not.toContain(CREDENTIALS.key);
		expect(lines.join('\n')).not.toContain(CREDENTIALS.user);
		expect(sessions.summary()).toEqual([]);
	});

	it('ends a session that could not load the runner page', async () => {
		hub = fakeHub({ failNavigate: true });
		const lines: string[] = [];
		const sessions = sessionsOn(hub, lines);
		expect(await sessions.open('bspixel10-chrome', PAGE)).toBe(false);
		expect(hub.received.at(-1)).toMatchObject({ method: 'DELETE', path: '/session/session-1' });
	});

	it('still passes the certificate warning in Safari when the load reports the warning page as an error', async () => {
		hub = fakeHub({ failNavigate: true });
		const sessions = sessionsOn(hub, []);
		expect(await sessions.open('bsiphone17-safari', PAGE)).toBe(true);
		expect(hub.received.at(-1)?.body?.script).toBe(ACCEPT_SSL_SCRIPT);
		await sessions.closeAll();
	});

	it('marks a session passed or failed with the reason, after it ended', async () => {
		hub = fakeHub();
		const marks: unknown[] = [];
		const sessions = sessionsOn(hub, [], marks);
		await sessions.open('bspixel10-chrome', PAGE);
		await sessions.close('bspixel10-chrome');
		await sessions.mark(
			'bspixel10-chrome',
			false,
			'bspixel10-chrome: 46 passed, 0 skipped, 4 failed',
		);
		await sessions.mark('bsiphone17-safari', true, 'never opened, so nothing to mark');
		expect(marks).toEqual([
			{
				id: 'session-1',
				passed: false,
				reason: 'bspixel10-chrome: 46 passed, 0 skipped, 4 failed',
			},
		]);
	});
});

describe('deviceText', () => {
	it('names the device, its system and its browser as people do', () => {
		expect(deviceText(cloudDevice('bsiphone17-safari') as CloudDevice)).toBe(
			'iPhone 17, iOS 26, safari',
		);
		expect(deviceText(cloudDevice('bsmacsequoia-safari') as CloudDevice)).toBe(
			'macOS Sequoia, safari 18.4',
		);
	});
});

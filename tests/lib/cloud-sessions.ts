// The sessions of a device cloud run: one remote browser per runner, on a real phone, tablet or
// desktop. A session opens on a runner page that waits for its turn, and the device runner then
// drives that page as it drives a page on the local network. While the session lives, a light
// command every so often keeps the cloud from ending it as idle, and reads the runner page's status
// line, which the driver prints when it changes. The session ends when the runner's turn ends, for
// whatever reason, and the driver marks it passed or failed once the run is judged.
import type { CloudDevice } from './browserstack-devices.ts';
import { type WebDriver, WebDriverError } from './webdriver.ts';

/** What the session manager needs from the cloud beyond WebDriver. */
export interface CloudAccount {
	/** The session's W3C capabilities for a device. */
	capabilities(device: CloudDevice, runner: string): Record<string, unknown>;
	/** Whether the device's browser needs the cloud's command that passes a certificate warning. */
	needsAcceptSsl(device: CloudDevice): boolean;
	/** The script that passes the certificate warning. */
	acceptSslScript: string;
	/** The session's page on the cloud's dashboard, or undefined when the cloud did not say. */
	link(session: string): Promise<string | undefined>;
	/** Marks a session passed or failed, with a reason. */
	mark(session: string, passed: boolean, reason: string): Promise<void>;
}

/** The script that reads the runner page's status line, or the page's title before it loads. */
export const STATUS_SCRIPT =
	"var line = document.getElementById('status'); return line ? line.textContent : document.title;";

/** The script that reads whether the browser shows the page or reports it hidden. */
export const VISIBILITY_SCRIPT = 'return document.visibilityState;';

/**
 * The script that asks the page for one animation frame, and returns whether the frame that its
 * last run asked for came. Its first run in a page arms it and returns false.
 */
export const FRAME_SCRIPT =
	'var w = window; var came = w.__null3dFrameCame === true; w.__null3dFrameCame = false; requestAnimationFrame(function () { w.__null3dFrameCame = true; }); return came;';

/**
 * How long a session waits for an animation frame before it counts the page as not drawing. A
 * page that the browser draws gets one within a few frames. The runner page waits far longer for
 * the frames of its first step, so the session has time for each way to bring it to the front.
 */
export const FRAME_WAIT_MS = 3_000;

/** The longest pause between two reads of whether the asked-for frame came. */
const FRAME_READ_MS = 250;

/** How often a live session gets a command, which keeps it from ending as idle. */
export const POLL_MS = 30_000;

/**
 * How many status reads in a row may get no answer before the session counts as lost. A busy
 * browser, such as Safari on an iPhone while a page compiles its shaders, can leave one read
 * unanswered while the page goes on and finishes its run.
 */
export const UNANSWERED_POLLS = 3;

interface Session {
	id: string;
	link?: string;
	timer?: ReturnType<typeof setInterval>;
	polling?: boolean;
	/** The status line read last, printed when it changes. */
	status?: string;
	/** Status reads in a row that got no answer. */
	unanswered: number;
	/** Why the cloud ended the session, when it did before the driver closed it. */
	lost?: string;
	closed?: boolean;
}

/** The sessions of one run, by runner. */
export class CloudSessions {
	private readonly sessions = new Map<string, Session>();

	constructor(
		private readonly devices: ReadonlyMap<string, CloudDevice>,
		private readonly driver: WebDriver,
		private readonly account: CloudAccount,
		private readonly log: (line: string) => void = console.log,
		private readonly pollMs = POLL_MS,
		private readonly frameWaitMs = FRAME_WAIT_MS,
	) {}

	/**
	 * Opens a session for a runner and loads `url` in it, and says whether it did. A session that
	 * opens but cannot load the page ends at once.
	 */
	async open(runner: string, url: string): Promise<boolean> {
		const device = this.devices.get(runner);
		if (!device) throw new Error(`${runner}: the cloud device list has no such runner`);
		this.log(`${runner}: opening a session on ${deviceText(device)}`);
		let id: string;
		try {
			id = await this.driver.newSession(this.account.capabilities(device, runner));
		} catch (e) {
			this.log(`${runner}: the cloud did not open a session: ${(e as Error).message}`);
			return false;
		}
		const session: Session = { id, unanswered: 0 };
		this.sessions.set(runner, session);
		session.link = await this.account.link(id).catch(() => undefined);
		this.log(`${runner}: session ${session.link ?? id}`);
		try {
			await this.load(device, id, url);
		} catch (e) {
			this.log(`${runner}: the session did not load the runner page: ${(e as Error).message}`);
			await this.close(runner);
			return false;
		}
		await this.bringToFront(runner, device, id, url);
		session.timer = setInterval(() => void this.poll(runner), this.pollMs);
		return true;
	}

	/** Loads a page, then passes the certificate warning where the browser shows one. */
	private async load(device: CloudDevice, id: string, url: string): Promise<void> {
		const needsAccept = this.account.needsAcceptSsl(device);
		try {
			await this.driver.navigate(id, url);
		} catch (e) {
			// Safari can report the warning page as a failed load, which acceptSsl then passes.
			if (!needsAccept || (e instanceof WebDriverError && e.code === 'invalid session id')) throw e;
		}
		if (needsAccept) await this.driver.execute(id, this.account.acceptSslScript);
	}

	/** Whether the page gets an animation frame within the session's wait. */
	private async draws(id: string): Promise<boolean> {
		await this.driver.execute(id, FRAME_SCRIPT);
		const end = Date.now() + this.frameWaitMs;
		do {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(FRAME_READ_MS, this.frameWaitMs)),
			);
			if ((await this.driver.execute(id, FRAME_SCRIPT)) === true) return true;
		} while (Date.now() < end);
		return false;
	}

	/**
	 * Brings the runner page to the front when it gets no animation frames, as Samsung Internet on
	 * Automate can right after a load. The browser may report such a page hidden, or visible with
	 * still no frames, so only a frame counts. Each way is tried only while the page gets none: a
	 * switch to its own window, which brings that tab to the front, then a second load. The runner
	 * page waits for frames for a while, so a way that works in time lets the run go on. When none
	 * works, the runner page stops at the end of its wait and says why, which ends the turn.
	 */
	private async bringToFront(
		runner: string,
		device: CloudDevice,
		id: string,
		url: string,
	): Promise<void> {
		const visibility = async () => String(await this.driver.execute(id, VISIBILITY_SCRIPT));
		const wait = `${this.frameWaitMs / 1000} s`;
		const ways: [string, () => Promise<void>][] = [
			[
				'a switch to its window',
				async () => this.driver.switchToWindow(id, await this.driver.windowHandle(id)),
			],
			['a second load', () => this.load(device, id, url)],
		];
		try {
			if (await this.draws(id)) return;
			this.log(
				`${runner}: the page got no animation frame in ${wait}; the browser reports it ${await visibility()}`,
			);
			for (const [way, attempt] of ways) {
				await attempt();
				if (await this.draws(id)) {
					this.log(`${runner}: ${way} brought the page to the front, and it draws`);
					return;
				}
				this.log(
					`${runner}: still no animation frame in ${wait} after ${way}; the browser reports the page ${await visibility()}`,
				);
			}
			this.log(
				`${runner}: no way brought the page to the front, so the runner page ends the turn when its wait for frames runs out`,
			);
		} catch (e) {
			this.log(`${runner}: bringing the page to the front failed: ${(e as Error).message}`);
		}
	}

	/**
	 * Sends the session a light command, and prints the runner page's status line when it changed.
	 * A session that the cloud ended counts as lost, and its polls stop, as does one that gave no
	 * answer to several reads in a row.
	 */
	async poll(runner: string): Promise<void> {
		const session = this.sessions.get(runner);
		if (!session || session.closed || session.lost || session.polling) return;
		session.polling = true;
		try {
			const status = String((await this.driver.execute(session.id, STATUS_SCRIPT)) ?? '').trim();
			if (status && status !== session.status) this.log(`${runner}: ${status}`);
			session.status = status;
			session.unanswered = 0;
		} catch (e) {
			if (session.closed) return;
			if (
				e instanceof WebDriverError &&
				e.code === 'no answer' &&
				++session.unanswered < UNANSWERED_POLLS
			) {
				this.log(
					`${runner}: no answer to the status read, ${session.unanswered} of ${UNANSWERED_POLLS} in a row: ${e.message}`,
				);
				return;
			}
			session.lost = (e as Error).message;
			clearInterval(session.timer);
			this.log(`${runner}: the cloud ended the session: ${session.lost}`);
		} finally {
			session.polling = false;
		}
	}

	/** Whether the cloud ended a runner's session before its turn ended. */
	lost(runner: string): boolean {
		return this.sessions.get(runner)?.lost !== undefined;
	}

	/** Ends a runner's session, if it has one that is still open. */
	async close(runner: string): Promise<void> {
		const session = this.sessions.get(runner);
		if (!session || session.closed) return;
		session.closed = true;
		clearInterval(session.timer);
		if (session.lost) return;
		try {
			await this.driver.deleteSession(session.id);
			this.log(`${runner}: session ended`);
		} catch (e) {
			this.log(`${runner}: ending the session failed: ${(e as Error).message}`);
		}
	}

	/** Ends every session that is still open. */
	async closeAll(): Promise<void> {
		await Promise.all([...this.sessions.keys()].map((runner) => this.close(runner)));
	}

	/** Marks a runner's session passed or failed on the cloud's dashboard, with the reason. */
	async mark(runner: string, passed: boolean, reason: string): Promise<void> {
		const session = this.sessions.get(runner);
		if (!session) return;
		try {
			await this.account.mark(session.id, passed, reason);
		} catch (e) {
			this.log(`${runner}: marking the session failed: ${(e as Error).message}`);
		}
	}

	/** A line for each runner that had a session: its link, and why the cloud ended it early. */
	summary(): string[] {
		return [...this.sessions].map(
			([runner, { id, link, lost }]) =>
				`${runner}: ${link ?? `session ${id}`}${lost ? ` (the cloud ended it early: ${lost})` : ''}`,
		);
	}
}

/** A device as people name it, with its system and browser. */
export function deviceText(device: CloudDevice): string {
	const where = device.device
		? `${device.device}, ${device.os === 'ios' ? 'iOS' : 'Android'} ${device.osVersion}`
		: `${device.os === 'OS X' ? 'macOS' : device.os} ${device.osVersion}`;
	const version = device.browserVersion ? ` ${device.browserVersion}` : '';
	return `${where}, ${device.browser}${version}`;
}

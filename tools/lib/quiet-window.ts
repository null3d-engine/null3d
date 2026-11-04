// The machine's quiet window. A timing run's figures hold only while nothing else loads the
// machine, so whatever starts such a run keeps a marker file in place while it measures. A tool
// that builds the engine or drives a browser refuses to start while the marker stands, unless the
// job queue started it, since the queue holds its own jobs back during a window. A build in
// another checkout, which no queue sees, then cannot spoil the figures.
//
// Two questions come of this, and a caller is usually asking one of them. A tool that may not run
// asks whether a window is live: `quietRefusal`, or `quietWindow` when it wants the holder's name.
// A waiter asks a second question as well — whose window it is, since a window that no run of its
// own queue opened belongs to another session and must be waited for whatever the waiter intended.
// `quietQueueRunWaiting` answers that one, and needs the queue's folders to do it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, HEAVY_SLOT_ENV } from './build-cache';

/** The variable that names another path for the marker. */
export const QUIET_FILE_ENV = 'NULL3D_QUIET_FILE';

/**
 * The variable that a process sets once it may start, so that the steps it starts later, such as a
 * shader build inside a page build, or a browser test's workers, go on when a window opens.
 */
export const QUIET_PASSED_ENV = 'NULL3D_QUIET_PASSED';

/** The marker's path: the one that `NULL3D_QUIET_FILE` names, or one in the null3D cache folder. */
export function quietFile(env: NodeJS.ProcessEnv = process.env): string {
	return env[QUIET_FILE_ENV] || cacheDir('quiet-window');
}

/**
 * Why `what` may not start now, or null when it may. It may when no marker stands, when the marker
 * has outlived the run that wrote it, when the job queue started this process, or when a process
 * that started it passed. The marker's first line, when it has one, says what holds the window.
 */
export function quietRefusal(
	what: string,
	env: NodeJS.ProcessEnv = process.env,
	file = quietFile(env),
	now = new Date(),
): string | null {
	if (env[HEAVY_SLOT_ENV] || env[QUIET_PASSED_ENV] || !existsSync(file)) return null;
	const window = quietWindow(file, now);
	// A marker left by a run that has gone holds nothing back: waiting on it forever is how one
	// machine stops building for an afternoon and nobody can say why.
	if (!window.held || window.stale) return null;
	const holder = window.holder;
	return `${what} did not start: a timing run holds this machine quiet${holder ? ` (${holder})` : ''}, and its figures hold only while nothing else loads the machine. Start it through the job queue, which runs it once the window closes, or start it again once ${file} is gone.`;
}

/**
 * Throws the refusal when `what` may not start now. Otherwise it marks `env`, the process's own by
 * default, as passed, for the processes it starts.
 */
export function refuseInQuietWindow(what: string, env: NodeJS.ProcessEnv = process.env): void {
	const refusal = quietRefusal(what, env);
	if (refusal) throw new Error(refusal);
	env[QUIET_PASSED_ENV] = '1';
}

/** How long a marker that names no end time stands before it counts as abandoned. */
export const QUIET_MARKER_LIFETIME_MS = 60 * 60 * 1000;

/** How long past the end time it names a marker still counts as held. */
export const QUIET_END_GRACE_MS = 5 * 60 * 1000;

/**
 * What a marker says about the window: that none stands, or that one does, and from whether the run
 * that wrote it is still behind it.
 */
export type QuietWindow = { held: false } | { held: true; holder: string; stale: boolean };

/**
 * When a marker's holder says it will finish, or null when it says nothing. It says so in one of two
 * ways: a time of day, read on the day that makes it the end of the window rather than a time
 * already past, or a span from the moment it wrote the marker. A run that says it ends at 00:20 says
 * so before midnight, so a time that reads more than half a day behind the clock belongs to the next
 * day.
 */
export function quietEndTime(holder: string, born: Date, now: Date): Date | null {
	const clock = /until about (\d\d):(\d\d)/.exec(holder);
	if (clock) {
		const hours = Number(clock[1]);
		const minutes = Number(clock[2]);
		if (hours > 23 || minutes > 59) return null;
		const end = new Date(now);
		end.setHours(hours, minutes, 0, 0);
		if (end.getTime() < now.getTime() - 12 * 60 * 60 * 1000) end.setDate(end.getDate() + 1);
		return end;
	}
	// A span counts from the marker's birth, which is when the run opened the window. That holds only
	// while a marker is written as its run starts: one written early, or rewritten mid-run, moves the
	// answer. A holder that can give its process should do that instead, since that rule needs no
	// arithmetic at all.
	const span = /about (\d+) min/.exec(holder);
	return span ? new Date(born.getTime() + Number(span[1]) * 60 * 1000) : null;
}

/**
 * The process that a marker's holder names when it names one, or null. A holder that gives its
 * process lets a reader see it has finished even if the marker was never removed, which is the
 * commonest way a window outlives its run.
 */
export function quietHolderPid(holder: string): number | null {
	const match = /\bpid (\d+)\b/.exec(holder);
	return match ? Number(match[1]) : null;
}

/** True when the marker names a process and that process has gone. */
function holderGone(holder: string): boolean {
	const pid = quietHolderPid(holder);
	if (pid === null) return false;
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		// A process another user owns is still a process; only a missing one means the run has gone.
		return (error as NodeJS.ErrnoException).code === 'ESRCH';
	}
}

/**
 * What the marker at `file` says about the window at `now`. A marker that names its process is
 * released as soon as that process has gone; otherwise one that names an end time is judged by that
 * time, since the run said when it would finish, and one that names none stands for an hour from
 * its own birth. A waiter that finds a stale window carries on rather than hanging on a run that is
 * never coming back.
 */
export function quietWindow(file = quietFile(), now = new Date()): QuietWindow {
	let holder: string;
	let born: Date;
	try {
		holder = readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? '';
		born = statSync(file).mtime;
	} catch {
		// The window closed between the two reads, or never opened.
		return { held: false };
	}
	const end = quietEndTime(holder, born, now);
	const stale =
		holderGone(holder) ||
		(end
			? now.getTime() >= end.getTime() + QUIET_END_GRACE_MS
			: now.getTime() - born.getTime() >= QUIET_MARKER_LIFETIME_MS);
	return { held: true, holder, stale };
}

/** A ticket's name ends with the part that says which kind of run it is, `.q` for a timing run. */
const TIMING_TICKET = /\.q[.a-z]*$/;

/** The pid that a ticket's name carries, in its second dot-separated part. */
function ticketPid(name: string): number | null {
	const pid = name.split('.')[1];
	return pid && /^\d+$/.test(pid) ? Number(pid) : null;
}

/** True while a process stands. */
function alive(pid: number | null): boolean {
	if (pid === null) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== 'ESRCH';
	}
}

/**
 * True while a timing run of the queue at `queue` holds the window or waits for its place in it.
 *
 * The queue marks a waiting run with a ticket of its own kind, whose name carries the run's pid, and
 * a running one with a slot that holds `quiet` and a `pid` file. This is the second question a
 * waiter asks: a window with no such run behind it was opened by another session, and waits for it
 * whatever the waiter intended. A queue that is not there answers false.
 */
export function quietQueueRunWaiting(queue: string): boolean {
	let tickets: string[] = [];
	try {
		tickets = readdirSync(join(queue, 'heavy-tickets'));
	} catch {
		// No queue here, so no run of it is behind the window.
	}
	for (const ticket of tickets)
		if (TIMING_TICKET.test(ticket) && alive(ticketPid(ticket))) return true;
	let slots: string[] = [];
	try {
		slots = readdirSync(join(queue, 'heavy-slots'));
	} catch {
		// The same.
	}
	for (const slot of slots) {
		const folder = join(queue, 'heavy-slots', slot);
		if (!existsSync(join(folder, 'quiet')) || existsSync(join(folder, 'window-closed'))) continue;
		try {
			if (alive(Number(readFileSync(join(folder, 'pid'), 'utf8').trim()))) return true;
		} catch {
			// A slot that names no process stands behind no run.
		}
	}
	return false;
}

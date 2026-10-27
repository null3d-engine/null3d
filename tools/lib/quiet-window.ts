// The machine's quiet window. A timing run's figures hold only while nothing else loads the
// machine, so whatever starts such a run keeps a marker file in place while it measures. A tool
// that builds the engine or drives a browser refuses to start while the marker stands, unless the
// job queue started it, since the queue holds its own jobs back during a window. A build in
// another checkout, which no queue sees, then cannot spoil the figures.
import { existsSync, readFileSync } from 'node:fs';
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
 * Why `what` may not start now, or null when it may. It may when no marker stands, when the job
 * queue started this process, or when a process that started it passed. The marker's first line,
 * when it has one, says what holds the window.
 */
export function quietRefusal(
	what: string,
	env: NodeJS.ProcessEnv = process.env,
	file = quietFile(env),
): string | null {
	if (env[HEAVY_SLOT_ENV] || env[QUIET_PASSED_ENV] || !existsSync(file)) return null;
	let holder: string;
	try {
		holder = readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? '';
	} catch {
		// The window closed between the two reads.
		return null;
	}
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

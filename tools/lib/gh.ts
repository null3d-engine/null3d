// Runs the GitHub CLI for the tools that read CI runs, and runs it again after a server error.
// GitHub's API answers HTTP 502 now and then, most often for a run of a hundred jobs or more, and
// one such answer stopped a tool that reads a run's jobs, logs or artifacts.

/** How many times a command runs before its server error stands. */
const TRIES = 5;

/** The wait before the first retry, in ms. Each later retry waits twice as long as the one before. */
const FIRST_WAIT_MS = 2000;

/** True when `gh` failed on GitHub's side, which a later try may not meet. */
const serverError = (stderr: string) => /HTTP 5\d\d|Server Error|stream error/.test(stderr);

/** The error of a command that failed for good. */
const failed = (args: readonly string[], stderr: string) =>
	new Error(`gh ${args.join(' ')} failed:\n${stderr}`);

/** Runs `gh` with `args` in `cwd`, and gives its output as bytes. */
export function ghBytes(args: readonly string[], cwd: string): Uint8Array {
	for (let attempt = 1; ; attempt++) {
		const result = Bun.spawnSync(['gh', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
		if (result.exitCode === 0) return result.stdout;
		const stderr = result.stderr.toString();
		if (attempt >= TRIES || !serverError(stderr)) throw failed(args, stderr);
		Bun.sleepSync(FIRST_WAIT_MS * 2 ** (attempt - 1));
	}
}

/** Runs `gh` with `args` in `cwd`, and gives its output as text. */
export function gh(args: readonly string[], cwd: string): string {
	return new TextDecoder().decode(ghBytes(args, cwd));
}

/** Runs `gh` with `args` in `cwd` without blocking, and gives its output as text. */
export async function ghAsync(args: readonly string[], cwd: string): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		const child = Bun.spawn(['gh', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
		const [out, err, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code === 0) return out;
		if (attempt >= TRIES || !serverError(err)) throw failed(args, err);
		await Bun.sleep(FIRST_WAIT_MS * 2 ** (attempt - 1));
	}
}

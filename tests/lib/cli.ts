// Runs the command-line tool as a developer runs it: its bin file with Node, in a project's folder.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './server.ts';

/** The command-line tool's bin file. */
const COMMAND = join(REPO_ROOT, 'packages/cli/bin/null3d.js');

/** What a run of the tool gave: its exit code, what it printed, and its standard output alone. */
export interface CliRun {
	code: number | null;
	/** The standard output and the standard error, in the order the tool printed them. */
	output: string;
	stdout: string;
}

/** Runs the tool with `args` in the folder `cwd`, and waits until it exits. */
export function runCli(cwd: string, args: readonly string[]): Promise<CliRun> {
	return new Promise((resolve, reject) => {
		// The tool starts the project's own Vite server, which serves HTTPS by default. A test that
		// runs it has no certificate on CI, and the loopback is a secure origin over plain HTTP, so
		// the tool is told to serve HTTP here, as the browser test servers are.
		const child = spawn(process.execPath, [COMMAND, ...args], {
			cwd,
			env: { ...process.env, NULL3D_HTTPS: '0' },
		});
		let output = '';
		let stdout = '';
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString();
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, output, stdout }));
	});
}

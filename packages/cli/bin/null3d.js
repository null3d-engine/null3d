#!/usr/bin/env node
// The null3d command. It runs the command that its arguments name, and exits with that command's
// code. An unexpected failure prints its message and exits with 1.
import { main } from '../src/cli.js';

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	console.error(`null3d: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}

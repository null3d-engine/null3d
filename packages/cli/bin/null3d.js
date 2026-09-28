#!/usr/bin/env node
// The null3d command. This version has no commands: it prints its version and the project's
// status, and exits with an error when asked to run a command.
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [command] = process.argv.slice(2);
const home = 'https://github.com/null3d-engine/null3d';

if (command === '--version' || command === '-v') {
	console.log(version);
} else if (command === undefined || command === '--help' || command === '-h') {
	console.log(`null3d ${version}

null3d is a browser 3D engine in early development. This package will hold its
command-line tool, which has no commands yet. The first commands arrive with
null3d 0.1.

Follow the project at ${home}`);
} else {
	console.error(`null3d ${version} has no "${command}" command yet. The first commands arrive with
null3d 0.1. Follow the project at ${home}`);
	process.exit(1);
}

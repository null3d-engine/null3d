#!/usr/bin/env node
// The sokko3d command. This version has no commands: it prints its version and the project's
// status, and exits with an error when asked to run a command.
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [command] = process.argv.slice(2);
const home = 'https://github.com/sokko3d/sokko3d';

if (command === '--version' || command === '-v') {
	console.log(version);
} else if (command === undefined || command === '--help' || command === '-h') {
	console.log(`sokko3d ${version}

sokko3d is a browser 3D engine in early development. This package will hold its
command-line tool, which has no commands yet. The first commands arrive with
sokko3d 0.1.

Follow the project at ${home}`);
} else {
	console.error(`sokko3d ${version} has no "${command}" command yet. The first commands arrive with
sokko3d 0.1. Follow the project at ${home}`);
	process.exit(1);
}

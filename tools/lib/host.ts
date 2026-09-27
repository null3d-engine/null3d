// The Mac's name on the local network, which phones and tablets use to reach its dev server.
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

/** The local host name without the .local suffix. */
export function localHostName(): string {
	try {
		return execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
	} catch {
		return hostname().replace(/\.local$/, '');
	}
}

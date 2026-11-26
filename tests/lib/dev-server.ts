// The address that a Vite dev server prints, read from its output.
import { stripVTControlCharacters } from 'node:util';

/** The first local address in a dev server's output, or undefined before the server prints one. */
export function devServerAddress(output: string): string | undefined {
	// Vite colors its banner and prints the port in bold, so the escapes split the address apart.
	return /http:\/\/localhost:\d+\//.exec(stripVTControlCharacters(output))?.[0];
}

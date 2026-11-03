// The command-line options that the plant review commands read: `--name value` pairs and bare
// `--name` switches.

/** One named option's value, or its default; throws when an option with no default is missing. */
export function option(name: string, fallback?: string): string {
	const at = process.argv.indexOf(`--${name}`);
	const value = at >= 0 ? process.argv[at + 1] : undefined;
	if (value === undefined || value.startsWith('--')) {
		if (fallback !== undefined) return fallback;
		throw new Error(`--${name} is required.`);
	}
	return value;
}

/** Whether a switch is on the command line. */
export function flag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

// The command-line options that the plant review and fitting commands read: `--name value` pairs, bare
// `--name` switches and the words that are neither.

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

/** Switches that take no value, so the word after one is not its value. */
const SWITCHES = new Set(['--no-matte']);

/**
 * The words on the command line that are neither options nor options' values, in order. The words
 * in `switches` take no value, so the word after one is not its value.
 */
export function positionals(switches: ReadonlySet<string> = SWITCHES): string[] {
	const words: string[] = [];
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		const word = args[i] as string;
		if (word.startsWith('--')) {
			if (!switches.has(word)) i++;
			continue;
		}
		words.push(word);
	}
	return words;
}

/** The `index`th word on the command line that is neither an option nor an option's value. */
export function positional(index: number): string | undefined {
	return positionals()[index];
}

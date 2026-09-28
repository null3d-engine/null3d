// The repository's commands, as package.json defines them and as AGENTS.md and the README name them.
// Every command is documented in AGENTS.md, and every command those files name exists, so the
// command list in the docs cannot drift from the code.

/** Scripts that package managers run by themselves, which no one types. */
const LIFECYCLE_SCRIPTS = new Set([
	'preinstall',
	'install',
	'postinstall',
	'prepare',
	'prepack',
	'postpack',
	'prepublishOnly',
]);

/** The command names that a Markdown text runs with `bun run`. */
export function namedCommands(markdown: string): Set<string> {
	return new Set(
		[...markdown.matchAll(/\bbun run ([a-z0-9][a-z0-9:_-]*)/g)].map((match) => match[1] as string),
	);
}

/**
 * What differs between the defined commands and the documented ones: a command that AGENTS.md does
 * not document, and a command that a file names but package.json does not define.
 */
export function commandProblems(
	scripts: readonly string[],
	files: Readonly<Record<string, string>>,
	guide = 'AGENTS.md',
): string[] {
	const problems: string[] = [];
	const documented = namedCommands(files[guide] ?? '');
	for (const name of scripts)
		if (!LIFECYCLE_SCRIPTS.has(name) && !documented.has(name))
			problems.push(
				`package.json defines "${name}", but ${guide} does not document bun run ${name}`,
			);
	for (const [file, text] of Object.entries(files))
		for (const name of namedCommands(text))
			if (!scripts.includes(name))
				problems.push(`${file} names bun run ${name}, which package.json does not define`);
	return problems;
}

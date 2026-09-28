import { describe, expect, it } from 'bun:test';
import { commandProblems, namedCommands } from './commands';

describe('namedCommands', () => {
	it('finds each command run with bun run, with its arguments left out', () => {
		expect(
			namedCommands(
				'Run `bun run test:bench`, then `bun run bench:run -- --sweep` and bun run dev.',
			),
		).toEqual(new Set(['test:bench', 'bench:run', 'dev']));
	});
});

describe('commandProblems', () => {
	const agents = '| `bun run build` | builds |\n| `bun run test` | tests |';

	it('passes when every command is documented and every named command exists', () => {
		expect(
			commandProblems(['build', 'test', 'prepare'], {
				'AGENTS.md': agents,
				'README.md': 'bun run build',
			}),
		).toEqual([]);
	});

	it('reports a command that AGENTS.md does not document', () => {
		expect(commandProblems(['build', 'test', 'readme-media'], { 'AGENTS.md': agents })).toEqual([
			'package.json defines "readme-media", but AGENTS.md does not document bun run readme-media',
		]);
	});

	it('reports a command that a file names but package.json does not define', () => {
		expect(
			commandProblems(['build', 'test'], { 'AGENTS.md': agents, 'README.md': 'bun run serve' }),
		).toEqual(['README.md names bun run serve, which package.json does not define']);
	});
});

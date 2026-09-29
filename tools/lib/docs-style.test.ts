import { describe, expect, it } from 'bun:test';
import { checkDocsStyle, isTitleCase } from './docs-style';

const rules = (md: string) => checkDocsStyle(md).map((f) => `${f.severity}:${f.rule}:${f.line}`);

describe('checkDocsStyle errors', () => {
	it('blocks dashes, curly quotes, chatbot phrases and emoji headings', () => {
		expect(rules('A — B.')).toEqual(['error:dash:1']);
		expect(rules('A – B.')).toEqual(['error:dash:1']);
		expect(rules('It is “fast”.')).toEqual(['error:curly_quote:1']);
		expect(rules('I hope this helps.')).toEqual(['error:chatbot_phrase:1']);
		expect(rules('## Speed \u{1F680}')).toEqual(['error:heading_emoji:1']);
	});

	it('blocks any mention of the private build plan, even in code', () => {
		expect(rules('Read `.internal/plan/x.md`.')).toEqual(['error:private_plan:1']);
		expect(rules('See [the plan](../.internal/plan/x.md).')).toEqual(['error:private_plan:1']);
		expect(rules('| Plan | `PLAN.md` |')).toEqual(['error:private_plan:1']);
		expect(rules('See https://null3d.dev/docs.')).toEqual([]);
	});

	it('blocks links from the public docs to the maintainer guides', () => {
		expect(rules('See [devices](../.dev/devices.md).')).toEqual(['error:maintainer_guide:1']);
		expect(rules('Read `.dev/benchmarks.md`.')).toEqual(['error:maintainer_guide:1']);
	});

	it('blocks the build process in docs for engine users', () => {
		expect(rules('The first milestone adds shadows.')).toEqual(['error:build_process:1']);
		expect(rules('These figures come from the checkpoint.')).toEqual(['error:build_process:1']);
		expect(rules('Task M0-J1 wrote this page.')).toEqual(['error:build_process:1']);
	});

	it('blocks the command line tool run as null3d, in prose and in code', () => {
		expect(rules('Run `npx null3d test`.')).toEqual([
			'error:cli_command:1',
			'error:package_manager:1',
		]);
		expect(rules('Made with `null3d assets optimize`.')).toEqual(['error:cli_command:1']);
		expect(rules('```sh\nbunx null3d shot\n```')).toEqual(['error:cli_command:2']);
		expect(rules('Run `bunx null3d test`.')).toEqual(['error:cli_command:1']);
		expect(rules('Run `bunx @null3d/cli test`. The `null3d` command is optional.')).toEqual([]);
	});

	it('blocks commands for other package managers, in prose and in code', () => {
		expect(rules('Run `npx vite`.')).toEqual(['error:package_manager:1']);
		expect(rules('```sh\nnpm install @null3d/engine\n```')).toEqual(['error:package_manager:2']);
		expect(rules('Or `pnpm add three`.')).toEqual(['error:package_manager:1']);
		expect(rules('Run `bunx vite`. It installs from npm, and pnpm works too.')).toEqual([]);
	});

	it("blocks the engine's name in any spelling but null3D, in prose, headings and tables", () => {
		expect(rules('null3d draws on workers.')).toEqual(['error:engine_name:1']);
		expect(rules('# Null3D documentation')).toEqual(['error:engine_name:1']);
		expect(rules('| [Install null3d](install.md) | x |')).toEqual(['error:engine_name:1']);
		expect(rules('Built with null 3d.')).toEqual(['error:engine_name:1']);
		expect(rules("null3d's core is Rust.")).toEqual(['error:engine_name:1']);
		expect(rules('The message starts with null3d: and then the cause.')).toEqual([
			'error:engine_name:1',
		]);
		expect(rules("null3D draws on workers. null3D's core is Rust.")).toEqual([]);
	});

	it("leaves the engine's code names alone", () => {
		expect(rules('Install `@null3d/engine` and `bunx @null3d/cli`.')).toEqual([]);
		expect(rules('Install @null3d/engine, then load null3d_bg.wasm and null3d.js.')).toEqual([]);
		expect(rules('The null3d-develop skill imports null3d::math.')).toEqual([]);
		expect(rules('See https://github.com/null3d-engine/null3d for the source.')).toEqual([]);
		expect(rules('[the source](https://github.com/null3d-engine/null3d)')).toEqual([]);
		expect(rules('<!-- null3d:placeholder -->')).toEqual([]);
		expect(rules('Run the `null3d` command.')).toEqual([]);
	});

	it('lets contributor files name the build process, but not the private plan', () => {
		const contributors = (md: string) =>
			checkDocsStyle(md, 'contributors').map((f) => `${f.severity}:${f.rule}:${f.line}`);
		expect(contributors('Add the milestone task ID, such as M0-J1.')).toEqual([]);
		expect(contributors('M1 adds shadows.')).toEqual([]);
		expect(contributors('Read `.internal/plan/x.md`.')).toEqual(['error:private_plan:1']);
		expect(contributors('See [devices](.dev/devices.md).')).toEqual([]);
	});

	it('ignores front matter, fenced code, inline code and comments', () => {
		const md = [
			'---',
			'title: "A — B"',
			'---',
			'```',
			'x — y',
			'```',
			'Use `a — b` here.',
			'<!-- I hope this helps -->',
		].join('\n');
		expect(rules(md)).toEqual([]);
	});
});

describe('checkDocsStyle warnings', () => {
	it('warns on long sentences, stock words, hedges and not-X-but-Y contrasts', () => {
		const long = `${Array.from({ length: 30 }, () => 'word').join(' ')}.`;
		expect(rules(long)).toEqual(['warning:long_sentence:1']);
		expect(rules('The engine offers a seamless workflow.')).toEqual(['warning:stock_word:1']);
		expect(rules('It generally works.')).toEqual(['warning:hedge:1']);
		expect(rules('It is not just fast but also small.')).toEqual(['warning:not_x_but_y:1']);
	});

	it('warns on a bare milestone name, but not on an Apple chip', () => {
		expect(rules('M1 adds shadows.')).toEqual(['warning:milestone_name:1']);
		expect(rules('It runs on an Apple M1 laptop.')).toEqual([]);
	});

	it('joins wrapped lines into one paragraph and reports its first line', () => {
		const words = Array.from({ length: 15 }, () => 'word').join(' ');
		expect(rules(`Intro.\n\n${words}\n${words}.`)).toEqual(['warning:long_sentence:3']);
	});

	it('ends a sentence at a full stop inside bold or italic text', () => {
		const words = Array.from({ length: 15 }, () => 'word').join(' ');
		expect(rules(`**${words}.** Then ${words}.`)).toEqual([]);
		expect(rules(`*${words}.* Then ${words}.`)).toEqual([]);
	});

	it('ends a sentence before a name spelled in lowercase', () => {
		const words = Array.from({ length: 15 }, () => 'word').join(' ');
		expect(rules(`${words}. null3D ${words}. three.js ${words}.`)).toEqual([]);
	});

	it('does not split sentences at version numbers or skip table rows for errors', () => {
		expect(rules('Version 0.1 ships first.')).toEqual([]);
		expect(rules('| a — b |')).toEqual(['error:dash:1']);
	});
});

describe('isTitleCase', () => {
	it('flags title case and leaves sentence case and product names alone', () => {
		expect(isTitleCase('Getting Started With Null')).toBe(true);
		expect(isTitleCase('Getting started with null3D')).toBe(false);
		expect(isTitleCase('Porting React Three Fiber')).toBe(false);
		expect(isTitleCase('GPU tiers and backends')).toBe(false);
	});
});

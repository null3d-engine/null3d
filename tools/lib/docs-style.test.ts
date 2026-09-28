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
		expect(rules('Read `.dev/plan/x.md`.')).toEqual(['error:private_plan:1']);
		expect(rules('| Plan | `PLAN.md` |')).toEqual(['error:private_plan:1']);
		expect(rules('See https://sokko3d.dev/docs.')).toEqual([]);
	});

	it('blocks the build process in docs for engine users', () => {
		expect(rules('The first milestone adds shadows.')).toEqual(['error:build_process:1']);
		expect(rules('These figures come from the checkpoint.')).toEqual(['error:build_process:1']);
		expect(rules('Task M0-J1 wrote this page.')).toEqual(['error:build_process:1']);
	});

	it('lets contributor files name the build process, but not the private plan', () => {
		const contributors = (md: string) =>
			checkDocsStyle(md, 'contributors').map((f) => `${f.severity}:${f.rule}:${f.line}`);
		expect(contributors('Add the milestone task ID, such as M0-J1.')).toEqual([]);
		expect(contributors('M1 adds shadows.')).toEqual([]);
		expect(contributors('Read `.dev/plan/x.md`.')).toEqual(['error:private_plan:1']);
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
		expect(rules(`${words}. sokko3d ${words}. three.js ${words}.`)).toEqual([]);
	});

	it('does not split sentences at version numbers or skip table rows for errors', () => {
		expect(rules('Version 0.1 ships first.')).toEqual([]);
		expect(rules('| a — b |')).toEqual(['error:dash:1']);
	});
});

describe('isTitleCase', () => {
	it('flags title case and leaves sentence case and product names alone', () => {
		expect(isTitleCase('Getting Started With Sokko')).toBe(true);
		expect(isTitleCase('Getting started with sokko3d')).toBe(false);
		expect(isTitleCase('Porting React Three Fiber')).toBe(false);
		expect(isTitleCase('GPU tiers and backends')).toBe(false);
	});
});

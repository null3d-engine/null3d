import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendarDate, OUTSIDE_DATE } from './lib/docs-style';

const ROOT = join(import.meta.dir, '..');

/** The files of code that git keeps, by the comment syntax that each kind uses. */
const C_LIKE = ['*.ts', '*.js', '*.mjs', '*.rs', '*.wgsl', '*.glsl'];
const HASH = ['*.yml', '*.yaml', '*.toml', '*.sh'];
const MARKUP = ['*.html'];
const STYLES = ['*.css'];

/** Third-party code that the repository vendors as published, with its own authors' comments. */
const VENDORED = /(^|\/)vendor\//;

interface Comment {
	/** The line where the comment's text sits, from 1. */
	line: number;
	text: string;
}

/** A function that gives the line of an offset in `source`, from 1. */
function lineFinder(source: string): (offset: number) => number {
	const starts = [0];
	for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
	return (offset) => {
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if ((starts[mid] as number) <= offset) low = mid;
			else high = mid - 1;
		}
		return low + 1;
	};
}

/** Splits a comment that spans lines into one entry per line, so a finding names its own line. */
function perLine(first: number, text: string): Comment[] {
	return text.split('\n').map((part, index) => ({ line: first + index, text: part }));
}

/** A character after which a slash in a script opens a regular expression rather than divides. */
const BEFORE_EXPRESSION = /[(,=:[!&|?{};+\-*%<>~^]/;

/**
 * The comments of C-like code. Strings and template literals are skipped, since their dates are
 * data that tests read. A slash after a value divides; anywhere else in a script it opens a regular
 * expression, which is skipped too. Rust and WGSL have no quoted characters that can hold a
 * comment's opening, so a single quote there is a lifetime or a character.
 */
export function cLikeComments(source: string, kind: 'script' | 'rust' | 'style'): Comment[] {
	const lineOf = lineFinder(source);
	const comments: Comment[] = [];
	/** The brace depth at each open `${` of a template literal, innermost last. */
	const interpolations: number[] = [];
	let braces = 0;
	let lastSignificant = '';
	let i = 0;
	const n = source.length;
	const skipQuoted = (quote: string) => {
		i++;
		while (i < n && source[i] !== quote && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
		i++;
	};
	/** Reads a template literal's text from `i` to its end or to its next interpolation. */
	const scanTemplate = () => {
		while (i < n) {
			const c = source[i];
			if (c === '\\') i += 2;
			else if (c === '`') {
				i++;
				return;
			} else if (c === '$' && source[i + 1] === '{') {
				interpolations.push(braces);
				braces++;
				i += 2;
				return;
			} else i++;
		}
	};
	const skipExpression = () => {
		i++;
		let inClass = false;
		while (i < n && source[i] !== '\n') {
			const c = source[i];
			if (c === '\\') i++;
			else if (c === '[') inClass = true;
			else if (c === ']') inClass = false;
			else if (c === '/' && !inClass) break;
			i++;
		}
		i++;
	};
	while (i < n) {
		const c = source[i] as string;
		const next = source[i + 1];
		if (c === '/' && next === '/' && kind !== 'style') {
			const end = source.indexOf('\n', i);
			const stop = end === -1 ? n : end;
			comments.push({ line: lineOf(i), text: source.slice(i + 2, stop) });
			i = stop;
		} else if (c === '/' && next === '*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end === -1 ? n : end;
			comments.push(...perLine(lineOf(i), source.slice(i + 2, stop)));
			i = stop + 2;
		} else if (c === '"' || (c === "'" && kind !== 'rust')) {
			skipQuoted(c);
			lastSignificant = 'a';
		} else if (c === '`' && kind === 'script') {
			i++;
			scanTemplate();
			lastSignificant = 'a';
		} else if (c === '}' && interpolations.at(-1) === braces - 1) {
			interpolations.pop();
			braces--;
			i++;
			scanTemplate();
			lastSignificant = 'a';
		} else if (
			c === '/' &&
			kind === 'script' &&
			(lastSignificant === '' || BEFORE_EXPRESSION.test(lastSignificant))
		) {
			skipExpression();
			lastSignificant = 'a';
		} else {
			if (c === '{') braces++;
			else if (c === '}') braces--;
			if (!/\s/.test(c)) lastSignificant = c;
			i++;
		}
	}
	return comments;
}

/** YAML, TOML and shell comments: an unquoted `#` that starts a line or follows a space. */
export function hashComments(source: string): Comment[] {
	const comments: Comment[] = [];
	source.split('\n').forEach((line, index) => {
		let quote: string | null = null;
		for (let i = 0; i < line.length; i++) {
			const c = line[i];
			if (quote) {
				if (c === quote) quote = null;
			} else if (c === '"' || c === "'") quote = c;
			else if (c === '#' && (i === 0 || /\s/.test(line[i - 1] as string))) {
				comments.push({ line: index + 1, text: line.slice(i + 1) });
				return;
			}
		}
	});
	return comments;
}

/** The comments of an HTML page: its own, and those of its scripts and styles. */
export function markupComments(source: string): Comment[] {
	const lineOf = lineFinder(source);
	const comments: Comment[] = [];
	for (const match of source.matchAll(/<!--([\s\S]*?)-->/g))
		comments.push(...perLine(lineOf(match.index), match[1] ?? ''));
	for (const [pattern, kind] of [
		[/<script\b[^>]*>([\s\S]*?)<\/script>/g, 'script'],
		[/<style\b[^>]*>([\s\S]*?)<\/style>/g, 'style'],
	] as const) {
		for (const match of source.matchAll(pattern)) {
			const body = match[1] ?? '';
			const offset = lineOf(match.index + match[0].indexOf(body)) - 1;
			for (const comment of cLikeComments(body, kind))
				comments.push({ line: comment.line + offset, text: comment.text });
		}
	}
	return comments.sort((a, b) => a.line - b.line);
}

/** The date in a comment, outside inline code, unless the comment marks it as an outside date. */
export function datedText(text: string): string | undefined {
	if (text.includes(OUTSIDE_DATE)) return undefined;
	return calendarDate(text.replace(/`[^`]*`/g, ''));
}

function listed(patterns: string[]): string[] {
	const result = Bun.spawnSync(['git', 'ls-files', ...patterns], { cwd: ROOT });
	return result.stdout
		.toString()
		.split('\n')
		.filter((file) => file && !VENDORED.test(file));
}

function commentsOf(file: string, source: string): Comment[] {
	if (file.endsWith('.html')) return markupComments(source);
	if (file.endsWith('.css')) return cLikeComments(source, 'style');
	if (/\.(ya?ml|toml|sh)$/.test(file)) return hashComments(source);
	return cLikeComments(source, file.endsWith('.rs') || file.endsWith('.wgsl') ? 'rust' : 'script');
}

describe('comments in code', () => {
	it('state what holds now, with no date, as hard rule 41 says', () => {
		const files = listed([...C_LIKE, ...HASH, ...MARKUP, ...STYLES]);
		expect(files.length).toBeGreaterThan(100);
		const found: string[] = [];
		for (const file of files) {
			const source = readFileSync(join(ROOT, file), 'utf8');
			for (const comment of commentsOf(file, source)) {
				const date = datedText(comment.text);
				if (date) found.push(`${file}:${comment.line} "${date}"`);
			}
		}
		// Write the fact that holds now and its reason, and leave when it happened to git. A date
		// that the reader needs from outside the project carries the words "outside date".
		expect(found).toEqual([]);
	});

	it('reads comments and skips strings, template literals and regular expressions', () => {
		const script = [
			'// On 25 October 2026 the job stalled.',
			"const fixture = 'Plans: checks 2026-10-03';",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the line is a script's source.
			'const table = `| 2026-10-07 | ${size} |`; // the size',
			'const url = "https://example.com/a"; /* Since October 2026 */',
			'const pattern = /"[^"]*"/; // read 4 October 2026',
			'/**',
			' * A run name, such as `checks 2026-10-03`.',
			' * Built on 2026-10-04.',
			' */',
		].join('\n');
		const dated = cLikeComments(script, 'script')
			.filter((c) => datedText(c.text))
			.map((c) => c.line);
		expect(dated).toEqual([1, 4, 5, 8]);
	});

	it('reads Rust, YAML and HTML comments', () => {
		const rust = 'fn f<\'a>(x: &\'a str) {} // Measured on 2026-10-20.\nlet s = "2026-10-20";';
		expect(cLikeComments(rust, 'rust').filter((c) => datedText(c.text))).toHaveLength(1);
		const yaml = [
			'# Raised on 24 October 2026.',
			'run: echo "#1 on 2026-10-01"',
			'key: value # until 2026-10-02',
		].join('\n');
		expect(hashComments(yaml).map((c) => c.line)).toEqual([1, 3]);
		const html = [
			'<!-- Added 4 October 2026 -->',
			'<p>Released 2026-10-01</p>',
			'<style>a { color: red; } /* October 2026 */</style>',
			'<script>const a = "2026-10-01"; // 2026-10-02</script>',
		].join('\n');
		expect(
			markupComments(html)
				.filter((c) => datedText(c.text))
				.map((c) => c.line),
		).toEqual([1, 3, 4]);
	});

	it('lets a marked outside date through', () => {
		expect(datedText(' npm classic tokens end on 2025-12-09, an outside date.')).toBeUndefined();
	});
});

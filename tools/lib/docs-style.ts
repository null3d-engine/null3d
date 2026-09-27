// The machine-checkable half of the writing rules for published Markdown (AGENTS.md, "Writing
// docs"). The humanizer pass is the judgement half; these rules catch what a machine can see.
//
// Severity decides what blocks. An `error` is unambiguous and mechanical, and fails the commit. A
// `warning` is a judgement call (sentence length, vocabulary) and only prints, because a heuristic
// that blocks an unrelated commit ends up weakened to quiet it. Demote a noisy rule to a warning
// rather than adding an exemption.

export type StyleSeverity = 'error' | 'warning';

export interface StyleFinding {
	rule: string;
	severity: StyleSeverity;
	/** 1-based line the finding anchors to. */
	line: number;
	excerpt: string;
	message: string;
}

/** Simplified Technical English allows 20 words; names and code inflate the count a little. */
export const MAX_SENTENCE_WORDS = 25;

const CHATBOT_PHRASES = [
	'i hope this helps',
	'let me know',
	'feel free to',
	'happy to help',
	'great question',
	'certainly!',
	'of course!',
	'as an ai',
	'as of my last',
	'i apologize',
];

const STOCK_WORDS = [
	'delve',
	'tapestry',
	'testament to',
	'pivotal',
	'seamless',
	'seamlessly',
	'leverage',
	'cutting-edge',
	'game-changer',
	'game changer',
	'unlock',
	'empower',
	'elevate',
	'realm',
	'embark',
	'meticulous',
	'vibrant',
	'boasts',
	'underscores',
	'foster',
	'holistic',
	'synergy',
	'paradigm',
	'ever-evolving',
	'at its core',
	'worth noting',
];

const HEDGES = ['generally', 'arguably', 'tends to', 'more or less', 'for the most part'];

/** The maintainers' build plan is private, so published text never points at it. */
const PRIVATE_PLAN = /\bPLAN\.md\b|(^|[\s(`'"])\.dev\/|\bbuild plan\b/i;

export function mentionsPrivatePlan(text: string): boolean {
	return PRIVATE_PLAN.test(text);
}

const EMOJI = /\p{Extended_Pictographic}/u;

/** A sentence ends at . ! or ? before a capital, a digit, a quote, a bracket, or a name spelled in lowercase. */
const SENTENCE_BREAK =
	/(?<=[.!?])\s+(?=[A-Z0-9"(]|sokko3d\b|three\.js\b|npm\b|iOS\b|iPadOS\b|macOS\b)/;

interface Block {
	line: number;
	text: string;
	kind: 'heading' | 'table' | 'prose';
}

/** Removes inline code, HTML tags and link targets, keeping the words a reader sees. */
function visibleText(line: string): string {
	return line
		.replace(/`[^`]*`/g, '')
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\*\*|__/g, '')
		.replace(/\*([^*\s][^*]*?)\*/g, '$1');
}

/**
 * Splits Markdown into headings, table rows and prose paragraphs, skipping front matter, fenced
 * code and HTML comments. A paragraph's line is the line where it starts.
 */
function blocks(md: string): Block[] {
	const lines = md.split('\n');
	const out: Block[] = [];
	let i = 0;
	if (lines[0]?.trim() === '---') {
		const close = lines.findIndex((l, n) => n > 0 && l.trim() === '---');
		if (close > 0) i = close + 1;
	}
	let fence: string | null = null;
	let inComment = false;
	let paragraph: { line: number; parts: string[] } | null = null;
	const flush = () => {
		if (paragraph)
			out.push({ line: paragraph.line, text: paragraph.parts.join(' '), kind: 'prose' });
		paragraph = null;
	};
	for (; i < lines.length; i++) {
		const raw = lines[i] ?? '';
		const trimmed = raw.trim();
		const marker = trimmed.match(/^(```|~~~)/);
		if (fence !== null) {
			if (marker && marker[1] === fence) fence = null;
			continue;
		}
		if (marker) {
			flush();
			fence = marker[1] ?? null;
			continue;
		}
		if (inComment) {
			if (trimmed.includes('-->')) inComment = false;
			continue;
		}
		if (trimmed.startsWith('<!--') && !trimmed.includes('-->')) {
			flush();
			inComment = true;
			continue;
		}
		if (trimmed === '') {
			flush();
			continue;
		}
		if (/^#{1,6}\s/.test(trimmed)) {
			flush();
			out.push({ line: i + 1, text: trimmed.replace(/^#{1,6}\s+/, ''), kind: 'heading' });
			continue;
		}
		if (trimmed.startsWith('|')) {
			flush();
			out.push({ line: i + 1, text: trimmed, kind: 'table' });
			continue;
		}
		if (/^([-*+]|\d+\.)\s/.test(trimmed)) flush();
		if (!paragraph) paragraph = { line: i + 1, parts: [] };
		paragraph.parts.push(trimmed.replace(/^([-*+]|\d+\.|>)\s+/, ''));
	}
	flush();
	return out;
}

const excerptOf = (text: string) => (text.length <= 80 ? text : `${text.slice(0, 77)}...`);

function wordsIn(sentence: string): number {
	return sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Names whose capitals are part of the name, so a heading that contains one is not title case. */
const PROPER_NAMES = ['React Three Fiber', 'Web Audio', 'Simplified Technical English'];

/** True when most longer words after the first are capitalized, as in "Getting Started Guide". */
export function isTitleCase(heading: string): boolean {
	const plain = PROPER_NAMES.reduce((h, name) => h.replaceAll(name, ''), heading);
	const words = plain
		.split(/\s+/)
		.slice(1)
		.filter((w) => /^[A-Za-z]{4,}$/.test(w));
	const capitalized = words.filter((w) => /^[A-Z][a-z]+$/.test(w));
	return capitalized.length >= 2 && capitalized.length / words.length >= 0.6;
}

function findPhrase(text: string, phrases: string[]): string | undefined {
	const lower = text.toLowerCase();
	return phrases.find((p) =>
		new RegExp(`(^|[^\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(
			lower,
		),
	);
}

/** Every style finding in one Markdown file. */
export function checkDocsStyle(md: string): StyleFinding[] {
	const findings: StyleFinding[] = [];
	const add = (
		rule: string,
		severity: StyleSeverity,
		line: number,
		text: string,
		message: string,
	) => findings.push({ rule, severity, line, excerpt: excerptOf(text), message });

	for (const block of blocks(md)) {
		const text = visibleText(block.text);
		const raw = block.text;

		if (text.includes('—') || / – /.test(text)) {
			add(
				'dash',
				'error',
				block.line,
				text,
				'Replace the dash with a comma, a colon, parentheses or a new sentence.',
			);
		}
		if (/[“”‘’]/.test(text)) {
			add('curly_quote', 'error', block.line, text, 'Use straight quotes and apostrophes.');
		}
		const chatbot = findPhrase(text, CHATBOT_PHRASES);
		if (chatbot)
			add(
				'chatbot_phrase',
				'error',
				block.line,
				text,
				`Remove "${chatbot}": the page speaks for itself.`,
			);
		if (mentionsPrivatePlan(raw)) {
			add(
				'private_plan',
				'error',
				block.line,
				raw,
				"Public files never point at the maintainers' private build plan.",
			);
		}

		if (block.kind === 'heading') {
			if (EMOJI.test(text))
				add('heading_emoji', 'error', block.line, text, 'Remove the emoji from the heading.');
			if (isTitleCase(text))
				add('title_case', 'warning', block.line, text, 'Use sentence case in headings.');
			continue;
		}
		if (block.kind === 'table') continue;

		for (const sentence of text.split(SENTENCE_BREAK)) {
			const words = wordsIn(sentence);
			if (words > MAX_SENTENCE_WORDS) {
				add(
					'long_sentence',
					'warning',
					block.line,
					sentence,
					`This sentence has ${words} words; split it (at most ${MAX_SENTENCE_WORDS}).`,
				);
			}
		}
		const stock = findPhrase(text, STOCK_WORDS);
		if (stock)
			add(
				'stock_word',
				'warning',
				block.line,
				text,
				`"${stock}" is a stock phrase; say what you mean plainly.`,
			);
		const hedge = findPhrase(text, HEDGES);
		if (hedge)
			add(
				'hedge',
				'warning',
				block.line,
				text,
				`"${hedge}" weakens the claim; state when it holds, or cut it.`,
			);
		if (
			/\bnot (just|only|merely)\b[^.]*\bbut\b/i.test(text) ||
			/\bisn't\b[^.]*,\s*it's\b/i.test(text)
		) {
			add(
				'not_x_but_y',
				'warning',
				block.line,
				text,
				'State the point directly instead of contrasting it with a claim nobody made.',
			);
		}
	}
	return findings.sort((a, b) => a.line - b.line);
}

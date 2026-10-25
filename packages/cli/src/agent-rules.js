// The rules that a null3D project gives to an AI agent, in one place. The project's hook applies
// them to each command and each edit, and a lint rule reads the same list. A rule either refuses
// the call or flags it: a refusal stops the call, and a flag tells the agent and lets it go on.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * @typedef {object} Rule
 * @property {string} id The rule's name, which a report names.
 * @property {'command' | 'source'} kind What the rule reads: a shell command or the project's source.
 * @property {'refuse' | 'flag'} action What the hook does when the rule fires.
 * @property {string} summary The rule in one sentence.
 */

/** Every rule, in the order that a report lists them. */
export const RULES = /** @type {readonly Rule[]} */ ([
	{
		id: 'no-sleep',
		kind: 'command',
		action: 'refuse',
		summary: 'Do not wait with sleep. Run a check that ends on its own.',
	},
	{
		id: 'no-kill-by-name',
		kind: 'command',
		action: 'refuse',
		summary: 'Stop only a process that you started, by its PID.',
	},
	{
		id: 'no-log-follow',
		kind: 'command',
		action: 'refuse',
		summary: 'Read a log file once instead of following it.',
	},
	{
		id: 'no-planned-api',
		kind: 'source',
		action: 'flag',
		summary: 'Import only names that the installed engine exports.',
	},
	{
		id: 'no-allocation-in-onupdate',
		kind: 'source',
		action: 'flag',
		summary: 'Make no object, array or string inside the frame update.',
	},
	{
		id: 'no-dom-in-sketch',
		kind: 'source',
		action: 'flag',
		summary: 'Keep DOM access out of the sketch, which runs in a worker.',
	},
]);

/**
 * @typedef {object} Finding
 * @property {string} id The rule that the finding reports.
 * @property {string} message What the agent must do instead.
 */

/** The words that end one shell command and start the next. */
const SEPARATORS = /&&|\|\||[;|\n]/;

/** A source line that only mentions a name in a comment is not code. */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** A name inside a plain string is text, so a DOM check ignores it. */
const STRINGS = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

/** The files whose code runs in the sketch worker, where the DOM does not exist. */
const SKETCH_FILE = /(?:^|\/)sketch\.[cm]?[jt]sx?$/;

/** Names that need the page's main thread. */
const DOM_NAMES =
	/\b(?:document|window|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|HTMLCanvasElement|querySelector|getElementById)\b/;

/** The ways that a source file writes the frame update that the sketch calls. */
const ON_UPDATE = [
	/\bonUpdate\s*\([^)]*\)\s*\{/g,
	/\bonUpdate\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g,
];

/** The ways that code makes a new object, array or string inside a frame. */
const ALLOCATIONS = /** @type {const} */ ([
	[/\bnew\s+[A-Za-z_$]/, 'creates an object'],
	[/\.(?:create|clone)\s*\(/, 'creates an object'],
	[/\.(?:map|filter|flatMap|slice|concat|join)\s*\(/, 'copies an array'],
	[/\bArray\.from\s*\(/, 'builds an array'],
	[/(?:=|\breturn|\(|,)\s*\[/, 'builds an array'],
	[/(?:=|\breturn|\(|,)\s*\{/, 'builds an object'],
	[/`/, 'builds a string'],
]);

/** The named imports that the engine's own package can satisfy. */
const ENGINE_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@null3d\/engine['"]/g;

/** The most declaration text that a check reads, so a huge package cannot slow every edit. */
const DECLARATION_LIMIT = 8_000_000;

const MESSAGES = {
	waiting:
		"null3D agent hook: do not wait with sleep. Run a check that ends on its own, such as `bunx @null3d/cli test`, or use the tool's own time limit.",
	stop: 'null3D agent hook: do not stop a process by name. Stop only a process that you started, by its PID.',
	follow:
		'null3D agent hook: do not follow a log. Read the file once, for example `tail -n 200 <file>`.',
};

/**
 * The words of one shell segment, without the wrappers and settings before the command, such as
 * `FOO=1`, `sudo` and `timeout 30`.
 *
 * @param {string} segment
 * @returns {string[]}
 */
function commandWords(segment) {
	const quoted = segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
	const words = quoted.map((word) => word.replace(/^["']|["']$/g, ''));
	let i = 0;
	while (i < words.length) {
		const word = words[i] ?? '';
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word === 'command' || word === 'nohup') {
			i += 1;
			continue;
		}
		if (word === 'sudo' || word === 'env' || word === 'exec') {
			i += 1;
			while (i < words.length && (words[i] ?? '').startsWith('-')) {
				const option = words[i] ?? '';
				i += 1;
				if (option === '-u' || option === '-g' || option === '-p' || option === '-a') i += 1;
			}
			continue;
		}
		if (word === 'timeout' || word === 'gtimeout') {
			i += 1;
			while (i < words.length && !/^\d/.test(words[i] ?? '')) i += 1;
			if (i < words.length) i += 1;
			continue;
		}
		break;
	}
	return words.slice(i);
}

/**
 * True when `args` ask a program to wait for new output.
 *
 * @param {readonly string[]} args
 */
function followsOutput(args) {
	return args.some((arg) => arg.startsWith('--follow') || /^-[A-Za-z]*[fF][A-Za-z]*$/.test(arg));
}

/**
 * True when the command shows a log and stays on it.
 *
 * @param {string} name
 * @param {readonly string[]} args
 */
function followsLog(name, args) {
	if (name === 'tail' || name === 'journalctl') return followsOutput(args);
	if (name === 'less' || name === 'more') return args.some((arg) => arg === '+F');
	if (name === 'docker' || name === 'podman' || name === 'kubectl')
		return args.includes('logs') && followsOutput(args);
	return false;
}

/**
 * The rule that a shell command breaks, or null when it breaks none.
 *
 * @param {string} command
 * @returns {Finding | null}
 */
export function refusedCommand(command) {
	for (const segment of command.split(SEPARATORS)) {
		const words = commandWords(segment);
		const name = words[0] ?? '';
		const args = words.slice(1);
		if (name === 'sleep') return { id: 'no-sleep', message: MESSAGES.waiting };
		if (name === 'pkill' || name === 'killall')
			return { id: 'no-kill-by-name', message: MESSAGES.stop };
		if (name === 'kill') {
			const targets = args.filter((arg) => !arg.startsWith('-'));
			if (targets.length === 0 || targets.some((target) => !/^\d+$/.test(target)))
				return { id: 'no-kill-by-name', message: MESSAGES.stop };
		}
		if (followsLog(name, args)) return { id: 'no-log-follow', message: MESSAGES.follow };
	}
	return null;
}

/**
 * `text` with each match of `pattern` replaced by spaces, so offsets and line numbers still match.
 *
 * @param {string} text
 * @param {RegExp} pattern
 */
function blank(text, pattern) {
	return text.replace(pattern, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * The line number of `index` in `text`, counting from 1.
 *
 * @param {string} text
 * @param {number} index
 */
function lineAt(text, index) {
	let line = 1;
	for (let i = 0; i < index; i++) if (text[i] === '\n') line += 1;
	return line;
}

/**
 * The body of the block whose opening brace is at `open`, and the index where it ends.
 *
 * @param {string} text
 * @param {number} open
 * @returns {{ start: number, end: number }}
 */
function blockAt(text, open) {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '{') depth += 1;
		else if (text[i] === '}') {
			depth -= 1;
			if (depth === 0) return { start: open + 1, end: i };
		}
	}
	return { start: open + 1, end: text.length };
}

/**
 * The first allocation in a frame update, as the finding that names it, or null.
 *
 * @param {string} file
 * @param {string} text Source text whose comments and strings are blank.
 * @returns {Finding | null}
 */
function allocationFinding(file, text) {
	for (const pattern of ON_UPDATE) {
		pattern.lastIndex = 0;
		for (const match of text.matchAll(pattern)) {
			const open = (match.index ?? 0) + match[0].lastIndexOf('{');
			const body = blockAt(text, open);
			const bodyText = text.slice(body.start, body.end);
			let first = null;
			for (const [allocates, effect] of ALLOCATIONS) {
				const found = allocates.exec(bodyText);
				const index = found?.index ?? -1;
				if (index >= 0 && (first === null || index < first.index)) first = { index, effect };
			}
			if (first) {
				const line = lineAt(text, body.start + first.index);
				return {
					id: 'no-allocation-in-onupdate',
					message: `null3D agent hook: ${file}:${line} ${first.effect} in onUpdate, which runs every frame. Make it once outside onUpdate and reuse it.`,
				};
			}
		}
	}
	return null;
}

/**
 * The first import of a name that the installed engine does not export, as the finding that names
 * it, or null. The docs mark an API that does not exist with `status: planned`.
 *
 * @param {string} file
 * @param {string} text Source text whose comments are blank.
 * @param {string} declarations
 * @returns {Finding | null}
 */
function plannedApiFinding(file, text, declarations) {
	if (declarations === '') return null;
	for (const match of text.matchAll(ENGINE_IMPORT)) {
		for (const part of (match[1] ?? '').split(',')) {
			const name = part
				.trim()
				.replace(/^type\s+/, '')
				.split(/\s+as\s+/)[0]
				?.trim();
			if (!name) continue;
			const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			if (!new RegExp(`\\b${escaped}\\b`).test(declarations)) {
				const line = lineAt(text, match.index ?? 0);
				return {
					id: 'no-planned-api',
					message: `null3D agent hook: ${file}:${line} imports ${name}, which the installed @null3d/engine does not export. A planned API does not exist in this version. Read its docs page and use the workaround that the page gives.`,
				};
			}
		}
	}
	return null;
}

/**
 * The rule that an edit of a file breaks, or null when it breaks none.
 *
 * @param {string} file The path of the file that the edit writes.
 * @param {string} source The whole text of the file after the edit.
 * @param {{ declarations?: string }} [context] The exports of the installed engine.
 * @returns {Finding | null}
 */
export function refusedSource(file, source, { declarations = '' } = {}) {
	const named = blank(source, COMMENTS);
	const planned = plannedApiFinding(file, named, declarations);
	if (planned) return planned;
	const code = blank(named, STRINGS);
	if (SKETCH_FILE.test(file)) {
		const dom = DOM_NAMES.exec(code);
		if (dom) {
			const line = lineAt(code, dom.index);
			return {
				id: 'no-dom-in-sketch',
				message: `null3D agent hook: ${file}:${line} uses ${dom[0]} in the sketch. The sketch runs in a worker and has no DOM: keep HTML in page.ts and send messages between the two. A sketch on the main thread may use the DOM, but it shares the page thread.`,
			};
		}
	}
	return allocationFinding(file, code);
}

/**
 * The text of every declaration file that the engine in `root` installs, or an empty string when
 * the project has no installed engine.
 *
 * @param {string} root The project's folder.
 * @returns {string}
 */
export function engineDeclarations(root) {
	const manifest = join(root, 'node_modules', '@null3d', 'engine', 'package.json');
	if (!existsSync(manifest)) return '';
	let types = '';
	try {
		const manifestText = readFileSync(manifest, 'utf8');
		const parsed = /** @type {{ exports?: Record<string, { types?: string }>, types?: string }} */ (
			JSON.parse(manifestText)
		);
		types = parsed.exports?.['.']?.types ?? parsed.types ?? '';
	} catch {
		return '';
	}
	if (!types) return '';
	const entry = resolve(dirname(manifest), types);
	if (!existsSync(entry)) return '';
	let text = '';
	const seen = new Set();
	/** @param {string} file */
	const read = (file) => {
		if (seen.has(file) || !existsSync(file) || text.length > DECLARATION_LIMIT) return;
		seen.add(file);
		text += readFileSync(file, 'utf8');
	};
	read(entry);
	const folder = dirname(entry);
	try {
		for (const name of readdirSync(folder, { recursive: true })) {
			if (typeof name === 'string' && name.endsWith('.d.ts')) read(join(folder, name));
		}
	} catch {
		// A package whose declarations a bundler keeps elsewhere still answers for its entry file.
	}
	return text;
}

/**
 * The rule that `finding` reports, or undefined when no rule has its id.
 *
 * @param {string} id
 * @returns {Rule | undefined}
 */
export function ruleFor(id) {
	return RULES.find((rule) => rule.id === id);
}

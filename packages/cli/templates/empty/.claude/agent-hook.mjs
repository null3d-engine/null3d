#!/usr/bin/env node
// The agent hook of a null3D project. Claude Code and Codex run it before a shell command and
// before a file edit, with the call as JSON on stdin: Claude Code names the tools Bash, Edit, Write
// and MultiEdit, and Codex names them Bash and apply_patch, whose call holds the patch text. It
// exits 2 to refuse the call, and prints the reason on stderr. It exits 0 to allow the call, and
// when it cannot read the call, so its own fault never stops work.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The words that end one shell command and start the next. */
const SEPARATORS = /&&|\|\||[;|\n]/;

/** A source line that only mentions a name in a comment is not code. */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** The files whose code runs in the sketch worker, where the DOM does not exist. */
const SKETCH_FILE = /(?:^|\/)sketch\.[cm]?[jt]sx?$/;

/** Names that need the page's main thread. */
const DOM_NAMES =
	/\b(?:document|window|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|HTMLCanvasElement|querySelector|getElementById)\b/;

/** The method that runs once per frame. */
const ON_UPDATE = /\bonUpdate\s*\([^)]*\)\s*\{/g;

/** The ways that code makes a new object, array or string inside a frame. */
const ALLOCATIONS = [
	[/\bnew\s+[A-Za-z_$]/, 'creates an object'],
	[/\.(?:create|clone)\s*\(/, 'creates an object'],
	[/\.(?:map|filter|flatMap|slice|concat|join)\s*\(/, 'copies an array'],
	[/\bArray\.from\s*\(/, 'builds an array'],
	[/(?:=|\breturn|\(|,)\s*\[/, 'builds an array'],
	[/(?:=|\breturn|\(|,)\s*\{/, 'builds an object'],
	[/`/, 'builds a string'],
];

/** The named imports that the engine's own package can satisfy. */
const ENGINE_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@null3d\/engine['"]/g;

/** The most declaration text that the hook reads, so a huge package cannot slow every edit. */
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
 * @returns {string | null}
 */
export function refusedCommand(command) {
	for (const segment of command.split(SEPARATORS)) {
		const words = commandWords(segment);
		const name = words[0] ?? '';
		const args = words.slice(1);
		if (name === 'sleep') return MESSAGES.waiting;
		if (name === 'pkill' || name === 'killall') return MESSAGES.stop;
		if (name === 'kill') {
			const targets = args.filter((arg) => !arg.startsWith('-'));
			if (targets.length === 0 || targets.some((target) => !/^\d+$/.test(target)))
				return MESSAGES.stop;
		}
		if (followsLog(name, args)) return MESSAGES.follow;
	}
	return null;
}

/**
 * `text` with every comment replaced by spaces, so offsets and line numbers still match.
 *
 * @param {string} text
 */
function blankComments(text) {
	return text.replace(COMMENTS, (comment) => comment.replace(/[^\n]/g, ' '));
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
 * The first allocation in an `onUpdate` body, as the message that names it, or null.
 *
 * @param {string} file
 * @param {string} text
 * @returns {string | null}
 */
function refusedAllocation(file, text) {
	for (const match of text.matchAll(ON_UPDATE)) {
		const open = (match.index ?? 0) + match[0].lastIndexOf('{');
		const body = blockAt(text, open);
		const bodyText = text.slice(body.start, body.end);
		let first = null;
		for (const [pattern, effect] of ALLOCATIONS) {
			const found = /** @type {RegExp} */ (pattern).exec(bodyText);
			const index = found?.index ?? -1;
			if (index >= 0 && (first === null || index < first.index)) first = { index, effect };
		}
		if (first) {
			const line = lineAt(text, body.start + first.index);
			return `null3D agent hook: ${file}:${line} ${first.effect} in onUpdate, which runs every frame. Make it once outside onUpdate and reuse it.`;
		}
	}
	return null;
}

/**
 * The first import of a name that the installed engine does not export, as the message that names
 * it, or null. The docs mark an API that does not exist with `status: planned`.
 *
 * @param {string} file
 * @param {string} text
 * @param {string} declarations
 * @returns {string | null}
 */
function refusedImport(file, text, declarations) {
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
				return `null3D agent hook: ${file}:${line} imports ${name}, which the installed @null3d/engine does not export. A planned API does not exist in this version; read its docs page and use the workaround the page gives.`;
			}
		}
	}
	return null;
}

/**
 * The rule that a file edit breaks, or null when it breaks none.
 *
 * @param {string} file The path of the file that the edit writes.
 * @param {string} source The text that the edit writes.
 * @param {{ declarations?: string }} [context] The exports of the installed engine.
 * @returns {string | null}
 */
export function refusedSource(file, source, { declarations = '' } = {}) {
	const text = blankComments(source);
	const imported = refusedImport(file, text, declarations);
	if (imported) return imported;
	if (SKETCH_FILE.test(file)) {
		const dom = DOM_NAMES.exec(text);
		if (dom) {
			const line = lineAt(text, dom.index);
			return `null3D agent hook: ${file}:${line} uses ${dom[0]} in the sketch. The sketch runs in a worker and has no DOM: keep HTML in page.ts and send messages between the two. A sketch on the main thread may use the DOM, but it shares the page thread.`;
		}
	}
	return refusedAllocation(file, text);
}

/** The header of a file that a patch adds or updates, and the path after it. */
const PATCH_FILE = /^\*\*\* (?:Add|Update) File: (.+?)\s*$/;
/** The header that moves a patched file to a new path. */
const PATCH_MOVE = /^\*\*\* Move to: (.+?)\s*$/;

/**
 * The rule that a Codex patch breaks, or null when it breaks none. A patch carries each file's new
 * lines after a header, so the rules read those lines as the edit that they write.
 *
 * @param {string} patch The patch text of the call.
 * @param {{ declarations?: string }} [context] The exports of the installed engine.
 * @returns {string | null}
 */
export function refusedPatch(patch, { declarations = '' } = {}) {
	/** @type {string | null} */
	let file = null;
	/** @type {string[]} */
	let lines = [];
	const check = () =>
		file === null ? null : refusedSource(file, lines.join('\n'), { declarations });
	for (const line of patch.split('\n')) {
		const header = PATCH_FILE.exec(line);
		if (header) {
			const refused = check();
			if (refused) return refused;
			file = header[1] ?? null;
			lines = [];
			continue;
		}
		if (line.startsWith('*** ')) {
			const refused = check();
			if (refused) return refused;
			const move = PATCH_MOVE.exec(line);
			file = move ? (move[1] ?? null) : null;
			lines = [];
			continue;
		}
		if (file !== null && line.startsWith('+')) lines.push(line.slice(1));
	}
	return check();
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

/** The event and the call that Claude Code gives the hook, as the rule that it breaks. */
async function main() {
	const event = process.argv[2] ?? '';
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	let call;
	try {
		call = /** @type {{ tool_name?: string, tool_input?: Record<string, unknown> }} */ (
			JSON.parse(input)
		);
	} catch {
		return 0;
	}
	const tool = call.tool_name ?? '';
	const args = call.tool_input ?? {};
	let refused = null;
	if (event === 'bash' || tool === 'Bash') {
		refused = refusedCommand(String(args.command ?? ''));
	} else if (tool === 'apply_patch') {
		// Codex writes a file edit as a patch, with every file of it in the call's one command.
		const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
		refused = refusedPatch(String(args.command ?? args.patch ?? ''), {
			declarations: engineDeclarations(root),
		});
	} else if (event === 'edit' || /^(?:Edit|Write|MultiEdit)$/.test(tool)) {
		const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
		refused = refusedSource(
			String(args.file_path ?? args.path ?? ''),
			String(args.content ?? args.new_string ?? ''),
			{ declarations: engineDeclarations(root) },
		);
	}
	if (refused) {
		console.error(refused);
		return 2;
	}
	return 0;
}

/** The real path of a file, so a path through a link names the file that it reaches. */
function realPath(file) {
	try {
		return realpathSync(file);
	} catch {
		return resolve(file);
	}
}

// The hook runs only when a host starts this file, and not when a test imports it. Both paths
// resolve to their real names, because a temporary folder or a home folder can be a link.
if (process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url))) {
	process.exitCode = await main();
}

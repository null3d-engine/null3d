#!/usr/bin/env node
// The agent hook of a null3D project. Claude Code and Codex run it before a command and before a
// file edit, with the call as JSON on stdin. A rule that refuses ends the call with exit code 2 and
// the reason on stderr. A rule that flags prints context for the agent and lets the call go on. A
// call that the hook cannot read is allowed, so its own fault never stops work.
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The module that holds every rule, so this file and other null3D tools share one definition. */
const RULES_PACKAGE = '@null3d/cli/agent-rules';

/**
 * The rules module that the project's installed command-line tool holds, or null when the project
 * has not run `bun install` yet.
 *
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function loadRules() {
	try {
		return /** @type {Record<string, unknown>} */ (await import(RULES_PACKAGE));
	} catch {
		process.stderr.write(
			'null3D agent hook: the project has no installed @null3d/cli, so its rules cannot run. Run bun install in the project.\n',
		);
		return null;
	}
}

/**
 * The project's folder.
 *
 * @param {{ cwd?: unknown }} call
 * @returns {string}
 */
function projectRoot(call) {
	const fromEnv = process.env.CLAUDE_PROJECT_DIR;
	if (fromEnv) return fromEnv;
	if (typeof call.cwd === 'string' && call.cwd !== '') return call.cwd;
	return process.cwd();
}

/**
 * The text of a file in the project, or null when it does not exist.
 *
 * @param {string} root
 * @param {string} path
 * @returns {string | null}
 */
function fileText(root, path) {
	const full = isAbsolute(path) ? path : resolve(root, path);
	try {
		return readFileSync(full, 'utf8');
	} catch {
		return null;
	}
}

/**
 * `base` with one replacement applied, or null when the text that it replaces is absent.
 *
 * @param {string | null} base
 * @param {Record<string, unknown>} edit
 * @returns {string | null}
 */
function applyEdit(base, edit) {
	if (base === null) return null;
	const oldText = typeof edit.old_string === 'string' ? edit.old_string : '';
	const newText = typeof edit.new_string === 'string' ? edit.new_string : '';
	if (oldText === '') return newText + base;
	if (!base.includes(oldText)) return null;
	return edit.replace_all === true
		? base.split(oldText).join(newText)
		: base.replace(oldText, () => newText);
}

/**
 * The text that a file edit leaves behind, as the path and the whole text.
 *
 * @param {Record<string, unknown>} args The tool's arguments.
 * @param {string} root
 * @returns {{ path: string, text: string } | null}
 */
function editedFile(args, root) {
	const path = String(args.file_path ?? args.path ?? '');
	if (path === '') return null;
	if (typeof args.content === 'string') return { path, text: args.content };
	const base = fileText(root, path);
	const edits = Array.isArray(args.edits) ? args.edits : null;
	if (edits) {
		let text = base;
		for (const edit of edits) {
			text = applyEdit(text, /** @type {Record<string, unknown>} */ (edit));
		}
		if (text !== null) return { path, text };
	} else if (typeof args.new_string === 'string') {
		const text = applyEdit(base, args);
		if (text !== null) return { path, text };
	}
	return { path, text: typeof args.new_string === 'string' ? args.new_string : '' };
}

/**
 * The index of `needle` in `lines` at or after `from`, or -1 when it is absent.
 *
 * @param {readonly string[]} lines
 * @param {readonly string[]} needle
 * @param {number} from
 */
function findLines(lines, needle, from) {
	if (needle.length === 0) return from;
	for (let i = from; i + needle.length <= lines.length; i++) {
		let found = true;
		for (let j = 0; j < needle.length; j++) {
			if (lines[i + j] !== needle[j]) {
				found = false;
				break;
			}
		}
		if (found) return i;
	}
	return -1;
}

/**
 * `base` with every hunk applied, or null when one hunk does not fit.
 *
 * @param {string} base
 * @param {{ lines: { tag: string, text: string }[] }[]} hunks
 * @returns {string | null}
 */
function applyHunks(base, hunks) {
	let lines = base.split('\n');
	let from = 0;
	for (const hunk of hunks) {
		const before = [];
		const after = [];
		for (const line of hunk.lines) {
			if (line.tag === ' ' || line.tag === '-') before.push(line.text);
			if (line.tag === ' ' || line.tag === '+') after.push(line.text);
		}
		const at = findLines(lines, before, from);
		if (at < 0) return null;
		lines = lines.slice(0, at).concat(after, lines.slice(at + before.length));
		from = at + after.length;
	}
	return lines.join('\n');
}

/**
 * The files that a Codex patch writes, each with the whole text that the patch leaves behind.
 *
 * The patch is applied to the file on disk, so a rule sees the file as it will be. When the patch
 * does not fit the file, the check reads the lines that its hunks carry, and their numbers count
 * from the start of those lines.
 *
 * @param {string} patch
 * @param {(path: string) => string | null} read
 * @returns {{ path: string, text: string }[]}
 */
export function patchedFiles(patch, read) {
	/** @type {{ path: string, kind: string, hunks: { lines: { tag: string, text: string }[] }[], added: string[] }[]} */
	const files = [];
	/** @type {(typeof files)[number] | null} */
	let file = null;
	/** @type {{ lines: { tag: string, text: string }[] } | null} */
	let hunk = null;
	const endHunk = () => {
		if (file && hunk) file.hunks.push(hunk);
		hunk = null;
	};
	const endFile = () => {
		endHunk();
		if (file) files.push(file);
		file = null;
	};
	/** @param {string} path @param {string} kind */
	const start = (path, kind) => {
		endFile();
		file = { path, kind, hunks: [], added: [] };
	};
	for (const line of patch.split('\n')) {
		if (line.startsWith('*** Begin Patch')) continue;
		if (line.startsWith('*** End Patch')) {
			endFile();
			continue;
		}
		if (line.startsWith('*** Add File: ')) {
			start(line.slice('*** Add File: '.length).trim(), 'add');
			continue;
		}
		if (line.startsWith('*** Update File: ')) {
			start(line.slice('*** Update File: '.length).trim(), 'update');
			continue;
		}
		if (line.startsWith('*** Delete File: ')) {
			start(line.slice('*** Delete File: '.length).trim(), 'delete');
			continue;
		}
		if (line.startsWith('*** Move to: ')) {
			if (file) file.path = line.slice('*** Move to: '.length).trim();
			continue;
		}
		if (!file || file.kind === 'delete') continue;
		if (line.startsWith('@@')) {
			endHunk();
			hunk = { lines: [] };
			continue;
		}
		const active = file;
		const tag = line.charAt(0);
		const text = line.slice(1);
		if (tag === '+') {
			if (active.kind === 'add') active.added.push(text);
			else if (hunk) hunk.lines.push({ tag, text });
			else active.added.push(text);
		} else if (tag === '-' || tag === ' ') {
			if (hunk) hunk.lines.push({ tag, text });
		} else if (line === '' && hunk) {
			hunk.lines.push({ tag: ' ', text: '' });
		}
	}
	endFile();
	return files
		.filter((entry) => entry.kind !== 'delete')
		.map((entry) => {
			const added = entry.added.join('\n');
			if (entry.kind === 'add') return { path: entry.path, text: added };
			const base = read(entry.path);
			const applied = base === null ? null : applyHunks(base, entry.hunks);
			if (applied !== null) return { path: entry.path, text: applied };
			// A hunk that does not fit the file still carries the lines around its addition, which
			// tell a rule that the addition sits inside the frame update.
			const nearby = entry.hunks
				.flatMap((h) => h.lines.filter((line) => line.tag !== '-').map((line) => line.text))
				.join('\n');
			return { path: entry.path, text: nearby === '' ? added : nearby };
		});
}

/**
 * Tells the agent about a finding, and refuses the call when its rule refuses.
 *
 * @param {Record<string, unknown>} rules
 * @param {{ id: string, message: string } | null} finding
 * @returns {number} The exit code.
 */
function report(rules, finding) {
	if (!finding) return 0;
	const ruleFor = /** @type {(id: string) => { action?: string } | undefined} */ (rules.ruleFor);
	if (ruleFor(finding.id)?.action === 'flag') {
		process.stdout.write(
			`${JSON.stringify({
				hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: finding.message },
			})}\n`,
		);
		return 0;
	}
	process.stderr.write(`${finding.message}\n`);
	return 2;
}

/** Reads the event and the call that the agent gives the hook, and applies the rules. */
async function main() {
	const mode = process.argv[2] ?? '';
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	/** @type {{ tool_name?: unknown, cwd?: unknown, tool_input?: unknown }} */
	let call;
	try {
		call = JSON.parse(input);
	} catch {
		return 0;
	}
	if (call === null || typeof call !== 'object') return 0;
	const rules = await loadRules();
	if (!rules) return 0;
	const tool = String(call.tool_name ?? '');
	const args = /** @type {Record<string, unknown>} */ (
		call.tool_input !== null && typeof call.tool_input === 'object' ? call.tool_input : {}
	);
	const kind = mode === 'bash' || mode === 'edit' ? mode : tool === 'Bash' ? 'bash' : 'edit';
	const refusedCommand =
		/** @type {(command: string) => { id: string, message: string } | null} */ (
			rules.refusedCommand
		);
	if (kind === 'bash') return report(rules, refusedCommand(String(args.command ?? '')));
	const root = projectRoot(call);
	const patch = tool === 'apply_patch' ? String(args.command ?? '') : '';
	/** @type {{ path: string, text: string }[]} */
	let files = [];
	if (patch) files = patchedFiles(patch, (path) => fileText(root, path));
	else {
		const edited = editedFile(args, root);
		if (edited) files = [edited];
	}
	const engineDeclarations = /** @type {(root: string) => string} */ (rules.engineDeclarations);
	const refusedSource =
		/** @type {(file: string, source: string, context: { declarations: string }) => { id: string, message: string } | null} */ (
			rules.refusedSource
		);
	const namesEngine = files.some((file) => file.text.includes('@null3d/engine'));
	const declarations = namesEngine ? engineDeclarations(root) : '';
	for (const file of files) {
		const finding = refusedSource(file.path, file.text, { declarations });
		if (finding) return report(rules, finding);
	}
	return 0;
}

/**
 * True when an agent runs this file, rather than a test or another module importing it.
 *
 * The paths go through their real names, because a project under a symbolic link, such as the
 * Mac's temporary folder, otherwise reads as a different file.
 */
function isEntryPoint() {
	try {
		return (
			realpathSync(resolve(process.argv[1] ?? '')) === realpathSync(fileURLToPath(import.meta.url))
		);
	} catch {
		return false;
	}
}

if (isEntryPoint()) process.exitCode = await main();

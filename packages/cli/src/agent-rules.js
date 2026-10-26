// The rules that a null3D project gives to an AI agent, in one place. The project's hook applies
// them to each command and each edit, and a lint rule can read the same list when one is built. A
// rule either refuses the call or flags it: a refusal stops the call, and a flag tells the agent and
// lets it go on.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

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

/** The words of the fixed messages, which a check can look for in a copy of the rules. */
const WAITING =
	"null3D agent hook: do not wait with sleep. Run a check that ends on its own, such as `bunx @null3d/cli test`, or use the tool's own time limit.";
const STOPPING =
	'null3D agent hook: do not stop a process by name. Stop only a process that you started, by its PID.';
const FOLLOWING =
	'null3D agent hook: do not follow a log. Read the file once, for example `tail -n 200 <file>`.';
const ALLOCATION_TAIL =
	'in onUpdate, which runs every frame. Make it once outside onUpdate and reuse it.';
const PLANNED_TAIL =
	'which the installed @null3d/engine does not export. A planned API does not exist in this version. Read its docs page and use the workaround that the page gives.';
const DOM_TAIL =
	'in the sketch. The sketch runs in a worker and has no DOM: keep HTML in page.ts and send messages between the two. A sketch on the main thread may use the DOM, but it shares the page thread.';

/** Every fixed phrase of a message, so a test can prove that a hook holds no rule of its own. */
export const MESSAGE_PHRASES = /** @type {readonly string[]} */ ([
	WAITING,
	STOPPING,
	FOLLOWING,
	ALLOCATION_TAIL,
	PLANNED_TAIL,
	DOM_TAIL,
]);

/** The shells whose `-c` argument holds a command that the rules must read too. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

/** The options of a wrapper command that take the word after them as their value. */
const WRAPPER_VALUES = /** @type {Readonly<Record<string, ReadonlySet<string>>>} */ ({
	sudo: new Set(['-u', '-g', '-p', '-a', '-C', '-D', '-r', '-t', '-U']),
	env: new Set(['-u', '-C', '-S', '--unset', '--chdir']),
	xargs: new Set(['-n', '-I', '-P', '-L', '-s', '-d', '-E', '-a', '-e']),
	timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
	nice: new Set(['-n']),
});

/** The wrapper commands that run the command after them, and their own options' shape. */
const WRAPPERS = new Set([
	'sudo',
	'env',
	'xargs',
	'command',
	'nohup',
	'exec',
	'builtin',
	'time',
	'timeout',
	'gtimeout',
	'nice',
]);

/** The shell words that open or close a command list rather than run a program. */
const LIST_WORDS = new Set([
	'do',
	'done',
	'then',
	'else',
	'elif',
	'fi',
	'if',
	'while',
	'until',
	'for',
	'case',
	'esac',
	'in',
	'!',
	'{',
	'}',
]);

/** The files whose code runs in the sketch worker, where the DOM does not exist. */
const SKETCH_FILE = /(?:^|\/)sketch\.[cm]?[jt]sx?$/;

/** Names that need the page's main thread. */
const DOM_NAMES =
	/\b(?:document|window|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|HTMLCanvasElement|querySelector|getElementById)\b/;

/** The ways that a source file writes the frame update that the sketch calls. */
const ON_UPDATE = [
	/\bonUpdate\s*\([^)]*\)\s*\{/g,
	/\bonUpdate\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g,
	/\bonUpdate\s*[:=]\s*(?:async\s+)?function\b[^(]*\([^)]*\)\s*\{/g,
];

/** A frame update that names a function made elsewhere, or the shorthand property. */
const ON_UPDATE_NAME = [
	/\bonUpdate\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,};]|$)/g,
	/\{\s*onUpdate\s*[,}]/g,
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

/**
 * The index after the quoted text that starts at `start`, honoring a backslash in double quotes and
 * the substitutions that a double-quoted string runs.
 *
 * @param {string} text
 * @param {number} start The index of the opening quote.
 * @returns {number}
 */
function readQuoted(text, start) {
	const quote = text[start];
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '\\' && quote === '"') {
			i += 2;
			continue;
		}
		if (ch === quote) return i + 1;
		if (quote === '"' && ch === '$' && text[i + 1] === '(') {
			i = readSubstitution(text, i);
			continue;
		}
		if (quote === '"' && ch === '`') {
			i = readBacktick(text, i);
			continue;
		}
		i += 1;
	}
	return text.length;
}

/**
 * The index after the backtick that closes the one at `start`.
 *
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function readBacktick(text, start) {
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (ch === '`') return i + 1;
		i += 1;
	}
	return text.length;
}

/**
 * The index after the `)` that closes the `$(` at `start`.
 *
 * @param {string} text
 * @param {number} start The index of the `$`.
 * @returns {number}
 */
function readSubstitution(text, start) {
	let depth = 0;
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "'" || ch === '"') {
			i = readQuoted(text, i);
			continue;
		}
		if (ch === '`') {
			i = readBacktick(text, i);
			continue;
		}
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (ch === '(') depth += 1;
		else if (ch === ')') {
			depth -= 1;
			if (depth === 0) return i + 1;
		}
		i += 1;
	}
	return text.length;
}

/**
 * The bodies of the command substitutions in `text`, which run what they hold.
 *
 * @param {string} text
 * @returns {string[]}
 */
function substitutionsIn(text) {
	/** @type {string[]} */
	const bodies = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i] ?? '';
		if (ch === '\\') {
			i += 2;
			continue;
		}
		if (ch === '$' && text[i + 1] === '(') {
			const end = readSubstitution(text, i);
			bodies.push(text.slice(i + 2, Math.max(i + 2, end - 1)));
			i = end;
			continue;
		}
		if (ch === '`') {
			const end = readBacktick(text, i);
			bodies.push(text.slice(i + 1, Math.max(i + 1, end - 1)));
			i = end;
			continue;
		}
		i += 1;
	}
	return bodies;
}

/**
 * One shell word from `start`, with its quotes removed, its substitutions kept whole, and the
 * commands that those substitutions run. A single-quoted run is data, so it runs none.
 *
 * @param {string} command
 * @param {number} start
 * @returns {{ text: string, end: number, substitutions: string[] }}
 */
function readShellWord(command, start) {
	let text = '';
	/** @type {string[]} */
	const substitutions = [];
	let i = start;
	while (i < command.length) {
		const ch = command[i] ?? '';
		if (ch === '' || ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') break;
		if (ch === ';' || ch === '&' || ch === '|') break;
		if (ch === "'" || ch === '"') {
			const end = readQuoted(command, i);
			const inner = command.slice(i + 1, Math.max(i + 1, end - 1));
			text += inner;
			if (ch === '"') substitutions.push(...substitutionsIn(inner));
			i = end;
			continue;
		}
		if (ch === '$' && command[i + 1] === '(') {
			const end = readSubstitution(command, i);
			substitutions.push(command.slice(i + 2, Math.max(i + 2, end - 1)));
			text += command.slice(i, end);
			i = end;
			continue;
		}
		if (ch === '`') {
			const end = readBacktick(command, i);
			substitutions.push(command.slice(i + 1, Math.max(i + 1, end - 1)));
			text += command.slice(i, end);
			i = end;
			continue;
		}
		if (ch === '\\' && i + 1 < command.length) {
			text += command[i + 1] ?? '';
			i += 2;
			continue;
		}
		text += ch;
		i += 1;
	}
	return { text, end: i, substitutions };
}

/**
 * The heredoc that starts with the `<<` at `start`, as its delimiter and whether it strips tabs.
 *
 * @param {string} command
 * @param {number} start
 * @returns {{ delimiter: string, stripTabs: boolean, end: number } | null}
 */
function readHeredocHeader(command, start) {
	let i = start + 2;
	let stripTabs = false;
	if (command[i] === '-') {
		stripTabs = true;
		i += 1;
	}
	while (command[i] === ' ' || command[i] === '\t') i += 1;
	let delimiter = '';
	while (i < command.length) {
		const ch = command[i] ?? '';
		if (ch === '' || /[\s;&|<>]/.test(ch)) break;
		if (ch === "'" || ch === '"') {
			const end = readQuoted(command, i);
			delimiter += command.slice(i + 1, Math.max(i + 1, end - 1));
			i = end;
			continue;
		}
		if (ch === '\\') {
			delimiter += command[i + 1] ?? '';
			i += 2;
			continue;
		}
		delimiter += ch;
		i += 1;
	}
	return delimiter === '' ? null : { delimiter, stripTabs, end: i };
}

/**
 * The bodies of the heredocs that wait from the line at `start`, and the index after them.
 *
 * @param {string} command
 * @param {number} start
 * @param {readonly { delimiter: string, stripTabs: boolean }[]} pending
 * @returns {{ end: number, bodies: string[] }}
 */
function skipHeredocs(command, start, pending) {
	const bodies = [];
	let i = start;
	for (const { delimiter, stripTabs } of pending) {
		const lines = [];
		while (i < command.length) {
			const end = command.indexOf('\n', i);
			const stop = end < 0 ? command.length : end;
			let line = command.slice(i, stop);
			if (stripTabs) line = line.replace(/^\t+/, '');
			i = end < 0 ? command.length : end + 1;
			if (line === delimiter) break;
			lines.push(line);
		}
		bodies.push(lines.join('\n'));
	}
	return { end: i, bodies };
}

/**
 * @typedef {object} ShellSegment
 * @property {string[]} words The words of the simple command.
 * @property {string[]} substitutions The commands that its substitutions run.
 * @property {boolean} piped True when a pipe feeds this command from the one before.
 * @property {string[]} heredocs The bodies of the heredocs that this command declares.
 */

/**
 * The simple commands in `command`. A quoted run is one word, `#` starts a comment at the start of
 * a word, and a heredoc's body belongs to the command that declares it.
 *
 * @param {string} command
 * @returns {ShellSegment[]}
 */
export function shellSegments(command) {
	/** @type {ShellSegment[]} */
	const segments = [];
	/** @type {string[]} */
	let words = [];
	/** @type {string[]} */
	let substitutions = [];
	/** @type {string[]} */
	let bodies = [];
	/** @type {{ delimiter: string, stripTabs: boolean }[]} */
	const pending = [];
	let piped = false;
	const endSegment = () => {
		if (words.length > 0) segments.push({ words, substitutions, piped, heredocs: bodies });
		words = [];
		substitutions = [];
		bodies = [];
		piped = false;
	};
	let i = 0;
	while (i < command.length) {
		const ch = command[i] ?? '';
		if (ch === ' ' || ch === '\t' || ch === '\r') {
			i += 1;
			continue;
		}
		if (ch === '\n') {
			if (pending.length > 0) {
				const skipped = skipHeredocs(command, i + 1, pending);
				bodies.push(...skipped.bodies);
				i = skipped.end;
			} else {
				i += 1;
			}
			endSegment();
			continue;
		}
		if (ch === '#') {
			const end = command.indexOf('\n', i);
			i = end < 0 ? command.length : end;
			continue;
		}
		if (ch === ';') {
			endSegment();
			i += 1;
			continue;
		}
		if (ch === '&') {
			endSegment();
			i += command[i + 1] === '&' ? 2 : 1;
			continue;
		}
		if (ch === '|') {
			endSegment();
			if (command[i + 1] === '|') {
				i += 2;
			} else {
				piped = true;
				i += 1;
			}
			continue;
		}
		if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
			const header = readHeredocHeader(command, i);
			if (header) {
				pending.push(header);
				i = header.end;
				continue;
			}
		}
		const word = readShellWord(command, i);
		words.push(word.text);
		substitutions.push(...word.substitutions);
		i = word.end;
	}
	endSegment();
	return segments;
}

/**
 * `words` without the redirections, which name a file and not a process.
 *
 * @param {readonly string[]} words
 * @returns {string[]}
 */
function withoutRedirections(words) {
	const kept = [];
	for (let i = 0; i < words.length; i++) {
		const word = words[i] ?? '';
		const operator = /^\d*[<>]/.exec(word);
		if (!operator) {
			kept.push(word);
			continue;
		}
		// A bare operator takes the next word as its file, and any other form names it inline.
		if (word.replace(operator[0], '') === '') i += 1;
	}
	return kept;
}

/**
 * `words` without the settings and wrappers before the command they run, and whether `xargs` runs
 * that command with the names that it reads from its input.
 *
 * @param {readonly string[]} words
 * @returns {{ words: string[], xargs: boolean }}
 */
function unwrap(words) {
	let i = 0;
	let xargs = false;
	while (i < words.length) {
		const word = words[i] ?? '';
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
			i += 1;
			continue;
		}
		if (
			word === 'command' &&
			((words[i + 1] ?? '').startsWith('-v') || (words[i + 1] ?? '').startsWith('-V'))
		) {
			break;
		}
		if (WRAPPERS.has(word)) {
			if (word === 'xargs') xargs = true;
			const values = WRAPPER_VALUES[word];
			i += 1;
			while (i < words.length && (words[i] ?? '').startsWith('-')) {
				const option = words[i] ?? '';
				i += 1;
				if (values?.has(option) && i < words.length) i += 1;
			}
			if ((word === 'timeout' || word === 'gtimeout') && i < words.length) i += 1;
			continue;
		}
		break;
	}
	return { words: words.slice(i), xargs };
}

/**
 * `words` without the list words that a loop, a condition or a group puts before its command, and
 * without a leading `(`. A wrapper may stand before a list word, so the two are removed in turns.
 *
 * @param {readonly string[]} words
 * @returns {{ words: string[], xargs: boolean }}
 */
function commandWords(words) {
	let rest = [...words];
	let xargs = false;
	let changed = true;
	while (changed) {
		const before = rest.length;
		let i = 0;
		while (i < rest.length && LIST_WORDS.has(rest[i] ?? '')) i += 1;
		const first = rest[i] ?? '';
		const stripped = first.replace(/^[({]+/, '');
		rest =
			i >= rest.length
				? []
				: stripped === ''
					? rest.slice(i + 1)
					: [stripped, ...rest.slice(i + 1)];
		const unwrapped = unwrap(rest);
		rest = unwrapped.words;
		xargs ||= unwrapped.xargs;
		changed = rest.length < before;
	}
	return { words: rest, xargs };
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
 * The words of a `kill` command that name what to stop, without its options and their values.
 *
 * @param {readonly string[]} args
 * @returns {string[]}
 */
function killTargets(args) {
	const targets = [];
	let literal = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? '';
		if (literal) {
			targets.push(arg);
			continue;
		}
		if (arg === '--') {
			literal = true;
			continue;
		}
		if (arg === '-s' || arg === '-n' || arg === '--signal') {
			i += 1;
			continue;
		}
		if (arg.startsWith('--signal=')) continue;
		if (/^-[A-Za-z0-9]+$/.test(arg)) continue;
		targets.push(arg);
	}
	return targets;
}

/**
 * True when `target` names a process that the command started: a number, a job, a shell expansion,
 * or a command that reads a stored number. A name, or a search by name, is not one.
 *
 * @param {string} target
 */
function namesPid(target) {
	if (/^\d+$/.test(target)) return true;
	// A job name points at a process of this shell, which the hook cannot see.
	if (/^%[\w-]+$/.test(target)) return true;
	if (/^\$\{[^}]*\}$/.test(target)) return true;
	if (/^\$[\w!@*#$?-]+$/.test(target)) return true;
	if (/^\$\([\s\S]*\)$/.test(target) || /^`[\s\S]*`$/.test(target))
		return !/\b(?:pgrep|pidof)\b/.test(target);
	return false;
}

/**
 * The index in `args` of the command that a shell runs for `-c`, or -1.
 *
 * @param {readonly string[]} args
 */
function shellCommandAt(args) {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? '';
		if (arg === '--command') return i + 1 < args.length ? i + 1 : -1;
		if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) return i + 1 < args.length ? i + 1 : -1;
	}
	return -1;
}

/** The commands that turn a process name into the numbers that another command reads. */
const NAME_LOOKUPS = new Set(['pgrep', 'pidof', 'ps', 'grep']);

/**
 * The rule that one simple command breaks, or null when it breaks none.
 *
 * @param {ShellSegment} segment
 * @param {number} depth How many shells this check has already looked inside.
 * @param {string} producer The command that pipes its output into this one, or an empty string.
 * @returns {Finding | null}
 */
function refusedWords(segment, depth, producer) {
	const { words: command, xargs } = commandWords(withoutRedirections(segment.words));
	const name = basename(command[0] ?? '');
	const args = command.slice(1);
	if (SHELLS.has(name)) {
		const at = shellCommandAt(args);
		if (at >= 0) return depth < 3 ? refusedCommand(args[at] ?? '', depth + 1) : null;
		// A shell that runs no `-c` command reads its script from a heredoc, when it has one.
		if (depth < 3) {
			for (const body of segment.heredocs) {
				const finding = refusedCommand(body, depth + 1);
				if (finding) return finding;
			}
		}
		return null;
	}
	if (name === 'eval') {
		// eval joins its arguments and runs them as a command, so a wait behind it is the wait.
		return depth < 3 ? refusedCommand(args.join(' '), depth + 1) : null;
	}
	if (name === 'sleep') return { id: 'no-sleep', message: WAITING };
	if (name === 'pkill' || name === 'killall') return { id: 'no-kill-by-name', message: STOPPING };
	if (name === 'kill') {
		const targets = killTargets(args);
		if (targets.length === 0 && args.some((arg) => arg === '-l' || arg === '-L')) return null;
		// xargs passes numbers in from its input, which a rule cannot see. Only a name lookup makes
		// a name, so any other producer leaves the target out of sight rather than out of a name.
		if (targets.length === 0 && xargs) {
			return NAME_LOOKUPS.has(producer) ? { id: 'no-kill-by-name', message: STOPPING } : null;
		}
		if (targets.length === 0 || targets.some((target) => !namesPid(target)))
			return { id: 'no-kill-by-name', message: STOPPING };
	}
	if (followsLog(name, args)) return { id: 'no-log-follow', message: FOLLOWING };
	if (depth < 3) {
		for (const body of segment.substitutions) {
			const finding = refusedCommand(body, depth + 1);
			if (finding) return finding;
		}
	}
	return null;
}

/**
 * The rule that a shell command breaks, or null when it breaks none.
 *
 * @param {string} command
 * @param {number} [depth] How many shells this check has already looked inside.
 * @returns {Finding | null}
 */
export function refusedCommand(command, depth = 0) {
	let producer = '';
	for (const segment of shellSegments(command)) {
		const finding = refusedWords(segment, depth, segment.piped ? producer : '');
		if (finding) return finding;
		producer = basename(unwrap(withoutRedirections(segment.words)).words[0] ?? '');
	}
	return null;
}

/**
 * `source` in two forms of the same length. `code` has its comments, strings and template literals
 * blank, and `named` has its comments alone blank, so an import's module name stays.
 *
 * @param {string} source
 * @returns {{ code: string, named: string }}
 */
function scanSource(source) {
	const code = source.split('');
	const named = source.split('');
	/**
	 * @param {number} from
	 * @param {number} to
	 * @param {boolean} both
	 */
	const blank = (from, to, both) => {
		for (let k = from; k < to; k++) {
			if (code[k] !== '\n') code[k] = ' ';
			if (both && named[k] !== '\n') named[k] = ' ';
		}
	};
	let i = 0;
	while (i < source.length) {
		const ch = source[i] ?? '';
		const next = source[i + 1] ?? '';
		if (ch === '/' && next === '/') {
			const end = source.indexOf('\n', i);
			const stop = end < 0 ? source.length : end;
			blank(i, stop, true);
			i = stop;
			continue;
		}
		if (ch === '/' && next === '*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end < 0 ? source.length : end + 2;
			blank(i, stop, true);
			i = stop;
			continue;
		}
		if (ch === "'" || ch === '"') {
			const stop = readQuoted(source, i);
			blank(i, stop, false);
			i = stop;
			continue;
		}
		if (ch === '`') {
			// The backticks stay, because the frame rule counts the string that they make.
			const stop = readBacktick(source, i);
			blank(i + 1, Math.max(i + 1, stop - 1), false);
			i = stop;
			continue;
		}
		i += 1;
	}
	return { code: code.join(''), named: named.join('') };
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
 * The block of the function that `name` holds, as the index of its opening brace, or null.
 *
 * @param {string} text
 * @param {string} name
 * @returns {{ open: number } | null}
 */
function namedFunction(text, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		`(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s+)?(?:function\\b[^(]*)?\\([^)]*\\)\\s*=>\\s*\\{`,
		`(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s+)?function\\b[^(]*\\([^)]*\\)\\s*\\{`,
		`function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`,
	];
	for (const pattern of patterns) {
		const found = new RegExp(pattern).exec(text);
		if (found) return { open: (found.index ?? 0) + found[0].lastIndexOf('{') };
	}
	return null;
}

/**
 * The body of each function that the sketch calls once per frame, which may be named elsewhere.
 *
 * @param {string} text Source text whose comments, strings and templates are blank.
 * @returns {{ start: number, end: number }[]}
 */
function updateBodies(text) {
	/** @type {{ start: number, end: number }[]} */
	const bodies = [];
	/** @type {Set<string>} */
	const seen = new Set();
	/** @param {number} open */
	const add = (open) => {
		const block = blockAt(text, open);
		const key = `${block.start}:${block.end}`;
		if (seen.has(key)) return;
		seen.add(key);
		bodies.push(block);
	};
	for (const pattern of ON_UPDATE) {
		pattern.lastIndex = 0;
		for (const match of text.matchAll(pattern)) {
			add((match.index ?? 0) + match[0].lastIndexOf('{'));
		}
	}
	for (const pattern of ON_UPDATE_NAME) {
		pattern.lastIndex = 0;
		for (const match of text.matchAll(pattern)) {
			const named = namedFunction(text, match[1] ?? 'onUpdate');
			if (named) add(named.open);
		}
	}
	return bodies;
}

/**
 * The first allocation in a frame update, as the finding that names it, or null.
 *
 * @param {string} file
 * @param {string} text Source text whose comments, strings and templates are blank.
 * @returns {Finding | null}
 */
function allocationFinding(file, text) {
	for (const body of updateBodies(text)) {
		const bodyText = text.slice(body.start, body.end);
		/** @type {{ index: number, effect: string } | null} */
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
				message: `null3D agent hook: ${file}:${line} ${first.effect} ${ALLOCATION_TAIL}`,
			};
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
					message: `null3D agent hook: ${file}:${line} imports ${name}, ${PLANNED_TAIL}`,
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
	const { code, named } = scanSource(source);
	const planned = plannedApiFinding(file, named, declarations);
	if (planned) return planned;
	if (SKETCH_FILE.test(file)) {
		const dom = DOM_NAMES.exec(code);
		if (dom) {
			const line = lineAt(code, dom.index);
			return {
				id: 'no-dom-in-sketch',
				message: `null3D agent hook: ${file}:${line} uses ${dom[0]} ${DOM_TAIL}`,
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

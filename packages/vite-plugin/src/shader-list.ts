// A project's list of the permutation words that its pages draw with, and the narrowing of the
// engine's shader set: to that list, and to the GPU paths that the project's build ships. The set
// holds every build of every word for both paths, gigabytes in thousands of files, and a page
// downloads the few that its device needs. With a list, a build copies only the builds of the
// listed words: a device file keeps the listed builds and drops the others, and a file that holds
// no listed build is replaced by one module without builds. A page that then asks for a word
// outside the list gets the engine's message that names the word. With a path set, a build drops
// the other path's files, and the engine refuses that path on a device that needs it.

import { readFileSync, statSync } from 'node:fs';
import MagicString from 'magic-string';
import { parseAst } from 'vite';
import { DRAW_INDEX, HALF, TONE_MAP } from './material-builds.ts';

/**
 * The permutation bits that a device fixes when it starts. A listed word leaves them out, so one
 * list serves every device module, and a build matches a word with those bits cleared.
 */
export const DEVICE_BITS = DRAW_INDEX | TONE_MAP | HALF;

/**
 * A GPU path that a build can ship: WGSL builds for WebGPU, or GLSL ES 3.00 builds for WebGL2.
 * WebGPU's compatibility mode draws with the WebGPU builds, so it counts as `webgpu`.
 */
export type GpuPath = 'webgpu' | 'webgl2';

/** The shader language of a GPU path: WGSL for WebGPU, GLSL for WebGL2. */
export type ShaderTarget = 'wgsl' | 'glsl';

/** The shader target of a GPU path. */
export function targetOfPath(path: GpuPath): ShaderTarget {
	return path === 'webgl2' ? 'glsl' : 'wgsl';
}

/**
 * The shader target of a generated shader module, from its name, or null for the modules that both
 * paths share, such as the main module and the marker module. A name that no longer names a target
 * cannot slip through: the build only drops a module whose target it read here.
 */
export function targetOfModule(name: string): ShaderTarget | null {
	const base = name.slice(name.lastIndexOf('/') + 1).replace(/\.(?:[cm]?[jt]s)$/, '');
	const tokens = base.split('-');
	if (tokens.includes('glsl')) return 'glsl';
	if (tokens.includes('wgsl')) return 'wgsl';
	return null;
}

/** The shader targets that a project's build keeps. */
export interface ShippedTargets {
	readonly wgsl: boolean;
	readonly glsl: boolean;
}

/**
 * The shader targets that the plugin's options ship. Both unless `gpuPaths` names one. Throws for
 * a list that names no GPU path, an unknown path, or one without WebGPU: the shader compiler builds
 * every shader for WebGPU, and a build that leaves it out would have no form for the shaders that a
 * project's own modules and its add-ons declare.
 */
export function shippedTargets(options: ShaderOptions | undefined): ShippedTargets {
	const paths = options?.gpuPaths;
	if (paths === undefined) return { wgsl: true, glsl: true };
	const known = paths.filter((path) => path !== 'webgpu' && path !== 'webgl2');
	if (known.length > 0)
		throw new Error(
			`null3D: shaders.gpuPaths takes 'webgpu' or 'webgl2', not ${known.map((path) => `"${path}"`).join(', ')}.`,
		);
	if (paths.length === 0)
		throw new Error(
			"null3D: shaders.gpuPaths is empty. Name the GPU paths to ship, such as ['webgpu'], or leave it out for both.",
		);
	if (!paths.includes('webgpu'))
		throw new Error(
			"null3D: shaders.gpuPaths must include 'webgpu'. The shader compiler builds every shader for WebGPU, so a build without it has no form for your own shaders and your add-ons' shaders. Ship both GPU paths instead.",
		);
	if (!paths.includes('webgl2')) return { wgsl: true, glsl: false };
	return { wgsl: true, glsl: true };
}

/** The shader options of the plugin. */
export interface ShaderOptions {
	/**
	 * The file that lists the permutation words that the project's pages draw with, one
	 * hexadecimal word on each line, as `bunx @null3d/cli shaders record` writes it. The path is
	 * relative to Vite's root. A production build then copies only the shader builds of those words,
	 * for every value of the bits a device fixes, and fails when the engine's shader set lacks a
	 * listed word. Without it, a build copies the whole set. The dev server draws with the whole
	 * set, and warns in the terminal and the browser's console about each word that a page draws
	 * with and the list lacks.
	 */
	list?: string;
	/**
	 * The GPU paths whose shaders the build ships, such as `['webgpu']` for an app whose browser
	 * frame always offers WebGPU, as an Electron desktop app's does. A build then drops the other
	 * path's shader files and fails with E1308 on a device that would need them. The default is
	 * both paths. `webgpu` is required, because the shader compiler builds every shader for it. The
	 * dev server keeps both paths. Docs: guides/assets-pipeline.md#ship-a-subset-of-the-gpu-paths.
	 */
	gpuPaths?: readonly GpuPath[];
}

/** The largest permutation word: the shader build keeps a word in 32 bits. */
const MAX_WORD = 0xffff_ffff;

/**
 * The words of a list file's text: one word on each line, as hexadecimal with `0x` or as a decimal
 * number, with `#` starting a comment, the rule that the engine's shader build reads. Throws with
 * the line of a word it cannot read, and for a list without a word.
 */
export function parseShaderList(text: string, file: string): number[] {
	const words: number[] = [];
	for (const [index, raw] of text.split('\n').entries()) {
		const word = (raw.split('#')[0] ?? '').trim();
		if (word === '') continue;
		const value = /^0[xX][0-9a-fA-F]+$/.test(word)
			? Number.parseInt(word.slice(2), 16)
			: /^\d+$/.test(word)
				? Number(word)
				: Number.NaN;
		if (!(value <= MAX_WORD))
			throw new Error(
				`${file} line ${index + 1}: "${word}" is not a permutation word. Write one hexadecimal word on each line, such as 0x00000010.`,
			);
		words.push(value);
	}
	if (words.length === 0)
		throw new Error(
			`${file} lists no permutation word. Record the words with bunx @null3d/cli shaders record.`,
		);
	return words;
}

/** A project's list of permutation words. */
export class ShaderList {
	/** The listed words, without the bits that a device fixes. */
	readonly words: ReadonlySet<number>;

	constructor(
		/** The list's file, as the build names it in its messages. */
		readonly file: string,
		words: Iterable<number>,
	) {
		this.words = new Set([...words].map((word) => word >>> 0));
	}

	/**
	 * Reads the list at `path`, which messages name as `name`. Throws for a list without the word
	 * that has no bit set, which every page's start draws its own passes with.
	 */
	static read(path: string, name: string = path): ShaderList {
		let text: string;
		try {
			text = readFileSync(path, 'utf8');
		} catch (error) {
			throw new Error(
				`cannot read the shader list ${name} (${(error as Error).message}). Record it with bunx @null3d/cli shaders record, or fix shaders.list in the null3D plugin's options.`,
			);
		}
		const list = new ShaderList(name, parseShaderList(text, name));
		if (!list.words.has(0))
			throw new Error(
				`the shader list ${name} lacks 0x00000000, the word of the engine's own passes, such as its culling, which every page draws with. Record the list again with bunx @null3d/cli shaders record, or add the word to it.`,
			);
		return list;
	}

	/**
	 * True when the list names the build whose permutation word is `permutation`: the word itself,
	 * or the word with the bits that a device fixes cleared.
	 */
	holds(permutation: number): boolean {
		return this.words.has(permutation >>> 0) || this.words.has((permutation & ~DEVICE_BITS) >>> 0);
	}

	/** The listed words that none of `held`, the words that a set's builds answer, holds. */
	missing(held: ReadonlySet<number>): number[] {
		return [...this.words].filter((word) => !held.has(word)).sort((a, b) => a - b);
	}
}

/** The dev server's warning about a word that a page draws with and the project's list lacks. */
export interface UnlistedWord {
	readonly message: string;
	/** True for the first warning about the word since the list last changed. */
	readonly first: boolean;
}

/**
 * The dev server's check of the words that its pages draw with against the project's list. The
 * dev server draws with the whole shader set, so a page there draws a word that the list lacks,
 * while a production build with the list stops that page. The check names such a word when a page
 * first draws with it. It reads the list again whenever the file changes, so a recording made
 * while the server runs counts at once.
 */
export class UnlistedWords {
	/** The list file's change time when it was last read, or undefined before the first read. */
	private stamp: number | undefined;
	private list: ShaderList | undefined;
	/** Why the list cannot be read, when it cannot. */
	private problem: string | undefined;
	/** The words that the check has warned about since the list last changed. */
	private readonly warned = new Set<number>();
	/** True once the check has reported the list's problem since the list last changed. */
	private problemShown = false;

	constructor(
		private readonly path: string,
		/** The list's file, as the warnings name it. */
		private readonly name: string,
	) {}

	/**
	 * The warning about `word`, which the page at `page` draws with, without the bits that a device
	 * fixes. Undefined when the list holds the word.
	 */
	check(word: number, page: string): UnlistedWord | undefined {
		this.refresh();
		if (this.list === undefined) {
			const first = !this.problemShown;
			this.problemShown = true;
			return { message: this.problem ?? '', first };
		}
		if (this.list.holds(word)) return undefined;
		const first = !this.warned.has(word >>> 0);
		this.warned.add(word >>> 0);
		const text = wordText(word);
		return {
			message: `${page} draws with the permutation word ${text}, which the shader list ${this.name} lacks. The dev server draws it, but a production build with this list skips a mesh pipeline's draws and reports the word, and a full-screen pass stops with the word in its error. Record the page again with bunx @null3d/cli shaders record, add the word by hand with bunx @null3d/cli shaders record --extra ${text}, or check the build with bunx @null3d/cli shaders verify.`,
			first,
		};
	}

	/** Reads the list again when its file changed since the last read. */
	private refresh(): void {
		const stamp = statSync(this.path, { throwIfNoEntry: false })?.mtimeMs ?? -1;
		if (stamp === this.stamp) return;
		this.stamp = stamp;
		this.warned.clear();
		this.problemShown = false;
		try {
			this.list = ShaderList.read(this.path, this.name);
			this.problem = undefined;
		} catch (error) {
			this.list = undefined;
			this.problem = (error as Error).message;
		}
	}
}

/** Adds to `held` each word that a build with the permutation word `permutation` answers. */
export function holdWord(held: Set<number>, permutation: number): void {
	held.add(permutation >>> 0);
	held.add((permutation & ~DEVICE_BITS) >>> 0);
}

/** A word as the list writes it: eight hexadecimal digits after `0x`. */
export function wordText(word: number): string {
	return `0x${(word >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * A line of a generated shader module that holds a build's permutation word. The hash workers
 * read the same lines in `hash-worker.js`, which cannot import this module.
 */
export const PERMUTATION_LINE = /^\t*permutation: (\d+),$/gm;

/** The permutation word of each build that a generated module's text holds. */
export function moduleWords(text: string): number[] {
	return [...text.matchAll(PERMUTATION_LINE)].map((match) => Number(match[1]));
}

/**
 * A build's permutation word in any form that a built file holds it: a minified object literal, or
 * the JSON text in which a module packs a custom material's builds, escaped inside a string.
 */
const BUILT_PERMUTATION = /\\?"?permutation\\?"?:\s*(\d+)/g;

/**
 * The permutation words that a built file's text names: those of the builds that it bundles, such
 * as the main shader module's own, a custom material's and an add-on's. A key of that name in other
 * code adds a word too, so the words that a check reads from here can only be more, never fewer.
 */
export function builtWords(text: string): number[] {
	return [...text.matchAll(BUILT_PERMUTATION)].map((match) => Number(match[1]));
}

/**
 * The module that stands for a device file whose builds the list leaves out. It holds no build,
 * so a page that asks for one of those words loads it, finds no build, and the engine names the
 * word.
 */
export const UNLISTED_MODULE = `// The builds of a device module that the project's shader list leaves out.\nexport const SHADERS = {};\n`;

/**
 * The generated marker module's text for a build: the listed words, or null for a build that copies
 * the whole set, and the shipped GPU paths, or null for a build that ships both. The module that
 * the shader build writes declares both names, so the engine reads one shape either way.
 */
export function shaderMarkersModule(
	words: ReadonlySet<number> | null,
	paths: readonly GpuPath[] | null,
): string {
	const listed = words === null ? 'null' : `[${[...words].sort((a, b) => a - b).join(', ')}]`;
	const shipped = paths === null ? 'null' : `[${paths.map((path) => `'${path}'`).join(', ')}]`;
	return `export const LISTED_PERMUTATIONS: readonly number[] | null = ${listed};\nexport const SHIPPED_GPU_PATHS: readonly ('webgpu' | 'webgl2')[] | null = ${shipped};\n`;
}

/** A node of the module's syntax tree, as far as the narrowing reads it. */
interface Node {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [field: string]: unknown;
}

/** A property of an object literal. */
interface PropertyNode extends Node {
	readonly key: Node & { name?: string; value?: unknown };
	readonly value: Node;
}

/** An object literal's properties, or undefined for any other node. */
function propertiesOf(node: Node | undefined | null): PropertyNode[] | undefined {
	if (node?.type !== 'ObjectExpression') return undefined;
	const properties = node.properties as Node[];
	return properties.every((property) => property.type === 'Property')
		? (properties as PropertyNode[])
		: undefined;
}

/** The name of a property's key, written as a name or as a string. */
function keyName(property: PropertyNode): string | undefined {
	const { key } = property;
	if (key.type === 'Identifier') return key.name;
	if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
	return undefined;
}

/** Each name that `node` and the nodes inside it read. */
function namesIn(node: unknown, names: Set<string>): void {
	if (Array.isArray(node)) {
		for (const item of node) namesIn(item, names);
		return;
	}
	if (node === null || typeof node !== 'object') return;
	const { type } = node as Node;
	if (type === 'Identifier') names.add((node as { name: string }).name);
	for (const [field, value] of Object.entries(node))
		if (field !== 'type' && value !== null && typeof value === 'object') namesIn(value, names);
}

/** The end of a statement that ends at `end`, with its line break, so that no blank line stays. */
function lineEnd(text: string, end: number): number {
	return text[end] === '\n' ? end + 1 : end;
}

/** Why a module cannot be narrowed: its form is not the one the shader build writes. */
function unreadable(file: string, why: string): Error {
	return new Error(
		`null3D cannot narrow ${file} to the shader list: ${why}. The plugin reads the form that the engine's shader build writes, so install the same version of @null3d/vite-plugin as of @null3d/engine.`,
	);
}

/**
 * The text of the generated device module `text` with only the builds whose permutation word
 * `keep` takes, and the counts of the builds it kept and held. A shader keeps its entry with no
 * build. Each shared paragraph and imported name that no kept build reads goes too, and so does an
 * import of a table of paragraphs that no kept build reads. Throws when the module is not in the
 * form that the shader build writes, so a build never ships a module it misread.
 */
export function narrowShaderModule(
	text: string,
	keep: (permutation: number) => boolean,
	file = 'a shader module',
): { text: string; kept: number; builds: number } {
	const program = parseAst(text) as unknown as { body: Node[] };
	const out = new MagicString(text);
	/** Each top-level constant by its name, with the statement that declares it. */
	const constants = new Map<string, Node>();
	let shaders: PropertyNode[] | undefined;
	for (const statement of program.body) {
		const declaration =
			statement.type === 'ExportNamedDeclaration' ? (statement.declaration as Node) : statement;
		if (declaration?.type !== 'VariableDeclaration') continue;
		for (const declarator of declaration.declarations as Node[]) {
			const name = (declarator.id as { name?: string }).name;
			if (name === undefined) continue;
			if (name === 'SHADERS' && statement.type === 'ExportNamedDeclaration')
				shaders = propertiesOf(declarator.init as Node);
			else if (statement === declaration) constants.set(name, statement);
		}
	}
	if (shaders === undefined) throw unreadable(file, 'it exports no object named SHADERS');
	const kept: Node[] = [];
	let builds = 0;
	for (const shader of shaders) {
		const variants = propertiesOf(shader.value);
		if (variants === undefined)
			throw unreadable(file, `its shader ${keyName(shader)} is not an object of builds`);
		for (const [index, variant] of variants.entries()) {
			const word = propertiesOf(variant.value)?.find((field) => keyName(field) === 'permutation')
				?.value as (Node & { value?: unknown }) | undefined;
			if (word?.type !== 'Literal' || typeof word.value !== 'number')
				throw unreadable(file, `its build ${keyName(variant)} has no permutation word`);
			builds++;
			if (keep(word.value)) {
				kept.push(variant.value);
				continue;
			}
			// A build goes with the text up to the next one, so the builds left keep their commas.
			const next = variants[index + 1];
			out.remove(variant.start, next === undefined ? shader.value.end - 1 : next.start);
		}
	}
	// The paragraphs that the kept builds read, and those that those paragraphs read.
	const read = new Set<string>();
	namesIn(kept, read);
	const pending = [...read];
	for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
		const statement = constants.get(name);
		if (statement === undefined) continue;
		const inner = new Set<string>();
		namesIn(statement, inner);
		for (const more of inner)
			if (!read.has(more)) {
				read.add(more);
				pending.push(more);
			}
	}
	for (const statement of program.body) {
		if (statement.type === 'VariableDeclaration') {
			const names = (statement.declarations as Node[]).map(
				(declarator) => (declarator.id as { name?: string }).name ?? '',
			);
			const plain = (statement.declarations as Node[]).every((declarator) => {
				const init = declarator.init as Node | null;
				return init?.type === 'TemplateLiteral' || init?.type === 'Literal';
			});
			if (plain && names.every((name) => !read.has(name)))
				out.remove(statement.start, lineEnd(text, statement.end));
		} else if (statement.type === 'ImportDeclaration') {
			const source = (statement.source as { value?: unknown }).value;
			if (typeof source !== 'string' || !source.startsWith('./shader-paragraphs-')) continue;
			const specifiers = statement.specifiers as Node[];
			const used = specifiers.filter(
				(specifier) =>
					specifier.type === 'ImportSpecifier' &&
					read.has((specifier.local as { name: string }).name),
			);
			if (used.length === specifiers.length) continue;
			// The import keeps the shader build's form, which the reader of a copy's tables reads, and
			// one that goes takes its line with it, since a blank line ends the imports.
			if (used.length === 0) out.remove(statement.start, lineEnd(text, statement.end));
			else
				out.overwrite(
					statement.start,
					statement.end,
					`import { ${used.map((specifier) => text.slice(specifier.start, specifier.end)).join(', ')} } from '${source}';`,
				);
		}
	}
	return { text: out.toString(), kept: kept.length, builds };
}

/**
 * The text of a table of shared paragraphs with only the paragraphs that `names` lists, the names
 * that the build's copies import from it. A paragraph of a table reads no other value, so each
 * one stays or goes on its own. Throws when the table is not in the form that the shader build
 * writes.
 */
export function narrowParagraphTable(
	text: string,
	names: ReadonlySet<string>,
	file = 'a table of paragraphs',
): string {
	const program = parseAst(text) as unknown as { body: Node[] };
	const out = new MagicString(text);
	for (const statement of program.body) {
		if (statement.type !== 'ExportNamedDeclaration') continue;
		const declaration = statement.declaration as Node | null;
		const declarators = (declaration?.declarations ?? []) as Node[];
		const plain =
			declaration?.type === 'VariableDeclaration' &&
			declarators.every((declarator) => {
				const init = declarator.init as Node | null;
				return (
					init?.type === 'Literal' ||
					(init?.type === 'TemplateLiteral' && (init.expressions as Node[]).length === 0)
				);
			});
		if (!plain) throw unreadable(file, 'one of its paragraphs is not plain text');
		const unused = declarators.every(
			(declarator) => !names.has((declarator.id as { name?: string }).name ?? ''),
		);
		if (unused) out.remove(statement.start, lineEnd(text, statement.end));
	}
	return out.toString();
}

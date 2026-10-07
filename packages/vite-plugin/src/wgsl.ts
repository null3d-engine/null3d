// The WGSL in a project's own modules: `.wgsl` files that modules import, and template literals
// that a `wgsl` block comment tags, as in `const glow = /* wgsl */ `...``. The plugin compiles
// each with the engine's shader library, checks it against the portable WGSL rules, and puts the
// compiled result where its source was: WGSL for WebGPU, and GLSL ES 3.00 for WebGL2 with the
// reflection that the WebGL2 backend binds by. WGSL with entry points is a whole shader. WGSL
// without them holds a custom material's functions, such as `fn surface`, which the plugin builds
// into every variant of the engine's standard material, or a custom effect's `fn effect` or tone
// curve's `fn toneCurve`, which it builds into the effect template or the final pass. WGSL that
// does not compile stops the
// module with an error at the file, line and column of each problem.
import { type ESTree, parseSync, Visitor } from 'vite';
import {
	compileHere,
	type ShaderCompiler,
	type ShaderProblem,
	type ShaderVariantSpec,
} from './shader-compiler.ts';
import type { CompiledWgsl, WgslPipeline } from './shader-types.ts';

/** The block comment that tags a template literal as WGSL, with any spacing inside it. */
export const WGSL_TAG = /\/\*\s*wgsl\s*\*\//;

/** How to keep WGSL away from the plugin, for messages about WGSL that it cannot compile. */
const TAG_HINT =
	'The plugin compiles every template literal that a `/* wgsl */` comment tags, so remove the tag from WGSL that null3D does not draw.';
const FILE_HINT =
	'To import the text of a `.wgsl` file without compiling it, add `?raw` to the import.';

/** What is wrong with a substitution in a tagged template literal, and how to fix it. */
const SUBSTITUTION =
	// biome-ignore lint/suspicious/noTemplateCurlyInString: the message names the substitution syntax.
	'a template literal that a `/* wgsl */` comment tags cannot hold `${...}`. The plugin compiles the WGSL while it builds the project, before any of your code runs, so write the value in the WGSL itself.';

/** A template literal that a `wgsl` block comment tags, in a module's code. */
export interface TaggedWgsl {
	/** The offset of the literal's opening backtick in the code. */
	readonly start: number;
	/** The offset just after the literal's closing backtick. */
	readonly end: number;
	/** The WGSL between the backticks, with Windows line ends made plain. */
	readonly source: string;
	/** The offset of the first `${` in the literal, or null when it has no substitution. */
	readonly substitution: number | null;
}

/** The parser's language for a script file, from its extension. */
function languageOf(file: string): 'js' | 'jsx' | 'ts' | 'tsx' {
	const extension = /\.[cm]?([jt]sx?)$/.exec(file)?.[1];
	return extension === 'ts' || extension === 'tsx' || extension === 'jsx' ? extension : 'js';
}

/**
 * The template literals that a `wgsl` block comment tags in a script module. Only a real comment
 * directly before a real template literal counts, so the same text inside a string or a line
 * comment does not. Code that does not parse gives none: Vite reports its syntax error.
 */
export function findTaggedWgsl(code: string, file: string): TaggedWgsl[] {
	const parsed = parseSync(file, code, { lang: languageOf(file) });
	if (parsed.errors.length > 0) return [];
	const literals = new Map<number, ESTree.TemplateLiteral>();
	new Visitor({
		TemplateLiteral: (node) => {
			literals.set(node.start, node);
		},
	}).visit(parsed.program);
	const tagged: TaggedWgsl[] = [];
	for (const comment of parsed.comments) {
		if (comment.type !== 'Block' || comment.value.trim() !== 'wgsl') continue;
		let at = comment.end;
		while (at < code.length && /\s/.test(code.charAt(at))) at++;
		const literal = literals.get(at);
		if (!literal) continue;
		const first = literal.expressions[0];
		tagged.push({
			start: literal.start,
			end: literal.end,
			source: code.slice(literal.start + 1, literal.end - 1).replaceAll('\r\n', '\n'),
			substitution: first ? code.lastIndexOf('${', first.start) : null,
		});
	}
	return tagged;
}

/** A place in a text: a 1-based line, and a 1-based column in UTF-16 code units. */
export interface Place {
	readonly line: number;
	readonly column: number;
}

/** The place of an offset in a text. */
export function placeOf(text: string, offset: number): Place {
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	let line = 1;
	for (let at = text.indexOf('\n'); at !== -1 && at < offset; at = text.indexOf('\n', at + 1))
		line++;
	return { line, column: offset - lineStart + 1 };
}

/** One entry point of a shader, and the offset of its stage attribute in the WGSL. */
interface EntryPoint {
	readonly stage: 'vertex' | 'fragment' | 'compute';
	readonly name: string;
	readonly at: number;
}

/** A WGSL name, as the language defines identifiers. */
const NAME = String.raw`[\p{XID_Start}_]\p{XID_Continue}*`;

/** A function declaration, with the attributes directly before it. */
const FUNCTION = new RegExp(
	String.raw`((?:@\s*${NAME}\s*(?:\([^()]*\))?\s*)*)\bfn\s+(${NAME})`,
	'gu',
);

/** The stage attribute among a function's attributes. */
const STAGE = /@\s*(vertex|fragment|compute)\b/;

/** WGSL with each comment turned into spaces, so every other character keeps its offset. */
function blankComments(source: string): string {
	let text = '';
	let depth = 0;
	for (let i = 0; i < source.length; i++) {
		const pair = source.slice(i, i + 2);
		if (depth === 0 && pair === '//') {
			const end = source.indexOf('\n', i);
			const stop = end === -1 ? source.length : end;
			text += ' '.repeat(stop - i);
			i = stop - 1;
		} else if (pair === '/*') {
			depth++;
			text += '  ';
			i++;
		} else if (depth > 0 && pair === '*/') {
			depth--;
			text += '  ';
			i++;
		} else {
			const char = source.charAt(i);
			text += depth > 0 && char !== '\n' ? ' ' : char;
		}
	}
	return text;
}

/** The functions that a custom material's WGSL may declare for the engine to call. */
const MATERIAL_FUNCTIONS: ReadonlySet<string> = new Set(['surface', 'vertexOffset']);

/**
 * True when WGSL is a mesh shader of its own: its `@vertex` entry point takes an `InstanceIn`, as
 * `null3d::mesh` finds each instance of a mesh with. Such a shader draws as a custom material.
 */
function isMeshShader(source: string): boolean {
	const text = blankComments(source);
	for (const match of text.matchAll(FUNCTION)) {
		if (!/@\s*vertex\b/.test(match[1] ?? '')) continue;
		const open = text.indexOf('(', match.index + match[0].length);
		const close = open < 0 ? -1 : text.indexOf('{', open);
		if (close > open && /\bInstanceIn\b/.test(text.slice(open, close))) return true;
	}
	return false;
}

/** The functions that a custom effect's or tone curve's WGSL declares for the engine to call. */
const POST_FUNCTIONS: ReadonlySet<string> = new Set(['effect', 'toneCurve']);

/** True when WGSL declares a function of `functions`, such as a custom material's `fn surface`. */
function declaresFunction(source: string, functions: ReadonlySet<string>): boolean {
	for (const match of blankComments(source).matchAll(FUNCTION))
		if (functions.has(match[2] ?? '')) return true;
	return false;
}

/**
 * The entry points that a shader declares, each once. Code behind shader defs counts too, so a
 * stage that `#ifdef` lines declare twice under one name is one entry point.
 */
function entryPoints(source: string): EntryPoint[] {
	const found = new Map<string, EntryPoint>();
	for (const match of blankComments(source).matchAll(FUNCTION)) {
		const stage = STAGE.exec(match[1] ?? '');
		const name = match[2] ?? '';
		const kind = stage?.[1] as EntryPoint['stage'] | undefined;
		if (!stage || !kind || found.has(`${kind} ${name}`)) continue;
		found.set(`${kind} ${name}`, { stage: kind, name, at: match.index + stage.index });
	}
	return [...found.values()];
}

/**
 * A problem that the plugin finds itself, at an offset in a text. Its column counts characters, as
 * the compiler's columns do.
 */
function problemAt(path: string, text: string, offset: number, message: string): ShaderProblem {
	const { line, column } = placeOf(text, offset);
	const before = [...text.slice(offset - column + 1, offset)].length;
	return { file: path, line, column: before + 1, feature: null, message, variants: [] };
}

/**
 * The render pipelines of a shader: one for each `@fragment` entry point, named after it, with
 * the shader's `@vertex` entry point. A shader with only `@compute` entry points has none.
 */
function pipelinesOf(
	path: string,
	source: string,
	hint: string,
): { pipelines: Record<string, WgslPipeline> } | { problem: ShaderProblem } {
	const entries = entryPoints(source);
	const [vertex, secondVertex] = entries.filter((entry) => entry.stage === 'vertex');
	const fragments = entries.filter((entry) => entry.stage === 'fragment');
	const problem = (at: number, message: string) => ({
		problem: problemAt(path, source, at, message),
	});
	if (entries.length === 0) {
		return problem(
			0,
			`the WGSL has no entry point and no function of a custom material or effect. For a custom material, declare \`fn surface(input: SurfaceInput) -> Surface\`, \`fn vertexOffset(input: VertexInput) -> vec3f\`, or both. For an effect, declare \`fn effect(input: EffectInput) -> vec4f\`, and for a tone curve \`fn toneCurve(color: vec3f) -> vec3f\`. For a shader of your own, give it a \`@vertex\` and a \`@fragment\` entry point, or a \`@compute\` one. ${hint}`,
		);
	}
	if (secondVertex) {
		return problem(
			secondVertex.at,
			'the WGSL has more than one `@vertex` entry point. The plugin pairs each `@fragment` entry point with the one `@vertex` entry point of its shader, so keep one, or split the shader in two.',
		);
	}
	const [fragment] = fragments;
	if (fragment && !vertex) {
		return problem(
			fragment.at,
			'the WGSL has a `@fragment` entry point but no `@vertex` one. A render pipeline needs both, so add a `@vertex` entry point.',
		);
	}
	if (vertex && !fragment) {
		return problem(
			vertex.at,
			'the WGSL has a `@vertex` entry point but no `@fragment` one. A render pipeline needs both, so add a `@fragment` entry point.',
		);
	}
	const pipelines: Record<string, WgslPipeline> = {};
	for (const { name } of fragments)
		pipelines[name] = { vertex: vertex?.name ?? '', fragment: name };
	return { pipelines };
}

/** The builds of a shader from a project: one for WebGPU, and one for WebGL2. */
const BUILDS = {
	webgpu: { targets: ['wgsl'] },
	webgl2: { defs: ['WEBGL2'], targets: ['glsl'] },
} as const satisfies Record<string, ShaderVariantSpec>;

/** The result of compiling WGSL from a project: the shader, or the problems that stopped it. */
export type WgslCompile =
	| { readonly ok: true; readonly shader: CompiledWgsl }
	| {
			readonly ok: false;
			readonly problems: readonly ShaderProblem[];
			/** The builds that the compile tried, which the problems' variants name. */
			readonly builds: readonly string[];
	  };

/**
 * Compiles WGSL from a project with the engine's shader library. A whole shader builds for WebGPU,
 * and for WebGL2 when it has a render pipeline. A custom material's functions build into every
 * variant of the engine's standard material, and a custom effect's or tone curve's into its
 * template. `path` names the file in messages, and `hint` ends the message about WGSL that is
 * none of these. `compiler` runs the compile, on this thread by default.
 */
export async function compileWgsl(
	path: string,
	source: string,
	hint: string,
	compiler: ShaderCompiler = compileHere,
): Promise<WgslCompile> {
	const noEntryPoints = entryPoints(source).length === 0;
	if (noEntryPoints && declaresFunction(source, POST_FUNCTIONS)) {
		const result = await compiler.effect({ path, source });
		// Effects and tone curves build for both GPU paths.
		if (!result.ok) return { ok: false, problems: result.problems, builds: ['webgpu', 'webgl2'] };
		const { function: kind, uniforms, depth, joins, variants, pieces } = result.effect;
		if (kind === 'toneCurve') return { ok: true, shader: { kind, variants, pieces } };
		return { ok: true, shader: { kind, uniforms, depth, joins, variants, pieces } };
	}
	const material = noEntryPoints && declaresFunction(source, MATERIAL_FUNCTIONS);
	if (material || isMeshShader(source)) {
		const result = await compiler.material({ path, source });
		// Custom materials build for both GPU paths.
		if (!result.ok) return { ok: false, problems: result.problems, builds: ['webgpu', 'webgl2'] };
		return { ok: true, shader: { kind: 'material', ...result.material } };
	}
	const shape = pipelinesOf(path, source, hint);
	if ('problem' in shape) return { ok: false, problems: [shape.problem], builds: [] };
	const render = Object.keys(shape.pipelines).length > 0;
	const variants = render ? BUILDS : { webgpu: BUILDS.webgpu };
	const result = await compiler.shader({ path, source, pipelines: shape.pipelines, variants });
	if (!result.ok) return { ok: false, problems: result.problems, builds: Object.keys(variants) };
	const { webgpu, webgl2 } = result.variants;
	if (!webgpu) throw new Error('null3D: the shader compiler gave no WebGPU build.');
	return { ok: true, shader: { kind: 'shader', webgpu, webgl2: webgl2 ?? null } };
}

/** Where WGSL starts in the file that holds it: the file as messages name it, and a place. */
export interface WgslOrigin extends Place {
	readonly path: string;
}

/** The 1-based UTF-16 column of a 1-based column that counts characters, in a line. */
function utf16Column(line: string, column: number): number {
	const chars = [...line];
	return chars.slice(0, column - 1).join('').length + 1 + Math.max(0, column - 1 - chars.length);
}

/**
 * A problem at its place in the file that holds the WGSL. The compiler counts from the start of
 * the WGSL, and a template literal starts part way into a module.
 */
function inFile(problem: ShaderProblem, source: string, origin: WgslOrigin): ShaderProblem {
	if (problem.file !== origin.path || problem.line === null) return problem;
	const text = source.split('\n')[problem.line - 1] ?? '';
	const column = problem.column === null ? null : utf16Column(text, problem.column);
	const first = problem.line === 1;
	return {
		...problem,
		line: origin.line + problem.line - 1,
		column: column === null ? null : first ? origin.column + column - 1 : column,
	};
}

/** The GPU path of a build, as messages name it, from the start of the build's name. */
function pathOf(build: string): string {
	return build.startsWith('webgl2') ? 'WebGL2' : 'WebGPU';
}

/**
 * A problem as one line of a message: its place, what is wrong, and the GPU path whose builds have
 * it, when not every path's builds do. `builds` names every build that the compile made.
 */
function describe(problem: ShaderProblem, builds: readonly string[]): string {
	const place = [problem.file, problem.line, problem.column].filter((part) => part !== null);
	const paths = new Set(problem.variants.map(pathOf));
	const [only] = paths;
	const partial = paths.size === 1 && new Set(builds.map(pathOf)).size > 1;
	const build = partial ? ` (in the ${only} build)` : '';
	return `${place.length > 0 ? `${place.join(':')}: ` : ''}${problem.message}${build}`;
}

/** An error in the form that Vite and Rolldown show with its place and the code around it. */
export interface WgslError {
	readonly message: string;
	/** The module that the error stopped. */
	readonly id: string;
	/**
	 * The place to show. Its column counts from 1, as editors and the message do, although Rollup
	 * counts its own columns from 0: Vite and Rolldown only print the place, and Vite's overlay
	 * opens the editor at it.
	 */
	readonly loc: { readonly file: string; readonly line: number; readonly column: number };
	readonly frame: string;
}

/**
 * The error for WGSL that did not compile. It lists every problem, and shows the first one in the
 * WGSL's own file, or else the WGSL's start. `id` is the file's module id, and `text` its text.
 */
export function wgslError(
	failed: Extract<WgslCompile, { ok: false }>,
	source: string,
	origin: WgslOrigin,
	id: string,
	text: string,
): WgslError {
	const problems = failed.problems.map((problem) => inFile(problem, source, origin));
	const shown = problems.find((problem) => problem.file === origin.path && problem.line !== null);
	const line = shown?.line ?? origin.line;
	const column = shown ? (shown.column ?? 1) : origin.column;
	const lines = problems.map((problem) => describe(problem, failed.builds));
	return {
		message: `null3D could not compile the WGSL:\n${lines.join('\n')}`,
		id,
		loc: { file: id, line, column },
		frame: codeFrame(text, line, column),
	};
}

/** Compiled WGSL, or the error that stops the module that holds it. */
export type ShaderOrError = { readonly shader: CompiledWgsl } | { readonly error: WgslError };

/**
 * Compiles a `.wgsl` file. `path` names the file in messages, `id` is its module id, and `text` its
 * content as read from disk.
 */
export async function compileWgslFile(
	path: string,
	id: string,
	text: string,
	compiler: ShaderCompiler = compileHere,
): Promise<ShaderOrError> {
	const source = text.replaceAll('\r\n', '\n');
	const compiled = await compileWgsl(path, source, FILE_HINT, compiler);
	if (compiled.ok) return { shader: compiled.shader };
	return { error: wgslError(compiled, source, { path, line: 1, column: 1 }, id, source) };
}

/**
 * Compiles one tagged template literal of a script module, whose code is `code`: the compiled
 * WGSL that takes its place, or the error that stops the module.
 */
export async function compileLiteral(
	literal: TaggedWgsl,
	code: string,
	id: string,
	path: string,
	compiler: ShaderCompiler = compileHere,
): Promise<ShaderOrError> {
	if (literal.substitution !== null) {
		const problem = problemAt(path, code, literal.substitution, SUBSTITUTION);
		const failed = { ok: false, problems: [problem], builds: [] } as const;
		return { error: wgslError(failed, code, { path, line: 1, column: 1 }, id, code) };
	}
	const origin = { path, ...placeOf(code, literal.start + 1) };
	const compiled = await compileWgsl(path, literal.source, TAG_HINT, compiler);
	if (compiled.ok) return { shader: compiled.shader };
	return { error: wgslError(compiled, literal.source, origin, id, code) };
}

/** A tagged template literal of a module, and the compiled WGSL that takes its place. */
export interface TaggedShader {
	readonly start: number;
	readonly end: number;
	readonly shader: CompiledWgsl;
}

/**
 * Compiles each tagged template literal in a script module, all at once, or gives the error that
 * stops the module at its first literal that does not compile.
 */
export async function compileTaggedWgsl(
	code: string,
	id: string,
	path: string,
	compiler: ShaderCompiler = compileHere,
): Promise<{ readonly shaders: readonly TaggedShader[] } | { readonly error: WgslError }> {
	const literals = findTaggedWgsl(code, id);
	const results = await Promise.all(
		literals.map((literal) => compileLiteral(literal, code, id, path, compiler)),
	);
	const shaders: TaggedShader[] = [];
	for (const [k, result] of results.entries()) {
		if ('error' in result) return result;
		const { start, end } = literals[k] as TaggedWgsl;
		shaders.push({ start, end, shader: result.shader });
	}
	return { shaders };
}

/** Lines of text around a place, each with its number, and a caret under the place's column. */
export function codeFrame(text: string, line: number, column: number): string {
	const lines = text.split('\n');
	const first = Math.max(1, line - 2);
	const last = Math.min(lines.length, line + 2);
	const width = String(last).length;
	const frame: string[] = [];
	for (let number = first; number <= last; number++) {
		const content = (lines[number - 1] ?? '').replace(/\r$/, '');
		frame.push(`${String(number).padStart(width)} | ${content}`);
		if (number === line) {
			const indent = content.slice(0, column - 1).replace(/[^\t]/g, ' ');
			frame.push(`${' '.repeat(width)} | ${indent}^`);
		}
	}
	return frame.join('\n');
}

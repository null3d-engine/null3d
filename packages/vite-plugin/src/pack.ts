// Compiled shaders as a module carries them. The builds of one material or effect share most of
// their text: a custom material joins the same library functions into every variant of the
// standard material, for both GPU paths, and many builds share whole stages. Written out in full, a
// sketch with a few such materials made a module of tens of megabytes. So a module keeps each
// top-level block of text once, and each distinct source once, as the list of its blocks' numbers.
// WGSL and GLSL have tables of their own, as a page draws with one GPU path and needs the text of
// that path only. A shader's records name each source by its number in its path's table. A
// function that the plugin adds to the end of the module gives each source field a getter, which
// builds the source's text when something reads it, so the engine and the project's code get the
// same values as before. The module keeps no built text: the sketch reads each source once, when it
// sends the shader to the thread that draws, so the text lives only in that thread. The other
// path's text is never built. The records and the tables go into the module as JSON text, which `JSON.parse`
// reads faster than an object literal of the same size, and which the transforms after the plugin
// leave on one line. The function makes no code from strings, so a strict Content Security Policy
// allows it.
/**
 * The function that the plugin adds to a module, which rebuilds the module's compiled shaders.
 */
export const UNPACK = '__null3dShader';

/**
 * The two tables of an unpacked module in its text: the WGSL table and the GLSL table, each the
 * JavaScript string literal that `JSON.stringify(JSON.stringify(...))` writes.
 */
const PATHS_TABLES =
	/__null3dShader\.paths = \[\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\]/;

/** The call that a module makes to unpack each compiled shader, and its first argument. */
const PACK_CALL = /__null3dShader\(\s*("(?:[^"\\]|\\.)*")/g;

/** The entries of a build-set loader that hold the sets of one GPU path, one on each line. */
const SET_ENTRY =
	/[ \t]*"(?:material|effect|toneCurve) glsl \d+": \(\) => import\("[^"]*"\),\r?\n/g;

/** The JSON text of a table that holds no text, in the form that the module's tables take. */
const EMPTY_TABLE = JSON.stringify(JSON.stringify({ blocks: [], lists: [] }));

/** Why a packed shader module cannot be narrowed: its text is not the form that the pack writes. */
function unreadablePack(file: string): Error {
	return new Error(
		`null3D cannot drop the WebGL2 builds of ${file}: the module is not in the form that the null3D plugin packs a compiled shader in. Install the same version of @null3d/vite-plugin as the package that wrote it.`,
	);
}

/**
 * Sets every `glsl` and `webgl2` field of a packed record to null, at any depth, so that no getter
 * ever asks for a source of a table that no longer holds any. A material's variants, an effect's
 * pieces and a whole shader's records all name their WebGL2 output that way.
 */
function dropWebgl2(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) dropWebgl2(item);
		return;
	}
	if (value === null || typeof value !== 'object') return;
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key === 'glsl' || key === 'webgl2') record[key] = null;
		else dropWebgl2(record[key]);
	}
}

/**
 * The text of a packed shader module with its WebGL2 builds removed, for a build that ships WebGPU
 * alone: each record keeps no WebGL2 output, the module keeps no table of GLSL text, and the loader
 * of build sets loses the entries of the GLSL sets, so their modules are never imported or emitted.
 * Throws when the text is not in the form that `ShaderPack` writes, so a build never ships a module
 * that it misread.
 */
export function narrowShaderPack(text: string, file: string): string {
	const tables = PATHS_TABLES.exec(text);
	if (tables === null) throw unreadablePack(file);
	let narrowed = text.replace(
		PATHS_TABLES,
		(_match, wgsl: string, _glsl: string) => `__null3dShader.paths = [${wgsl}, ${EMPTY_TABLE}]`,
	);
	let calls = 0;
	narrowed = narrowed.replace(PACK_CALL, (match, literal: string) => {
		let packed: string;
		let records: unknown;
		try {
			packed = JSON.parse(literal) as string;
			records = JSON.parse(packed);
		} catch {
			throw unreadablePack(file);
		}
		dropWebgl2(records);
		calls++;
		return match.replace(literal, () => JSON.stringify(JSON.stringify(records)));
	});
	if (calls === 0) throw unreadablePack(file);
	return narrowed.replace(SET_ENTRY, '');
}

/**
 * The function of a module whose custom materials' builds load on first use, which imports the
 * builds of a GPU path and a set by its permutation bits, as `material-builds.ts` writes it.
 */
export const LOAD_BUILDS = '__null3dBuilds';

/** The key of each field that holds a shader's text, in a compiled shader's records. */
const SOURCE = 'source';

/** The field of a WGSL module beside its text, which a GLSL stage does not have. */
const WGSL_FIELD = 'pipelines';

/**
 * A source's top-level blocks, each with the line break before it: a block starts at each line that
 * starts with neither white space nor a closing bracket, so a function or struct is one block with
 * its closing line. Joined in order, the blocks give the source back.
 */
const blocksOf = (source: string) => source.split(/(?=\n[^\s}\])])/);

/** A value's number in a table, which adds the value at the end when it is new. */
function numberIn<T>(table: Map<T, number>, value: T): number {
	let n = table.get(value);
	if (n === undefined) {
		n = table.size;
		table.set(value, n);
	}
	return n;
}

/** The JSON text of the tables of `sources`: each distinct block once, and each source's blocks. */
function tablesOf(sources: Map<string, number>): string {
	const blocks = new Map<string, number>();
	const lists = [...sources.keys()].map((source) =>
		blocksOf(source).map((block) => numberIn(blocks, block)),
	);
	return JSON.stringify(JSON.stringify({ blocks: [...blocks.keys()], lists }));
}

/** The compiled shaders of one module, with the tables of text that they share. */
export class ShaderPack {
	/** Each distinct WGSL source and GLSL source, by its number. */
	private readonly wgsl = new Map<string, number>();
	private readonly glsl = new Map<string, number>();
	private used = false;

	/** Whether the module holds no compiled shader, and so needs no function. */
	get empty(): boolean {
		return !this.used;
	}

	/**
	 * The JavaScript expression that takes the place of a compiled shader in the module: a call of
	 * the function with the shader's records as JSON text, each WGSL source as its number and each
	 * GLSL source as -1 less its number. `hot` is the key of the shader's hot updates on the dev
	 * server. `builds` is a shader's place among the module's shaders of its `kind` whose builds
	 * load on first use, which the shader's `builds` function imports through the module's function.
	 */
	value(shader: object, hot?: string, builds?: number, kind?: string): string {
		this.used = true;
		const { wgsl, glsl } = this;
		const packed = JSON.stringify(shader, function (this: object, key: string, value: unknown) {
			if (key !== SOURCE || typeof value !== 'string') return value;
			return WGSL_FIELD in this ? numberIn(wgsl, value) : -1 - numberIn(glsl, value);
		});
		const args = [JSON.stringify(packed)];
		if (hot !== undefined || builds !== undefined)
			args.push(hot === undefined ? 'undefined' : JSON.stringify(hot));
		if (builds !== undefined) args.push(`${LOAD_BUILDS}, ${builds}, ${JSON.stringify(kind ?? '')}`);
		return `${UNPACK}(${args.join(', ')})`;
	}

	/**
	 * The function that the module ends with. A function declaration is set up before any of the
	 * module's code runs, so a shader in the module's first line can call it. It reads a path's
	 * tables the first time a getter needs a source of that path.
	 */
	unpacker(): string {
		const tables = `[${tablesOf(this.wgsl)}, ${tablesOf(this.glsl)}]`;
		return `
function ${UNPACK}(text, hot, load, index, kind) {
	const paths = ${UNPACK}.paths || (${UNPACK}.paths = ${tables}.map((json) => ({ json })));
	const sourceOf = (n) => {
		const path = paths[n < 0 ? 1 : 0];
		const tables = path.tables || (path.tables = JSON.parse(path.json));
		return tables.lists[n < 0 ? -1 - n : n].map((block) => tables.blocks[block]).join('');
	};
	const walk = (item) => {
		for (const key in item) {
			const field = item[key];
			if (key === ${JSON.stringify(SOURCE)} && typeof field === 'number')
				Object.defineProperty(item, key, { get: () => sourceOf(field), enumerable: true });
			else if (field !== null && typeof field === 'object') walk(field);
		}
	};
	const shader = JSON.parse(text);
	walk(shader);
	if (hot !== undefined) shader.hot = hot;
	if (load !== undefined)
		shader.builds = (target, set) => load(kind, target, set).then((module) => module.default[index] || {});
	return shader;
}
`;
	}
}

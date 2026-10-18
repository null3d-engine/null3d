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
/** The function that the plugin adds to a module, which rebuilds the module's compiled shaders. */
export const UNPACK = '__null3dShader';

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
	 * server. `builds` is a custom material's place among the module's materials whose builds load
	 * on first use, which the shader's `builds` function imports through the module's function.
	 */
	value(shader: object, hot?: string, builds?: number): string {
		this.used = true;
		const { wgsl, glsl } = this;
		const packed = JSON.stringify(shader, function (this: object, key: string, value: unknown) {
			if (key !== SOURCE || typeof value !== 'string') return value;
			return WGSL_FIELD in this ? numberIn(wgsl, value) : -1 - numberIn(glsl, value);
		});
		const args = [JSON.stringify(packed)];
		if (hot !== undefined || builds !== undefined)
			args.push(hot === undefined ? 'undefined' : JSON.stringify(hot));
		if (builds !== undefined) args.push(`${LOAD_BUILDS}, ${builds}`);
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
function ${UNPACK}(text, hot, load, index) {
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
		shader.builds = (target, set) => load(target, set).then((module) => module.default[index] || {});
	return shader;
}
`;
	}
}

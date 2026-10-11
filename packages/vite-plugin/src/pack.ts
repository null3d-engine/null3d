// Compiled shaders as a module carries them. The builds of one material or effect share most of
// their text: a custom material joins the same library functions into every variant of the
// standard material, for both GPU paths, and many builds share whole stages. Written out in full, a
// sketch with a few such materials made a module of tens of megabytes. So a module keeps each
// top-level block of text once, and each distinct source once, as the list of its blocks' numbers.
// A shader's records name each source by its number. A function that the plugin adds to the end
// of the module builds each source's text once, when the module runs, so the engine and the
// project's code get the same values as before, and equal sources share one string. The records
// and the tables go into the module as JSON text, which `JSON.parse` reads faster than an object
// literal of the same size, and which the transforms after the plugin leave on one line. The
// function makes no code from strings, so a strict Content Security Policy allows it.
import type { CompiledWgsl } from './shader-types.ts';

/** The function that the plugin adds to a module, which rebuilds the module's compiled shaders. */
export const UNPACK = '__null3dShader';

/** The key of each field that holds a shader's text, in a compiled shader's records. */
const SOURCE = 'source';

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

/** The compiled shaders of one module, with the tables of text that they share. */
export class ShaderPack {
	/** Each distinct source, by its number. */
	private readonly sources = new Map<string, number>();
	private used = false;

	/** Whether the module holds no compiled shader, and so needs no function. */
	get empty(): boolean {
		return !this.used;
	}

	/**
	 * The JavaScript expression that takes the place of a compiled shader in the module: a call of
	 * the function with the shader's records as JSON text, each source as its number. `hot` is the
	 * key of the shader's hot updates on the dev server.
	 */
	value(shader: CompiledWgsl, hot?: string): string {
		this.used = true;
		const packed = JSON.stringify(shader, (key, value) =>
			key === SOURCE && typeof value === 'string' ? numberIn(this.sources, value) : value,
		);
		return `${UNPACK}(${JSON.stringify(packed)}${hot === undefined ? '' : `, ${JSON.stringify(hot)}`})`;
	}

	/**
	 * The function that the module ends with. A function declaration is set up before any of the
	 * module's code runs, so a shader in the module's first line can call it. It reads the tables
	 * on its first call, and builds each source's text the first time a shader names it.
	 */
	unpacker(): string {
		const blocks = new Map<string, number>();
		const lists = [...this.sources.keys()].map((source) =>
			blocksOf(source).map((block) => numberIn(blocks, block)),
		);
		const tables = JSON.stringify(JSON.stringify({ blocks: [...blocks.keys()], lists }));
		return `
function ${UNPACK}(text, hot) {
	const tables = ${UNPACK}.tables || (${UNPACK}.tables = JSON.parse(${tables}));
	const texts = tables.texts || (tables.texts = []);
	const sourceOf = (n) =>
		texts[n] || (texts[n] = tables.lists[n].map((block) => tables.blocks[block]).join(''));
	const walk = (item) => {
		for (const key in item) {
			const field = item[key];
			if (key === ${JSON.stringify(SOURCE)} && typeof field === 'number') item[key] = sourceOf(field);
			else if (field !== null && typeof field === 'object') walk(field);
		}
	};
	const shader = JSON.parse(text);
	walk(shader);
	if (hot !== undefined) shader.hot = hot;
	return shader;
}
`;
	}
}

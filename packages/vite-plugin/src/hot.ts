// Hot updates of WGSL on the dev server. When a `.wgsl` file changes, or only the WGSL of tagged
// template literals in a script changes, the plugin compiles the new WGSL and sends it to the
// page under a key, with no page reload. A small client module on each page hands it to the
// null3D engines there, which swap the shader of each custom material with that key. WGSL that
// does not compile shows in Vite's overlay, and the page keeps the old shader. An edit that
// changes what the page keeps of a material, such as its uniforms, reloads the page as before.
import type { CompiledWgsl } from './shader-types.ts';
import { findTaggedWgsl, type TaggedWgsl } from './wgsl.ts';

/** The event that carries hot updates, on Vite's channel and on the page's global object. */
export const WGSL_UPDATE_EVENT = 'null3d:wgsl';

/** The module that hands hot updates to the engines on a page, which the dev server injects. */
export const HOT_CLIENT = 'virtual:null3d/hot';

/** The module id of the hot client, which no other plugin loads. */
export const HOT_CLIENT_ID = `\0${HOT_CLIENT}`;

/** The hot client's name or its module id, as Vite's hook filters match them. */
export const HOT_CLIENT_ADDRESS = /^\0?virtual:null3d\/hot$/;

/** The hot client's code. It also closes Vite's overlay, which may show an earlier WGSL error. */
export const HOT_CLIENT_CODE = `if (import.meta.hot) {
	import.meta.hot.on(${JSON.stringify(WGSL_UPDATE_EVENT)}, ({ updates }) => {
		for (const overlay of document.querySelectorAll('vite-error-overlay')) overlay.close();
		globalThis.dispatchEvent(new CustomEvent(${JSON.stringify(WGSL_UPDATE_EVENT)}, { detail: updates }));
		console.debug('[null3D] hot updated: ' + updates.map((update) => update.key).join(', '));
	});
}
`;

/** One hot update: the new compiled WGSL under its key. */
export interface WgslUpdate {
	readonly key: string;
	readonly shader: CompiledWgsl;
}

/**
 * The key of a project's WGSL: a `.wgsl` file's path from the project's root, or that of a script
 * with the place of a tagged literal among the script's literals, from 0.
 */
export function hotKey(path: string, literal?: number): string {
	return literal === undefined ? path : `${path}#${literal}`;
}

/**
 * What a running page keeps of compiled WGSL, as text: everything of a custom material but its
 * builds. A material whose new WGSL keeps it can swap its shader. Null for a whole shader, which
 * code outside the engine uses as it likes, and for a custom effect or tone curve, which the
 * engine does not swap. Only a reload brings either a new one.
 */
export function contractOf(shader: CompiledWgsl): string | null {
	if (shader.kind !== 'material') return null;
	const { uniforms, textures, locations, attributes, baseColor } = shader;
	// A vertex offset gives the material the builds of its shadow casters, which the engine picks
	// when it creates the material.
	const casts = shader.functions.includes('vertexOffset');
	return JSON.stringify({ uniforms, textures, locations, attributes, baseColor, casts });
}

/**
 * The code of a script with the text of its tagged literals left out, so two scripts whose code
 * differs only in their WGSL give the same text.
 */
function frameOf(code: string, literals: readonly TaggedWgsl[]): string {
	let frame = '';
	let at = 0;
	for (const { start, end } of literals) {
		frame += `${code.slice(at, start)}\`\``;
		at = end;
	}
	return frame + code.slice(at);
}

/** A tagged literal of a script, with its place among the script's literals. */
export interface ChangedLiteral {
	readonly index: number;
	readonly literal: TaggedWgsl;
}

/**
 * The tagged literals of a script whose WGSL differs between two versions of its code, or null
 * when the code differs elsewhere too, so the script itself must run again.
 */
export function changedLiterals(
	before: string,
	after: string,
	file: string,
): ChangedLiteral[] | null {
	const old = findTaggedWgsl(before, file);
	const now = findTaggedWgsl(after, file);
	if (old.length === 0 || old.length !== now.length) return null;
	if (frameOf(before, old) !== frameOf(after, now)) return null;
	return now.flatMap((literal, index) =>
		literal.source === old[index]?.source ? [] : [{ index, literal }],
	);
}

/** What the dev server knows of the WGSL that pages run, to judge each change. */
export class HotState {
	/** The contract of each key's WGSL as the page runs it. */
	private readonly contracts = new Map<string, string | null>();
	/** The code of each script with tagged WGSL, as the page runs it, by file. */
	readonly scripts = new Map<string, string>();

	/** Notes the WGSL that the page runs under a key. */
	remember(key: string, shader: CompiledWgsl): void {
		this.contracts.set(key, contractOf(shader));
	}

	/**
	 * True when the page can swap the WGSL under a key for `shader` without a reload: both are
	 * custom materials with the same contract.
	 */
	swaps(key: string, shader: CompiledWgsl): boolean {
		const before = this.contracts.get(key);
		const after = contractOf(shader);
		return before !== undefined && before !== null && before === after;
	}
}

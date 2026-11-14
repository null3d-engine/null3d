// The render pipeline templates of the sketch's compiled WGSL. Custom materials, custom effects and
// custom tone curves each draw with templates of their own, from the first custom template up.
// One counter gives them out, so no two compiled shaders share a template. The shaders of each
// template go to the thread that draws once, the first time a sketch uses the compiled WGSL. On the
// dev server, compiled WGSL under one hot update key shares its templates, and a hot update sends
// their new shaders, which the thread that draws swaps in.
//
// The thread that draws gets the builds of its GPU path only, so it never holds the other path's
// text. A custom material's builds load on first use, in sets by the permutation bits that a
// device fixes and by skinning; an effect's and a tone curve's take one set for each GPU path.
// When the sketch first uses a shader, this thread imports its first set and sends it on. The
// thread that draws asks for another set when a pipeline first needs one, and this thread imports
// that set then. It imports and sends each set of a template once.

import { DEV } from '../errors/checks';
import { messageOf } from '../errors/message';
import { SHADING_CUSTOM_FIRST } from '../generated/core';
import type { ShaderVariants } from '../generated/shaders';
import type { PieceBuilds, ShaderPiece } from '../gpu/effect-join';
import type { BuildsSender, CustomShader, ShaderSender } from '../shared/images';

/** The GPU path whose builds a page draws with. */
export type ShaderTarget = 'wgsl' | 'glsl';

/** Imports a set of a compiled shader's builds that load on first use, by its permutation bits. */
export type BuildsLoader = (target: ShaderTarget, set: number) => Promise<ShaderVariants>;

/** The builds of `builds` that have output for `target`. */
function only<T extends { readonly wgsl: unknown; readonly glsl: unknown }>(
	builds: Readonly<Record<string, T>>,
	target: ShaderTarget,
): Record<string, T> {
	const kept: Record<string, T> = {};
	for (const name in builds) {
		const build = builds[name] as T;
		if (build[target] !== null) kept[name] = build;
	}
	return kept;
}

/** The templates of the sketch's compiled WGSL, and the shaders that go with them. */
export class ShaderTemplates {
	/** The first template of each compiled WGSL that the sketch used. */
	private readonly firsts = new WeakMap<object, number>();
	/** The template of each shader that the engine joins, by its key. */
	private readonly joined = new Map<string, number>();
	private next = SHADING_CUSTOM_FIRST;
	/** In development builds, the first template of the WGSL under each hot update key. */
	private readonly hotFirsts = new Map<string, number>();
	/** In development builds, the newest shaders under each hot update key that an update brought. */
	private readonly hotShaders = new Map<string, readonly CustomShader[]>();
	/** The import of each template's builds that load on first use. */
	private readonly later = new Map<number, BuildsLoader>();
	/** The sets of each template's builds that this thread imports or sent, by their bits. */
	private readonly sent = new Map<number, Set<number>>();

	/**
	 * `send` gives each template's shader to the thread that draws, with the builds of `target`, or
	 * of both paths without it. `sendBuilds` gives it the sets of builds that load on first use,
	 * from the set of `deviceSet`, the permutation bits that the device fixes, at a material's
	 * first use.
	 */
	constructor(
		private readonly send: ShaderSender = () => {},
		private readonly target?: ShaderTarget,
		private readonly sendBuilds: BuildsSender = () => {},
		private readonly deviceSet = 0,
	) {}

	/**
	 * The first template of `compiled`. The first call for it takes a template for each shader that
	 * `shaders` gives, in order, and sends each one to the thread that draws. On the dev server,
	 * WGSL under the hot update key `hot` shares the templates of the first WGSL under it, and the
	 * newest shaders under it go first. `later` imports the sets of the builds of the shaders that
	 * load on first use: the first set of each starts to load at once.
	 */
	of(
		compiled: object,
		shaders: () => readonly CustomShader[],
		hot?: string,
		later?: BuildsLoader,
	): number {
		let first = this.firsts.get(compiled);
		if (first !== undefined) return first;
		const key = DEV ? hot : undefined;
		first = key === undefined ? undefined : this.hotFirsts.get(key);
		if (first === undefined) {
			first = this.next;
			const made = (key === undefined ? undefined : this.hotShaders.get(key)) ?? shaders();
			this.next += made.length;
			for (let k = 0; k < made.length; k++) this.give(first + k, made[k] as CustomShader);
			if (key !== undefined) this.hotFirsts.set(key, first);
			if (later)
				for (let k = 0; k < made.length; k++) {
					const shader = made[k] as CustomShader;
					if (!shader.builds) continue;
					this.later.set(first + k, later);
					this.answer(first + k, shader.buildsSet ?? this.deviceSet);
				}
		}
		this.firsts.set(compiled, first);
		return first;
	}

	/**
	 * The template of a shader that the thread that draws joins from compiled WGSL, such as a
	 * group of effects, by a key that names what it joins. The first call for a key takes a
	 * template and sends `shader` to the thread that draws.
	 */
	ofKey(key: string, shader: () => CustomShader): number {
		let template = this.joined.get(key);
		if (template === undefined) {
			template = this.next++;
			this.give(template, shader());
			this.joined.set(key, template);
		}
		return template;
	}

	/**
	 * In development builds, sends the shaders of a hot update under `key` to its templates, or
	 * keeps them for the first WGSL under the key that a sketch uses.
	 */
	update(key: string, shaders: readonly CustomShader[]): void {
		if (!DEV) return;
		this.hotShaders.set(key, shaders);
		const first = this.hotFirsts.get(key);
		if (first === undefined) return;
		for (let k = 0; k < shaders.length; k++) this.give(first + k, shaders[k] as CustomShader);
	}

	/**
	 * Imports the set `set` of the builds of `template` that load on first use, which the thread
	 * that draws asked for or which the template's first use sends, and sends it, or why it did not
	 * load. A set that this thread imports or sent already is not sent again.
	 */
	answer(template: number, set: number): void {
		let sent = this.sent.get(template);
		if (sent?.has(set)) return;
		if (!sent) {
			sent = new Set();
			this.sent.set(template, sent);
		}
		sent.add(set);
		const load = this.later.get(template);
		const { target } = this;
		if (!load || !target) {
			this.sendBuilds(template, set, 'the sketch holds no such builds');
			return;
		}
		load(target, set).then(
			(variants) => this.sendBuilds(template, set, variants),
			(error: unknown) => this.sendBuilds(template, set, messageOf(error)),
		);
	}

	/** Sends `shader` under `template`, with the builds and pieces of the page's GPU path. */
	private give(template: number, shader: CustomShader): void {
		const { target } = this;
		if (!target) {
			this.send(template, shader);
			return;
		}
		const { pieces, ...rest } = shader;
		const piecesOf = (builds: PieceBuilds) => only<ShaderPiece>(builds, target);
		this.send(template, {
			...rest,
			variants: only(shader.variants, target),
			...(pieces && { pieces: { group: piecesOf(pieces.group), fold: piecesOf(pieces.fold) } }),
		});
	}
}

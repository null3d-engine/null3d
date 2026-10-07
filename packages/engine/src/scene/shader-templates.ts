// The render pipeline templates of the sketch's compiled WGSL. Custom materials, custom effects and
// custom tone curves each draw with templates of their own, from the first custom template up.
// One counter gives them out, so no two compiled shaders share a template. The shaders of each
// template go to the thread that draws once, the first time a sketch uses the compiled WGSL. On the
// dev server, compiled WGSL under one hot update key shares its templates, and a hot update sends
// their new shaders, which the thread that draws swaps in.

import { DEV } from '../errors/checks';
import { SHADING_CUSTOM_FIRST } from '../generated/core';
import type { CustomShader, ShaderSender } from '../shared/images';

/** The templates of the sketch's compiled WGSL, and the shaders that go with them. */
export class ShaderTemplates {
	/** The first template of each compiled WGSL that the sketch used. */
	private readonly firsts = new WeakMap<object, number>();
	private next = SHADING_CUSTOM_FIRST;
	/** In development builds, the first template of the WGSL under each hot update key. */
	private readonly hotFirsts = new Map<string, number>();
	/** In development builds, the newest shaders under each hot update key that an update brought. */
	private readonly hotShaders = new Map<string, readonly CustomShader[]>();

	/** `send` gives each template's shader to the thread that draws. */
	constructor(private readonly send: ShaderSender = () => {}) {}

	/**
	 * The first template of `compiled`. The first call for it takes a template for each shader that
	 * `shaders` gives, in order, and sends each one to the thread that draws. On the dev server,
	 * WGSL under the hot update key `hot` shares the templates of the first WGSL under it, and the
	 * newest shaders under it go first.
	 */
	of(compiled: object, shaders: () => readonly CustomShader[], hot?: string): number {
		let first = this.firsts.get(compiled);
		if (first !== undefined) return first;
		const key = DEV ? hot : undefined;
		first = key === undefined ? undefined : this.hotFirsts.get(key);
		if (first === undefined) {
			first = this.next;
			const made = (key === undefined ? undefined : this.hotShaders.get(key)) ?? shaders();
			this.next += made.length;
			for (let k = 0; k < made.length; k++) this.send(first + k, made[k] as CustomShader);
			if (key !== undefined) this.hotFirsts.set(key, first);
		}
		this.firsts.set(compiled, first);
		return first;
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
		for (let k = 0; k < shaders.length; k++) this.send(first + k, shaders[k] as CustomShader);
	}
}

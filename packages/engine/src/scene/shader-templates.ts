// The render pipeline templates of the sketch's compiled WGSL. Custom materials, custom effects and
// custom tone curves each draw with templates of their own, from the first custom template up.
// One counter gives them out, so no two compiled shaders share a template. The shaders of each
// template go to the thread that draws once, the first time a sketch uses the compiled WGSL.

import { SHADING_CUSTOM_FIRST } from '../generated/core';
import type { CustomShader, ShaderSender } from '../shared/images';

/** The templates of the sketch's compiled WGSL, and the shaders that go with them. */
export class ShaderTemplates {
	/** The first template of each compiled WGSL that the sketch used. */
	private readonly firsts = new WeakMap<object, number>();
	private next = SHADING_CUSTOM_FIRST;

	/** `send` gives each template's shader to the thread that draws. */
	constructor(private readonly send: ShaderSender = () => {}) {}

	/**
	 * The first template of `compiled`. The first call for it takes a template for each shader that
	 * `shaders` gives, in order, and sends each one to the thread that draws.
	 */
	of(compiled: object, shaders: () => readonly CustomShader[]): number {
		let first = this.firsts.get(compiled);
		if (first === undefined) {
			first = this.next;
			const made = shaders();
			this.next += made.length;
			for (let k = 0; k < made.length; k++) this.send(first + k, made[k] as CustomShader);
			this.firsts.set(compiled, first);
		}
		return first;
	}
}

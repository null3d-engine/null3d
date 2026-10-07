import { describe, expect, it } from 'bun:test';
import * as G from '../../generated/gpu';
import { loadGlslShaders } from '../../generated/shaders';
import { WebGL2Backend } from './backend';

/**
 * A WebGL2 context that lists the calls made on it. Its constants are numbers, it offers no
 * extension, each create call makes an empty object, and every framebuffer is complete.
 */
function fakeContext() {
	const calls: string[] = [];
	let constants = 0;
	const values = new Map<string, number>();
	const constant = (name: string) => {
		if (!values.has(name)) values.set(name, ++constants);
		return values.get(name);
	};
	const gl = new Proxy(
		{},
		{
			get(_, name: string) {
				if (/^[A-Z0-9_]+$/.test(name)) return constant(name);
				return () => {
					calls.push(name);
					if (name === 'checkFramebufferStatus') return constant('FRAMEBUFFER_COMPLETE');
					if (name === 'getExtension') return null;
					if (name === 'getParameter') return 4;
					if (name === 'isContextLost') return false;
					if (name.startsWith('create')) return {};
					return undefined;
				};
			},
		},
	);
	return { gl: gl as WebGL2RenderingContext, calls };
}

describe('WebGL2Backend', () => {
	it('starts to link the mip level and layer copy programs when it starts, without waiting for them', async () => {
		const { gl, calls } = fakeContext();
		const canvas = { width: 1, height: 1 } as OffscreenCanvas;
		new WebGL2Backend(gl, canvas, await loadGlslShaders(0), true, 'reversed');
		expect(calls.filter((name) => name === 'linkProgram')).toHaveLength(2);
		expect(calls).not.toContain('getProgramParameter');
	});

	it('keeps a framebuffer with depth and one without for a target that passes draw into both ways', async () => {
		const { gl, calls } = fakeContext();
		const canvas = { width: 4, height: 4 } as OffscreenCanvas;
		const backend = new WebGL2Backend(gl, canvas, await loadGlslShaders(0), true, 'reversed');
		const words: number[] = [];
		const push = (op: number, operands: number[]) =>
			words.push(op | ((operands.length + 1) << 8), ...operands);
		const usage = G.TEXTURE_USAGE_RENDER_ATTACHMENT | G.TEXTURE_USAGE_TEXTURE_BINDING;
		push(G.OP_CREATE_TEXTURE, [1, 4, 4, 1, G.FORMAT_RGBA16_FLOAT, usage, 1, 1, G.VIEW_2D]);
		push(G.OP_CREATE_TEXTURE, [2, 4, 4, 1, G.FORMAT_DEPTH24_PLUS, usage, 1, 1, G.VIEW_2D]);
		// Three frames, each with a scene pass into the color with the depth, then an effect's pass
		// into the same color without it, as the render graph shares the target between them.
		for (let frame = 0; frame < 3; frame++) {
			for (const depth of [2, G.NO_TARGET]) {
				push(G.OP_BEGIN_RENDER_PASS, [1, G.NO_TARGET, depth, 0, 0, 0, 0, 0, 0]);
				push(G.OP_END_RENDER_PASS, []);
			}
		}
		const list = new Uint32Array(words);
		backend.replay(list, new Float32Array(list.buffer), 0, list.length, new ArrayBuffer(64));
		expect(calls.filter((name) => name === 'createFramebuffer')).toHaveLength(2);
		expect(calls.filter((name) => name === 'checkFramebufferStatus')).toHaveLength(2);
	});
});

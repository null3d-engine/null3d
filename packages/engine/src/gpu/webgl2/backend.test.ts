import { describe, expect, it } from 'bun:test';
import * as G from '../../generated/gpu';
import { loadGlslShaders, type ShaderVariants } from '../../generated/shaders';
import { WebGL2Backend } from './backend';

/**
 * A WebGL2 context that lists the calls made on it. Its constants are numbers, it offers no
 * extension, each create call makes an empty object, every program links and every framebuffer is
 * complete. With `uniforms`, every uniform that a program asks for exists.
 */
function fakeContext(uniforms = false) {
	const calls: string[] = [];
	/** The attachment lists passed to `invalidateFramebuffer`, in call order. */
	const invalidates: number[][] = [];
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
				return (...args: unknown[]) => {
					calls.push(name);
					if (name === 'invalidateFramebuffer') invalidates.push((args[1] as number[]) ?? []);
					if (name === 'checkFramebufferStatus') return constant('FRAMEBUFFER_COMPLETE');
					if (name === 'getExtension') return null;
					if (name === 'getParameter') return 4;
					if (name === 'getProgramParameter') return true;
					if (name === 'isContextLost') return false;
					if (name.startsWith('create')) return {};
					if (name === 'getUniformLocation') return uniforms ? {} : null;
					return undefined;
				};
			},
		},
	);
	return { gl: gl as WebGL2RenderingContext, calls, invalidates };
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

	it('invalidates no attachment a pass does not have', async () => {
		const { gl, invalidates } = fakeContext();
		const canvas = { width: 4, height: 4 } as OffscreenCanvas;
		const backend = new WebGL2Backend(gl, canvas, await loadGlslShaders(0), true, 'reversed');
		const words: number[] = [];
		const push = (op: number, operands: number[]) =>
			words.push(op | ((operands.length + 1) << 8), ...operands);
		const usage = G.TEXTURE_USAGE_RENDER_ATTACHMENT | G.TEXTURE_USAGE_TEXTURE_BINDING;
		// Two passes: a fullscreen step into its own colour target with no depth, as an effect's step,
		// and a depth-only pass that keeps its depth. Neither may invalidate an attachment it lacks.
		push(G.OP_CREATE_TEXTURE, [1, 4, 4, 1, G.FORMAT_RGBA16_FLOAT, usage, 1, 1, G.VIEW_2D]);
		push(G.OP_CREATE_TEXTURE, [2, 4, 4, 1, G.FORMAT_DEPTH24_PLUS, usage, 1, 1, G.VIEW_2D]);
		push(G.OP_BEGIN_RENDER_PASS, [1, G.NO_TARGET, G.NO_TARGET, 0, 0, 0, 0, 0, G.PASS_STORE_COLOR]);
		push(G.OP_END_RENDER_PASS, []);
		push(G.OP_BEGIN_RENDER_PASS, [G.NO_TARGET, G.NO_TARGET, 2, 0, 0, 0, 0, 0, G.PASS_STORE_DEPTH]);
		push(G.OP_END_RENDER_PASS, []);
		const list = new Uint32Array(words);
		backend.replay(list, new Float32Array(list.buffer), 0, list.length, new ArrayBuffer(64));
		// GL's depth attachment, which no pass here lacks while it stores.
		expect(invalidates.flat()).not.toContain(0x8d00);
	});

	it("makes the levels of a linear render target of one layer with GL's own generateMipmap", async () => {
		const { gl, calls } = fakeContext();
		const canvas = { width: 4, height: 4 } as OffscreenCanvas;
		const backend = new WebGL2Backend(gl, canvas, await loadGlslShaders(0), true, 'reversed');
		const words: number[] = [];
		const push = (op: number, operands: number[]) =>
			words.push(op | ((operands.length + 1) << 8), ...operands);
		const replay = () => {
			const list = new Uint32Array(words.splice(0));
			backend.replay(list, new Float32Array(list.buffer), 0, list.length, new ArrayBuffer(64));
		};
		const usage = G.TEXTURE_USAGE_RENDER_ATTACHMENT | G.TEXTURE_USAGE_TEXTURE_BINDING;
		const array = G.VIEW_2D_ARRAY;
		push(G.OP_CREATE_TEXTURE, [1, 64, 64, 1, G.FORMAT_RGBA16_FLOAT, usage, 1, 7, array]);
		push(G.OP_GENERATE_MIPMAPS, [1, 0]);
		replay();
		expect(calls.filter((name) => name === 'generateMipmap')).toHaveLength(1);
		expect(calls).not.toContain('drawArrays');
		// An sRGB target, an array of several layers and a texture of uploaded images draw each level.
		const srgb = G.FORMAT_RGBA8_UNORM_SRGB;
		const uploaded = usage | G.TEXTURE_USAGE_COPY_DST;
		push(G.OP_CREATE_TEXTURE, [2, 64, 64, 1, srgb, usage, 1, 7, array]);
		push(G.OP_CREATE_TEXTURE, [3, 64, 64, 4, G.FORMAT_RGBA16_FLOAT, usage, 1, 7, array]);
		push(G.OP_CREATE_TEXTURE, [4, 64, 64, 1, G.FORMAT_RGBA8_UNORM, uploaded, 1, 7, array]);
		for (const id of [2, 3, 4]) push(G.OP_GENERATE_MIPMAPS, [id, 0]);
		replay();
		expect(calls.filter((name) => name === 'generateMipmap')).toHaveLength(1);
		expect(calls.filter((name) => name === 'drawArrays')).toHaveLength(3 * 6);
	});

	it('keeps a running total of the GPU memory that its buffers, textures and renderbuffers take', async () => {
		const { gl } = fakeContext();
		const canvas = { width: 4, height: 4 } as OffscreenCanvas;
		const backend = new WebGL2Backend(gl, canvas, await loadGlslShaders(0), true, 'reversed');
		const words: number[] = [];
		const push = (op: number, operands: number[]) =>
			words.push(op | ((operands.length + 1) << 8), ...operands);
		const replay = () => {
			const list = new Uint32Array(words.splice(0));
			backend.replay(list, new Float32Array(list.buffer), 0, list.length, new ArrayBuffer(64));
		};
		const sampled = G.TEXTURE_USAGE_TEXTURE_BINDING | G.TEXTURE_USAGE_COPY_DST;
		const target = G.TEXTURE_USAGE_RENDER_ATTACHMENT;
		push(G.OP_CREATE_BUFFER, [1, 1000, G.BUFFER_USAGE_VERTEX]);
		push(G.OP_CREATE_BUFFER, [2, 256, G.BUFFER_USAGE_UNIFORM]);
		// A cube of 16 x 16 faces with its levels of 8 x 8 and 4 x 4.
		push(G.OP_CREATE_TEXTURE, [3, 16, 16, 6, G.FORMAT_RGBA16_FLOAT, sampled, 1, 3, G.VIEW_CUBE]);
		// A multisampled color target, which lives in a renderbuffer of 4 samples.
		push(G.OP_CREATE_TEXTURE, [4, 32, 32, 1, G.FORMAT_RGBA8_UNORM, target, 4, 1, G.VIEW_2D]);
		// A multisampled depth target that shaders read, with its copy of one sample.
		push(G.OP_CREATE_TEXTURE, [
			5,
			32,
			32,
			1,
			G.FORMAT_DEPTH24_PLUS,
			target | G.TEXTURE_USAGE_TEXTURE_BINDING,
			4,
			1,
			G.VIEW_2D,
		]);
		push(G.OP_CREATE_TEXTURE_VIEW, [6, 3, 1, 2]);
		replay();
		const cube = 6 * (16 * 16 + 8 * 8 + 4 * 4) * 8;
		const color = 32 * 32 * 4 * 4;
		const depth = 32 * 32 * 4 * 4 + 32 * 32 * 4;
		expect([...backend.gpuMemory.bytes]).toEqual([cube + color + depth, 1256]);
		push(G.OP_CREATE_BUFFER, [1, 3000, G.BUFFER_USAGE_VERTEX]);
		push(G.OP_DESTROY_BUFFER, [2]);
		push(G.OP_DESTROY_TEXTURE, [5]);
		push(G.OP_DESTROY_TEXTURE, [6]);
		replay();
		expect([...backend.gpuMemory.bytes]).toEqual([cube + color, 3000]);
		backend.destroy();
		expect([...backend.gpuMemory.bytes]).toEqual([0, 0]);
	});

	it('reads a uniform buffer range that a shader takes as a texture from a copy, made again after each write', async () => {
		const { gl, calls } = fakeContext(true);
		const canvas = { width: 4, height: 4 } as OffscreenCanvas;
		const backend = new WebGL2Backend(gl, canvas, await loadGlslShaders(0), true, 'reversed');
		const stage = (
			textures: { name: string; group: number; binding: number; sampler: null }[],
		) => ({
			source: '',
			uniformBlocks: [],
			textures,
		});
		// A shader that reads group 1's binding 0 as a texture, as the multi-draw builds read their records.
		const shader: ShaderVariants = {
			table: {
				permutation: 0,
				wgsl: null,
				glsl: {
					main: {
						vertex: stage([{ name: 'records', group: 1, binding: 0, sampler: null }]),
						fragment: stage([]),
					},
				},
			},
		};
		backend.defineTemplate(G.TEMPLATE_CUSTOM_FIRST, { shader, pipeline: 'main' });
		const words: number[] = [];
		const push = (op: number, operands: number[]) =>
			words.push(op | ((operands.length + 1) << 8), ...operands);
		const uploads = () => calls.filter((name) => name === 'texSubImage2D').length;
		const before = uploads();
		const copies = () => uploads() - before;
		const replay = () => {
			const list = new Uint32Array(words.splice(0));
			backend.replay(list, new Float32Array(list.buffer), 0, list.length, new ArrayBuffer(8192));
		};
		const target = G.TEXTURE_USAGE_RENDER_ATTACHMENT;
		push(G.OP_CREATE_TEXTURE, [1, 4, 4, 1, G.FORMAT_RGBA8_UNORM, target, 1, 1, G.VIEW_2D]);
		push(G.OP_CREATE_BUFFER, [2, 8192, G.BUFFER_USAGE_UNIFORM | G.BUFFER_USAGE_COPY_DST]);
		push(G.OP_CREATE_BIND_GROUP, [3, G.LAYOUT_DRAWS, 1, 0, G.RESOURCE_BUFFER, 2, 0, 4096]);
		push(G.OP_CREATE_RENDER_PIPELINE, [
			4,
			G.TEMPLATE_CUSTOM_FIRST,
			0,
			G.FORMAT_RGBA8_UNORM,
			G.FORMAT_NONE,
			1,
			G.STATE_CULL_NONE,
			0,
			0,
			0,
		]);
		push(G.OP_BEGIN_RENDER_PASS, [1, G.NO_TARGET, G.NO_TARGET, 0, 0, 0, 0, 0, 0]);
		push(G.OP_SET_PIPELINE, [4]);
		const draw = (offset: number) => {
			push(G.OP_SET_BIND_GROUP, [1, 3, 1, offset]);
			push(G.OP_DRAW, [3, 1, 0, 0]);
		};
		draw(0);
		draw(0);
		draw(4096);
		draw(0);
		replay();
		// One copy of each range, which later draws of the range reuse.
		expect(copies()).toBe(2);
		push(G.OP_WRITE_BUFFER, [2, 0, 0, 16]);
		draw(0);
		draw(0);
		replay();
		expect(copies()).toBe(3);
		// A new range takes the texture of the range that no draw read since the write.
		draw(2048);
		push(G.OP_END_RENDER_PASS, []);
		replay();
		expect(copies()).toBe(4);
		// Each copy is one texel of four 32-bit words per 16 bytes.
		expect([...backend.gpuMemory.bytes]).toEqual([4 * 4 * 4 + 2 * 4096, 8192]);
		backend.destroy();
		expect([...backend.gpuMemory.bytes]).toEqual([0, 0]);
	});
});

// The WebGL2 backend: owns every GL object in tables indexed by the core's resource ids, and
// replays binary draw lists into WebGL2 calls. A state cache skips calls that would set what is
// already set. The replay loop reads 32-bit words from views on engine memory, uploads straight
// from them, and allocates nothing per command, except when a command creates a GL object. Where
// WebGL refuses views on shared memory, uploads first copy their words out of it into a staging
// buffer.

import * as G from '../../generated/gpu';
import { createProgram, type Program, prepareProgram, SLOTS_PER_GROUP } from './programs';

/** The texture unit that texture uploads use, apart from the units that bind groups use. */
const UPLOAD_UNIT = 15;

// Attachment names, for invalidating what a pass does not store.
const COLOR_ATTACHMENT0 = 0x8ce0;
const DEPTH_ATTACHMENT = 0x8d00;
const DISCARD_BOTH = [COLOR_ATTACHMENT0, DEPTH_ATTACHMENT];
const DISCARD_COLOR = [COLOR_ATTACHMENT0];
const DISCARD_DEPTH = [DEPTH_ATTACHMENT];

/** Where drawing into the canvas goes during a capture: an offscreen stand-in of the same size. */
export interface CanvasTarget {
	framebuffer: WebGLFramebuffer;
	width: number;
	height: number;
}

interface GlBuffer {
	buffer: WebGLBuffer;
	size: number;
}

/** A data texture, or a render target, which WebGL2 keeps in a renderbuffer. */
interface GlTexture {
	texture: WebGLTexture | null;
	renderbuffer: WebGLRenderbuffer | null;
	width: number;
	height: number;
	format: number;
}

interface BindEntry {
	binding: number;
	kind: number;
	resource: number;
	offset: number;
	size: number;
}

/** A vertex page's vertex array object, and the buffers it was made for. */
interface VertexArray {
	vao: WebGLVertexArrayObject;
	vertices: WebGLBuffer;
	indices: WebGLBuffer;
}

/** The framebuffer of a pass that draws into render targets. */
interface PassFramebuffer {
	framebuffer: WebGLFramebuffer;
	color: WebGLRenderbuffer;
	depth: WebGLRenderbuffer | null;
}

export class WebGL2Backend {
	private readonly buffers: (GlBuffer | undefined)[] = [];
	private readonly textures: (GlTexture | undefined)[] = [];
	private readonly programs: (Program | undefined)[] = [];
	private readonly bindGroups: (BindEntry[] | undefined)[] = [];
	private readonly vertexArrays: (VertexArray | undefined)[] = [];
	private readonly multiDraw: WEBGL_multi_draw | null;
	private readonly maxSamples: number;
	private passFramebuffer: PassFramebuffer | undefined;
	/** Where drawing into the canvas goes during a capture; the canvas itself otherwise. */
	canvasTarget: CanvasTarget | undefined;
	/** What the replays since the last reset uploaded, drew and built. */
	readonly counts = { uploadBytes: 0, drawCalls: 0, pipelines: 0 };

	// Views on engine memory, rebuilt when it grows, and copies for browsers that refuse views on
	// shared memory.
	private memory: ArrayBufferLike | undefined;
	private bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	private ints: Int32Array<ArrayBufferLike> = new Int32Array(0);
	private copying = false;
	private staging = new ArrayBuffer(0);
	private stagingBytes = new Uint8Array(0);
	private stagingFloats = new Float32Array(0);
	private stagingUints = new Uint32Array(0);
	private stagingInts = new Int32Array(0);
	/** A multi-draw call's counts, offsets and instance counts, one after another. */
	private drawLists = new Int32Array(3 * G.SIZE_MULTI_DRAW_RECORDS);

	// The state cache.
	private program: WebGLProgram | null = null;
	private vertexArray: WebGLVertexArrayObject | null = null;
	private activeUnit = -1;
	private readonly unitTextures: (WebGLTexture | null)[] = [];
	private readonly blockBuffers: (WebGLBuffer | null)[] = [];
	private readonly blockOffsets: number[] = [];
	private readonly blockSizes: number[] = [];
	private cullFace = false;
	private depthTest = false;
	private depthMask = true;
	// Fractions passed to WebGL become new number objects, so the clear values are set only when
	// they change.
	private readonly clearColor = [0, 0, 0, 0];
	private clearDepth = 1;

	// The pass and draw state the list set last.
	private current: Program | undefined;
	private vertexBuffer = 0;
	private indexBuffer = 0;
	private indexType = 0;
	private indexBytes = 2;
	private passWidth = 0;
	private passHeight = 0;
	private passResolve = G.NO_TARGET;
	private passFlags = 0;
	private passToCanvas = false;

	/**
	 * `sharedUploads` is false where WebGL refuses views on shared memory, so uploads and multi-draw
	 * arrays go through copies.
	 */
	constructor(
		private readonly gl: WebGL2RenderingContext,
		private readonly canvas: OffscreenCanvas | HTMLCanvasElement,
		private readonly sharedUploads: boolean,
	) {
		this.multiDraw = gl.getExtension('WEBGL_multi_draw');
		gl.getExtension('KHR_parallel_shader_compile');
		this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
		this.indexType = gl.UNSIGNED_SHORT;
		// Depth is reversed on both GPU paths: 1 at the near plane, 0 at the far plane.
		gl.depthFunc(gl.GREATER);
	}

	private need<T>(table: (T | undefined)[], id: number, what: string): T {
		const value = table[id];
		if (value === undefined) throw new Error(`draw list names ${what} ${id}, which does not exist`);
		return value;
	}

	resetCounts(): void {
		this.counts.uploadBytes = 0;
		this.counts.drawCalls = 0;
		this.counts.pipelines = 0;
	}

	/**
	 * Replays the draw list in `words[start, end)`. `floats` views the same memory as `words`, for
	 * float operands; `memory` is the engine memory that uploads read from.
	 */
	replay(
		words: Uint32Array,
		floats: Float32Array,
		start: number,
		end: number,
		memory: ArrayBufferLike,
	): void {
		if (memory !== this.memory) {
			this.memory = memory;
			this.bytes = new Uint8Array(memory);
			this.ints = new Int32Array(memory);
			this.copying =
				!this.sharedUploads &&
				typeof SharedArrayBuffer === 'function' &&
				memory instanceof SharedArrayBuffer;
		}
		const gl = this.gl;
		for (let i = start; i < end; ) {
			const header = words[i] as number;
			const op = header & 0xff;
			const length = header >>> 8;
			if (length === 0 || i + length > end) throw new Error(`draw list is truncated at word ${i}`);
			const a = i + 1;
			switch (op) {
				case G.OP_CREATE_BUFFER:
					this.createBuffer(words[a] as number, words[a + 1] as number, words[a + 2] as number);
					break;
				case G.OP_WRITE_BUFFER: {
					const buffer = this.need(this.buffers, words[a] as number, 'buffer').buffer;
					const offset = words[a + 1] as number;
					const source = words[a + 2] as number;
					const bytes = words[a + 3] as number;
					gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
					if (this.copying) {
						gl.bufferSubData(gl.COPY_WRITE_BUFFER, offset, this.stage(source, bytes), 0, bytes);
					} else {
						gl.bufferSubData(gl.COPY_WRITE_BUFFER, offset, this.bytes, source, bytes);
					}
					this.counts.uploadBytes += bytes;
					break;
				}
				case G.OP_DESTROY_BUFFER:
					this.destroyBuffer(words[a] as number);
					break;
				case G.OP_CREATE_TEXTURE:
					this.createTexture(words, a);
					break;
				case G.OP_DESTROY_TEXTURE:
					this.destroyTexture(words[a] as number);
					break;
				case G.OP_WRITE_TEXTURE:
					this.writeTexture(words, floats, a);
					break;
				case G.OP_RESIZE_CANVAS: {
					const width = words[a] as number;
					const height = words[a + 1] as number;
					if (this.canvas.width !== width || this.canvas.height !== height) {
						this.canvas.width = width;
						this.canvas.height = height;
					}
					break;
				}
				case G.OP_CREATE_RENDER_PIPELINE:
					this.programs[words[a] as number] = createProgram(
						gl,
						words[a + 1] as number,
						words[a + 2] as number,
						words[a + 4] as number,
						words[a + 6] as number,
					);
					this.counts.pipelines++;
					break;
				case G.OP_CREATE_BIND_GROUP: {
					const entries: BindEntry[] = [];
					for (let k = 0; k < (words[a + 2] as number); k++) {
						const e = a + 3 + k * 5;
						entries.push({
							binding: words[e] as number,
							kind: words[e + 1] as number,
							resource: words[e + 2] as number,
							offset: words[e + 3] as number,
							size: words[e + 4] as number,
						});
					}
					this.bindGroups[words[a] as number] = entries;
					break;
				}
				case G.OP_BEGIN_RENDER_PASS:
					this.beginPass(words, floats, a);
					break;
				case G.OP_END_RENDER_PASS:
					this.endPass();
					break;
				case G.OP_SET_PIPELINE:
					this.setPipeline(this.need(this.programs, words[a] as number, 'render pipeline'));
					break;
				case G.OP_SET_BIND_GROUP:
					this.setBindGroup(words, a);
					break;
				case G.OP_SET_VERTEX_BUFFER:
					if (words[a] !== 0) throw new Error('the WebGL2 backend reads vertices from slot 0 only');
					this.vertexBuffer = words[a + 1] as number;
					break;
				case G.OP_SET_INDEX_BUFFER:
					this.indexBuffer = words[a] as number;
					this.indexType =
						words[a + 1] === G.INDEX_FORMAT_UINT32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
					this.indexBytes = words[a + 1] === G.INDEX_FORMAT_UINT32 ? 4 : 2;
					break;
				case G.OP_DRAW_INDEXED: {
					if (words[a + 3] !== 0) throw new Error('WebGL2 has no base vertex for draws');
					this.prepareDraw(words[a + 4] as number);
					gl.drawElementsInstanced(
						gl.TRIANGLES,
						words[a] as number,
						this.indexType,
						(words[a + 2] as number) * this.indexBytes,
						words[a + 1] as number,
					);
					this.counts.drawCalls++;
					break;
				}
				case G.OP_MULTI_DRAW_INDEXED:
					this.multiDrawIndexed(words, a);
					break;
				case G.OP_SUBMIT:
					break;
				default:
					throw new Error(`the WebGL2 backend cannot replay draw list command ${op} at word ${i}`);
			}
			i += length;
		}
	}

	/** Makes the staging buffer hold at least `bytes`. */
	private ensureStaging(bytes: number): void {
		if (this.staging.byteLength >= bytes) return;
		this.staging = new ArrayBuffer(Math.max(bytes, this.staging.byteLength * 2));
		this.stagingBytes = new Uint8Array(this.staging);
		this.stagingFloats = new Float32Array(this.staging);
		this.stagingUints = new Uint32Array(this.staging);
		this.stagingInts = new Int32Array(this.staging);
	}

	/**
	 * Copies bytes out of shared memory into the staging buffer, and returns them. Uploads start and
	 * end on four-byte boundaries, so a loop copies whole words, which makes no view per upload.
	 */
	private stage(source: number, bytes: number): Uint8Array {
		this.ensureStaging(bytes);
		const from = source >>> 2;
		const staged = this.stagingInts;
		const ints = this.ints;
		for (let k = 0; k < bytes >>> 2; k++) staged[k] = ints[from + k] as number;
		return this.stagingBytes;
	}

	private useVertexArray(vao: WebGLVertexArrayObject | null): void {
		if (this.vertexArray === vao) return;
		this.gl.bindVertexArray(vao);
		this.vertexArray = vao;
	}

	private bindTexture(unit: number, texture: WebGLTexture | null): void {
		const gl = this.gl;
		if (this.unitTextures[unit] === texture) return;
		if (this.activeUnit !== unit) {
			gl.activeTexture(gl.TEXTURE0 + unit);
			this.activeUnit = unit;
		}
		gl.bindTexture(gl.TEXTURE_2D, texture);
		this.unitTextures[unit] = texture;
	}

	private createBuffer(id: number, size: number, usage: number): void {
		const gl = this.gl;
		this.destroyBuffer(id);
		const buffer = gl.createBuffer();
		if (!buffer) throw new Error('WebGL2 could not create a buffer');
		// A buffer's first binding fixes its kind; an index buffer must first bind as one, which
		// also binds it to the current vertex array, so none may be current.
		const target =
			usage & G.BUFFER_USAGE_INDEX
				? gl.ELEMENT_ARRAY_BUFFER
				: usage & G.BUFFER_USAGE_UNIFORM
					? gl.UNIFORM_BUFFER
					: gl.ARRAY_BUFFER;
		this.useVertexArray(null);
		gl.bindBuffer(target, buffer);
		gl.bufferData(target, size, gl.DYNAMIC_DRAW);
		this.buffers[id] = { buffer, size };
	}

	private destroyBuffer(id: number): void {
		const old = this.buffers[id];
		if (!old) return;
		this.gl.deleteBuffer(old.buffer);
		this.buffers[id] = undefined;
		for (let slot = 0; slot < this.blockBuffers.length; slot++)
			if (this.blockBuffers[slot] === old.buffer) this.blockBuffers[slot] = null;
	}

	private createTexture(words: Uint32Array, a: number): void {
		const gl = this.gl;
		const id = words[a] as number;
		const width = words[a + 1] as number;
		const height = words[a + 2] as number;
		const format = words[a + 4] as number;
		const usage = words[a + 5] as number;
		const samples = words[a + 6] as number;
		this.destroyTexture(id);
		if (usage & G.TEXTURE_USAGE_RENDER_ATTACHMENT) {
			const renderbuffer = gl.createRenderbuffer();
			if (!renderbuffer) throw new Error('WebGL2 could not create a renderbuffer');
			gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
			const internal = this.renderFormat(format);
			if (samples > 1) {
				gl.renderbufferStorageMultisample(
					gl.RENDERBUFFER,
					Math.min(samples, this.maxSamples),
					internal,
					width,
					height,
				);
			} else {
				gl.renderbufferStorage(gl.RENDERBUFFER, internal, width, height);
			}
			this.textures[id] = { texture: null, renderbuffer, width, height, format };
			return;
		}
		const texture = gl.createTexture();
		if (!texture) throw new Error('WebGL2 could not create a texture');
		this.bindTexture(UPLOAD_UNIT, texture);
		const internal =
			format === G.FORMAT_RGBA32_FLOAT
				? gl.RGBA32F
				: format === G.FORMAT_R32_UINT
					? gl.R32UI
					: this.renderFormat(format);
		gl.texStorage2D(gl.TEXTURE_2D, words[a + 7] as number, internal, width, height);
		// Data textures are read with texelFetch, which needs no filtering; 32-bit formats cannot
		// be filtered without extensions, and would read as incomplete.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		this.textures[id] = { texture, renderbuffer: null, width, height, format };
	}

	/**
	 * The GL format of a render target. The canvas holds three channels when its context has no
	 * alpha, and a multisampled image resolves only into the same format.
	 */
	private renderFormat(format: number): number {
		const gl = this.gl;
		switch (format) {
			case G.FORMAT_CANVAS:
				return gl.RGB8;
			case G.FORMAT_RGBA8_UNORM:
				return gl.RGBA8;
			case G.FORMAT_RGBA16_FLOAT:
				return gl.RGBA16F;
			case G.FORMAT_DEPTH24_PLUS:
				return gl.DEPTH_COMPONENT24;
			case G.FORMAT_DEPTH32_FLOAT:
				return gl.DEPTH_COMPONENT32F;
			default:
				throw new Error(`the WebGL2 backend has no render target format ${format}`);
		}
	}

	private destroyTexture(id: number): void {
		const gl = this.gl;
		const old = this.textures[id];
		if (!old) return;
		if (old.texture) {
			gl.deleteTexture(old.texture);
			for (let unit = 0; unit < this.unitTextures.length; unit++)
				if (this.unitTextures[unit] === old.texture) this.unitTextures[unit] = null;
		}
		if (old.renderbuffer) gl.deleteRenderbuffer(old.renderbuffer);
		this.textures[id] = undefined;
	}

	/** Writes a rectangle of a data texture: rows of matrices as floats, or index lists as uints. */
	private writeTexture(words: Uint32Array, floats: Float32Array, a: number): void {
		const gl = this.gl;
		const texture = this.need(this.textures, words[a] as number, 'texture');
		const source = words[a + 5] as number;
		const bytes = words[a + 6] as number;
		const float = texture.format === G.FORMAT_RGBA32_FLOAT;
		if (this.copying) this.stage(source, bytes);
		const data = this.copying
			? float
				? this.stagingFloats
				: this.stagingUints
			: float
				? floats
				: words;
		this.bindTexture(UPLOAD_UNIT, texture.texture);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			words[a + 1] as number,
			words[a + 2] as number,
			words[a + 3] as number,
			words[a + 4] as number,
			float ? gl.RGBA : gl.RED_INTEGER,
			float ? gl.FLOAT : gl.UNSIGNED_INT,
			data,
			this.copying ? 0 : source / 4,
		);
		this.counts.uploadBytes += bytes;
	}

	private beginPass(words: Uint32Array, floats: Float32Array, a: number): void {
		const gl = this.gl;
		const color = words[a] as number;
		const depth = words[a + 2] as number;
		const flags = words[a + 8] as number;
		this.passResolve = words[a + 1] as number;
		this.passFlags = flags;
		this.passToCanvas = color === 0;
		if (color === 0) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.canvasTarget?.framebuffer ?? null);
			this.passWidth = this.canvasTarget?.width ?? this.canvas.width;
			this.passHeight = this.canvasTarget?.height ?? this.canvas.height;
		} else {
			const target = this.need(this.textures, color, 'texture');
			const depthTarget =
				depth === G.NO_TARGET ? undefined : this.need(this.textures, depth, 'texture');
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebufferFor(target, depthTarget));
			this.passWidth = target.width;
			this.passHeight = target.height;
		}
		gl.viewport(0, 0, this.passWidth, this.passHeight);
		let clear = 0;
		if (flags & G.PASS_CLEAR_COLOR) {
			const color = this.clearColor;
			if (
				color[0] !== floats[a + 3] ||
				color[1] !== floats[a + 4] ||
				color[2] !== floats[a + 5] ||
				color[3] !== floats[a + 6]
			) {
				for (let k = 0; k < 4; k++) color[k] = floats[a + 3 + k] as number;
				gl.clearColor(
					color[0] as number,
					color[1] as number,
					color[2] as number,
					color[3] as number,
				);
			}
			clear |= gl.COLOR_BUFFER_BIT;
		}
		if (flags & G.PASS_CLEAR_DEPTH && depth !== G.NO_TARGET) {
			if (!this.depthMask) {
				gl.depthMask(true);
				this.depthMask = true;
			}
			if (this.clearDepth !== floats[a + 7]) {
				this.clearDepth = floats[a + 7] as number;
				gl.clearDepth(this.clearDepth);
			}
			clear |= gl.DEPTH_BUFFER_BIT;
		}
		if (clear) gl.clear(clear);
	}

	/** The framebuffer of a pass's render targets, made again only when they change. */
	private framebufferFor(color: GlTexture, depth: GlTexture | undefined): WebGLFramebuffer {
		const gl = this.gl;
		const colorBuffer = color.renderbuffer;
		if (!colorBuffer) throw new Error('the WebGL2 backend draws only into render targets');
		const depthBuffer = depth?.renderbuffer ?? null;
		const cached = this.passFramebuffer;
		if (cached && cached.color === colorBuffer && cached.depth === depthBuffer)
			return cached.framebuffer;
		if (cached) gl.deleteFramebuffer(cached.framebuffer);
		const framebuffer = gl.createFramebuffer();
		if (!framebuffer) throw new Error('WebGL2 could not create a framebuffer');
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorBuffer);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
		this.passFramebuffer = { framebuffer, color: colorBuffer, depth: depthBuffer };
		return framebuffer;
	}

	private endPass(): void {
		const gl = this.gl;
		if (this.passToCanvas) return;
		const framebuffer = this.passFramebuffer?.framebuffer ?? null;
		if (this.passResolve !== G.NO_TARGET) {
			if (this.passResolve !== 0)
				throw new Error('the WebGL2 backend resolves passes into the canvas only');
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.canvasTarget?.framebuffer ?? null);
			const width = this.passWidth;
			const height = this.passHeight;
			gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
		}
		// Tile-based GPUs then skip writing the multisampled targets back to memory.
		const storeColor = (this.passFlags & G.PASS_STORE_COLOR) !== 0;
		const storeDepth = (this.passFlags & G.PASS_STORE_DEPTH) !== 0;
		const discard = storeColor
			? storeDepth
				? undefined
				: DISCARD_DEPTH
			: storeDepth
				? DISCARD_COLOR
				: DISCARD_BOTH;
		if (discard) {
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
			gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, discard);
		}
	}

	private setPipeline(p: Program): void {
		const gl = this.gl;
		if (!p.ready) {
			prepareProgram(gl, p);
			this.program = p.program;
		}
		if (this.program !== p.program) {
			gl.useProgram(p.program);
			this.program = p.program;
		}
		this.current = p;
		const cull = !p.cullNone;
		if (cull !== this.cullFace) {
			if (cull) gl.enable(gl.CULL_FACE);
			else gl.disable(gl.CULL_FACE);
			this.cullFace = cull;
		}
		if (p.depth !== this.depthTest) {
			if (p.depth) gl.enable(gl.DEPTH_TEST);
			else gl.disable(gl.DEPTH_TEST);
			this.depthTest = p.depth;
		}
		if (p.depth && !this.depthMask) {
			gl.depthMask(true);
			this.depthMask = true;
		}
	}

	private setBindGroup(words: Uint32Array, a: number): void {
		const gl = this.gl;
		const group = words[a] as number;
		const entries = this.need(this.bindGroups, words[a + 1] as number, 'bind group');
		const offsets = words[a + 2] as number;
		// The group's dynamic offsets apply to its buffer entries, in order.
		let dynamic = 0;
		for (let k = 0; k < entries.length; k++) {
			const entry = entries[k] as BindEntry;
			const slot = group * SLOTS_PER_GROUP + entry.binding;
			if (entry.kind === G.RESOURCE_BUFFER) {
				const buffer = this.need(this.buffers, entry.resource, 'buffer');
				const offset = entry.offset + (dynamic < offsets ? (words[a + 3 + dynamic] as number) : 0);
				dynamic++;
				const size = entry.size || buffer.size - offset;
				if (
					this.blockBuffers[slot] !== buffer.buffer ||
					this.blockOffsets[slot] !== offset ||
					this.blockSizes[slot] !== size
				) {
					gl.bindBufferRange(gl.UNIFORM_BUFFER, slot, buffer.buffer, offset, size);
					this.blockBuffers[slot] = buffer.buffer;
					this.blockOffsets[slot] = offset;
					this.blockSizes[slot] = size;
				}
			} else if (entry.kind === G.RESOURCE_TEXTURE) {
				this.bindTexture(slot, this.need(this.textures, entry.resource, 'texture').texture);
			}
		}
	}

	/** Binds the vertex array of the current vertex and index buffers, and the first instance. */
	private prepareDraw(firstInstance: number): void {
		const gl = this.gl;
		const vertices = this.need(this.buffers, this.vertexBuffer, 'buffer').buffer;
		const indices = this.need(this.buffers, this.indexBuffer, 'buffer').buffer;
		const cached = this.vertexArrays[this.vertexBuffer];
		if (cached && cached.vertices === vertices && cached.indices === indices) {
			this.useVertexArray(cached.vao);
		} else {
			if (cached) gl.deleteVertexArray(cached.vao);
			const vao = gl.createVertexArray();
			if (!vao) throw new Error('WebGL2 could not create a vertex array');
			this.useVertexArray(vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, G.SIZE_VERTEX_STRIDE, 0);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 3, gl.FLOAT, false, G.SIZE_VERTEX_STRIDE, 12);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
			this.vertexArrays[this.vertexBuffer] = { vao, vertices, indices };
		}
		const p = this.current;
		if (!p) throw new Error('draw list draws before it sets a pipeline');
		if (p.firstInstance && p.firstInstanceValue !== firstInstance) {
			gl.uniform1ui(p.firstInstance, firstInstance);
			p.firstInstanceValue = firstInstance;
		}
	}

	/**
	 * Draws a run of buckets in one multi-draw call. Safari reads all of an array that a multi-draw
	 * call gets, not just the entries its draws use, so a view on engine memory would cost time in
	 * proportion to the memory: over 200 ms a call at 16 MB. The draws' three lists therefore go
	 * into a small array of their own, which a loop fills without making a view.
	 */
	private multiDrawIndexed(words: Uint32Array, a: number): void {
		const ext = this.multiDraw;
		if (!ext) throw new Error('this WebGL2 context has no WEBGL_multi_draw');
		const count = words[a] as number;
		const ints = this.ints;
		const counts = (words[a + 1] as number) / 4;
		const offsets = (words[a + 2] as number) / 4;
		const instances = (words[a + 3] as number) / 4;
		if (count === 1) {
			// One draw needs no arrays. Its gl_DrawID is 0 either way, so it reads the same record.
			this.prepareDraw(0);
			this.gl.drawElementsInstanced(
				this.gl.TRIANGLES,
				ints[counts] as number,
				this.indexType,
				ints[offsets] as number,
				ints[instances] as number,
			);
			this.counts.drawCalls += 1;
			return;
		}
		if (this.drawLists.length < 3 * count) this.drawLists = new Int32Array(3 * count);
		const lists = this.drawLists;
		for (let k = 0; k < count; k++) {
			lists[k] = ints[counts + k] as number;
			lists[count + k] = ints[offsets + k] as number;
			lists[2 * count + k] = ints[instances + k] as number;
		}
		this.prepareDraw(0);
		ext.multiDrawElementsInstancedWEBGL(
			this.gl.TRIANGLES,
			lists,
			0,
			this.indexType,
			lists,
			count,
			lists,
			2 * count,
			count,
		);
		this.counts.drawCalls += count;
	}

	destroy(): void {
		const gl = this.gl;
		for (let id = 0; id < this.buffers.length; id++) this.destroyBuffer(id);
		for (let id = 0; id < this.textures.length; id++) this.destroyTexture(id);
		for (const p of this.programs) if (p) gl.deleteProgram(p.program);
		for (const v of this.vertexArrays) if (v) gl.deleteVertexArray(v.vao);
		if (this.passFramebuffer) gl.deleteFramebuffer(this.passFramebuffer.framebuffer);
	}
}

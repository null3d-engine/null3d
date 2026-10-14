// WebGPU descriptors and lists that each frame fills again instead of making new ones, so a frame
// allocates none of its own. WebGPU reads a descriptor only during the call that takes it, so one
// object can serve every frame.

/**
 * A render pass descriptor with at most two color targets and one depth target. Only the weighted
 * layer draws into a second color target, which clears and stores as the first does.
 */
/** How many clear colors a render pass setup keeps, more than a frame's passes clear to. */
const CLEAR_COLORS = 4;

/**
 * A color whose parts the browser reads without making objects. Its parts start as `null`, so the
 * browser keeps each number stored there as an object of its own, and hands that object over when
 * it reads the part. A part that starts as a number holds a fraction unboxed, and the browser's
 * reading of a descriptor then makes a new 12-byte number object for each fraction at every call.
 */
function boxedColor(): GPUColorDict {
	return { r: null, g: null, b: null, a: null } as unknown as GPUColorDict;
}

/** A render pass descriptor with at most one color target and one depth target. */
export class RenderPassSetup {
	/**
	 * The latest clear colors, each made once, so a frame whose passes clear to the same few colors
	 * stores no new parts. Their parts in `clearParts` are what the colors are compared by: a part
	 * read back from a color to compare it with a fraction would be boxed for the comparison.
	 */
	private readonly clearColors: GPUColorDict[] = Array.from({ length: CLEAR_COLORS }, boxedColor);
	private readonly clearParts = new Float32Array(4 * CLEAR_COLORS).fill(Number.NaN);
	/** The clear color that the next new color replaces. */
	private nextClearColor = 0;
	private readonly colorTarget: GPURenderPassColorAttachment = {
		view: undefined as unknown as GPUTextureView,
		loadOp: 'clear',
		storeOp: 'store',
		clearValue: undefined,
	};
	private readonly colorTargets: GPURenderPassColorAttachment[] = [this.colorTarget];
	private readonly secondTarget: GPURenderPassColorAttachment = {
		view: undefined as unknown as GPUTextureView,
		loadOp: 'clear',
		storeOp: 'store',
		clearValue: undefined,
	};
	private readonly twoColorTargets: GPURenderPassColorAttachment[] = [
		this.colorTarget,
		this.secondTarget,
	];
	private readonly noColorTargets: GPURenderPassColorAttachment[] = [];
	private readonly depthTarget: GPURenderPassDepthStencilAttachment = {
		view: undefined as unknown as GPUTextureView,
		depthLoadOp: 'clear',
		depthStoreOp: 'discard',
		depthClearValue: 0,
	};
	/** The descriptor as the latest calls set it. */
	readonly descriptor: GPURenderPassDescriptor = { colorAttachments: this.noColorTargets };

	/**
	 * Sets the color target, or removes it when `view` is undefined. The pass starts by clearing
	 * the target to the color at `color[at, at + 4)` when `clear` is set, and keeps what it draws
	 * when `store` is set. The color and the depth value come from a typed array: a fraction passed
	 * to a call that the browser does not inline is boxed in a new object. A pass that loads its
	 * target gives no clear color, so the browser reads none.
	 */
	setColor(
		view: GPUTextureView | undefined,
		resolveTarget: GPUTextureView | undefined,
		clear: boolean,
		store: boolean,
		color: Float32Array,
		at: number,
	): void {
		if (!view) {
			this.descriptor.colorAttachments = this.noColorTargets;
			return;
		}
		const target = this.colorTarget;
		target.view = view;
		target.resolveTarget = resolveTarget;
		target.loadOp = clear ? 'clear' : 'load';
		target.storeOp = store ? 'store' : 'discard';
		target.clearValue = clear ? this.clearColor(color, at) : undefined;
		this.descriptor.colorAttachments = this.colorTargets;
	}

	/**
	 * Sets a second color target after the first, or leaves the first alone when `view` is
	 * undefined. Call it after `setColor`, whose clear color and operations it takes.
	 */
	setSecondColor(view: GPUTextureView | undefined): void {
		if (!view) return;
		const target = this.secondTarget;
		target.view = view;
		target.loadOp = this.colorTarget.loadOp;
		target.storeOp = this.colorTarget.storeOp;
		target.clearValue = this.colorTarget.clearValue;
		this.descriptor.colorAttachments = this.twoColorTargets;
	}

	/** The clear color with the parts at `color[at, at + 4)`, made from the oldest when new. */
	private clearColor(color: Float32Array, at: number): GPUColorDict {
		const parts = this.clearParts;
		const r = color[at] as number;
		const g = color[at + 1] as number;
		const b = color[at + 2] as number;
		const a = color[at + 3] as number;
		for (let k = 0, p = 0; k < CLEAR_COLORS; k++, p += 4)
			if (parts[p] === r && parts[p + 1] === g && parts[p + 2] === b && parts[p + 3] === a)
				return this.clearColors[k] as GPUColorDict;
		const k = this.nextClearColor;
		this.nextClearColor = (k + 1) % CLEAR_COLORS;
		parts[4 * k] = r;
		parts[4 * k + 1] = g;
		parts[4 * k + 2] = b;
		parts[4 * k + 3] = a;
		const clearColor = this.clearColors[k] as GPUColorDict;
		clearColor.r = r;
		clearColor.g = g;
		clearColor.b = b;
		clearColor.a = a;
		return clearColor;
	}

	/** Sets the depth target, or removes it when `view` is undefined. It clears to `value[at]`. */
	setDepth(
		view: GPUTextureView | undefined,
		clear: boolean,
		store: boolean,
		value: Float32Array,
		at: number,
	): void {
		if (!view) {
			this.descriptor.depthStencilAttachment = undefined;
			return;
		}
		const target = this.depthTarget;
		target.view = view;
		target.depthLoadOp = clear ? 'clear' : 'load';
		target.depthStoreOp = store ? 'store' : 'discard';
		target.depthClearValue = value[at] as number;
		this.descriptor.depthStencilAttachment = target;
	}

	setTimestampWrites(writes: GPURenderPassTimestampWrites | undefined): void {
		this.descriptor.timestampWrites = writes;
	}
}

/**
 * The arguments of texel copies, texel writes and image uploads. Draw lists name a texture
 * location as five words: the texture id, then the mip level, x, y and the array layer.
 */
export class TexelCopySetup {
	private readonly sourceOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	private readonly destinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	/** Where a copy reads. */
	readonly source: GPUTexelCopyTextureInfo = {
		texture: undefined as unknown as GPUTexture,
		mipLevel: 0,
		origin: this.sourceOrigin,
	};
	/** Where a copy, a write or an image upload writes. */
	readonly destination: GPUCopyExternalImageDestInfo = {
		texture: undefined as unknown as GPUTexture,
		mipLevel: 0,
		origin: this.destinationOrigin,
		premultipliedAlpha: false,
	};
	private readonly imageOrigin: GPUOrigin2DDict = { x: 0, y: 0 };
	/** The image that an upload reads, and where in it the upload starts. */
	readonly image: GPUCopyExternalImageSourceInfo = {
		source: undefined as unknown as ImageBitmap,
		origin: this.imageOrigin,
	};
	/** How a write's texels lie in engine memory. */
	readonly layout: GPUTexelCopyBufferLayout = { offset: 0, bytesPerRow: 0, rowsPerImage: 0 };
	/** A buffer that a copy between textures passes through, with its texels' layout. */
	readonly via: GPUTexelCopyBufferInfo = {
		buffer: undefined as unknown as GPUBuffer,
		offset: 0,
		bytesPerRow: 0,
		rowsPerImage: 0,
	};
	readonly size: GPUExtent3DDict = { width: 0, height: 0, depthOrArrayLayers: 1 };

	/** Sets where a copy reads: `texture` at the location in `words[at, at + 5)`. */
	setSource(texture: GPUTexture, words: Uint32Array, at: number): void {
		this.source.texture = texture;
		this.source.mipLevel = words[at + 1] as number;
		this.sourceOrigin.x = words[at + 2] as number;
		this.sourceOrigin.y = words[at + 3] as number;
		this.sourceOrigin.z = words[at + 4] as number;
	}

	/** Sets where a copy, a write or an upload writes: `texture` at the location in `words[at, at + 5)`. */
	setDestination(texture: GPUTexture, words: Uint32Array, at: number): void {
		this.destination.texture = texture;
		this.destination.mipLevel = words[at + 1] as number;
		this.destinationOrigin.x = words[at + 2] as number;
		this.destinationOrigin.y = words[at + 3] as number;
		this.destinationOrigin.z = words[at + 4] as number;
	}

	/** Sets the image that an upload reads, from its pixel at (`x`, `y`). */
	setImage(image: ImageBitmap, x: number, y: number): void {
		this.image.source = image;
		this.imageOrigin.x = x;
		this.imageOrigin.y = y;
	}

	setSize(width: number, height: number, layers: number): void {
		this.size.width = width;
		this.size.height = height;
		this.size.depthOrArrayLayers = layers;
	}

	/** Sets the buffer that a copy passes through: rows of `bytesPerRow`, `rows` to a layer. */
	setVia(buffer: GPUBuffer, bytesPerRow: number, rows: number): void {
		this.via.buffer = buffer;
		this.via.bytesPerRow = bytesPerRow;
		this.via.rowsPerImage = rows;
	}

	/** Sets a write's source: tightly packed rows of `bytesPerRow`, `rows` to a layer, from `offset`. */
	setLayout(offset: number, bytesPerRow: number, rows: number): void {
		this.layout.offset = offset;
		this.layout.bytesPerRow = bytesPerRow;
		this.layout.rowsPerImage = rows;
	}
}

// A list of one that stays one long: emptying it would free its storage, and the next frame's
// write would allocate new storage. It keeps the last submitted buffer, which WebGPU has used up.
const submitList: GPUCommandBuffer[] = [];

/** Submits one command buffer through a list that every call reuses. */
export function submitOne(queue: GPUQueue, commands: GPUCommandBuffer): void {
	submitList[0] = commands;
	queue.submit(submitList);
}

// WebGPU descriptors and lists that each frame fills again instead of making new ones, so a frame
// allocates none of its own. WebGPU reads a descriptor only during the call that takes it, so one
// object can serve every frame.

/** A render pass descriptor with at most one color target and one depth target. */
export class RenderPassSetup {
	private readonly clearColor: GPUColorDict = { r: 0, g: 0, b: 0, a: 1 };
	private readonly colorTarget: GPURenderPassColorAttachment = {
		view: undefined as unknown as GPUTextureView,
		loadOp: 'clear',
		storeOp: 'store',
		clearValue: this.clearColor,
	};
	private readonly colorTargets: GPURenderPassColorAttachment[] = [this.colorTarget];
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
	 * to a call that the browser does not inline is boxed in a new object.
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
		const clearColor = this.clearColor;
		clearColor.r = color[at] as number;
		clearColor.g = color[at + 1] as number;
		clearColor.b = color[at + 2] as number;
		clearColor.a = color[at + 3] as number;
		this.descriptor.colorAttachments = this.colorTargets;
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

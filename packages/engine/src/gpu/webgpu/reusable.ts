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
	 * the target to the given color when `clear` is set, and keeps what it draws when `store` is set.
	 */
	setColor(
		view: GPUTextureView | undefined,
		resolveTarget: GPUTextureView | undefined,
		clear: boolean,
		store: boolean,
		r: number,
		g: number,
		b: number,
		a: number,
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
		this.clearColor.r = r;
		this.clearColor.g = g;
		this.clearColor.b = b;
		this.clearColor.a = a;
		this.descriptor.colorAttachments = this.colorTargets;
	}

	/** Sets the depth target, or removes it when `view` is undefined. */
	setDepth(view: GPUTextureView | undefined, clear: boolean, store: boolean, value: number): void {
		if (!view) {
			this.descriptor.depthStencilAttachment = undefined;
			return;
		}
		const target = this.depthTarget;
		target.view = view;
		target.depthLoadOp = clear ? 'clear' : 'load';
		target.depthStoreOp = store ? 'store' : 'discard';
		target.depthClearValue = value;
		this.descriptor.depthStencilAttachment = target;
	}

	setTimestampWrites(writes: GPURenderPassTimestampWrites | undefined): void {
		this.descriptor.timestampWrites = writes;
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

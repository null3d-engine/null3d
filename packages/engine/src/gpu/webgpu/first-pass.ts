// A pass that draws one point on a new device before its first frame. Some drivers draw nothing in
// the first render pass on a device that draws, when its draws are indirect and their arguments came
// from the CPU. Every pass after one that drew is right. The Adreno 619 does this on WebGPU and in
// compatibility mode alike (`.dev/driver-bugs.md`). The pass costs a pipeline of a few lines, which
// builds in the background beside the frame's own pipelines, and one draw of one point.

const SHADER = `@vertex fn v() -> @builtin(position) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }
@fragment fn f() -> @location(0) vec4f { return vec4f(1.0); }`;

/** The target's format: one that every device renders to. */
const FORMAT: GPUTextureFormat = 'rgba8unorm';

/** Draws one point on a device once, before the device's first frame. */
export class FirstPass {
	private pipeline: GPURenderPipeline | undefined;
	private drawn = false;
	/** Settles once the pipeline is built, or has failed to build. */
	readonly built: Promise<void>;

	constructor(private readonly device: GPUDevice) {
		const module = device.createShaderModule({ code: SHADER });
		this.built = device
			.createRenderPipelineAsync({
				layout: 'auto',
				vertex: { module, entryPoint: 'v' },
				fragment: { module, entryPoint: 'f', targets: [{ format: FORMAT }] },
				primitive: { topology: 'point-list' },
			})
			.then(
				(pipeline) => {
					this.pipeline = pipeline;
				},
				// A device lost during the build draws nothing more, so its frames need no pass.
				() => {
					this.drawn = true;
				},
			);
	}

	/** True once the pass is drawn, or can be drawn now. */
	get ready(): boolean {
		return this.drawn || this.pipeline !== undefined;
	}

	/** Submits the pass, the first time it is called after the pipeline is built. */
	draw(): void {
		const { pipeline, device } = this;
		if (this.drawn || !pipeline) return;
		this.drawn = true;
		this.pipeline = undefined;
		const target = device.createTexture({
			size: [1, 1],
			format: FORMAT,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
		});
		pass.setPipeline(pipeline);
		pass.draw(1);
		pass.end();
		device.queue.submit([encoder.finish()]);
		target.destroy();
	}
}

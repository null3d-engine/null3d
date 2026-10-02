// Gives the canvas back when the engine stops, without its display buffers. Safari keeps a canvas's
// display buffers, of the canvas's size, after its context gives the canvas up, and frees them only
// when it collects the context. A page that keeps its canvas then keeps them for as long as the
// canvas lives, and one that starts and stops many engines runs out of GPU memory. A resize while
// the context holds the canvas replaces the buffers with ones of the new size, except the buffer on
// show, which the browser keeps until it shows another frame. So the canvas shrinks to one pixel
// and shows a blank frame before its context gives it up.

/** What the release needs of a renderer: its canvas, a blank frame and a way to free the GPU. */
export interface CanvasHolder {
	readonly canvas: { width: number; height: number };
	/** Clears the canvas, at its current size, in a frame that the browser shows. */
	drawBlank(): void;
	/** Frees the renderer's GPU objects and gives up the canvas's context. */
	destroy(): void;
}

/** The longest wait for the browser to show the blank frame. A hidden page shows no frames. */
const SHOW_TIMEOUT_MS = 100;

/** Resolves after the browser's next two frames, or after the time limit when they do not come. */
function shown(): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, SHOW_TIMEOUT_MS);
		if (typeof requestAnimationFrame !== 'function') return;
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				clearTimeout(timer);
				resolve();
			}),
		);
	});
}

/**
 * Shows a blank frame of one pixel on the canvas, destroys the renderer, and then gives the canvas
 * its size back. A resize after the context gave the canvas up makes no display buffers.
 */
export async function releaseCanvas(holder: CanvasHolder): Promise<void> {
	const { canvas } = holder;
	const { width, height } = canvas;
	canvas.width = 1;
	canvas.height = 1;
	try {
		holder.drawBlank();
		await shown();
	} catch {
		// A canvas whose GPU is lost shows no blank frame. The release still frees the rest.
	}
	holder.destroy();
	canvas.width = width;
	canvas.height = height;
}

/** Clears a WebGPU canvas to transparent black. */
export function clearWebGPUCanvas(device: GPUDevice, context: GPUCanvasContext): void {
	const encoder = device.createCommandEncoder();
	encoder
		.beginRenderPass({
			colorAttachments: [
				{
					view: context.getCurrentTexture().createView(),
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: [0, 0, 0, 0],
				},
			],
		})
		.end();
	device.queue.submit([encoder.finish()]);
}

/** Clears a WebGL2 canvas to transparent black, whatever state the renderer left. */
export function clearWebGL2Canvas(gl: WebGL2RenderingContext): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.disable(gl.SCISSOR_TEST);
	gl.disable(gl.RASTERIZER_DISCARD);
	gl.colorMask(true, true, true, true);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);
}

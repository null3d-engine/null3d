// Checks the browser's image buffers, which every texture, canvas texture and frame capture of the
// engine goes through: a 2D canvas that reads back what it drew, an ImageBitmap that WebGL2 uploads
// with its pixels, and an ImageBitmap that reaches a worker when the page posts it. Each fault is a
// short text; an empty list means the buffers work.
//
// Safari 27.2 on GitHub's macOS machines fails all three on their paravirtual GPU, while Safari 26.6
// passes on the same machines and Safari 27 passes on real devices: .dev/devices.md, "Safari on
// CI's machines", has the evidence.

/** How long the worker may take to answer, in milliseconds. */
const ECHO_LIMIT_MS = 5000;

const RED = Uint8ClampedArray.of(255, 0, 0, 255);

const reason = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** The fault of a 2D canvas that cannot draw and read back one pixel, or undefined. */
function canvasFault(): string | undefined {
	try {
		const context = new OffscreenCanvas(1, 1).getContext('2d');
		if (!context) return 'a 2D canvas gives no context';
		context.fillStyle = 'rgb(255, 0, 0)';
		context.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
		return r === 255 && g === 0 && b === 0 && a === 255
			? undefined
			: `a 2D canvas reads back ${r},${g},${b},${a} where it drew red`;
	} catch (error) {
		return `a 2D canvas cannot read back what it drew (${reason(error)})`;
	}
}

/** The fault of WebGL2's upload of a red ImageBitmap, which it must read back as red, or undefined. */
function uploadFault(bitmap: ImageBitmap): string | undefined {
	const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
	if (!gl) return undefined;
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	const pixel = new Uint8Array(4);
	gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	const [r, g, b, a] = pixel;
	return r === 255 && g === 0 && b === 0 && a === 255
		? undefined
		: `WebGL2 uploads a red ImageBitmap as ${r},${g},${b},${a}`;
}

/** The fault of an ImageBitmap that the page posts to a worker, which must arrive whole, or undefined. */
async function postFault(bitmap: ImageBitmap): Promise<string | undefined> {
	const worker = new Worker(new URL('./image-echo-worker.ts', import.meta.url), {
		type: 'module',
	});
	try {
		const answer = await new Promise<string>((resolve) => {
			const timer = setTimeout(() => resolve('no answer'), ECHO_LIMIT_MS);
			worker.onmessage = (event: MessageEvent<string>) => {
				clearTimeout(timer);
				resolve(event.data);
			};
			worker.onerror = (event) => {
				clearTimeout(timer);
				resolve(`an error: ${event.message}`);
			};
			worker.postMessage(bitmap, [bitmap]);
		});
		return answer === '1x1' ? undefined : `an ImageBitmap posted to a worker arrives as ${answer}`;
	} finally {
		worker.terminate();
	}
}

/** The browser's faults with image buffers, each as a short text, or an empty list. */
export async function imageBufferFaults(): Promise<string[]> {
	const faults: string[] = [];
	const canvas = canvasFault();
	if (canvas) faults.push(canvas);
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(new ImageData(RED.slice(), 1, 1));
	} catch (error) {
		return [...faults, `the browser makes no ImageBitmap from pixels (${reason(error)})`];
	}
	const upload = uploadFault(bitmap);
	if (upload) faults.push(upload);
	const post = await postFault(bitmap);
	if (post) faults.push(post);
	return faults;
}

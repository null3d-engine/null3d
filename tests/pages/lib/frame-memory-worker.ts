// A worker of the frame memory probe. It holds the shared memory that the frame gives it, beats
// on the probe page's beat counter while its thread runs, and holds the memory the way the frame
// asks: idle, inside a pending Atomics.waitAsync, or behind the context-loss listener of a WebGL2
// context that it draws into every frame.

export interface FrameMemoryWorkerMessage {
	memory: WebAssembly.Memory;
	beats: SharedArrayBuffer;
	beat: number;
	hold: 'idle' | 'waitasync' | 'webgl';
	canvas?: OffscreenCanvas;
}

const kept: unknown[] = [];

self.onmessage = ({ data }: MessageEvent<FrameMemoryWorkerMessage>) => {
	const { memory, hold, canvas } = data;
	const beats = new Int32Array(data.beats);
	kept.push(memory);
	setInterval(() => Atomics.add(beats, data.beat, 1), 100);
	if (hold === 'waitasync') {
		const word = new Int32Array(memory.buffer, 0, 1);
		const wait = Atomics.waitAsync(word, 0, 0);
		if (wait.async) void wait.value.then(() => kept.push(memory.buffer.byteLength));
	} else if (hold === 'webgl' && canvas) {
		const gl = canvas.getContext('webgl2');
		if (!gl) throw new Error('the worker has no WebGL2 context');
		const onLost = (event: Event) => {
			event.preventDefault();
			kept.push(memory.buffer.byteLength);
		};
		canvas.addEventListener('webglcontextlost', onLost);
		canvas.addEventListener('contextlost', onLost);
		let frame = 0;
		const draw = () => {
			frame++;
			gl.clearColor((frame % 60) / 60, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			requestAnimationFrame(draw);
		};
		requestAnimationFrame(draw);
	}
	self.postMessage('ready');
};

// A job worker for the animation page: it starts the core in the page's shared memory and serves
// the job system until the page sets the stop flag. The page creates the job system first.
import { startCore } from '@null3d/engine/internal';

interface Start {
	module: WebAssembly.Module;
	memory: WebAssembly.Memory;
	index: number;
}

addEventListener('message', async ({ data }: MessageEvent<Start>) => {
	try {
		const { glue } = await startCore('threaded', data.module, data.memory);
		postMessage({ type: 'ready', index: data.index });
		glue.jobWorkerLoop(data.index);
		postMessage({ type: 'stopped', index: data.index });
	} catch (e) {
		postMessage({ type: 'error', message: String(e) });
	}
});

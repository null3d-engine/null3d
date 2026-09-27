// A job worker: runs the engine core's parallel loops over scene data. It loads the core with the
// shared memory, reports its index, and then serves the core's job system.

import { startCore } from '../shared/core';
import type { JobWorkerInit, WorkerReply } from './protocol';

self.onmessage = async (event: MessageEvent<JobWorkerInit>) => {
	const message = event.data;
	try {
		const core = await startCore(message.build, message.module, message.memory);
		const reply: WorkerReply = {
			type: 'ready',
			role: 'job',
			index: message.index,
			threaded: core.isThreadedBuild(),
			version: core.engineVersion(),
		};
		postMessage(reply);
	} catch (e) {
		const reply: WorkerReply = {
			type: 'error',
			role: 'job',
			message: e instanceof Error ? e.message : String(e),
		};
		postMessage(reply);
	}
};

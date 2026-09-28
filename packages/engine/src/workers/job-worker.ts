// A job worker: runs the engine core's parallel loops over scene data. It loads the core with the
// shared memory, reports that it is ready, and then serves the core's job system until the engine
// stops. Serving blocks this worker's thread, which a job worker may do; the sketch worker never
// blocks.

import { startCore } from '../shared/core';
import type { JobWorkerInit, WorkerReply } from './protocol';

self.onmessage = async (event: MessageEvent<JobWorkerInit>) => {
	const message = event.data;
	try {
		const { glue: core } = await startCore(message.build, message.module, message.memory);
		const reply: WorkerReply = {
			type: 'ready',
			role: 'job',
			index: message.index,
			threaded: core.isThreadedBuild(),
			version: core.engineVersion(),
		};
		postMessage(reply);
		core.jobWorkerLoop(message.index);
	} catch (e) {
		const reply: WorkerReply = {
			type: 'error',
			role: 'job',
			message: e instanceof Error ? e.message : String(e),
		};
		postMessage(reply);
	}
};

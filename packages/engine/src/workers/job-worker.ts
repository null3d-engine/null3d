// A job worker: runs the engine core's parallel loops over scene data. It loads the core with the
// shared memory, reports that it is ready, and waits without blocking until the sketch thread has
// created the job system. Then it serves the job system until the engine stops, and reports that it
// has stopped. Serving blocks this worker's thread, which a job worker may do; the sketch worker
// never blocks.

import { controlViews, Slot } from '../shared/control';
import { startCore } from '../shared/core';
import { type JobWorkerInit, replyToPage, startSteps } from './protocol';

const step = startSteps('job');
step('loaded');

self.onmessage = async (event: MessageEvent<JobWorkerInit>) => {
	const message = event.data;
	try {
		const { glue: core } = await startCore(message.build, message.module, message.memory, step);
		replyToPage({
			type: 'ready',
			role: 'job',
			index: message.index,
			threaded: core.isThreadedBuild(),
			version: core.engineVersion(),
		});
		const { slots } = controlViews(message.control);
		while (Atomics.load(slots, Slot.JobsReady) === 0 && Atomics.load(slots, Slot.Running) !== 0) {
			const wait = Atomics.waitAsync(slots, Slot.JobsReady, 0);
			if (wait.async) await wait.value;
		}
		if (Atomics.load(slots, Slot.Running) !== 0) core.jobWorkerLoop(message.index);
		replyToPage({ type: 'stopped', role: 'job', index: message.index });
	} catch (e) {
		replyToPage({
			type: 'error',
			role: 'job',
			message: e instanceof Error ? e.message : String(e),
		});
	}
};

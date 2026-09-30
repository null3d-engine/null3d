// A job worker: runs the engine core's parallel loops over scene data. It loads the core with the
// shared memory, reports that it is ready, and waits without blocking until the sketch thread has
// created the job system. Then it serves the job system until the engine stops, and reports that it
// has stopped. Serving blocks this worker's thread, which a job worker may do; the sketch worker
// never blocks.

import { messageOf } from '../errors/message';
import { controlViews, Slot } from '../shared/control';
import {
	type JobWorkerInit,
	replyToPage,
	startSteps,
	startWorker,
	startWorkerCore,
} from './protocol';

const step = startSteps('job');

startWorker('job', step, async (event: MessageEvent<JobWorkerInit>) => {
	const message = event.data;
	try {
		const { glue: core } = await startWorkerCore(message, step);
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
			message: messageOf(e),
		});
	}
});

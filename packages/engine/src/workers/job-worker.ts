// A job worker: runs the engine core's parallel loops over scene data, and the tasks of the
// on-demand loader, such as the KTX2 transcoder. It loads the core with the shared memory,
// reports that it is ready, and waits until the sketch thread has created the job system, without
// blocking where the browser has Atomics.waitAsync. Then it serves the job system until the engine
// stops, and reports that it has stopped. Serving blocks this worker's thread, which a job worker
// may do; the sketch worker never blocks. When the loader sends it a task, the core lets it leave
// the job system between frame jobs. It runs its tasks, then serves the job system again. A failure
// after the start ends the worker's part in the job system and reaches the page as a failure of
// the running engine.

import { messageOf } from '../errors/message';
import { controlViews, Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import {
	type JobWorkerInit,
	replyToPage,
	startSteps,
	startWorker,
	startWorkerCore,
} from './protocol';
import { serveTasks } from './tasks';

const step = startSteps('job');

startWorker('job', step, async (event: MessageEvent<JobWorkerInit>) => {
	const message = event.data;
	let core: CoreGlue | undefined;
	try {
		const glue = (await startWorkerCore(message, step)).glue;
		core = glue;
		const { index } = message;
		const tasks = serveTasks(message.taskPort, () => glue.jobWorkerCallDone(index));
		replyToPage({
			type: 'ready',
			role: 'job',
			index,
			threaded: glue.isThreadedBuild(),
			version: glue.engineVersion(),
		});
		const { slots } = controlViews(message.control);
		while (Atomics.load(slots, Slot.JobsReady) === 0 && Atomics.load(slots, Slot.Running) !== 0) {
			// Where the threads wake each other with messages, this worker blocks until the job system
			// exists: nothing sends it a wake message, and a job worker may block.
			if (message.wakeByMessage) Atomics.wait(slots, Slot.JobsReady, 0);
			else {
				const wait = Atomics.waitAsync(slots, Slot.JobsReady, 0);
				if (wait.async) await wait.value;
			}
		}
		if (Atomics.load(slots, Slot.Running) !== 0) {
			Atomics.add(slots, Slot.JobsServing, 1);
			try {
				while (glue.jobWorkerLoop(index))
					await tasks.whenIdle(() => glue.jobWorkerCalls(index) === 0);
			} finally {
				Atomics.sub(slots, Slot.JobsServing, 1);
			}
		}
		replyToPage({ type: 'stopped', role: 'job', index });
	} catch (e) {
		if (!core) {
			replyToPage({ type: 'error', role: 'job', message: messageOf(e) });
			return;
		}
		// A failure inside the job system, such as a trap in the core, leaves the chunk this worker
		// held unfinished. Counting it lets the sketch thread's wait end, so the thread fails too
		// instead of waiting for good, which would hang the page when the sketch runs there.
		try {
			core.jobWorkerFailed(message.index);
		} catch {
			// The core could not count the chunk; the page still hears of the failure.
		}
		replyToPage({ type: 'fault', role: 'job', index: message.index, message: messageOf(e) });
	}
});

// The task worker: runs the on-demand loader's tasks, such as the KTX2 transcoder, where the engine
// has no job workers to run them: in the single-threaded build, and with job workers turned off.
// The loader starts it with its first task. It loads no engine core.

import { serveTasks, type TaskSource } from './tasks';

serveTasks(self as unknown as TaskSource);

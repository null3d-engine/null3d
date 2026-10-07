// A worker thread of the shader compiler pool. It runs the shader compiler on the requests that
// the pool sends, so the dev server and the build go on while a shader compiles. The pool hands
// over the compiled module, so no worker reads or compiles the file again.
import { parentPort, workerData } from 'node:worker_threads';
import { CompilerCalls } from './compiler-calls.js';

const calls = new CompilerCalls(workerData.module);

parentPort?.on('message', ({ id, name, request }) => {
	parentPort?.postMessage({ id, response: calls.call(name, request) });
});

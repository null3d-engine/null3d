// The shader compiler on worker threads. A compile takes the CPU for most of a second, and Node
// answers no request while it runs on Node's own thread: on the dev server, a page then waits for
// every file, the engine's worker probe among them. The pool runs each compile on a worker thread
// instead. It splits a custom material's builds into one share for each worker, so the material
// compiles in a fraction of the time, and joins the shares' results.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import {
	type CallName,
	type CompileResult,
	compilerModule,
	type EffectBuild,
	type EffectResult,
	effectResult,
	joinShares,
	type MaterialBuild,
	type MaterialResult,
	type MaterialSource,
	materialResult,
	type Response,
	type ShaderCompiler,
	type ShaderSource,
	shaderResult,
} from './shader-compiler.ts';
import type { ShaderVariant } from './shader-types.ts';

/**
 * The most workers a pool starts. Each holds about 20 MB, and a custom material's compile takes
 * about 270 ms with 8 against 525 ms with 4 on a busy 18-core Mac; more gain less for their memory.
 */
const MOST_WORKERS = 8;

/** The workers of a pool by default: one for each core but one, at most `MOST_WORKERS`. */
export function defaultWorkers(): number {
	return Math.max(1, Math.min(MOST_WORKERS, availableParallelism() - 1));
}

/** A worker thread and the calls that it has not answered yet, by id. */
interface PoolWorker {
	readonly thread: Worker;
	readonly waiting: Map<number, { resolve(response: string): void; reject(e: Error): void }>;
}

/**
 * Compiles on worker threads, which start at the first compile. An idle worker does not keep the
 * process alive, so a build ends without `close`.
 */
export class CompilerPool implements ShaderCompiler {
	/** The most workers that run at once, and the shares that a custom material splits into. */
	readonly size: number;
	private readonly workers: PoolWorker[] = [];
	private nextId = 0;

	constructor(size: number = defaultWorkers()) {
		this.size = size;
	}

	async shader(shader: ShaderSource): Promise<CompileResult> {
		return shaderResult(await this.run<Record<string, ShaderVariant>>('compile', shader));
	}

	async material(material: MaterialSource): Promise<MaterialResult> {
		const count = this.size;
		if (count === 1)
			return materialResult(await this.run<MaterialBuild>('compile_material', material));
		const shares = Array.from({ length: count }, (_, index) =>
			this.run<MaterialBuild>('compile_material', { ...material, share: { index, count } }),
		);
		return joinShares((await Promise.all(shares)).map(materialResult));
	}

	/** Compiles a custom effect or tone curve, whose few builds take one worker. */
	async effect(effect: MaterialSource): Promise<EffectResult> {
		return effectResult(await this.run<EffectBuild>('compile_effect', effect));
	}

	/** Stops every worker. A later compile starts them again. */
	async close(): Promise<void> {
		const workers = this.workers.splice(0);
		await Promise.all(workers.map((worker) => worker.thread.terminate()));
	}

	/** Runs a call on the worker with the fewest calls waiting, or on a new one while there is room. */
	private run<T>(name: CallName, request: unknown): Promise<Response<T>> {
		let worker = this.workers.reduce<PoolWorker | undefined>(
			(best, next) => (!best || next.waiting.size < best.waiting.size ? next : best),
			undefined,
		);
		if (!worker || (worker.waiting.size > 0 && this.workers.length < this.size))
			worker = this.start();
		const id = this.nextId++;
		const { thread, waiting } = worker;
		const answer = new Promise<string>((resolve, reject) => waiting.set(id, { resolve, reject }));
		thread.ref();
		thread.postMessage({ id, name, request: JSON.stringify(request) });
		return answer.then((response) => JSON.parse(response));
	}

	private start(): PoolWorker {
		const thread = new Worker(new URL('./compile-worker.js', import.meta.url), {
			workerData: { module: compilerModule() },
		});
		const worker: PoolWorker = { thread, waiting: new Map() };
		thread.on('message', ({ id, response }: { id: number; response: string }) => {
			worker.waiting.get(id)?.resolve(response);
			worker.waiting.delete(id);
			if (worker.waiting.size === 0) thread.unref();
		});
		const fail = (error: Error) => {
			const index = this.workers.indexOf(worker);
			if (index >= 0) this.workers.splice(index, 1);
			for (const call of worker.waiting.values()) call.reject(error);
			worker.waiting.clear();
		};
		thread.on('error', (error: Error) =>
			fail(new Error(`null3D: a shader compiler thread stopped: ${error.message}`)),
		);
		thread.on('exit', (code) =>
			fail(new Error(`null3D: a shader compiler thread exited with code ${code}`)),
		);
		thread.unref();
		this.workers.push(worker);
		return worker;
	}
}

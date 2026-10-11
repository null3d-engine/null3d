// Locks the pointer to the canvas, for first-person controls and games that turn with the mouse.
// Browsers differ in how they answer: Chrome's request returns a promise that settles with the
// lock, and others answer only with a pointerlockchange or pointerlockerror event on the document.
// The request below waits for whichever comes first.

import { EngineError } from '../errors/engine-error';

/**
 * Options for `engine.requestPointerLock`.
 *
 * @category api/engine
 */
export interface PointerLockOptions {
	/**
	 * True asks for the mouse's raw movement, without the speed-up that the system applies. Browsers
	 * that cannot give it refuse the lock with E1425. The default is false.
	 */
	unadjustedMovement?: boolean;
}

/**
 * The name and message of a refusal, or the cause the page gives when the browser gives none,
 * without a closing full stop, which the engine's message adds.
 */
function reason(error: unknown): string {
	const text =
		error instanceof Error
			? error.message
				? `${error.name}: ${error.message}`
				: error.name
			: String(error);
	return text.replace(/\.+$/, '');
}

/** Resolves once the canvas holds the pointer lock. Fails with E1425 when the browser refuses it. */
export function requestPointerLock(
	canvas: HTMLCanvasElement,
	options: PointerLockOptions = {},
): Promise<void> {
	if (document.pointerLockElement === canvas) return Promise.resolve();
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: string) => {
			if (settled) return;
			settled = true;
			document.removeEventListener('pointerlockchange', onChange);
			document.removeEventListener('pointerlockerror', onError);
			if (error === undefined) resolve();
			else reject(new EngineError('E1425', `the browser refused the pointer lock: ${error}.`));
		};
		const onChange = () => {
			if (document.pointerLockElement === canvas) finish();
		};
		// Chrome's promise rejects with the browser's reason, which its error event lacks.
		let promised = false;
		const onError = () => {
			if (!promised) finish('the browser gave no reason');
		};
		document.addEventListener('pointerlockchange', onChange);
		document.addEventListener('pointerlockerror', onError);
		try {
			const request: unknown = options.unadjustedMovement
				? canvas.requestPointerLock({ unadjustedMovement: true })
				: canvas.requestPointerLock();
			if (request instanceof Promise) {
				promised = true;
				request.then(
					() => finish(),
					(error: unknown) => finish(reason(error)),
				);
			}
		} catch (error) {
			finish(reason(error));
		}
	});
}

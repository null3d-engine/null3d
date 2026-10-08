import { afterEach, describe, expect, it } from 'bun:test';
import { requestPointerLock } from './pointer-lock';

/** A document that sends the pointer lock's events, as browsers do, and a canvas on it. */
function stage(answer: (canvas: HTMLCanvasElement, document: StandInDocument) => unknown) {
	const document = new EventTarget() as StandInDocument;
	document.pointerLockElement = null;
	const canvas = {
		requestPointerLock: (options?: object) => {
			canvas.asked.push(options);
			return answer(canvas as unknown as HTMLCanvasElement, document);
		},
		asked: [] as (object | undefined)[],
	};
	Object.assign(globalThis, { document });
	return { document, canvas: canvas as unknown as HTMLCanvasElement & { asked: unknown[] } };
}

type StandInDocument = EventTarget & { pointerLockElement: unknown };

/** Locks the pointer to the canvas after the request returns, with the change event. */
const lockSoon = (canvas: HTMLCanvasElement, document: StandInDocument) => {
	setTimeout(() => {
		document.pointerLockElement = canvas;
		document.dispatchEvent(new Event('pointerlockchange'));
	});
};

afterEach(() => Reflect.deleteProperty(globalThis, 'document'));

describe('requestPointerLock', () => {
	it('resolves once the lock begins, in browsers that answer with an event alone', async () => {
		const { canvas } = stage(lockSoon);
		await requestPointerLock(canvas);
		expect(canvas.asked).toEqual([undefined]);
	});

	it("resolves once Chrome's promise resolves, and asks for raw movement when told to", async () => {
		const { canvas } = stage((canvas, document) => {
			lockSoon(canvas, document);
			return new Promise<void>((resolve) => setTimeout(resolve, 5));
		});
		await requestPointerLock(canvas, { unadjustedMovement: true });
		expect(canvas.asked).toEqual([{ unadjustedMovement: true }]);
	});

	it("fails with E1425 and the reason of Chrome's rejected promise, before its error event", async () => {
		const { canvas } = stage((_canvas, document) => {
			setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')));
			return new Promise<void>((_resolve, reject) =>
				setTimeout(() => reject(new DOMException('', 'NotSupportedError')), 5),
			);
		});
		await expect(requestPointerLock(canvas, { unadjustedMovement: true })).rejects.toThrow(
			'E1425: the browser refused the pointer lock: NotSupportedError.',
		);
	});

	it("ends the reason with one full stop when the browser's message ends with one", async () => {
		const { canvas } = stage(() =>
			Promise.reject(
				new DOMException('The root document of this element is not valid.', 'WrongDocumentError'),
			),
		);
		const error = await requestPointerLock(canvas).catch((error: Error) => error);
		expect((error as Error).message).toStartWith(
			'E1425: the browser refused the pointer lock: WrongDocumentError: The root document of this element is not valid. ',
		);
	});

	it('fails with E1425 on the error event, in browsers that give no promise', async () => {
		const { canvas } = stage((_canvas, document) => {
			setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')));
		});
		await expect(requestPointerLock(canvas)).rejects.toThrow(
			'E1425: the browser refused the pointer lock: the browser gave no reason.',
		);
	});

	it('resolves at once when the canvas holds the lock already', async () => {
		const { canvas, document } = stage(() => {
			throw new Error('asked again');
		});
		document.pointerLockElement = canvas;
		await requestPointerLock(canvas);
		expect(canvas.asked).toEqual([]);
	});
});

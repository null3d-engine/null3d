import { describe, expect, it } from 'bun:test';
import { historyOf, NO_HISTORY, StartMarker } from './start-marker';

const SKETCH = 'https://example.com/sketch.js';

/** A localStorage stand-in that keeps its items in a map. */
class MemoryStorage implements Storage {
	readonly items = new Map<string, string>();
	get length() {
		return this.items.size;
	}
	clear() {
		this.items.clear();
	}
	getItem(key: string) {
		return this.items.get(key) ?? null;
	}
	key(index: number) {
		return [...this.items.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.items.delete(key);
	}
	setItem(key: string, value: string) {
		this.items.set(key, value);
	}
}

/** A localStorage stand-in that refuses every call, as a browser does in a sandboxed frame. */
class BlockedStorage extends MemoryStorage {
	override getItem(): string | null {
		throw new Error('SecurityError');
	}
	override setItem() {
		throw new Error('QuotaExceededError');
	}
	override removeItem() {
		throw new Error('SecurityError');
	}
}

/**
 * Starts the sketch in the page load `page`: reads the history, writes the note, and ends it when
 * the start survives. Returns the history that the start saw.
 */
function start(
	storage: Storage,
	page: number,
	survives: boolean,
	tier: 'webgpu' | 'webgl2' = 'webgpu',
) {
	const marker = new StartMarker(SKETCH, page, storage);
	const history = marker.read();
	marker.begin(history, tier);
	if (survives) marker.end();
	return history;
}

describe('the crash marker', () => {
	it('finds no crash on a first start, or after a start that ended', () => {
		const storage = new MemoryStorage();
		expect(start(storage, 1, true)).toEqual(NO_HISTORY);
		expect(start(storage, 2, true)).toEqual(NO_HISTORY);
		expect(storage.length).toBe(0);
	});

	it('counts each start that left its note as a crash, one after another', () => {
		const storage = new MemoryStorage();
		expect(start(storage, 1, false)).toEqual({ crashed: 0, lastTier: null });
		expect(start(storage, 2, false)).toEqual({ crashed: 1, lastTier: 'webgpu' });
		expect(start(storage, 3, false, 'webgl2')).toEqual({ crashed: 2, lastTier: 'webgpu' });
		expect(start(storage, 4, true)).toEqual({ crashed: 3, lastTier: 'webgl2' });
		// A start that lived clears the count.
		expect(start(storage, 5, true)).toEqual(NO_HISTORY);
	});

	it("never counts another engine's start in the same page load as a crash", () => {
		const storage = new MemoryStorage();
		start(storage, 1, false);
		expect(start(storage, 2, false)).toEqual({ crashed: 1, lastTier: 'webgpu' });
		// A second engine in page load 2 sees the crash before it, but not the first engine's start.
		expect(new StartMarker(SKETCH, 2, storage).read()).toEqual({ crashed: 1, lastTier: null });
	});

	it("keeps each sketch's note apart", () => {
		const storage = new MemoryStorage();
		start(storage, 1, false);
		expect(new StartMarker('https://example.com/other.js', 2, storage).read()).toEqual(NO_HISTORY);
	});

	it('removes only the note that its own page load wrote', () => {
		const storage = new MemoryStorage();
		const first = new StartMarker(SKETCH, 1, storage);
		first.begin(first.read(), 'webgpu');
		// Another tab starts the same sketch before the first start ends, and writes its own note.
		const second = new StartMarker(SKETCH, 2, storage);
		second.begin(second.read(), 'webgpu');
		first.end();
		expect(storage.length).toBe(1);
		second.end();
		expect(storage.length).toBe(0);
	});

	it('counts storage that refuses every call as a normal start, and never throws', () => {
		const storage = new BlockedStorage();
		const marker = new StartMarker(SKETCH, 1, storage);
		expect(marker.read()).toEqual(NO_HISTORY);
		expect(() => marker.begin(NO_HISTORY, 'webgpu')).not.toThrow();
		expect(() => marker.end()).not.toThrow();
		expect(new StartMarker(SKETCH, 2, undefined).read()).toEqual(NO_HISTORY);
	});

	it('counts a note that it cannot read as none', () => {
		for (const text of [
			'',
			'yes',
			'null',
			'{}',
			'{"crashed":-1,"tier":"webgpu","page":1}',
			'{"crashed":1.5,"tier":"webgpu","page":1}',
			'{"crashed":1,"tier":"vulkan","page":1}',
			'{"crashed":1,"tier":"webgpu","page":"1"}',
		])
			expect([text, historyOf(text, 2)]).toEqual([text, NO_HISTORY]);
		expect(historyOf(null, 2)).toEqual(NO_HISTORY);
	});

	it('removes the note once the engine has drawn for its first seconds of play', async () => {
		const storage = new MemoryStorage();
		const marker = new StartMarker(SKETCH, 1, storage);
		marker.begin(marker.read(), 'webgpu');
		let showFirstFrame = () => {};
		const firstFrame = new Promise<void>((resolve) => {
			showFirstFrame = resolve;
		});
		marker.endAfter(firstFrame, 5);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(storage.length).toBe(1);
		showFirstFrame();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(storage.length).toBe(0);
	});

	it('keeps an ended start ended, so a later first frame removes nothing', async () => {
		const storage = new MemoryStorage();
		const marker = new StartMarker(SKETCH, 1, storage);
		marker.begin(marker.read(), 'webgpu');
		marker.end();
		// The same page load starts the engine again, and its note stays until that start ends.
		const again = new StartMarker(SKETCH, 1, storage);
		again.begin(again.read(), 'webgpu');
		marker.endAfter(Promise.resolve(), 1);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(storage.length).toBe(1);
	});

	it('removes the note when the page leaves before the first seconds of play', () => {
		const storage = new MemoryStorage();
		const marker = new StartMarker(SKETCH, 1, storage);
		marker.begin(marker.read(), 'webgpu');
		globalThis.dispatchEvent(new Event('pagehide'));
		expect(storage.length).toBe(0);
	});
});

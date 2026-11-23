import { describe, expect, test } from 'bun:test';
import type { SketchContext } from '@null3d/engine';
import { CONNECT_MESSAGE, type ConnectData, MAX_VOICES } from './layout';
import type { SketchMessage, TableLayout } from './protocol';
import { createSound } from './sound';

/** A sketch's context with the parts that the add-on reads, and a way to send it the page's link. */
function sketch(preset = 'high') {
	let handler: ((type: string, data: unknown) => void) | undefined;
	let quality: ((q: { preset: string }) => void) | undefined;
	const ctx = {
		page: {
			post() {},
			onMessage(h: (type: string, data: unknown) => void) {
				handler = h;
				return () => {
					handler = undefined;
				};
			},
		},
		quality: {
			preset,
			onChange(h: (q: { preset: string }) => void) {
				quality = h;
				return () => {
					quality = undefined;
				};
			},
		},
	} as unknown as SketchContext;
	const listener = {
		at: [1, 2, 3],
		turn: [0, 0, 0, 1],
		getWorldPosition(out: Float64Array) {
			out.set(this.at);
		},
		getWorldQuaternion(out: Float64Array) {
			out.set(this.turn);
		},
	};
	/** Opens the page's link and gathers what the sketch sends over it. */
	const connect = () => {
		const channel = new MessageChannel();
		const messages: SketchMessage[] = [];
		channel.port1.onmessage = (event) => messages.push(event.data);
		const data: ConnectData = { port: channel.port2, box: { table: null } };
		handler?.(CONNECT_MESSAGE, data);
		const settled = () => new Promise((resolve) => setTimeout(resolve, 10));
		return { messages, data, settled, close: () => channel.port1.close() };
	};
	return {
		ctx,
		listener,
		connect,
		changeQuality: (p: string) => quality?.({ preset: p }),
		listening: () => handler !== undefined,
	};
}

/** The table that the sketch gave the page, as views. */
function views(data: ConnectData, layout: TableLayout) {
	const table = data.box.table as ArrayBuffer;
	return { floats: new Float32Array(table, 0, layout.length), ints: new Int32Array(table) };
}

describe('createSound', () => {
	test('refuses a sketch with no listener', () => {
		const s = sketch();
		expect(() => createSound(s.ctx, {} as never)).toThrow('sound E2500');
	});

	test('sends the page its table, its panning and the sounds made before the link', async () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener, capacity: 8 });
		sound.loop({ file: 'https://example.test/sea.mp3', positional: false, level: 0.5 });
		expect(sound.connected).toBe(false);
		const link = s.connect();
		await link.settled();
		expect(sound.connected).toBe(true);
		const [table, add] = link.messages;
		expect(table?.type).toBe('table');
		if (table?.type !== 'table') return;
		expect(table.panning).toBe('hrtf');
		expect(table.layout.capacity).toBe(8);
		// The sketch runs here on the page's thread, so it hands the page its live table in the box.
		expect(link.data.box.table).toBeInstanceOf(ArrayBuffer);
		expect(add).toMatchObject({
			type: 'add',
			sound: { kind: 'loop', file: 'https://example.test/sea.mp3', positional: false, voices: 1 },
		});
		const { floats } = views(link.data, table.layout);
		expect(floats[table.layout.levels]).toBe(0.5);
		link.close();
	});

	test('writes the listener and counts the frame in update', async () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener });
		const link = s.connect();
		await link.settled();
		const table = link.messages[0];
		if (table?.type !== 'table') throw new Error('no table');
		const { floats, ints } = views(link.data, table.layout);
		sound.update();
		sound.update();
		expect(ints[table.layout.frame]).toBe(2);
		expect([...floats.subarray(table.layout.listenerAt, table.layout.listenerAt + 3)]).toEqual([
			1, 2, 3,
		]);
		expect(floats[table.layout.listenerTurn + 3]).toBe(1);
		link.close();
	});

	test('a group writes its members through its setters and its arrays alike', async () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener });
		const cars = sound.group({
			file: 'https://example.test/car.mp3',
			count: 4,
			voices: 2,
			near: 3,
			far: 80,
		});
		cars.setPosition(1, 5, 0, -7);
		cars.levels[2] = 0.25;
		cars.positions.set([9, 9, 9], 9);
		expect([...cars.positions.subarray(3, 6)]).toEqual([5, 0, -7]);
		expect([...cars.positions.subarray(9, 12)]).toEqual([9, 9, 9]);
		expect(cars.levels[2]).toBe(0.25);
		expect(cars.rates[0]).toBe(1);
		expect(() => cars.setLevel(4, 1)).toThrow('sound E2503');
		const link = s.connect();
		await link.settled();
		expect(link.messages[1]).toMatchObject({
			type: 'add',
			sound: { kind: 'group', count: 4, voices: 2, near: 3, far: 80, muffle: true },
		});
		link.close();
	});

	test('a shot writes its slot and tells the page which plays', async () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener });
		const thunder = sound.shot({ file: 'https://example.test/thunder.mp3', voices: 2, far: 900 });
		const link = s.connect();
		await link.settled();
		thunder.play(10, 20, 30, 0.7);
		thunder.play(1, 2, 3);
		thunder.play(4, 5, 6);
		await link.settled();
		const plays = link.messages.filter((m) => m.type === 'play');
		expect(plays.map((m) => (m.type === 'play' ? m.slot : -1))).toEqual([0, 1, 0]);
		link.close();
	});

	test('runs out of voices with a message that says how to fix it', () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener, capacity: 64 });
		sound.group({ file: 'https://example.test/a.mp3', count: 40, voices: MAX_VOICES });
		expect(() => sound.loop({ file: 'https://example.test/b.mp3' })).toThrow('sound E2501');
	});

	test('runs out of emitters with a message that names the capacity', () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener, capacity: 4 });
		sound.group({ file: 'https://example.test/a.mp3', count: 3, voices: 1 });
		expect(() => sound.group({ file: 'https://example.test/b.mp3', count: 2, voices: 1 })).toThrow(
			'sound E2502',
		);
	});

	test('frees a destroyed sound for the next and tells the page', async () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener, capacity: 2 });
		const a = sound.group({ file: 'https://example.test/a.mp3', count: 2, voices: 1 });
		const link = s.connect();
		await link.settled();
		a.destroy();
		const b = sound.group({ file: 'https://example.test/b.mp3', count: 2, voices: 1 });
		await link.settled();
		expect(link.messages.map((m) => m.type)).toEqual(['table', 'add', 'remove', 'add']);
		expect(b.count).toBe(2);
		link.close();
	});

	test('tells the page when the preset changes its panning', async () => {
		const s = sketch('high');
		createSound(s.ctx, { listener: s.listener });
		const link = s.connect();
		await link.settled();
		s.changeQuality('ultra');
		s.changeQuality('medium');
		await link.settled();
		expect(link.messages.filter((m) => m.type === 'panning')).toEqual([
			{ type: 'panning', panning: 'equal-power' },
		]);
		link.close();
	});

	test('stops listening and closes the link on destroy', async () => {
		const s = sketch();
		const sound = createSound(s.ctx, { listener: s.listener });
		const link = s.connect();
		await link.settled();
		sound.destroy();
		expect(s.listening()).toBe(false);
		expect(sound.connected).toBe(false);
		expect(() => sound.loop({ file: 'https://example.test/a.mp3' })).toThrow('sound E2500');
		link.close();
	});
});

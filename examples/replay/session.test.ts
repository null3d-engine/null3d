// The deterministic simulation demo's play without the page: what the sketch gets before the first
// tick, the ticks that frames step, a replay through the same logged steps as live play, and a
// restart that leaves nothing of the run before it.
import { describe, expect, test } from 'bun:test';
import { Session, TickClock } from './session';
import { FORWARD, LEFT, ORBS, startRun, stepLogged } from './sim';
import { BEFORE, BETWEEN, NOW } from './view';

/** The run's start as the view lays out a pose: the eye, then the view's rotation. */
const START = (() => {
	const run = startRun();
	return [...run.position, ...run.look];
})();
const pose = (view: Float64Array, at: number) => [...view.subarray(at, at + START.length)];

/** Plays 240 ticks of walking forward and then left, with the mouse turning and tilting. */
function play(session: Session): void {
	for (let k = 0; k < 240; k++)
		session.tick(k < 120 ? FORWARD : LEFT, (k % 7) - 3, k % 5 === 0 ? 2 : 0);
}

describe("the deterministic simulation demo's session", () => {
	test("gives the sketch the run's start in both poses before the first tick", () => {
		const view = new Session().frame(0.5);
		// A frame between the two poses then draws the start, not a blend from the origin.
		expect(pose(view, BEFORE)).toEqual(START);
		expect(pose(view, NOW)).toEqual(START);
		expect(view[BETWEEN]).toBe(0.5);
	});

	test("counts a frame's time before the clock's start as no time, and steps at most 250 ms", () => {
		const clock = new TickClock(1000);
		expect(clock.due(990)).toBe(0);
		expect(clock.between).toBe(0);
		expect(clock.due(990 + (1000 / 60) * 2.5)).toBe(2);
		expect(clock.between).toBeCloseTo(0.5, 9);
		// A minute away steps what a quarter of a second does.
		expect(clock.due(60_000)).toBe(new TickClock(0).due(250));
	});

	test("replays the log from the seed to the run's state, bit for bit, ignoring live input", () => {
		const session = new Session();
		play(session);
		const played = session.frame(0).slice();
		expect(pose(played, NOW)).not.toEqual(START);
		expect(session.replay()).toBe(true);
		expect(session.replay()).toBe(false);
		let ticks = 0;
		for (; session.replays; ticks++) session.tick(FORWARD, 40, 40);
		expect(ticks).toBe(240);
		expect(session.status()).toBe('Replay ended on the same state');
		expect(pose(session.frame(0), NOW)).toEqual(pose(played, NOW));
	});

	test("a restart clears the replay's verdict with the log", () => {
		const session = new Session();
		play(session);
		session.replay();
		while (session.replays) session.tick(0, 0, 0);
		expect(session.status()).toBe('Replay ended on the same state');
		session.restart();
		expect(session.status()).toBe(`0 of ${ORBS} orbs`);
		expect(session.replay()).toBe(false);
		expect(pose(session.frame(0), BEFORE)).toEqual(START);
		expect(pose(session.frame(0), NOW)).toEqual(START);
		// A new run plays on with no verdict from the old one.
		session.tick(0, 0, 0);
		expect(session.status()).toBe(`0 of ${ORBS} orbs`);
	});

	test('keeps the fraction of the gathered movement for a later tick', () => {
		const session = new Session();
		const gathered = { keys: 0, turn: 2.5, tilt: -1.25 };
		session.steps(1, gathered);
		expect(gathered).toEqual({ keys: 0, turn: 0.5, tilt: -0.25 });
	});

	test('drops the movement that came during a replay, at the tick where the replay ends too', () => {
		const session = new Session();
		play(session);
		const turned = pose(session.frame(0), NOW).slice(3);
		session.replay();
		// The mouse moved while the replay ran. The frame's loop runs the replay's last ticks and then
		// live ticks, which must not turn the run by it.
		const gathered = { keys: 0, turn: 300, tilt: 200 };
		session.steps(240 + 5, gathered);
		expect(session.replays).toBe(false);
		expect(gathered).toEqual({ keys: 0, turn: 0, tilt: 0 });
		expect(pose(session.frame(0), NOW).slice(3)).toEqual(turned);
	});

	test('steps only a tick that the log holds', () => {
		const run = startRun();
		expect(() => stepLogged(run, [])).toThrow('the log holds 0 ticks, and the run is at tick 0');
	});
});

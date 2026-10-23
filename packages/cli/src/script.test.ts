import { describe, expect, it } from 'bun:test';
import { UsageError } from './args.js';
import { dumpSteps, parseScript, scriptProgram, shotSteps } from './script.js';

/** What parsing `text` throws, as the message a person sees. */
function mistake(text: string): string {
	try {
		parseScript(text);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`the script parsed without a mistake:\n${text}`);
}

describe('parseScript', () => {
	it('reads every step, with comments and blank lines left out', () => {
		const text = [
			'# A drive through the showcase.',
			'',
			'0 key KeyW down',
			'0.5 pointer move 640 360',
			'1 pointer down 640 360',
			'1.1 pointer up',
			'1.2 pointer wheel 0 100',
			'1.5 set car.position=0, 2, 0',
			'2 set car.visible=false',
			'2.5 dump car.position',
			'3 dump car',
			'3.5 key KeyW up',
			'4 shot parked',
		].join('\n');
		expect(parseScript(text)).toEqual([
			{ at: 0, verb: 'key', code: 'KeyW', down: true },
			{ at: 0.5, verb: 'pointer', action: 'move', x: 640, y: 360 },
			{ at: 1, verb: 'pointer', action: 'down', x: 640, y: 360 },
			{ at: 1.1, verb: 'pointer', action: 'up' },
			{ at: 1.2, verb: 'pointer', action: 'wheel', x: 0, y: 100 },
			{ at: 1.5, verb: 'set', target: 'car', path: 'position', value: [0, 2, 0] },
			{ at: 2, verb: 'set', target: 'car', path: 'visible', value: [0] },
			{ at: 2.5, verb: 'dump', target: 'car', path: 'position' },
			{ at: 3, verb: 'dump', target: 'car' },
			{ at: 3.5, verb: 'key', code: 'KeyW', down: false },
			{ at: 4, verb: 'shot', name: 'parked' },
		]);
	});

	it("splits an object's name from its property at the last dot, so a name may hold dots", () => {
		expect(parseScript('0 set Cube.001.position=1, 2, 3')[0]).toEqual({
			at: 0,
			verb: 'set',
			target: 'Cube.001',
			path: 'position',
			value: [1, 2, 3],
		});
		expect(parseScript('0 dump Cube.001.visible')[0]).toEqual({
			at: 0,
			verb: 'dump',
			target: 'Cube.001',
			path: 'visible',
		});
		// A dump of an object whose name ends in a word that is no property's name keeps it whole.
		expect(parseScript('0 dump Cube.001')[0]).toEqual({
			at: 0,
			verb: 'dump',
			target: 'Cube.001',
		});
	});

	it('reads true and false as a flag, and numbers joined by spaces or commas', () => {
		expect(parseScript('0 set car.visible=true')[0]).toMatchObject({ value: [1] });
		expect(parseScript('0 set car.position=1 2 3')[0]).toMatchObject({ value: [1, 2, 3] });
		expect(parseScript('0 set car.position=-1,0.5,2e3')[0]).toMatchObject({
			value: [-1, 0.5, 2000],
		});
	});

	it('says on which line a step is wrong, and what the step takes', () => {
		expect(mistake('0 jump up')).toBe(
			'script line 1: "jump" is not a step that a script takes. Its steps are key, pointer, set, shot and dump',
		);
		expect(mistake('0 key KeyW')).toBe(
			'script line 1: a key step reads "key <code> down" or "key <code> up", such as "key KeyW down"',
		);
		expect(mistake('0 pointer tap 1 2')).toBe(
			'script line 1: a pointer step takes move, down, up or wheel, such as "pointer move 640 360"',
		);
		expect(mistake('0 pointer move 640')).toContain('"pointer move" takes two numbers');
		expect(mistake('0 pointer down 640')).toContain(
			'"pointer down" takes two numbers, or none to keep the pointer where it is',
		);
		expect(mistake('0 pointer wheel 10')).toContain('"pointer wheel" takes two numbers');
		expect(mistake('0 set car')).toBe(
			'script line 1: a set step takes <object>.<property>=<value>, such as "set car.position=0, 2, 0"',
		);
		expect(mistake('0 set car=1')).toBe(
			'script line 1: name an object and a property, such as car.position, with a dot between them',
		);
		expect(mistake('0 set car.position=')).toContain(
			'script line 1: a set step takes 1 to 4 numbers after =',
		);
		expect(mistake('0 set car.position=1,2,3,4,5')).toContain('a set step takes 1 to 4 numbers');
		expect(mistake('0 shot Parked')).toContain(
			'script line 1: a shot step takes one name of lowercase words joined by dashes',
		);
		expect(mistake('0 dump')).toBe(
			'script line 1: a dump step takes one object, or an object and a property, such as "dump car.position"',
		);
	});

	it('says what is wrong with a time', () => {
		expect(mistake('soon key KeyW down')).toBe(
			'script line 1: "soon" is not a time in seconds from 0, such as 1.5',
		);
		expect(mistake('601 shot far')).toBe(
			'script line 1: 601 is past the 600 seconds that a hold steps through',
		);
		expect(mistake('1 key KeyW down\n0 key KeyW up')).toBe(
			"script line 2: 0 s falls before the step at 1 s above it. A script's steps come in time order",
		);
	});

	it('refuses two shot steps with one name, and two shots at one time', () => {
		expect(mistake('1 shot start\n2 shot start')).toBe(
			'script line 2: two shot steps are named "start"',
		);
		expect(mistake('1 shot start\n1 shot driving')).toBe(
			'script line 2: another shot step is at 1 s. Give each shot its own time',
		);
	});
});

describe('scriptProgram', () => {
	it('gives the engine every step but the shots, and leaves a press without a place where the pointer is', () => {
		const steps = parseScript(
			['0 pointer move 640 360', '1 pointer up', '2 set car.position=1, 2, 3', '3 shot start'].join(
				'\n',
			),
		);
		expect(scriptProgram(steps)).toEqual({
			steps: [
				{ at: 0, verb: 'pointer', action: 'move', x: 640, y: 360 },
				{ at: 1, verb: 'pointer', action: 'up' },
				{ at: 2, verb: 'set', target: 'car', path: 'position', value: [1, 2, 3] },
			],
		});
	});

	it('lists a script’s shots and dumps in time order', () => {
		const steps = parseScript('1 dump car\n2 shot start\n3 dump car.position\n4 shot driving');
		expect(shotSteps(steps).map((step) => step.name)).toEqual(['start', 'driving']);
		expect(dumpSteps(steps).map((step) => step.target)).toEqual(['car', 'car']);
	});
});

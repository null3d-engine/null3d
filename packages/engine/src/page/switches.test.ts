import { describe, expect, it } from 'bun:test';
import { jobWorkerCount, parseSwitches } from './switches';

describe('parseSwitches', () => {
	it('leaves every choice to the engine when the address has no switch', () => {
		expect(parseSwitches('')).toEqual({
			gpu: 'auto',
			threads: true,
			renderOnMain: false,
			sketchThread: undefined,
			latency: undefined,
			copyUploads: false,
			depth: undefined,
			compression: undefined,
			parallelCompile: true,
			freshShaders: false,
			freshCheck: false,
			wakeByMessage: false,
			displayChecks: true,
			hdr: true,
			sceneFormat: undefined,
			half: undefined,
			cells: true,
			prepass: undefined,
			occlusion: undefined,
			vertexSkinning: false,
			indexInstances: false,
			shadowDepthBits: 16,
			fps: undefined,
			queue: undefined,
			jobs: undefined,
			join: true,
			memoryMiB: undefined,
			preset: undefined,
			hold: undefined,
			bench: false,
			glTiming: undefined,
		});
	});

	it('skins in the vertex shader on WebGPU with ?skinning=vertex, and in a compute pass otherwise', () => {
		expect(parseSwitches('?skinning=vertex').vertexSkinning).toBe(true);
		expect(parseSwitches('?skinning=compute').vertexSkinning).toBe(false);
		expect(parseSwitches('?instances=index').indexInstances).toBe(true);
		expect(parseSwitches('?instances=copy').indexInstances).toBe(false);
	});

	it('keeps shadow cascades in 16-bit depth unless ?shadowdepth=32 asks for 32-bit floats', () => {
		expect(parseSwitches('?shadowdepth=32').shadowDepthBits).toBe(32);
		expect(parseSwitches('?shadowdepth=16').shadowDepthBits).toBe(16);
		expect(parseSwitches('?shadowdepth=24').shadowDepthBits).toBe(16);
	});

	it('turns occlusion culling on or off with ?occlusion=, and leaves it to the page otherwise', () => {
		expect(parseSwitches('?occlusion=on').occlusion).toBe(true);
		expect(parseSwitches('?occlusion=off').occlusion).toBe(false);
		expect(parseSwitches('?occlusion=yes').occlusion).toBeUndefined();
	});

	it('turns the depth prepass on or off with ?prepass=, and leaves it to the page otherwise', () => {
		expect(parseSwitches('?prepass=on').prepass).toBe(true);
		expect(parseSwitches('?prepass=off').prepass).toBe(false);
		expect(parseSwitches('?prepass=yes').prepass).toBeUndefined();
	});

	it('turns GPU occlusion culling on or off with ?occlusion=, and leaves it to the page otherwise', () => {
		expect(parseSwitches('?occlusion=on').occlusion).toBe(true);
		expect(parseSwitches('?occlusion=off').occlusion).toBe(false);
		expect(parseSwitches('').occlusion).toBeUndefined();
	});

	it('reads the compressed texture families that ?compression= keeps, and none for ?compression=none', () => {
		expect(parseSwitches('?compression=bc,etc2').compression).toEqual(['bc', 'etc2']);
		expect(parseSwitches('?compression=astc').compression).toEqual(['astc']);
		expect(parseSwitches('?compression=none').compression).toEqual([]);
	});

	it('reads ?half=on and ?half=off, and leaves any other value to the engine', () => {
		expect(parseSwitches('?half=on').half).toBe(true);
		expect(parseSwitches('?half=off').half).toBe(false);
		expect(parseSwitches('?half=yes').half).toBeUndefined();
	});

	it('reads ?bench with or without a value', () => {
		expect(parseSwitches('?bench').bench).toBe(true);
		expect(parseSwitches('?gpu=webgl2&bench=1').bench).toBe(true);
	});

	it('reads ?gl-timing, which times each WebGL call for benchmark pages', () => {
		expect(parseSwitches('?gpu=webgl2&gl-timing').glTiming).toBe('calls');
		expect(parseSwitches('?gl-timing=sync').glTiming).toBe('sync');
	});

	it('keeps the text of ?hold for the engine to check, and an empty text for a bare ?hold', () => {
		expect(parseSwitches('?hold=1.5').hold).toBe('1.5');
		expect(parseSwitches('?gpu=webgl2&hold').hold).toBe('');
		expect(parseSwitches('?hold=soon').hold).toBe('soon');
	});

	it('reads the job worker count and the memory maximum as whole numbers', () => {
		const switches = parseSwitches('?gpu=webgl2&latency=low&jobs=4&memory=2048');
		expect(switches).toMatchObject({ gpu: 'webgl2', latency: 'low', jobs: 4, memoryMiB: 2048 });
		expect(parseSwitches('?jobs=1&memory=256')).toMatchObject({ jobs: 1, memoryMiB: 256 });
		expect(parseSwitches('?jobs=255').jobs).toBe(255);
	});

	it('ignores counts and sizes that are not whole numbers above 0', () => {
		for (const value of ['0', '-2', '1.5', 'many', '', 'Infinity']) {
			const switches = parseSwitches(`?jobs=${value}&memory=${value}`);
			expect([value, switches.jobs, switches.memoryMiB]).toEqual([value, undefined, undefined]);
		}
	});

	it('ignores a job worker count above the most the engine core runs', () => {
		expect(parseSwitches('?jobs=256').jobs).toBeUndefined();
	});

	it('ignores a memory maximum outside the range that the memory option takes', () => {
		for (const mib of [16, 255, 4097, 65_536])
			expect([mib, parseSwitches(`?memory=${mib}`).memoryMiB]).toEqual([mib, undefined]);
		expect(parseSwitches('?memory=4096').memoryMiB).toBe(4_096);
	});

	it('starts no more job workers than the device has logical cores', () => {
		expect(jobWorkerCount(255, 8)).toBe(8);
		expect(jobWorkerCount(4, 8)).toBe(4);
		expect(jobWorkerCount(4, 0)).toBe(1);
	});

	it('leaves two cores free of job workers without the switch, and starts at least one', () => {
		expect(jobWorkerCount(undefined, 18)).toBe(16);
		expect(jobWorkerCount(undefined, 2)).toBe(1);
	});

	it('picks the scene format with ?scene-format=, and leaves it to the GPU path otherwise', () => {
		expect(parseSwitches('?scene-format=rg11b10').sceneFormat).toBe('rg11b10');
		expect(parseSwitches('?scene-format=rgba16f').sceneFormat).toBe('rgba16f');
		expect(parseSwitches('?scene-format=rgba8').sceneFormat).toBeUndefined();
	});

	it('turns HDR color off only for ?hdr=off', () => {
		expect(parseSwitches('?hdr=off').hdr).toBe(false);
		expect(parseSwitches('?hdr=on').hdr).toBe(true);
		expect(parseSwitches('?gpu=webgl2').hdr).toBe(true);
	});

	it('reads a frame rate above 0, with decimals', () => {
		expect(parseSwitches('?fps=59.94').fps).toBe(59.94);
		expect(parseSwitches('?fps=0').fps).toBeUndefined();
		expect(parseSwitches('?queue=3').queue).toBe(3);
		expect(parseSwitches('?queue=off').queue).toBe(Number.POSITIVE_INFINITY);
		expect(parseSwitches('?queue=0').queue).toBeUndefined();
		expect(parseSwitches('?queue=1.5').queue).toBeUndefined();
	});

	it('reads the thread that runs the sketch, and ignores a thread it does not know', () => {
		expect(parseSwitches('?sketch-thread=main').sketchThread).toBe('main');
		expect(parseSwitches('?latency=low&sketch-thread=worker').sketchThread).toBe('worker');
		expect(parseSwitches('?sketch-thread=page').sketchThread).toBeUndefined();
	});

	it('turns background compiles off with ?compile=wait only', () => {
		expect(parseSwitches('?gpu=webgl2&compile=wait').parallelCompile).toBe(false);
		expect(parseSwitches('?compile=later').parallelCompile).toBe(true);
	});

	it('makes the shaders fresh with ?shaders=fresh only', () => {
		expect(parseSwitches('?shaders=fresh').freshShaders).toBe(true);
		expect(parseSwitches('?shaders=cached').freshShaders).toBe(false);
	});

	it('measures the preset again with ?check=fresh only', () => {
		expect(parseSwitches('?check=fresh').freshCheck).toBe(true);
		expect(parseSwitches('?check=stored').freshCheck).toBe(false);
	});

	it('makes the threads wake each other with messages with ?wake=message only', () => {
		expect(parseSwitches('?wake=message').wakeByMessage).toBe(true);
		expect(parseSwitches('?wake=atomics').wakeByMessage).toBe(false);
	});

	it('stops the checks of the display only with ?display-check=off', () => {
		expect(parseSwitches('?display-check=off').displayChecks).toBe(false);
		expect(parseSwitches('?display-check=on').displayChecks).toBe(true);
	});

	it('reads the WebGL2 depth mode, and ignores a mode it does not know', () => {
		expect(parseSwitches('?gpu=webgl2&depth=standard').depth).toBe('standard');
		expect(parseSwitches('?depth=reversed-gl').depth).toBe('reversed-gl');
		expect(parseSwitches('?depth=reversed').depth).toBe('reversed');
		expect(parseSwitches('?depth=log').depth).toBeUndefined();
	});

	it('turns grid-cell culling off with ?cells=off only', () => {
		expect(parseSwitches('?gpu=webgl2&cells=off').cells).toBe(false);
		expect(parseSwitches('?cells=on').cells).toBe(true);
		expect(parseSwitches('?cells=no').cells).toBe(true);
	});

	it('reads the quality preset, and ignores a name that is no preset', () => {
		for (const preset of ['low', 'medium', 'high', 'ultra'] as const)
			expect(parseSwitches(`?preset=${preset}`).preset).toBe(preset);
		for (const value of ['auto', 'Low', 'epic', ''])
			expect(parseSwitches(`?preset=${value}`).preset).toBeUndefined();
	});
});

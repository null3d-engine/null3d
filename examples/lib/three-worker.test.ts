import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as three from 'three';
import * as csmShader from 'three/addons/csm/CSMShader.js';
import { DrawnFrames, measuredFigures, type Three, withCsmLightFix } from './three-worker';

// The add-on's type declarations name the shader as a type only, though the module exports it.
const { CSMShader } = csmShader as unknown as { CSMShader: csmShader.CSMShader };

describe('the three.js worker', () => {
	test('frames that draw nothing are not drawn frames', () => {
		const drawn = new DrawnFrames();
		drawn.note(0, 10);
		expect(drawn.count).toBe(0);
		expect(drawn.since(0)).toBe(false);
		drawn.note(3, 20);
		expect(drawn.count).toBe(1);
		expect(drawn.since(20)).toBe(true);
		expect(drawn.since(21)).toBe(false);
	});

	test('a measurement with no drawn frame has no frame rate, whatever the empty frames ran at', () => {
		const means = new Float64Array([120, 120, 0.002, 0.001, 0.001, 0]);
		expect(measuredFigures(means, false)).toEqual({
			frames: 0,
			fps: 0,
			cpuMs: null,
			codeMs: null,
			renderMs: null,
		});
		expect(measuredFigures(means, true).fps).toBe(120);
	});

	// A guard on the wiring: every frame notes its draws, and every measurement goes through the
	// rule, so empty frames can never count as a frame rate again.
	test('every frame and every measurement goes through the drawn-frame rule', () => {
		const source = readFileSync(new URL('./three-worker.ts', import.meta.url), 'utf8');
		expect(source).toContain('this.drawn.note(renderer.info.render.drawCalls');
		const posts = source.match(/type: 'measured'/g) ?? [];
		const ruled = source.match(/type: 'measured', id, \.\.\.measuredFigures\(/g) ?? [];
		expect(posts.length).toBeGreaterThan(0);
		expect(ruled.length).toBe(posts.length);
		expect(source).toContain('measuredFigures(means, this.drawn.since(');
	});

	test("CSM's lights get three.js's own setup lines, with the standard material's energy terms", () => {
		const standard = three.ShaderChunk.lights_fragment_begin;
		const chunks = { lights_fragment_begin: standard };
		const fake = { ShaderChunk: chunks } as unknown as Three;
		// three.js 0.186.1's CSM add-on swaps in a copy of the chunk that lacks the terms. When an
		// update of three.js adds them, this fails: then remove the fix and check the WebGL frames.
		expect(CSMShader.lights_fragment_begin).not.toContain('material.dfg');
		withCsmLightFix(fake, () => {
			chunks.lights_fragment_begin = CSMShader.lights_fragment_begin;
		});
		const fixed = chunks.lights_fragment_begin;
		expect(fixed).toContain('material.dfg');
		expect(fixed).toContain('multiScatteringCompensation');
		// The add-on's own lights, with their cascades, stay.
		const lights = CSMShader.lights_fragment_begin.indexOf('IncidentLight directLight;');
		expect(fixed.endsWith(CSMShader.lights_fragment_begin.slice(lights))).toBe(true);
	});
});

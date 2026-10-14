import { describe, expect, it } from 'bun:test';
import { RenderPassSetup } from './reusable';

const view = {} as GPUTextureView;
/** Clear colors as a draw list holds them: the background, black and three more. */
const COLORS = Float32Array.of(
	...[0.051, 0.106, 0.161, 1],
	...[0, 0, 0, 0],
	...[0.25, 0.5, 0.75, 1],
	...[0.3, 0.3, 0.3, 1],
	...[0.9, 0.1, 0.2, 1],
);

function clearValue(setup: RenderPassSetup): GPUColor | undefined {
	return (setup.descriptor.colorAttachments as GPURenderPassColorAttachment[])[0]?.clearValue;
}

describe('RenderPassSetup', () => {
	it('gives a pass that loads its target no clear color', () => {
		const setup = new RenderPassSetup();
		setup.setColor(view, undefined, true, true, COLORS, 0);
		setup.setColor(view, undefined, false, true, COLORS, 0);
		expect(setup.descriptor.colorAttachments).toHaveLength(1);
		expect(clearValue(setup)).toBeUndefined();
	});

	it('clears to the color at the given place', () => {
		const setup = new RenderPassSetup();
		setup.setColor(view, undefined, true, true, COLORS, 8);
		expect(clearValue(setup)).toEqual({ r: 0.25, g: 0.5, b: 0.75, a: 1 });
	});

	it('hands back the same color object for a color it holds, among a few', () => {
		const setup = new RenderPassSetup();
		const made = [0, 4, 8, 12].map((at) => {
			setup.setColor(view, undefined, true, true, COLORS, at);
			return clearValue(setup);
		});
		for (const [k, at] of [0, 4, 8, 12].entries()) {
			setup.setColor(view, undefined, true, true, COLORS, at);
			expect(clearValue(setup)).toBe(made[k]);
		}
		// A fifth color takes the place of the oldest.
		setup.setColor(view, undefined, true, true, COLORS, 16);
		expect(clearValue(setup)).toBe(made[0]);
		expect(clearValue(setup)).toEqual({
			r: Math.fround(0.9),
			g: Math.fround(0.1),
			b: Math.fround(0.2),
			a: 1,
		});
	});
});

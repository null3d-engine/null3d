import { describe, expect, it } from 'bun:test';
import { loadGlslShaders } from '../../generated/shaders';
import { WebGL2Backend } from './backend';

/**
 * A WebGL2 context that lists the calls made on it. Its constants are numbers, it offers no
 * extension, and each create call makes an empty object.
 */
function fakeContext() {
	const calls: string[] = [];
	let constants = 0;
	const values = new Map<string, number>();
	const gl = new Proxy(
		{},
		{
			get(_, name: string) {
				if (/^[A-Z0-9_]+$/.test(name)) {
					if (!values.has(name)) values.set(name, ++constants);
					return values.get(name);
				}
				return () => {
					calls.push(name);
					if (name === 'getExtension') return null;
					if (name === 'getParameter') return 4;
					if (name === 'isContextLost') return false;
					if (name.startsWith('create')) return {};
					return undefined;
				};
			},
		},
	);
	return { gl: gl as WebGL2RenderingContext, calls };
}

describe('WebGL2Backend', () => {
	it('starts to link the mip level and layer copy programs when it starts, without waiting for them', async () => {
		const { gl, calls } = fakeContext();
		const canvas = { width: 1, height: 1 } as OffscreenCanvas;
		new WebGL2Backend(gl, canvas, await loadGlslShaders(0), true, 'reversed');
		expect(calls.filter((name) => name === 'linkProgram')).toHaveLength(2);
		expect(calls).not.toContain('getProgramParameter');
	});
});

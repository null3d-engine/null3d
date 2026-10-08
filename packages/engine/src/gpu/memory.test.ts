import { describe, expect, it } from 'bun:test';
import * as G from '../generated/gpu';
import { BUFFER_BYTES, GpuMemory, TEXTURE_BYTES, textureBytes } from './memory';

describe('textureBytes', () => {
	it('counts an uncompressed texture by its texel size', () => {
		expect(textureBytes(G.FORMAT_RGBA8_UNORM, 256, 128, 1, 1, 1)).toBe(256 * 128 * 4);
		expect(textureBytes(G.FORMAT_RGBA16_FLOAT, 64, 64, 1, 1, 1)).toBe(64 * 64 * 8);
		expect(textureBytes(G.FORMAT_RGBA32_FLOAT, 16, 16, 1, 1, 1)).toBe(16 * 16 * 16);
	});

	it('counts a whole mip chain, down to one texel', () => {
		// 8 x 4, 4 x 2, 2 x 1 and 1 x 1.
		expect(textureBytes(G.FORMAT_RGBA8_UNORM, 8, 4, 1, 4, 1)).toBe((32 + 8 + 2 + 1) * 4);
		// A 1024 x 1024 texture with its 11 levels takes about 5.3 MiB: a third more than its first.
		const chain = textureBytes(G.FORMAT_RGBA8_UNORM, 1024, 1024, 1, 11, 1);
		expect(chain).toBe(1_398_101 * 4);
	});

	it('counts a compressed texture in whole blocks, also for levels smaller than a block', () => {
		// BC7 and ASTC 4x4 hold 16 bytes per block of 4 x 4 texels, ETC2 RGB 8.
		expect(textureBytes(G.FORMAT_BC7_RGBA_UNORM, 256, 256, 1, 1, 1)).toBe(64 * 64 * 16);
		expect(textureBytes(G.FORMAT_ASTC_4X4_UNORM, 10, 6, 1, 1, 1)).toBe(3 * 2 * 16);
		expect(textureBytes(G.FORMAT_ETC2_RGB8_UNORM, 256, 256, 1, 1, 1)).toBe(64 * 64 * 8);
		// 8 x 8, 4 x 4, then 2 x 2 and 1 x 1, which each take a whole block.
		expect(textureBytes(G.FORMAT_BC7_RGBA_UNORM, 8, 8, 1, 4, 1)).toBe((4 + 1 + 1 + 1) * 16);
	});

	it('multiplies by the layers of an array or a cube, which mip levels keep', () => {
		expect(textureBytes(G.FORMAT_RGBA8_UNORM, 4, 4, 6, 1, 1)).toBe(6 * 16 * 4);
		expect(textureBytes(G.FORMAT_RGBA8_UNORM, 4, 4, 3, 3, 1)).toBe(3 * (16 + 4 + 1) * 4);
	});

	it("halves a 3D texture's depth at each mip level", () => {
		// 4 x 4 x 4, 2 x 2 x 2 and 1 x 1 x 1.
		expect(textureBytes(G.FORMAT_RGBA8_UNORM, 4, 4, 4, 3, 1, true)).toBe((64 + 8 + 1) * 4);
		expect(textureBytes(G.FORMAT_RGBA16_FLOAT, 32, 32, 32, 1, 1, true)).toBe(32 ** 3 * 8);
	});

	it('multiplies by the sample count of a multisampled target', () => {
		expect(textureBytes(G.FORMAT_RGBA8_UNORM, 100, 50, 1, 1, 4)).toBe(100 * 50 * 4 * 4);
		expect(textureBytes(G.FORMAT_DEPTH32_FLOAT, 100, 50, 1, 1, 4)).toBe(100 * 50 * 4 * 4);
	});

	it('counts depth at the size that the GPU stores', () => {
		expect(textureBytes(G.FORMAT_DEPTH16_UNORM, 2048, 2048, 1, 1, 1)).toBe(2048 * 2048 * 2);
		expect(textureBytes(G.FORMAT_DEPTH24_PLUS, 2048, 2048, 1, 1, 1)).toBe(2048 * 2048 * 4);
		expect(textureBytes(G.FORMAT_DEPTH32_FLOAT, 1024, 1024, 4, 1, 1)).toBe(4 * 1024 * 1024 * 4);
	});
});

describe('GpuMemory', () => {
	it('keeps one running total of textures and one of buffers', () => {
		const memory = new GpuMemory();
		memory.addTextures(4096);
		memory.addBuffers(256);
		memory.addBuffers(1024);
		memory.addTextures(-1024);
		memory.addBuffers(-256);
		expect(memory.bytes[TEXTURE_BYTES]).toBe(3072);
		expect(memory.bytes[BUFFER_BYTES]).toBe(1024);
	});
});

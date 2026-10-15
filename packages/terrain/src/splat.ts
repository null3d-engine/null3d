// The weights of the ground's layers: a splat map whose red, green, blue and alpha channels say
// how much each layer shows. A caller may give a function or take the default, which puts grass
// low and gentle, soil drier, rock on the steep slopes and snow on the high ground.
import type { SketchContext, Texture } from '@null3d/engine';
import type { Heightfield } from './heightfield';

/**
 * A weight of each layer at a point, written into `out` as red, green, blue and alpha.
 *
 * @category api/terrain
 */
export type SplatFunction = (x: number, z: number, out: number[]) => void;

/** The smooth ends of a ramp from 0 below `edge0` to 1 above `edge1`, as WGSL's smoothstep. */
function smoothstep(value: number, edge0: number, edge1: number): number {
	const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
	return t * t * (3 - 2 * t);
}

/**
 * The default weights, from the ground's height and slope: grass on the low, gentle ground, soil
 * on the drier higher ground, rock on the steep slopes and snow above. The layers are grass, soil,
 * rock and snow, in that order, so the splat map's red is grass.
 */
export function defaultSplat(field: Heightfield): SplatFunction {
	const range = Math.max(field.max - field.min, 1e-3);
	return (x, z, out) => {
		const high = (field.heightAt(x, z) - field.min) / range;
		const slope = field.slopeAt(x, z);
		const snow = smoothstep(high, 0.62, 0.85);
		const rock = smoothstep(slope, 0.5, 0.85);
		const dry = smoothstep(high, 0.35, 0.62);
		out[0] = (1 - snow) * (1 - rock) * (1 - dry);
		out[1] = (1 - snow) * (1 - rock) * dry;
		out[2] = (1 - snow) * rock;
		out[3] = snow;
	};
}

/**
 * Builds the splat map as a texture: `resolution` texels along each side over the whole ground, in
 * linear color, so the layers meet in soft bands. The texture is built once, when the terrain is
 * made, so a frame costs nothing.
 */
export function splatTexture(
	textures: SketchContext['textures'],
	size: number,
	resolution: number,
	splat: SplatFunction,
): Texture {
	const data = new Uint8Array(resolution * resolution * 4);
	const weights = [0, 0, 0, 0];
	const byte = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255);
	for (let row = 0; row < resolution; row++) {
		const z = -size / 2 + ((row + 0.5) / resolution) * size;
		for (let col = 0; col < resolution; col++) {
			const x = -size / 2 + ((col + 0.5) / resolution) * size;
			splat(x, z, weights);
			const at = (row * resolution + col) * 4;
			data[at] = byte(weights[0] as number);
			data[at + 1] = byte(weights[1] as number);
			data[at + 2] = byte(weights[2] as number);
			data[at + 3] = byte(weights[3] as number);
		}
	}
	return textures.fromData({
		width: resolution,
		height: resolution,
		data,
		colorSpace: 'linear',
		wrap: 'clamp',
		mipmaps: true,
		anisotropy: 4,
	});
}

// The wind scene's own plants, made in code beside the shared trees and grass: a fern of arching
// fronds and the fern's cut-out leaf texture, and the meadow's ground texture. Each plant
// is built from parts that the shared generator samples at four levels of detail.
import { math } from '@null3d/engine';
import { lean, type Part, TURN } from '../lib/trees';

const frac = (x: number) => x - Math.floor(x);

/**
 * A fern 1 across: fronds that rise from the crown, arch over and droop at their tips. A frond's
 * second texture coordinates carry its weight in the wind, from 0 at the crown to 1 at the tip, and
 * a phase of its own, so the tips rock out of step.
 */
export function fernParts(fronds = 8): Part[] {
	math.seed(23);
	return Array.from({ length: fronds }, (_, k): Part => {
		const a = (k / fronds) * TURN + math.randFloat(-0.25, 0.25);
		const [long, rise, curl] = [
			math.randFloat(0.8, 1),
			math.randFloat(1, 1.3),
			math.randFloat(2.1, 2.7),
		];
		const [sx, sz] = [-Math.sin(a), Math.cos(a)];
		const phase = frac(k * 0.618);
		return {
			at: (u, v) => {
				// The frond's spine turns down as it goes: its angle falls by the curl along its length.
				const turn = rise - curl * v;
				const out = (long * (Math.sin(rise) - Math.sin(turn))) / curl;
				const up = 0.02 + (long * (Math.cos(turn) - Math.cos(rise))) / curl;
				const across = (u - 0.5) * 2;
				const half = 0.17 * long * Math.sin(Math.PI * Math.min(1, v * 1.08)) ** 0.7;
				const fold = -Math.abs(across) * half * 0.3;
				const [x, z] = [
					Math.cos(a) * out + sx * across * half,
					Math.sin(a) * out + sz * across * half,
				];
				const shade = 0.55 + 0.45 * v;
				return [x, up + fold, z, ...lean(a, 2), u, v, shade, shade, shade, v, phase];
			},
			grids: [
				[4, 10],
				[2, 6],
				[1, 4],
				[1, 2],
			],
		};
	});
}

/**
 * The fern's frond, 64 by 256 texels, with v along the frond and u across it: a stem up the middle,
 * and leaflets that slant toward the tip, each cut into small lobes. Alpha cuts the leaflets out.
 */
export function fernTexture(width = 64, height = 256) {
	math.seed(31);
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const [u, v] = [(x + 0.5) / width, (y + 0.5) / height];
			const across = Math.abs(u - 0.5) * 2;
			const reach = v < 0.14 ? 0 : Math.sin((Math.PI * (v - 0.14)) / 0.86) ** 0.6;
			const leaflet = frac(v * 30 + across * 1.8) < 0.68;
			const lobe = frac(across * 9 + v * 30 * 0.5) < 0.82;
			const stem = across < 0.07;
			const leaf = leaflet && lobe && across < reach * (0.92 - 0.12 * frac(v * 30 + across * 1.8));
			const lit = (0.7 + 0.3 * v) * math.randFloat(0.9, 1.1);
			const rgb = stem ? [74, 96, 40] : [54 + 40 * v * across, 104 + 40 * v, 32 + 10 * v];
			data.set(
				[...rgb.map((c) => Math.min(255, c * lit)), stem || leaf ? 255 : 0],
				(y * width + x) * 4,
			);
		}
	return { width, height, data };
}

/** The meadow's ground: blades and clover in light and shade, bright so the land's colors tint it. */
export function meadowTexture(size = 128) {
	math.seed(41);
	const data = new Uint8Array(size * size * 4).fill(255);
	for (let i = 0; i < size * size; i++) {
		const [x, y] = [(i % size) / size, Math.floor(i / size) / size];
		const streak = 0.5 + 0.5 * Math.sin((x * 9 + Math.sin(y * TURN * 3) * 0.4) * TURN);
		const clump = 0.5 + 0.5 * Math.sin(x * TURN * 2 + 1) * Math.sin(y * TURN * 3);
		const shade = (150 + 60 * streak * clump + 45 * clump) * math.randFloat(0.78, 1.1);
		data.set(
			[shade * 0.92, shade, shade * 0.7, 255].map((c) => Math.min(255, Math.round(c))),
			i * 4,
		);
	}
	return { width: size, height: size, data };
}

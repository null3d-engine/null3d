// The garden's setting: the ring of mountains around the glade, and the moss that the cloud lies on.
// Both are meshes, so a coarse preset that draws only prefixes of the cloud's chunks still shows
// moss in the gaps and no horizon behind the splats.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import { mountainRing } from '../lib/mountains';
import { terrain } from '../lib/procedural';
import { gardenHeight, groundLight, LAND } from './cloud';

/** The ground's detail around the glade, by preset: the ring's bearings and rows. */
const DETAIL: Record<QualityPreset, readonly [number, number]> = {
	low: [160, 26],
	medium: [200, 32],
	high: [240, 38],
	ultra: [280, 44],
};

/** Builds the mountains and the moss ground around the glade. */
export function createLandscape(ctx: SketchContext, preset: QualityPreset): void {
	const { scene, geometry, materials } = ctx;
	// The ring of mountains around the glade, forested and hazy, so no view reaches the background.
	const [segments, rows] = DETAIL[preset];
	const ring = mountainRing({
		half: LAND,
		land: gardenHeight,
		crest: [260, 340],
		heights: [44, 72],
		segments,
		rows,
		seed: 41,
		palette: {
			forest: [0.06, 0.12, 0.045],
			rock: [0.19, 0.18, 0.15],
			snow: [0.7, 0.74, 0.8],
			treeLine: 26,
			snowLine: 64,
			frost: 0.02,
		},
	});
	scene.createMesh({
		mesh: geometry.fromArrays(ring.arrays),
		material: materials.standard({ vertexColors: true, roughness: 1 }),
		castShadows: false,
		receiveShadows: false,
	});
	// The moss the cloud lies on: a mesh under the ground splats, so a coarser preset, which draws
	// only prefixes of the cloud's chunks, shows moss in the gaps rather than the horizon.
	const ground = terrain({
		size: LAND * 2,
		quads: 96,
		tile: 9,
		middle: 0.45,
		height: (x, z) => gardenHeight(x, z) - 0.06,
		color: (x, z, _y, _slope, out) => groundLight(x, z, out),
	});
	scene.createMesh({
		mesh: geometry.fromArrays(ground),
		// The mesh is the moss that shows through the splats, so it wears the capture's light
		// rather than the stage's. A relit mesh shows a different moss wherever the splats leave
		// a gap, and a low sun turns those gaps into a band across the ground.
		material: materials.unlit({ vertexColors: true }),
		castShadows: false,
		receiveShadows: false,
	});
}

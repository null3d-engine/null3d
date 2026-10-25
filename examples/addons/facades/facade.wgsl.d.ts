// The types of facade.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly power: 'f32';
		readonly litShare: 'f32';
		readonly cellWidth: 'f32';
		readonly floorHeight: 'f32';
		readonly sill: 'f32';
		readonly glassX0: 'f32';
		readonly glassY0: 'f32';
		readonly glassX1: 'f32';
		readonly glassY1: 'f32';
		readonly windowWidth: 'f32';
		readonly windowHeight: 'f32';
		readonly roomDepth: 'f32';
		readonly roomLight: 'f32';
		readonly flicker: 'f32';
		readonly waveStart: 'f32';
		readonly waveSpeed: 'f32';
		readonly waveOriginX: 'f32';
		readonly waveOriginZ: 'f32';
		readonly waveRise: 'f32';
		readonly waveDamping: 'f32';
		readonly farFade: 'f32';
		readonly farFull: 'f32';
		readonly wallTile: 'f32';
		readonly shopHeight: 'f32';
		readonly mode: 'f32';
		readonly furniture: 'f32';
		readonly blinds: 'f32';
	},
	'wallMap' | 'wallOrm' | 'codeMap'
>;
export default shader;

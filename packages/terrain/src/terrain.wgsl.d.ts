// The types of terrain.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly tiles: 'vec4f';
		readonly layerRoughness: 'vec4f';
		readonly ground: 'vec4f';
		readonly layerContrast: 'vec4f';
		readonly layerAlpha: 'vec4f';
		readonly selection: 'vec2f';
	},
	'splatMap' | 'layerZero' | 'layerOne' | 'layerTwo' | 'layerThree' | 'normalMap'
>;
export default shader;

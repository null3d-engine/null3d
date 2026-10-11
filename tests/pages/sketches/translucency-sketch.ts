// Light through thin surfaces (glTF's diffuse transmission): four upright double-sided panels with
// a low sun behind them, which lets 0, 1/3, 2/3 and all of their diffuse light through to the
// camera's side. A box between the sun and the last panel shades its back, so its shadow shows
// through the panel. An orange lamp behind the second panel lights its lower half from behind.
// The translucency spec measures each effect.
// ?custom draws the panels with a custom material whose surface function sets the transmission.
// ?maps gives the last panel a diffuse transmission map in stripes and a color map.
// ?volume gives the panels a thick red volume, which tints the light that passes through.
// ?leaves draws masked leaf cards with alpha to coverage in front of the panels, whose cut outlines
// cast shadows too. Without it and ?maps, the page downloads one shader file that loads on first
// use: the builds that let light through to the other side.
import { defineSketch } from '@null3d/engine';
import {
	BOX,
	CAMERA,
	LAMP,
	LAMP_RANGE,
	PANEL_SHARES,
	PANEL_SIZE,
	PANEL_X,
	SUN,
} from './translucency-scene';

const params = new URL(import.meta.url).searchParams;

/** A surface function that sets the diffuse transmission that the material's uniform gives. */
const leafWgsl = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.diffuseTransmission = material.share;
    return s;
}

struct Uniforms { share: f32 }
`;

/** A texture of `size` square texels from a function of each texel's place, in 0 to 1. */
function texels(size: number, rgba: (u: number, v: number) => [number, number, number, number]) {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const at = (y * size + x) * 4;
			data.set(
				rgba((x + 0.5) / size, (y + 0.5) / size).map((c) => Math.round(c * 255)),
				at,
			);
		}
	return data;
}

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground('#1b2433');
	scene.setActiveCamera(scene.createPerspectiveCamera(CAMERA));
	// The sun shines from behind the panels toward the camera, a little from above and the left.
	scene.createDirectionalLight({
		direction: SUN,
		color: '#fff1d8',
		intensity: 3,
		castShadows: true,
		shadow: { distance: 20 },
	});
	scene.createAmbientLight({ color: '#a8c0ff', intensity: 0.25 });
	scene.createPointLight({
		position: LAMP,
		color: '#ff8a3c',
		intensity: 2,
		range: LAMP_RANGE,
	});

	const panel = geometry.plane({ width: PANEL_SIZE[0], height: PANEL_SIZE[1] });
	const stripes = textures.fromData({
		width: 32,
		height: 32,
		data: texels(32, (u) => ((u * 4) % 1 < 0.5 ? [1, 0.55, 0.3, 1] : [1, 1, 1, 0.2])),
		colorSpace: 'linear',
	});
	const volume = params.has('volume')
		? { thickness: 0.4, attenuationColor: '#e05030', attenuationDistance: 0.2 }
		: {};
	PANEL_SHARES.forEach((share, k) => {
		const options = {
			color: '#3f7a2a',
			roughness: 0.6,
			doubleSided: true,
			diffuseTransmission: share,
			diffuseTransmissionColor: '#c8e070',
			...volume,
		};
		const maps = params.has('maps') && k === 3;
		const material = params.has('custom')
			? materials.shader({ ...options, wgsl: leafWgsl, uniforms: { share } })
			: materials.standard({
					...options,
					...(maps
						? { diffuseTransmissionMap: stripes, diffuseTransmissionColorMap: stripes }
						: {}),
				});
		scene.createMesh({
			mesh: panel,
			material,
			position: [PANEL_X[k] as number, 0.1, 0],
			castShadows: true,
			receiveShadows: true,
		});
	});
	// A box between the sun and the last panel, whose shadow falls on the panel's back.
	scene.createMesh({
		mesh: geometry.box({ width: 0.35, height: 0.35, depth: 0.35 }),
		material: materials.standard({ color: '#6b6b6b' }),
		position: BOX,
		castShadows: true,
	});

	if (params.has('leaves')) {
		// Leaf cards: an ellipse cut out by the mask, with veins that let less light through.
		const leaf = textures.fromData({
			width: 64,
			height: 64,
			data: texels(64, (u, v) => {
				const inside = ((u - 0.5) / 0.42) ** 2 + ((v - 0.5) / 0.48) ** 2 < 1;
				const vein = Math.abs(u - 0.5) < 0.03 || Math.abs(((v * 6) % 1) - Math.abs(u - 0.5)) < 0.04;
				const shade = vein ? 0.75 : 1;
				return [shade, shade, shade, inside ? 1 : 0];
			}),
			colorSpace: 'srgb',
			mipmaps: true,
		});
		const card = geometry.plane({ width: 0.7, height: 0.9 });
		const cards = materials.standard({
			map: leaf,
			color: '#5d9a35',
			roughness: 0.55,
			doubleSided: true,
			alphaMode: 'mask',
			diffuseTransmission: 0.8,
			diffuseTransmissionColor: '#d6ec7a',
		});
		for (let k = 0; k < 7; k++) {
			const angle = (k - 3) * 0.35;
			scene.createMesh({
				mesh: card,
				material: cards,
				position: [(k - 3) * 0.75, -0.95 + 0.12 * Math.cos(k * 1.7), 0.6],
				rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
				castShadows: true,
				receiveShadows: true,
			});
		}
	}
});

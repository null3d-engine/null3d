// The far cards of the showcase scenes' Blender plants, lit as a rounded tree rather than as a flat
// painted plane. A hand-baked card stores one picture of the plant and a single outward-and-up
// normal over each face, so the sun catches the whole crown and the trunk takes a crown's light:
// measured against its mesh, such a card is a third to four fifths brighter and its crown's shading
// spread a third to a half lower. This material keeps the card's own picture and builds a dome
// normal per pixel instead, about the plant's foot, so a crown lights as a mass and a trunk shades
// as a trunk. It costs no texture memory and no triangles.
import type { Material, SketchContext, Texture } from '@null3d/engine';

/**
 * The card's material: its color map, lit through the engine's own shading with a dome normal about
 * the plant's foot. A card's left atlas half holds its side view and its right half the view from
 * above: the upright quads take the dome's normal, and the level quad keeps the sky's.
 *
 * The approximation has a limit: every upright face shows the same side view, so the dome cannot
 * vary with the direction the camera looks from. Per-view normals, or more stored views, are the
 * exact route and cost texture memory.
 */
const cardShader = /* wgsl */ `
var cardMap: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let texel = textureSample(cardMap, cardMapSampler, input.uv);
    s.baseColor = texel.rgb * s.baseColor;
    // A cut-out's alpha thins in the smaller mip levels, so a far card would fade away. The alpha
    // grows with the level that the texture reads, as the swaying leaves' does.
    let texels = vec2f(textureDimensions(cardMap, 0));
    let duv1 = dpdx(input.uv);
    let duv2 = dpdy(input.uv);
    let stretch = max(dot(duv1 * texels, duv1 * texels), dot(duv2 * texels, duv2 * texels));
    let mip = max(0.0, 0.5 * log2(max(stretch, 1e-8)));
    s.alpha = texel.a * (1.0 + 0.25 * mip);
    // The upright quads show the side view. Their normal follows a dome about the plant's foot: the
    // trunk below the crown lies sideways, and the crown's normal rises toward the sky with the
    // height that the side view's second texture coordinate gives. The level quad keeps the sky's
    // normal, so a crown seen from above still lights from above.
    if (input.uv.x < 0.5) {
        let across = vec3f(input.normal.x, 0.0, input.normal.z);
        let reach = length(across);
        if (reach > 1e-4) {
            let outward = across / reach;
            let t = clamp(input.uv.y, 0.0, 1.0);
            let rise = smoothstep(0.45, 1.0, t);
            let dome = normalize(outward * (1.0 - 0.8 * rise) + vec3f(0.0, 0.25 + 1.1 * rise, 0.0));
            s.normal = dome;
            s.diffuseNormal = dome;
            s.ambientNormal = dome;
        }
    }
    return s;
}
`;

/** A card material's settings: the part's color map, and the roughness that the card lights with. */
export interface CardMaterialOptions {
	/** The card's atlas, which holds its side view and its view from above. */
	readonly map?: Texture;
	/** How rough the card lights, 1 by default. */
	readonly roughness?: number;
}

/**
 * Makes the material of a far card: the card part's color map, drawn as a cut-out, whose upright
 * faces light with a dome normal about the plant's foot. Stand the card part's batch with it in
 * place of the file's material. The material lives in the scene until `destroy`.
 */
export function createCardMaterial(
	ctx: SketchContext,
	{ map, roughness = 1 }: CardMaterialOptions = {},
): Material {
	// A card without a map draws white, so the shader always has a texture to sample.
	const white =
		map ?? ctx.textures.fromData({ width: 1, height: 1, data: new Uint8Array(4).fill(255) });
	return ctx.materials.shader({
		wgsl: cardShader,
		roughness,
		vertexColors: true,
		doubleSided: true,
		alphaMode: 'mask',
		alphaCutoff: 0.5,
		textures: { cardMap: white },
	});
}

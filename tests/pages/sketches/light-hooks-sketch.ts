// The surface's two light hooks: a normal for the sky's light alone (`s.ambientNormal`) and the
// switch that joins the surface's occlusion with screen-space occlusion by the smaller of the two
// (`s.occlusionByMinimum`). `tests/image/light-hooks.spec.ts` draws each case and compares the
// pictures pixel by pixel.
//
// ?hook=sky draws one sphere under a sun, with ?sky=sun (no other light), ?sky=hemisphere (a blue
// sky over a brown ground) or ?sky=environment (the built-in room). ?normal= picks the sphere's
// material: `plain` names no hook, `same` names the sky's normal and leaves it at the mesh's
// normal, `up` turns the sky's normal straight up, and `diffuse-up` turns the diffuse normal up
// instead, which bends the sun as well.
//
// ?hook=occlusion draws ambient occlusion's scene (bench/scenes/ao.ts), lit by ambient light
// alone, with every shape's own occlusion at a fixed share. ?occlusion= picks the join: `plain`
// names no hook, `product` names the switch and leaves it false, and `minimum` sets it. ?ao=off
// leaves screen-space ambient occlusion off.
import { defineSketch } from '@null3d/engine';
import {
	AO_AMBIENT,
	AO_BACKGROUND,
	AO_CAMERA,
	AO_SETTINGS,
	AO_SHAPES,
} from '../../../bench/scenes/ao';

const params = new URL(import.meta.url).searchParams;
const HOOK = params.get('hook') ?? 'sky';
const SKY = params.get('sky') ?? 'hemisphere';
const NORMAL = params.get('normal') ?? 'plain';
const OCCLUSION = params.get('occlusion') ?? 'plain';
const AO = params.get('ao') !== 'off';

/** The sphere's surface for each `?normal=`. */
const SPHERE_WGSL: Record<string, string> = {
	plain: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    return defaultSurface(input);
}
`,
	same: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.ambientNormal = input.normal;
    return s;
}
`,
	up: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.ambientNormal = vec3f(0.0, 1.0, 0.0);
    return s;
}
`,
	'diffuse-up': /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.diffuseNormal = vec3f(0.0, 1.0, 0.0);
    return s;
}
`,
};

/** The shapes' surface for each `?occlusion=`: an own occlusion that holds over the whole shape. */
const SHAPE_WGSL: Record<string, string> = {
	plain: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.occlusion = 0.6;
    return s;
}
`,
	product: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.occlusion = 0.6;
    s.occlusionByMinimum = false;
    return s;
}
`,
	minimum: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.occlusion = 0.6;
    s.occlusionByMinimum = true;
    return s;
}
`,
};

export default defineSketch(async ({ scene, materials, geometry, assets, post, quality }) => {
	// Every picture draws at the canvas's size with no bounce light, so two pictures differ only
	// where their materials do.
	quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false, bounceRays: 0 });
	if (HOOK === 'occlusion') {
		quality.set({ aoScale: 0.5 });
		if (AO) post.set({ ao: AO_SETTINGS.default });
		scene.setBackground(AO_BACKGROUND);
		scene.setActiveCamera(
			scene.createPerspectiveCamera({
				...AO_CAMERA,
				position: [...AO_CAMERA.position],
				target: [...AO_CAMERA.target],
			}),
		);
		scene.createAmbientLight({ color: AO_AMBIENT.color, intensity: AO_AMBIENT.intensity });
		const wgsl = SHAPE_WGSL[OCCLUSION] as string;
		for (const shape of AO_SHAPES) {
			const [x, y, z] = shape.size;
			const mesh =
				shape.kind === 'box'
					? geometry.box({ width: x, height: y, depth: z })
					: geometry.sphere({ radius: x });
			const material = materials.shader({ wgsl, color: shape.color, roughness: 1, metalness: 0 });
			scene.createMesh({ mesh, material, position: [...shape.position] });
		}
		return;
	}
	scene.setBackground('#202428');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 20,
			position: [0, 0.4, 4.2],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-0.6, -0.5, -0.6], color: '#fff2dc', intensity: 2.5 });
	if (SKY === 'hemisphere')
		scene.createHemisphereLight({ skyColor: '#7fb2ff', groundColor: '#5a3a1e', intensity: 1.5 });
	if (SKY === 'environment')
		scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 1 });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1, widthSegments: 64, heightSegments: 32 }),
		material: materials.shader({
			wgsl: SPHERE_WGSL[NORMAL] as string,
			color: '#d8d0c4',
			roughness: 0.9,
			metalness: 0,
		}),
	});
});

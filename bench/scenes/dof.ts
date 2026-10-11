// Depth of field's scene, defined once for null3D's image tests and its cost test. It is plain data
// with no engine imports: a white post near the camera, an orange box and a teal sphere at the
// focus, a row of bright lights far behind in front of a dim wall, and a ground between them, seen
// through an 85 mm lens at f/1.4. The post stands over the sphere's left edge, and the box and the
// sphere stand over the lights.

type Vec3 = readonly [number, number, number];

/** The perspective camera: where it stands, the point it looks at, its lens and its planes. */
export const DOF_CAMERA = {
	position: [0, 1, 6],
	target: [0, 1, 0],
	focalLength: 85,
	near: 0.1,
	far: 60,
} as const satisfies {
	position: Vec3;
	target: Vec3;
	focalLength: number;
	near: number;
	far: number;
};

/** The distance along the view of the post, of the box and of the lights. */
export const DOF_DISTANCES = { near: 2, both: 6, far: 16 } as const;

/** A point at the box, on the camera's axis, as far along the view as the box is. */
export const DOF_BOX_POINT: Vec3 = [0, 1, 0];

/** The taps that the quality setting dofSamples takes. */
export const DOF_TAPS = [0, 16, 22, 43, 71] as const;

/** The lens of every test: wide open, with blur up to 5% of the image's height. */
export const DOF_LENS = { aperture: 1.4, maxBlur: 0.05 } as const;

/** The sRGB background color, the sun and the ambient light. */
export const DOF_BACKGROUND = '#0b1020';
export const DOF_SUN = { direction: [-0.4, -1, -0.6], color: '#fff4e0', intensity: 2.5 } as const;
export const DOF_AMBIENT = { color: '#9fb4d8', intensity: 0.6 } as const;

/**
 * A shape of the scene: a box of `size`, or a sphere whose radius is `size[0]`, at `position`, with
 * the standard material's sRGB color, roughness and emissive light.
 */
export interface DofShape {
	kind: 'box' | 'sphere';
	size: Vec3;
	position: Vec3;
	color: string;
	roughness: number;
	emissiveIntensity: number;
}

const shape = (
	kind: DofShape['kind'],
	size: Vec3,
	position: Vec3,
	color: string,
	emissiveIntensity = 0,
): DofShape => ({ kind, size, position, color, roughness: 0.6, emissiveIntensity });

/** The shapes: the ground, the post, the box, the sphere, the lights and the wall. */
export const DOF_SHAPES: readonly DofShape[] = [
	shape('box', [12, 0.05, 30], [0, -0.025, -8], '#6d6a62'),
	shape('box', [0.05, 3, 0.05], [0.08, 1, 4], '#f2f2f2'),
	shape('box', [0.5, 0.8, 0.2], [-0.3, 1, 0], '#e07a2f'),
	{ ...shape('sphere', [0.25, 0, 0], [0.45, 1.1, 0], '#2fa4a0'), roughness: 0.3 },
	...Array.from({ length: 9 }, (_, k) =>
		shape('sphere', [0.06, 0, 0], [-2 + 0.5 * k, 1 + 0.35 * Math.sin(k * 1.7), -10], '#ffe2a8', 12),
	),
	shape('box', [12, 6, 0.2], [0, 2, -14], '#28324a'),
];

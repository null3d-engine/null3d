// The cone of haze under a spot light, as a surface function for null3D and as GLSL for three.js.
// Both fade the cone where the surface turns away from the camera, so the shell reads as a soft
// volume rather than a solid wedge. The cone mesh's vertex colors carry the light from the lens down
// to the floor, and one strength scales the whole cone with the power-on wave.
export const CONE_WGSL = /* wgsl */ `
struct Uniforms { strength: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let facing = abs(dot(normalize(input.normal), normalize(input.viewDirection)));
    s.baseColor = vec3f(0.0);
    s.emissive = input.vertexColor.rgb * (facing * facing * facing) * material.strength;
    s.alpha = 1.0;
    return s;
}
`;

export const CONE_VERTEX = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormalView;
varying vec3 vViewPosition;

void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const CONE_FRAGMENT = /* glsl */ `
uniform float strength;
varying vec3 vColor;
varying vec3 vNormalView;
varying vec3 vViewPosition;

void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
    gl_FragColor = vec4(vColor * facing * facing * facing * strength, 1.0);
}
`;

/** The whole cone's light at full power, before the vertex colors darken it toward the floor. */
export const CONE_STRENGTH = 0.3;

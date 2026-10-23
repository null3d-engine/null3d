// The draw of a batch's splats: each row places one Gaussian, and this shader turns its row into a
// camera-facing card that covers the splat's projected ellipse. The vertex offset sizes the card
// from the row's covariance, which the row's rotation and scales give, and the surface function
// fades it with the same ellipse in pixels, so the splat is a soft Gaussian rather than a disc.
//
// The engine sorts the batch's rows back to front in the transparent pass and culls them by their
// spheres, so this shader reads no order of its own. It also fades a splat where it meets an opaque
// mesh, from the copy of the scene's depth, so an intersection is soft rather than a cut.

struct Uniforms {
    // The radius, in standard deviations, that a splat's card covers.
    extent: f32,
    // The square pixels of blur that every splat gains, so a tiny splat still covers a pixel.
    blur: f32,
    // How far in front of an opaque mesh a splat fades in, in meters. 0 keeps a hard edge.
    softness: f32,
    // The alpha under which a pixel draws nothing.
    cutoff: f32,
}

// The gravity of the blur that a point of a splat spreads over, as the covariance adds it.
const BASE_BLUR: f32 = 0.09;

// A splat on the screen: where its center lies in pixels, the inverse of its 2D covariance, and the
// two covariance axes that the card spans.
struct SplatScreen {
    // The center in pixels from the top left, or 0 when the splat does not draw.
    center: vec2f,
    // The inverse of the 2D covariance: [a, b; b, c].
    conic: vec3f,
    // The covariance's x and y axes on the screen, in pixels.
    axisX: vec2f,
    axisY: vec2f,
    // The distance of the center in front of the camera, in meters.
    depth: f32,
    // How many meters one pixel covers at that depth.
    worldPerPixel: f32,
    // True when the splat lies in front of the camera and covers a pixel.
    drawn: bool,
}

// The coordinates of `v` in the basis whose columns are the matrix's three axes, which turns a
// world direction back into the mesh's own space.
fn to_mesh(m: mat3x3f, v: vec3f) -> vec3f {
    let a = m[0];
    let b = m[1];
    let c = m[2];
    let det = dot(a, cross(b, c));
    if (abs(det) < 1e-12) {
        return v;
    }
    return vec3f(dot(cross(b, c), v), dot(cross(c, a), v), dot(cross(a, b), v)) / det;
}

// The splat that one row places, as the screen sees it. The row's world matrix holds its center and
// the rotation and scales that its covariance is made of: the matrix's three axes are the
// covariance's own axes, in meters.
fn splat_screen(matrix: mat4x4f) -> SplatScreen {
    var out: SplatScreen;
    out.center = vec2f(0.0);
    out.conic = vec3f(0.0);
    out.axisX = vec2f(0.0);
    out.axisY = vec2f(0.0);
    out.depth = 0.0;
    out.worldPerPixel = 0.0;
    out.drawn = false;
    let center = matrix[3].xyz;
    let view = camera.view;
    let center_view = (view * vec4f(center, 1.0)).xyz;
    // The camera looks down -Z, so a point in front of it has a negative view Z.
    let depth = -center_view.z;
    out.depth = depth;
    if (depth <= camera.near) {
        return out;
    }
    let res = frame.resolution;
    let fx = camera.projection[0][0] * res.x * 0.5 / depth;
    let fy = camera.projection[1][1] * res.y * 0.5 / depth;
    // The perspective derivative, with y pointing down the screen as the pixels count.
    let jx = vec3f(fx, 0.0, -fx * center_view.x / depth);
    let jy = vec3f(0.0, -fy, fy * center_view.y / depth);
    let va = (view * vec4f(matrix[0].xyz, 0.0)).xyz;
    let vb = (view * vec4f(matrix[1].xyz, 0.0)).xyz;
    let vc = (view * vec4f(matrix[2].xyz, 0.0)).xyz;
    let ca = vec2f(dot(jx, va), dot(jy, va));
    let cb = vec2f(dot(jx, vb), dot(jy, vb));
    let cc = vec2f(dot(jx, vc), dot(jy, vc));
    let blur = material.blur + BASE_BLUR;
    let sxx = ca.x * ca.x + cb.x * cb.x + cc.x * cc.x + blur;
    let sxy = ca.x * ca.y + cb.x * cb.y + cc.x * cc.y;
    let syy = ca.y * ca.y + cb.y * cb.y + cc.y * cc.y + blur;
    let det = sxx * syy - sxy * sxy;
    if (det <= 1e-12) {
        return out;
    }
    out.conic = vec3f(syy, -sxy, sxx) / det;
    out.axisX = ca;
    out.axisY = cb;
    let clip = camera.viewProjection * vec4f(center, 1.0);
    if (clip.w <= 0.0) {
        return out;
    }
    let ndc = clip.xy / clip.w;
    out.center = vec2f((ndc.x * 0.5 + 0.5) * res.x, (0.5 - ndc.y * 0.5) * res.y);
    out.worldPerPixel = 2.0 * depth / (camera.projection[1][1] * res.y);
    out.drawn = true;
    return out;
}

// Places the card that covers the splat: the quad's corner moves along the splat's two screen axes,
// and the result turns back into the mesh's space, where the engine applies the row's matrix.
fn vertexOffset(input: VertexInput) -> vec3f {
    let matrix = object.worldMatrix;
    let axes = mat3x3f(matrix[0].xyz, matrix[1].xyz, matrix[2].xyz);
    let screen = splat_screen(matrix);
    if (!screen.drawn) {
        // Every corner meets at the row's center, so the card covers no pixel.
        return -input.position;
    }
    let corner = input.uv * 2.0 - 1.0;
    let offset = material.extent * (corner.x * screen.axisX + corner.y * screen.axisY);
    let right = vec3f(camera.view[0][0], camera.view[1][0], camera.view[2][0]);
    let up = vec3f(camera.view[0][1], camera.view[1][1], camera.view[2][1]);
    let world = (right * offset.x - up * offset.y) * screen.worldPerPixel;
    return to_mesh(axes, world) - input.position;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let screen = splat_screen(object.worldMatrix);
    var alpha = 0.0;
    if (screen.drawn) {
        let d = input.fragCoord.xy - screen.center;
        let power = 0.5 * (screen.conic.x * d.x * d.x + 2.0 * screen.conic.y * d.x * d.y + screen.conic.z * d.y * d.y);
        alpha = input.vertexColor.a * exp(-power);
        if (material.softness > 0.0) {
            // The opaque scene behind this pixel, and the splat's own distance along the view: a
            // splat that meets a mesh fades over the last meters before it.
            let uv = input.fragCoord.xy / frame.resolution;
            let behind = sceneDistance(uv);
            alpha *= smoothstep(0.0, material.softness, behind - screen.depth);
        }
        alpha = select(0.0, alpha, alpha >= material.cutoff);
    }
    s.baseColor = vec3f(0.0);
    s.metalness = 0.0;
    s.roughness = 1.0;
    s.emissive = input.vertexColor.rgb;
    s.alpha = clamp(alpha, 0.0, 1.0);
    return s;
}

// The draw of a batch's splats: each row places one Gaussian, and this shader turns its row into a
// camera-facing card that covers the splat's projected ellipse. The vertex offset projects the
// row's covariance, which the row's rotation and scales give, onto the screen, and spans the card
// along the ellipse's own axes, so the card's texture coordinates measure the distance from the
// splat's center in standard deviations. The unlit function then fades the card by that distance
// alone, so a pixel pays for no projection, and the splat shows its own color with no lighting.
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

// A splat on the screen: the ellipse's two axes in pixels, and how many meters a pixel covers at
// the splat's depth.
struct SplatScreen {
    // The ellipse's major and minor axes, each one standard deviation long, in pixels.
    axisX: vec2f,
    axisY: vec2f,
    // How many meters one pixel covers at the splat's depth.
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
    out.axisX = vec2f(0.0);
    out.axisY = vec2f(0.0);
    out.worldPerPixel = 0.0;
    out.drawn = false;
    let view = camera.view;
    let center_view = (view * vec4f(matrix[3].xyz, 1.0)).xyz;
    // The camera looks down -Z, so a point in front of it has a negative view Z.
    let depth = -center_view.z;
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
    if (sxx * syy - sxy * sxy <= 1e-12) {
        return out;
    }
    // The card spans the ellipse's own axes, from the 2D covariance's eigenvectors. All three of
    // the splat's axes add to that ellipse, so a flat splat seen edge on, or one whose longest
    // axis is its third, still gets a card that covers it.
    let mid = 0.5 * (sxx + syy);
    let spread = sqrt(max(0.25 * (sxx - syy) * (sxx - syy) + sxy * sxy, 0.0));
    let major = mid + spread;
    let minor = max(mid - spread, 0.0);
    // Either row of the covariance less the major value gives the major axis; the longer one
    // keeps its precision, and a round ellipse takes any direction.
    let fromX = vec2f(major - syy, sxy);
    let fromY = vec2f(sxy, major - sxx);
    var direction = select(fromY, fromX, dot(fromX, fromX) >= dot(fromY, fromY));
    let length2 = dot(direction, direction);
    direction = select(vec2f(1.0, 0.0), direction * inverseSqrt(length2), length2 > 1e-20);
    out.axisX = direction * sqrt(major);
    out.axisY = vec2f(-direction.y, direction.x) * sqrt(minor);
    out.worldPerPixel = 2.0 * depth / (camera.projection[1][1] * res.y);
    out.drawn = true;
    return out;
}

// Places the card that covers the splat: the quad's corner moves along the ellipse's axes, and the
// result turns back into the mesh's space, where the engine applies the row's matrix. The card
// lies in the plane through the splat's center that faces the camera, so every pixel of it has the
// center's depth.
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

// The splat's own color, faded by the Gaussian: the card's corner coordinates reach `extent`
// standard deviations, so their length gives the distance from the center in standard deviations.
// A pixel too faint to show draws nothing, so it costs no blend.
fn unlit(input: SurfaceInput) -> vec4f {
    let corner = input.uv * 2.0 - 1.0;
    let deviations = material.extent * material.extent * dot(corner, corner);
    var alpha = input.vertexColor.a * exp(-0.5 * deviations);
    if (material.softness > 0.0) {
        // The opaque scene behind this pixel, and the splat's own depth along the view: a splat
        // that meets a mesh fades over the last meters before it.
        let uv = input.fragCoord.xy / frame.resolution;
        let depth = -(camera.view * vec4f(input.relativePosition, 0.0)).z;
        alpha *= smoothstep(0.0, material.softness, sceneDistance(uv) - depth);
    }
    if (alpha < material.cutoff) {
        discard;
    }
    return vec4f(input.vertexColor.rgb, min(alpha, 1.0));
}

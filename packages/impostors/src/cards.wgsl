// The impostor cards' surface: a quad that faces the screen, drawn from the three atlas views
// nearest the direction from the card toward the eye, and lit by the scene's lights from the
// normal that the bake stored. The bake holds two atlases of the same octahedral grid: the
// colour, in sRGB, and a surface atlas whose red and green hold the octahedral code of the view's
// normal, its blue the depth from the view's front to its back, and its alpha the coverage.
//
// The vertex offset turns each quad toward the screen. The instance's world matrix takes the mesh
// to the view, so the offset that lands the quad on the screen's plane is that matrix's inverse
// applied to the wanted view-space point, less the vertex's own offset.

var impostorColor: texture_2d<f32>;
var impostorSurface: texture_2d<f32>;

struct Uniforms {
    // x and y: the cells of the atlas across and down. z: the share of the cell that the cell's
    // centre moves a view, 0 for none. w: unused.
    cells: vec4f,
}

/// The sign of a number, with 0 counted as positive, so the fold sends each back direction home.
fn signOf(n: f32) -> f32 {
    return select(-1.0, 1.0, n >= 0.0);
}

/// The octahedral coordinates of a unit direction, each from -1 to 1, as `encodeOctahedral` gives
/// them. The front half fills the square's middle diamond and the back half its four corners.
fn octahedralCode(direction: vec3f) -> vec2f {
    let sum = abs(direction.x) + abs(direction.y) + abs(direction.z);
    let p = direction.xy / max(sum, 1e-6);
    if (direction.z >= 0.0) {
        return p;
    }
    return vec2f((1.0 - abs(p.y)) * signOf(p.x), (1.0 - abs(p.x)) * signOf(p.y));
}

/// The atlas coordinate of a point of the card, whose own texture coordinate is `uv`, in the cell
/// at `cell`.
fn cellAt(cell: vec2f, cells: vec2f, uv: vec2f) -> vec2f {
    return vec2f((cell.x + uv.x) / cells.x, 1.0 - (cell.y + 1.0 - uv.y) / cells.y);
}

/// The colour of a cell at the card's point, as the atlas holds it. A direction at the edge of the
/// octahedron's square names a cell past the grid, which reads the nearest cell's picture: the
/// folds on the square's outer edge name a direction that a cell on the edge holds.
fn colorOf(cell: vec2f, cells: vec2f, uv: vec2f) -> vec4f {
    let inside = clamp(cell, vec2f(0.0), max(cells - vec2f(1.0), vec2f(0.0)));
    return textureSample(impostorColor, impostorColorSampler, cellAt(inside, cells, uv));
}

/// The stored surface of a cell at the card's point: the octahedral code of its normal in red and
/// green, its depth in blue and its coverage in alpha. A cell past the grid reads the nearest one,
/// as the colour does.
fn surfaceOf(cell: vec2f, cells: vec2f, uv: vec2f) -> vec4f {
    let inside = clamp(cell, vec2f(0.0), max(cells - vec2f(1.0), vec2f(0.0)));
    return textureSample(impostorSurface, impostorSurfaceSampler, cellAt(inside, cells, uv));
}

/// The unit normal in the view's space that an octahedral code names, the inverse of the fold.
fn octahedralDirection(code: vec2f) -> vec3f {
    let z = 1.0 - abs(code.x) - abs(code.y);
    var n: vec3f;
    if (z >= 0.0) {
        n = vec3f(code.x, code.y, z);
    } else {
        n = vec3f((1.0 - abs(code.y)) * signOf(code.x), (1.0 - abs(code.x)) * signOf(code.y), z);
    }
    return normalize(n);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let m = object.worldMatrix;
    let columnX = m[0].xyz;
    let columnY = m[1].xyz;
    let scaleX = max(length(columnX), 1e-6);
    let scaleY = max(length(columnY), 1e-6);
    let right = columnX / scaleX;
    let up = columnY / scaleY;
    // The corner's place on the screen's plane, in the view's space, where the engine multiplies
    // the mesh by the instance's transform.
    let wanted = vec3f(input.position.x * scaleX, input.position.y * scaleY, 0.0);
    let local = vec3f(dot(right, wanted) / scaleX, dot(up, wanted) / scaleY, 0.0);
    return local - input.position;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let cells = material.cells.xy;
    let direction = normalize(-input.relativePosition);
    let code = octahedralCode(direction);
    // Where the direction falls among the cells' centres, counted from the top left.
    let at = vec2f((code.x * 0.5 + 0.5) * cells.x - 0.5, (code.y * 0.5 + 0.5) * cells.y - 0.5);
    let base = floor(at);
    let f = at - base;
    // The two triangles of the square between four cell centres, with the weights of its corners.
    var cell0: vec2f;
    var cell1: vec2f;
    var cell2: vec2f;
    var w0: f32;
    var w1: f32;
    var w2: f32;
    if (f.x + f.y <= 1.0) {
        cell0 = base + vec2f(0.0, 0.0);
        cell1 = base + vec2f(1.0, 0.0);
        cell2 = base + vec2f(0.0, 1.0);
        w0 = 1.0 - f.x - f.y;
        w1 = f.x;
        w2 = f.y;
    } else {
        cell0 = base + vec2f(1.0, 0.0);
        cell1 = base + vec2f(0.0, 1.0);
        cell2 = base + vec2f(1.0, 1.0);
        w0 = 1.0 - f.y;
        w1 = 1.0 - f.x;
        w2 = f.x + f.y - 1.0;
    }
    let uv = input.uv;
    let color = colorOf(cell0, cells, uv) * w0 + colorOf(cell1, cells, uv) * w1
        + colorOf(cell2, cells, uv) * w2;
    s.baseColor = color.rgb;
    s.alpha = color.a;
    // Each stored normal is decoded in its own view's space, whose x and y lie across and up the
    // picture and whose z points at the viewer. The blend of the three is the view's normal, and
    // the camera's axes take it to the world, since the card faces the screen. The surface's blue
    // holds the depth of the view, which nothing reads yet.
    let stored0 = surfaceOf(cell0, cells, uv);
    let stored1 = surfaceOf(cell1, cells, uv);
    let stored2 = surfaceOf(cell2, cells, uv);
    let normal = octahedralDirection(stored0.xy) * w0 + octahedralDirection(stored1.xy) * w1
        + octahedralDirection(stored2.xy) * w2;
    let view = camera.view;
    s.normal = normalize(view[0].xyz * normal.x + view[1].xyz * normal.y + view[2].xyz * normal.z);
    return s;
}

// The impostor cards' surface: a quad that stands upright and turns about the world's up toward
// the eye, drawn from the three atlas views nearest the direction from the card toward the eye,
// and lit by the scene's lights from the normal that the bake stored. The bake holds two atlases
// of the same octahedral grid: the colour, in sRGB, and a surface atlas whose red and green hold
// the octahedral code of the view's normal, its blue the depth from the view's front to its back,
// and its alpha the coverage.
//
// The vertex offset turns each quad toward the eye and keeps its up along the world's up, so a
// tree's card stands as its mesh does. The instance's world matrix takes the mesh to the world,
// so the offset that lands the quad on the plane across the eye is that matrix's inverse applied
// to the wanted offset in the world, less the vertex's own offset. A shadow pass fills the matrix
// with the light's view, so the card turns toward the light there.
//
// A card's turn, about the world's up, is the tree's own turn. The shader turns the direction
// toward the eye by that turn before it picks the cells, and it turns the stored normal by the
// same angle before it lights it. Both read the tree's frame alone: the card's quad faces the eye,
// but the light does not, so a camera that moves around a tree leaves the tree's light where the
// sun puts it. The surface atlas stores each normal in the tree's local frame, so a turned copy
// lights as its mesh does from every camera.
//
// The card's shadow caster tests the coverage at the direction toward the light, from the same
// three cells, so the shadow has the crown's shape rather than the quad's. A card that receives
// shadows reads them where the stored depth puts the surface that it shows, so its own cast does
// not fall on it.

var impostorColor: texture_2d<f32>;
var impostorSurface: texture_2d<f32>;

struct Uniforms {
    // x and y: the cells of the atlas across and down. z: 1 draws the nearest view alone, 0 blends
    // the three nearest. w: the world distance that the surface atlas's stored depth spans, or 0
    // to read the card's own plane for the shadow lookup.
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
/// folds on the square's outer edge name a direction that a cell on the edge holds. The gradients
/// of the card's texture coordinates arrive from the caller, so the read is legal in the branch
/// that draws one view.
fn colorOf(cell: vec2f, uv: vec2f, gx: vec2f, gy: vec2f) -> vec4f {
    let cells = material.cells.xy;
    let inside = clamp(cell, vec2f(0.0), max(cells - vec2f(1.0), vec2f(0.0)));
    return textureSampleGrad(impostorColor, impostorColorSampler, cellAt(inside, cells, uv), gx / cells, gy / cells);
}

/// The stored surface of a cell at the card's point: the octahedral code of its normal in red and
/// green, its depth in blue and its coverage in alpha. A cell past the grid reads the nearest one,
/// as the colour does.
fn surfaceOf(cell: vec2f, uv: vec2f, gx: vec2f, gy: vec2f) -> vec4f {
    let cells = material.cells.xy;
    let inside = clamp(cell, vec2f(0.0), max(cells - vec2f(1.0), vec2f(0.0)));
    return textureSampleGrad(impostorSurface, impostorSurfaceSampler, cellAt(inside, cells, uv), gx / cells, gy / cells);
}

/// The unit direction that an octahedral code names, the inverse of the fold.
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

/// The card's frame in the world: the horizontal direction toward the eye, and the right and up
/// axes about it. The up stays the world's up, so the card stands as the tree does.
struct CardFrame {
    right: vec3f,
    up: vec3f,
    forward: vec3f,
}

/// The card's frame from the direction toward the eye, `eye`. A direction straight up or down has
/// no horizontal part, and faces the world's forward.
fn cardFrame(eye: vec3f) -> CardFrame {
    let flat = vec3f(eye.x, 0.0, eye.z);
    let forward = select(vec3f(0.0, 0.0, 1.0), normalize(flat), length(flat) > 1e-4);
    let up = vec3f(0.0, 1.0, 0.0);
    var frame: CardFrame;
    frame.right = normalize(cross(up, forward));
    frame.up = up;
    frame.forward = forward;
    return frame;
}

/// The unit direction from the card toward the frame's camera. A shadow pass draws the card from
/// the light, and its cascades see the light from one direction, as an orthographic camera does.
fn eyeDirection(at: vec3f) -> vec3f {
    let eye = engine_frame.camera_position;
    return normalize(eye.xyz - at * eye.w);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let m = object.worldMatrix;
    let columnX = m[0].xyz;
    let columnY = m[1].xyz;
    let scaleX = max(length(columnX), 1e-6);
    let scaleY = max(length(columnY), 1e-6);
    // The direction from the card toward the eye, which the frame's camera gives.
    let frame = cardFrame(eyeDirection(m[3].xyz));
    // The corner's place across the card and up it, in the world. The instance's transform turns
    // it into the local move that lands the corner there, which is its inverse applied to the
    // wanted offset.
    let wanted = frame.right * (input.position.x * scaleX) + frame.up * (input.position.y * scaleY);
    let columnZ = m[2].xyz;
    // The local point that lands there, less the vertex's own local point: the offset.
    return vec3f(
        dot(columnX, wanted) / (scaleX * scaleX),
        dot(columnY, wanted) / (scaleY * scaleY),
        dot(columnZ, wanted) / max(dot(columnZ, columnZ), 1e-12),
    ) - input.position;
}

/// The three cells of the atlas nearest the direction toward the eye, and the weights of the
/// square's triangle that holds the direction. One view draws the nearest cell alone.
struct Cells {
    a: vec2f,
    b: vec2f,
    c: vec2f,
    wa: f32,
    wb: f32,
    wc: f32,
}

fn cellsOf(at: vec2f) -> Cells {
    let base = floor(at);
    let f = at - base;
    var out: Cells;
    // The two triangles of the square between four cell centres, with the weights of its corners.
    if (f.x + f.y <= 1.0) {
        out.a = base + vec2f(0.0, 0.0);
        out.b = base + vec2f(1.0, 0.0);
        out.c = base + vec2f(0.0, 1.0);
        out.wa = 1.0 - f.x - f.y;
        out.wb = f.x;
        out.wc = f.y;
    } else {
        out.a = base + vec2f(1.0, 0.0);
        out.b = base + vec2f(0.0, 1.0);
        out.c = base + vec2f(1.0, 1.0);
        out.wa = 1.0 - f.y;
        out.wb = 1.0 - f.x;
        out.wc = f.x + f.y - 1.0;
    }
    return out;
}

/// The cells nearest the direction toward the eye, in the tree's frame, and the weights of each.
fn cellsAt(eye: vec3f) -> Cells {
    let cells = material.cells.xy;
    let code = octahedralCode(directionOf(eye));
    // Where the direction falls among the cells' centres, counted from the top left.
    let at = vec2f((code.x * 0.5 + 0.5) * cells.x - 0.5, (code.y * 0.5 + 0.5) * cells.y - 0.5);
    if (material.cells.z > 0.5) {
        let nearest = clamp(round(at), vec2f(0.0), max(cells - vec2f(1.0), vec2f(0.0)));
        var one: Cells;
        one.a = nearest;
        one.b = nearest;
        one.c = nearest;
        one.wa = 1.0;
        one.wb = 0.0;
        one.wc = 0.0;
        return one;
    }
    return cellsOf(at);
}

/// The direction toward the eye in the tree's own frame: the world direction turned by the tree's
/// turn. The cell pick and the light read the tree's frame, never the card's, so a camera that
/// moves around a tree does not turn the tree's light with it.
fn directionOf(eye: vec3f) -> vec3f {
    let turn = object.values.x;
    return vec3f(
        cos(turn) * eye.x - sin(turn) * eye.z,
        eye.y,
        sin(turn) * eye.x + cos(turn) * eye.z,
    );
}

/// The colour of the card at a point, from the cells nearest the direction toward the eye. One
/// view reads its cell alone, so the blend costs three reads a point and one costs one.
fn cardColor(inside: Cells, uv: vec2f, gx: vec2f, gy: vec2f) -> vec4f {
    if (material.cells.z > 0.5) {
        return colorOf(inside.a, uv, gx, gy);
    }
    return colorOf(inside.a, uv, gx, gy) * inside.wa
        + colorOf(inside.b, uv, gx, gy) * inside.wb
        + colorOf(inside.c, uv, gx, gy) * inside.wc;
}

/// The stored surfaces of the cells nearest the direction toward the eye. One view reads its cell
/// alone, and the three carry it.
fn cardSurfaces(inside: Cells, uv: vec2f, gx: vec2f, gy: vec2f) -> array<vec4f, 3> {
    if (material.cells.z > 0.5) {
        let stored = surfaceOf(inside.a, uv, gx, gy);
        return array<vec4f, 3>(stored, stored, stored);
    }
    return array<vec4f, 3>(
        surfaceOf(inside.a, uv, gx, gy),
        surfaceOf(inside.b, uv, gx, gy),
        surfaceOf(inside.c, uv, gx, gy),
    );
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let turn = object.values.x;
    let cosTurn = cos(turn);
    let sinTurn = sin(turn);
    let eye = input.viewDirection;
    let inside = cellsAt(eye);
    let gx = dpdx(input.uv);
    let gy = dpdy(input.uv);
    let color = cardColor(inside, input.uv, gx, gy);
    s.baseColor = color.rgb;
    s.alpha = color.a;
    // Each stored normal is decoded in the tree's local frame, whose x and y lie across and up the
    // tree and whose z points along it. The blend of the three is the tree's normal, and the tree's
    // turn takes it to the world. The card's quad faces the eye, but the normal does not: a light
    // that stands still lights the same side of a tree from every camera.
    let stored = cardSurfaces(inside, input.uv, gx, gy);
    // The atlas holds each code as a byte from 0 to 1, so it reads back into -1 to 1 first.
    let normal = octahedralDirection(stored[0].xy * 2.0 - vec2f(1.0)) * inside.wa
        + octahedralDirection(stored[1].xy * 2.0 - vec2f(1.0)) * inside.wb
        + octahedralDirection(stored[2].xy * 2.0 - vec2f(1.0)) * inside.wc;
    s.normal = normalize(vec3f(
        cosTurn * normal.x + sinTurn * normal.z,
        normal.y,
        -sinTurn * normal.x + cosTurn * normal.z,
    ));
    // The card shows a surface that stands along the view from its own plane. The shadow lookup
    // reads that surface, not the plane, so the card's own cast does not fall on it.
    let depth = stored[0].z * inside.wa + stored[1].z * inside.wb + stored[2].z * inside.wc;
    if (material.cells.w > 0.0) {
        s.shadowOffset = eye * (material.cells.w * (0.5 - depth));
    }
    return s;
}

/// The opacity of the card at a point, which the card's shadow caster tests: the blended coverage
/// of the three cells nearest the direction toward the light. A shadow pass draws the card toward
/// the light, so its caster cuts the crown's shape out of the shadow.
fn coverage(input: SurfaceInput) -> f32 {
    let gx = dpdx(input.uv);
    let gy = dpdy(input.uv);
    return cardColor(cellsAt(input.viewDirection), input.uv, gx, gy).a;
}

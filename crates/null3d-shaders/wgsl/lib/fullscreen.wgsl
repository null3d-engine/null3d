#define_import_path null3d::fullscreen

// What the full-screen passes share: the triangle that covers a target. A pass draws it with three
// vertices and no vertex buffer, and its fragment shader reads the pixel's own position.

/// The clip position of corner `vertex` of a triangle that covers the frame: the corners (-1, -1),
/// (3, -1) and (-1, 3), past the corners of clip space so that the triangle covers it whole. Its
/// depth sits halfway, so no depth mode of the WebGL2 path moves it to the edge of the clip range.
fn triangle(vertex: u32) -> vec4f {
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

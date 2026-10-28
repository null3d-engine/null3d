// The green layer of the sky layer held page: it covers the whole sky, brighter toward the
// horizon, so both places that a sky is seen take a color of its own.
fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    let low = 1.0 - 0.4 * clamp(input.direction.y, 0.0, 1.0);
    return SkyLayer(vec3f(0.1, 1.3, 0.45) * low, 1.0);
}

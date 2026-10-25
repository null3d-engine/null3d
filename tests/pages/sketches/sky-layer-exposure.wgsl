// The layer of the sky layer exposure page: a flat colour that covers the whole sky, so the sky and
// the lake that mirrors it must show one value at any exposure.
fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    return SkyLayer(vec3f(0.1, 1.0, 0.4), 1.0);
}

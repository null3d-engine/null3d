// The layer of the sky layer sun page: it covers nothing, so the sky keeps its own pixels and the
// only thing its values change is the share of the sun that it hides.
fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    return SkyLayer(vec3f(0.0), 0.0);
}

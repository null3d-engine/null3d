// S7's sky layer: three bands of light that hang over the horizon. The layer reads only the view
// direction, so the sky is the same in every run and the surface's reflection of it can be measured.
fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    let up = clamp(input.direction.y, 0.0, 1.0);
    let low_at = (up - 0.10) / 0.045;
    let mid_at = (up - 0.24) / 0.075;
    let high_at = (up - 0.42) / 0.11;
    let low = exp(-low_at * low_at);
    let mid = exp(-mid_at * mid_at);
    let high = exp(-high_at * high_at);
    let color = vec3f(0.10, 0.95, 0.55) * low
        + vec3f(0.40, 0.30, 0.95) * mid * 0.8
        + vec3f(0.95, 0.35, 0.45) * high * 0.5;
    return SkyLayer(color * 2.2, clamp(low + mid + high, 0.0, 1.0));
}

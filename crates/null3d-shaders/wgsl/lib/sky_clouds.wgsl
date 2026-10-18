#define_import_path null3d::sky_clouds

// The physical sky's clouds: the analytic sky's cloud field (null3d::atmosphere), with the same
// settings, lit by the physical sky's own light. The sun's and the moon's light at the camera
// light their tops, with a silver lining toward each, and the sky straight up lights their shade.
// Seen low over the horizon, the air between hides them as it hides the sun.
#import null3d::atmosphere::{cloud_fbm, cloud_noise}
#import null3d::sky_scattering::{SkyValues, PI}

/// The silver lining toward a light at `cos_theta` from the view: bright where the view looks
/// past a cloud's edge toward it.
fn silver_lining(cos_theta: f32) -> f32 {
    let base = 1.49 - cos_theta * 1.4;
    return clamp(0.51 / (base * sqrt(base)), 0.0, 3.0);
}

/// The sky's light `sky` in the unit direction `d`, above the horizon, with the clouds over it.
/// `zenith` is the sky's light straight up, `sun_light` and `moon_light` the lights at the camera,
/// and `through` the air's transmittance along `d` to the top of the air.
fn clouds(
    d: vec3f,
    sky: vec3f,
    zenith: vec3f,
    sun_light: vec3f,
    moon_light: vec3f,
    through: vec3f,
    values: SkyValues,
) -> vec3f {
    let cloud_scale = values.clouds.x;
    let cloud_speed = values.clouds.y;
    let cloud_coverage = values.clouds.z;
    let cloud_density = values.clouds.w;
    let cloud_elevation = values.cloud_place.x;
    let time = values.cloud_place.y;
    // The cloud plane, as the analytic sky's: a higher elevation brings the clouds lower and closer.
    let elevation = mix(1.0, 0.1, cloud_elevation);
    let cloud_uv = d.xz / (d.y * elevation) * cloud_scale + time * cloud_speed;
    let evolve = time * cloud_speed * 300.0;
    let density = clamp(cloud_fbm(cloud_uv * 1000.0, evolve) * 0.7 + 0.5, 0.0, 1.0);
    let region = cloud_noise(cloud_uv * 300.0) * 0.37 + 0.5;
    let coverage = clamp(cloud_coverage + (region - 0.5) * 0.6, 0.0, 1.0);
    let threshold = 1.0 - coverage;
    let horizon_fade = smoothstep(0.0, 0.03 + 0.06 * cloud_elevation, d.y);
    let mask = smoothstep(threshold, threshold + 0.3, density) * horizon_fade;
    if mask <= 0.0 {
        return sky;
    }
    let depth = max(0.0, density - threshold);
    let beer = exp(depth * -4.0);
    let powder = 1.0 - beer * beer;
    let shade = mix(0.45, 1.0, clamp(beer * powder * 2.6, 0.0, 1.0));
    let edge = mask * (1.0 - mask) * 4.0;
    // A thick cloud's top reflects about as a white surface does, and its edge shines toward the
    // light it stands in front of.
    let sun = sun_light * ((0.55 * shade + 0.35 * silver_lining(dot(d, values.sun.xyz)) * edge) / PI);
    let moon = moon_light * ((0.55 * shade + 0.35 * silver_lining(dot(d, values.moon.xyz)) * edge) / PI);
    let cloud = zenith * mix(1.0, 1.6, shade) + sun + moon;
    let alpha = (1.0 - exp(depth * cloud_density * -12.0)) * horizon_fade;
    // The air between hides the cloud as it hides the sky behind: luminance of the transmittance.
    let seen = dot(through, vec3f(0.2126, 0.7152, 0.0722));
    return mix(sky, mix(sky, cloud, seen), alpha);
}

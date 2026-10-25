//! Sky maps: environment maps of three.js's sky, which follow the scene's sky as the sketch moves
//! its sun or changes its air and clouds, as three.js's `PMREMGenerator.fromScene` makes one from
//! a scene that holds its `Sky`.
//!
//! A sky map is a cube texture whose generator, which the thread that draws holds, made it ready
//! for the sky. The map then fills in stages, one draw-list command each ([`Op::SkyMapStep`]). The
//! thread that draws plans what each stage does, and the map knows only how many there are: the
//! first stages draw the sky into the generator's chain of levels, the next ones filter the map's
//! levels from the chain for their roughness, a few faces each, and the last stage copies every
//! level into the texture at once. Until that copy, frames draw with the map as it was. The first fill records every stage in
//! one frame, so the first frame that draws with the map already has its light. A later change of
//! the sky refreshes the map one stage a frame, so no frame waits for the whole map. A change that
//! comes while a refresh runs waits for it to end, and then starts the next one with the sky as it
//! is then.
//!
//! A map redraws only for a change that shows: its sun turning more than half a degree, one of its
//! color values drifting by a fiftieth, or its clouds drifting a tenth of a cell of their pattern.
//! Anything finer waits, so a sun that moves in every frame costs one stage a frame only while it
//! crosses those steps. When the sky stops changing, one last fill captures it exactly, so a map
//! never keeps a sun that stopped short of a step.
//!
//! The map's diffuse light comes from the CPU ([`crate::sky_light`]), worked out when a fill
//! starts. Frames take it in the frame of the last stage, with the map's new levels, so the diffuse
//! light and the reflections change together.
//!
//! A sky layer that an add-on draws over the background reaches a map too: its WGSL is built into
//! the shader that draws the sky into the map's cube faces, so the map's texels hold the layer that
//! the background shows. The layer's own light then comes from those texels rather than from the
//! CPU's model of the core sky: the map's last stage sums a level of them onto the nine spherical
//! harmonics coefficients, and the GPU's read of that small target lands them in engine memory a
//! frame or two later. So the light a layer gives costs one small draw and one read for each fill,
//! never a frame, and it matches the reflections because it is measured from them. Until the first
//! read lands, the map keeps the CPU's model of the core sky, so no frame loses its light.
//!
//! A map of the physical sky (D-143) reads the physical sky's panorama in place of the analytic
//! sky's model: its stages name the panorama's texture. Its fill starts only in a frame whose
//! physical sky pass drew the panorama for the sky as it is then, so the faces that later frames
//! draw show the same sky. Its diffuse light comes from the CPU copy of the physical model
//! ([`crate::physical_sky_light`]).

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage};

use crate::background::{Sky, SkyLayer};
use crate::frame::{RecordError, address};
use crate::physical_sky::{Atmosphere, BOTTOM_RADIUS};
use crate::physical_sky_light::AirModel;
use crate::sky_light::{Sh, sky_sh};
use crate::textures::TextureStore;

/// Words of a stage's command: the texture, the generator, the stage, the panorama, the sky's 16
/// values, the layer's template, the core sky's four cloud values that the layer obeys, the share
/// of the sun that it hides, its opacity, its clock, the light capture's buffer, the volumetric
/// cloud tier's step count and its noise field's texture.
const STEP_WORDS: usize = 31;

/// The word of a stage's command that holds the template of the layer's build of the sky map's
/// shader, or 0 for a map that draws no layer.
const LAYER_WORD: usize = 20;

/// The word that first holds the layer's values: the four cloud values, the share of the sun, the
/// opacity and the clock.
const LAYER_VALUES: usize = 21;

/// The word that holds the id of the buffer that a light capture lands in, or 0 for no capture.
const LIGHT_BUFFER_WORD: usize = 28;

/// The nine coefficients of the light that a capture sums, red, green and blue each, as words in
/// engine memory and as float bits in the target that the GPU draws them into.
const LIGHT_WORDS: usize = 27;

/// The bytes of a capture's target: sixteen words a row, of which the first nine hold the
/// coefficients. A row of a texel copy starts on this boundary.
const LIGHT_BYTES: u32 = 256;

/// The fills that a map makes for a layer whose light has not landed, before it holds the levels it
/// has: two more than the one that came with the layer's install.
const LAYER_RETRIES: u8 = 3;

/// The frames that a map waits after a fill with a layer before it fills again for a light that has
/// not landed. A capture lands a frame or two after the fill's last stage, so a map that works never
/// waits this long.
const LAYER_GRACE: u8 = 4;

/// The captures that one map may have in flight. A map fills at most once every few frames, so
/// three buffers leave a capture waiting for the GPU without ever stopping the next one.
pub const LIGHT_RING: usize = 3;

/// The word that holds the steps of each ray of the volumetric cloud tier, or 0 for a map that
/// draws the flat layer.
const CLOUD_STEPS_WORD: usize = 29;

/// The word that holds the noise field's texture that the volumetric cloud tier reads, or 0 while
/// the tier draws the flat layer.
const CLOUD_FIELD_WORD: usize = 30;

/// The least turn of a sun, in radians, that a map draws again for: half a degree. A sun that
/// turns less darkens or brightens the light it gives a surface by far less than a level of 255.
const SUN_STEP: f32 = std::f32::consts::PI / 360.0;

/// The least drift of a color value, relative to its size, that a map draws again for: a fiftieth.
const COLOUR_STEP: f32 = 0.02;

/// The least drift of the clouds across the sky, in cells of their pattern, that a map draws again
/// for: a tenth. The shaders read the pattern at a thousand times the clock's drift, so at
/// three.js's speed the clouds cover a tenth of a cell in about five seconds.
const CLOUD_STEP: f32 = 0.1;

/// The height, in kilometers, under which a camera counts as this high when a map weighs how far
/// it moved. The sky changes little with height near the ground, so a camera below it must climb
/// 10 meters before a map draws again.
const FLAT_HEIGHT: f32 = 0.5;

/// The sky that a map shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MapSky {
    /// The analytic sky, whose light frames take times `gain`: 1, or the factor that matches the
    /// analytic sky to the physical sky that it stands in for.
    Analytic { sky: Sky, gain: f32 },
    /// The physical sky, seen from `height` kilometers above the ground.
    Physical { atmosphere: Atmosphere, height: f32 },
}

impl MapSky {
    /// The analytic sky as it is.
    pub fn analytic(sky: Sky) -> Self {
        Self::Analytic { sky, gain: 1.0 }
    }

    /// The core sky's cloud coverage, cloud density, cloud elevation and cloud scale, which a
    /// layer over it obeys.
    fn clouds(&self) -> [f32; 4] {
        match self {
            Self::Analytic { sky, .. } => [
                sky.cloud_coverage,
                sky.cloud_density,
                sky.cloud_elevation,
                sky.cloud_scale,
            ],
            Self::Physical { atmosphere, .. } => [
                atmosphere.cloud_coverage,
                atmosphere.cloud_density,
                atmosphere.cloud_elevation,
                atmosphere.cloud_scale,
            ],
        }
    }

    /// The factor of the light that frames take from a map of this sky.
    fn gain(&self) -> f32 {
        match self {
            Self::Analytic { gain, .. } => *gain,
            Self::Physical { .. } => 1.0,
        }
    }

    /// The diffuse light of this sky, with the physical sky's model `model`.
    fn sh(&self, model: Option<&AirModel>) -> Sh {
        match self {
            Self::Analytic { sky, .. } => sky_sh(sky),
            Self::Physical { atmosphere, height } => model.map_or([[0.0; 3]; 9], |model| {
                model.sh(atmosphere, BOTTOM_RADIUS + height)
            }),
        }
    }

    /// True when a map of `self` keeps its levels for `other`: its sun stands within half a degree
    /// of the other's, no color value has drifted by a fiftieth, and its clouds have drifted less
    /// than a tenth of their pattern's cell.
    fn near(&self, other: &Self) -> bool {
        self.compares(other, SUN_STEP, COLOUR_STEP, CLOUD_STEP)
    }

    /// True when `other` is the same sky down to the last value that a map draws, but for its
    /// clouds: they drift on their own, and only their step draws the map again.
    fn same(&self, other: &Self) -> bool {
        self.compares(other, 0.0, 0.0, f32::INFINITY)
    }

    /// True when `other` holds the same values as `self`, within `turn` radians of each sun's
    /// direction, `drift` of each color value relative to its size, and `clouds` cells of the
    /// clouds' pattern.
    fn compares(&self, other: &Self, turn: f32, drift: f32, clouds: f32) -> bool {
        match (self, other) {
            (Self::Analytic { sky: a, gain: ga }, Self::Analytic { sky: b, gain: gb }) => {
                same_direction(a.sun_position, b.sun_position, turn)
                    && within(rayleigh_coefficient(a), rayleigh_coefficient(b), drift)
                    && within(a.turbidity, b.turbidity, drift)
                    && within(a.mie_coefficient, b.mie_coefficient, drift)
                    && within(a.mie_directional_g, b.mie_directional_g, drift)
                    && within(a.second_sky_weight, b.second_sky_weight, drift)
                    && within(*ga, *gb, drift)
                    && same_clouds(a, b, drift, clouds)
                    && (a.second_sky_weight <= 0.0
                        || same_direction(a.second_sun_position, b.second_sun_position, turn))
            }
            (
                Self::Physical {
                    atmosphere: a,
                    height: ha,
                },
                Self::Physical {
                    atmosphere: b,
                    height: hb,
                },
            ) => {
                // The air between the camera and the surfaces is not the sky that a map draws, so
                // its aerial perspective counts for nothing here.
                same_direction(a.sun_position, b.sun_position, turn)
                    && same_direction(a.moon_position, b.moon_position, turn)
                    && within(a.sun_intensity, b.sun_intensity, drift)
                    && within(a.moon_intensity, b.moon_intensity, drift)
                    && within(a.stars, b.stars, drift)
                    && within(a.rayleigh, b.rayleigh, drift)
                    && within(a.haze, b.haze, drift)
                    && within(a.ozone, b.ozone, drift)
                    && within(a.mie_directional_g, b.mie_directional_g, drift)
                    && within(a.ground_albedo, b.ground_albedo, drift)
                    && within(a.altitude, b.altitude, drift)
                    && within(a.meters_per_unit, b.meters_per_unit, drift)
                    && same_clouds(a, b, drift, clouds)
                    && same_height(*ha, *hb, drift)
            }
            _ => false,
        }
    }
}

/// The Rayleigh coefficient that the analytic sky scatters its air by: its setting, less what a sun
/// sunk far below the horizon takes from it, as three.js's `sunFade` does.
fn rayleigh_coefficient(sky: &Sky) -> f32 {
    let fade = (sky.sun_position[1] / 450_000.0).exp().min(1.0);
    sky.rayleigh - (1.0 - fade)
}

/// True when the points `a` and `b` lie within `turn` radians of each other.
fn same_direction(a: [f32; 3], b: [f32; 3], turn: f32) -> bool {
    if a == b {
        return true;
    }
    let length = |v: [f32; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let (la, lb) = (length(a), length(b));
    if la <= 0.0 || lb <= 0.0 {
        return false;
    }
    // The sine of the angle between the points, from their cross product: a cosine rounds a turn
    // under two degrees to 1 on a sun hundreds of thousands of units away, which is exactly the
    // turn that a map weighs.
    let cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    dot > 0.0 && length(cross) <= turn.sin() * la * lb
}

/// The clouds that a sky draws: their shape, the speed that moves them and the clock that does.
struct Clouds {
    scale: f32,
    speed: f32,
    coverage: f32,
    density: f32,
    elevation: f32,
    time: f32,
}

/// A sky's settings, seen by the values that its clouds draw with.
trait Clouded {
    fn clouds(&self) -> Clouds;
}

impl Clouded for Sky {
    fn clouds(&self) -> Clouds {
        Clouds {
            scale: self.cloud_scale,
            speed: self.cloud_speed,
            coverage: self.cloud_coverage,
            density: self.cloud_density,
            elevation: self.cloud_elevation,
            time: self.time,
        }
    }
}

impl Clouded for Atmosphere {
    fn clouds(&self) -> Clouds {
        Clouds {
            scale: self.cloud_scale,
            speed: self.cloud_speed,
            coverage: self.cloud_coverage,
            density: self.cloud_density,
            elevation: self.cloud_elevation,
            time: self.time,
        }
    }
}

/// True when two skies draw clouds that lie within `drift` of each other in each value, and that
/// have drifted less than `cells` cells of their pattern apart. The sky's shaders read the pattern
/// at a thousand times the drift of the clock times the speed. A sky that draws no clouds has none
/// to compare, so it holds as still as it likes.
fn same_clouds(ours: &impl Clouded, theirs: &impl Clouded, drift: f32, cells: f32) -> bool {
    let ours = ours.clouds();
    let theirs = theirs.clouds();
    within(ours.scale, theirs.scale, drift)
        && within(ours.speed, theirs.speed, drift)
        && within(ours.coverage, theirs.coverage, drift)
        && within(ours.density, theirs.density, drift)
        && within(ours.elevation, theirs.elevation, drift)
        && (ours.coverage <= 0.0
            || theirs.coverage <= 0.0
            || (ours.time * ours.speed - theirs.time * theirs.speed).abs() * 1000.0 <= cells)
}

/// True when `a` and `b` lie within `drift` of each other, relative to the larger.
fn within(a: f32, b: f32, drift: f32) -> bool {
    (a - b).abs() <= drift * a.abs().max(b.abs())
}

/// True when two heights above the ground, in kilometers, lie within `drift` of each other. A
/// height under `FLAT_HEIGHT` counts as that high, so a camera near the ground must climb 10 meters
/// before a map draws again, as the physical sky's own tables wait for.
fn same_height(a: f32, b: f32, drift: f32) -> bool {
    (a - b).abs() <= drift * a.abs().max(b.abs()).max(FLAT_HEIGHT)
}

/// True when a map that shows `shown` starts a fill for `sky`: the sky has moved past the step that
/// a map draws for, or it has come to rest, which `settled` says, and the map does not hold it
/// exactly.
fn start_fill(shown: &MapSky, sky: &MapSky, settled: bool) -> bool {
    !shown.near(sky) || (settled && !shown.same(sky))
}

/// True when a map that shows `shown` starts a fill for the layer `layer`, which it showed as
/// `shown_layer`: the layer is another one, its values changed, or its own clock has moved by the
/// time that it asks the map to follow.
fn start_layer_fill(
    shown_layer: Option<SkyLayer>,
    filled_at: f32,
    clock: f32,
    layer: Option<SkyLayer>,
) -> bool {
    let (Some(shown), Some(layer)) = (shown_layer, layer) else {
        return shown_layer != layer;
    };
    if shown != layer {
        return true;
    }
    // A layer whose own clock moves changes the map's texels between two frames, and the engine
    // cannot tell how fast: the layer says how often its map should capture it. A layer of 0 holds
    // still, and leaves the map to fill when the sky or its values change.
    layer.refresh > 0.0 && (clock - filled_at).abs() >= layer.refresh
}

/// One sky map.
#[derive(Clone, Copy, Debug)]
struct SkyMap {
    texture: Handle,
    /// Its stages, the copy included.
    stages: u32,
    /// The stage at which the map captures its light, which the page places a stage or two before
    /// the copy so that the read lands before the levels that frame publishes.
    capture: u32,
    /// The sky and the layer of the levels that frames draw with, and its diffuse light, once the
    /// map is full.
    shown: Option<(MapSky, Option<SkyLayer>, Sh)>,
    /// The fill under way: the next stage to record, and the sky, the layer and the diffuse light
    /// that it makes.
    fill: Option<(u32, MapSky, Option<SkyLayer>, Sh)>,
    /// The place of this map's light capture among [`SkyMaps::lights`].
    light: usize,
    /// The frame's clock when the shown fill started, which a layer's refresh counts from.
    filled_at: f32,
    /// The fills that a layer's light has not yet answered since it last landed, up to
    /// [`LAYER_RETRIES`], and the frames since the shown fill ended, up to [`LAYER_GRACE`].
    retries: u8,
    since: u8,
}

/// The coefficients of the light that a map's fills capture on the GPU, when an add-on draws a sky
/// layer over it: one read a fill, which lands in engine memory a few frames later.
#[derive(Debug)]
struct LightCapture {
    /// The next buffer of the ring to write, and whether the GPU has the ring.
    next: usize,
    made: bool,
    /// Where a capture lands, as the bytes that the GPU writes, and the values that the frame
    /// before read from it: a difference means that a capture landed since.
    words: Box<[u8; LIGHT_BYTES as usize]>,
    before: [u8; LIGHT_BYTES as usize],
    /// True once a capture's coefficients are in `words`, and false until one lands and after the
    /// GPU is replaced.
    valid: bool,
}

/// Where a map's light capture reads back to: the first GPU id of its ring of buffers, and the
/// control slot that a landed capture raises.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LightTarget {
    /// The first GPU id of the ring, or 0 while the builder placed none.
    pub buffers: u32,
    /// The control slot that a landed capture raises by one.
    pub slot: u32,
}

impl LightCapture {
    fn new() -> Self {
        Self {
            next: 0,
            made: false,
            words: Box::new([0; LIGHT_BYTES as usize]),
            before: [0; LIGHT_BYTES as usize],
            valid: false,
        }
    }

    /// The address in engine memory that a capture lands at.
    fn destination(&self) -> u32 {
        address(&self.words[..])
    }

    /// The coefficients that a capture wrote, as the light that a map gives a surface.
    fn coefficients(&self) -> Sh {
        let word = |k: usize| {
            let at = k * 4;
            f32::from_le_bytes([
                self.words[at],
                self.words[at + 1],
                self.words[at + 2],
                self.words[at + 3],
            ])
        };
        std::array::from_fn(|k| std::array::from_fn(|c| word(k * 3 + c)))
    }

    /// Takes the coefficients of a capture that landed since the frame before. A capture that wrote
    /// nothing, as one does before the page's layer reached the thread that draws, leaves the words
    /// as they were: the map then keeps the CPU's model of the core sky for its light.
    fn take(&mut self) -> Option<Sh> {
        let length = LIGHT_WORDS * 4;
        if self.words[..length] == self.before[..length] {
            return None;
        }
        self.before[..length].copy_from_slice(&self.words[..length]);
        self.valid = true;
        Some(self.coefficients())
    }

    /// The light of the newest capture, once one has landed.
    fn light(&self) -> Option<Sh> {
        self.valid.then(|| self.coefficients())
    }

    /// Records the buffer that the GPU writes this capture into: makes the ring the first time,
    /// and returns the buffer, the address that its bytes land at and the slot that they raise.
    fn next_read(
        &mut self,
        list: &mut DrawList,
        target: LightTarget,
    ) -> Result<Option<(u32, u32, u32)>, RecordError> {
        // A builder that placed no ring, or a page that gave no slot, captures nothing: slot 0 is
        // the frame counter, which a read must never raise.
        if target.buffers == 0 || target.slot == 0 {
            return Ok(None);
        }
        if !self.made {
            for k in 0..LIGHT_RING as u32 {
                list.push(
                    Op::CreateBuffer,
                    &[
                        target.buffers + k,
                        LIGHT_BYTES,
                        usage::MAP_READ | usage::COPY_DST,
                    ],
                )?;
            }
            self.made = true;
        }
        let buffer = target.buffers + self.next as u32;
        self.next = (self.next + 1) % LIGHT_RING;
        Ok(Some((buffer, self.destination(), target.slot)))
    }

    /// Forgets the GPU's objects after a device was lost, and the coefficients that it wrote.
    fn reset_gpu(&mut self) {
        self.made = false;
        self.valid = false;
        self.before = [0; LIGHT_BYTES as usize];
        *self.words = [0; LIGHT_BYTES as usize];
    }
}

/// The scene's sky maps, and the sky that they show.
#[derive(Debug, Default)]
pub struct SkyMaps {
    /// The sky that the maps show: the settings of the scene's last sky background, or none
    /// before the first.
    sky: Option<MapSky>,
    /// The sky of the frame before the last recorded one, to tell when the sky has come to rest.
    before: Option<MapSky>,
    /// The layer that the scene draws over its background, which every map shows.
    layer: Option<SkyLayer>,
    /// The frame's clock in seconds, which a layer's shader reads and its refresh counts by.
    clock: f32,
    maps: Vec<SkyMap>,
    /// The light capture of each map, by the place that the map names.
    lights: Vec<LightCapture>,
}

impl SkyMaps {
    /// The sky that the maps show, or none before the first.
    pub fn sky(&self) -> Option<MapSky> {
        self.sky
    }

    /// Makes the maps show `sky` from the next recorded frame on, in stages.
    pub fn set_sky(&mut self, sky: MapSky) {
        self.sky = Some(sky);
    }

    /// Makes the maps show the layer that the scene draws over its background, or none, from the
    /// next recorded frame on. A map whose layer is another one, or whose layer's values changed,
    /// fills again.
    pub fn set_layer(&mut self, layer: Option<SkyLayer>) {
        self.layer = layer;
    }

    /// Sets the frame's clock in seconds, which a layer over the sky reads as `SkyLayerInput.time`
    /// and which its refresh counts between captures.
    pub fn set_clock(&mut self, clock: f32) {
        self.clock = clock;
    }

    /// Sets the height above the ground, in kilometers, from which a map of the physical sky sees
    /// it: the height of the physical sky's tables.
    pub(crate) fn set_height(&mut self, height: f32) {
        if let Some(MapSky::Physical { height: h, .. }) = &mut self.sky {
            *h = height;
        }
    }

    /// True when the sky of this frame holds the values of the frame before, so it has come to
    /// rest and a map that lags it captures it exactly.
    fn settled(&self) -> bool {
        match (&self.before, &self.sky) {
            (Some(before), Some(sky)) => before.same(sky),
            _ => false,
        }
    }

    /// True when a map of the physical sky starts a fill in this frame once it has the panorama:
    /// a map whose texture is ready, which no fill runs on, and whose sky has moved past the step
    /// that a map draws for, or has come to rest and the map does not hold it exactly.
    pub(crate) fn wants_panorama(&self, textures: &TextureStore) -> bool {
        let Some(sky @ MapSky::Physical { .. }) = &self.sky else {
            return false;
        };
        let settled = self.settled();
        self.maps.iter().any(|map| {
            map.fill.is_none()
                && textures.generated_cube(map.texture).is_some()
                && map.shown.is_none_or(|(shown, shown_layer, _)| {
                    start_fill(&shown, sky, settled)
                        || start_layer_fill(shown_layer, map.filled_at, self.clock, self.layer)
                })
        })
    }

    /// Makes cube texture `texture` a sky map of `stages` stages, at least 1, which fills in the
    /// first frame after its generator made it ready. A texture that is a sky map already stays one.
    pub fn add(&mut self, texture: Handle, stages: u32, capture: u32) {
        if self.maps.iter().all(|map| map.texture != texture) {
            let stages = stages.max(1);
            self.maps.push(SkyMap {
                texture,
                stages,
                capture: capture.min(stages - 1),
                shown: None,
                fill: None,
                light: self.lights.len(),
                filled_at: 0.0,
                retries: 0,
                since: 0,
            });
            self.lights.push(LightCapture::new());
        }
    }

    /// The diffuse light of the sky map in `texture`, once frames draw with its levels, or none
    /// for a texture that is not a full sky map.
    pub fn sh(&self, texture: Handle) -> Option<Sh> {
        self.light(texture).map(|(sh, _)| sh)
    }

    /// The diffuse light of the sky map in `texture` and the factor of its light, once frames draw
    /// with its levels, or none for a texture that is not a full sky map. A map that a sky layer
    /// drew takes the light that its own texels gave, once a capture landed: the layer's light is
    /// part of the map, so the light and the reflections hold the same sky.
    pub fn light(&self, texture: Handle) -> Option<(Sh, f32)> {
        let map = self.maps.iter().find(|map| map.texture == texture)?;
        map.shown.map(|(sky, layer, sh)| {
            let light = match layer {
                Some(_) => self
                    .lights
                    .get(map.light)
                    .and_then(LightCapture::light)
                    .unwrap_or(sh),
                None => sh,
            };
            (light, sky.gain())
        })
    }

    /// Forgets every map's levels after the thread that draws replaced the GPU: each map fills
    /// whole again once its generator has run on the new device.
    pub fn reset_gpu(&mut self) {
        for map in &mut self.maps {
            map.shown = None;
            map.fill = None;
        }
        for light in &mut self.lights {
            light.reset_gpu();
        }
    }

    /// Keeps one capture for each map, in the maps' order, after the maps that were destroyed.
    fn compact_lights(&mut self) {
        if self.lights.len() == self.maps.len() {
            return;
        }
        for k in 0..self.maps.len() {
            let from = self.maps[k].light;
            if from != k {
                self.lights.swap(k, from);
                self.maps[k].light = k;
            }
        }
        self.lights.truncate(self.maps.len());
    }

    /// Records the frame's stages of each map whose texture is ready: every stage of a map that
    /// is not full yet, and the next stage of a refresh. Forgets maps whose texture was destroyed.
    #[allow(clippy::too_many_arguments)]
    /// `panorama_drawn` is true when the frame drew the physical sky's panorama, texture
    /// `panorama`, for the sky as it is, which a fill of the physical sky needs to start. `model`
    /// is the physical sky's CPU model.
    pub(crate) fn record(
        &mut self,
        textures: &TextureStore,
        list: &mut DrawList,
        panorama_drawn: bool,
        panorama: u32,
        model: Option<&AirModel>,
        target: LightTarget,
        cloud_steps: u32,
        noise: u32,
    ) -> Result<(), RecordError> {
        self.maps.retain(|map| textures.is_live(map.texture));
        self.compact_lights();
        let settled = self.settled();
        self.before = self.sky;
        let Some(sky) = self.sky else {
            return Ok(());
        };
        let layer = self.layer;
        let clock = self.clock;
        // The captures leave the maps while they record, since a capture lands in a field of the
        // maps that a map's own borrow would hide.
        let mut lights = std::mem::take(&mut self.lights);
        let recorded = self.record_maps(
            textures,
            list,
            panorama_drawn,
            panorama,
            model,
            sky,
            layer,
            &mut lights,
            target,
            settled,
            clock,
            cloud_steps,
            noise,
        );
        self.lights = lights;
        recorded
    }

    /// Records each map's stages, with the captures in `lights`.
    #[allow(clippy::too_many_arguments)]
    fn record_maps(
        &mut self,
        textures: &TextureStore,
        list: &mut DrawList,
        panorama_drawn: bool,
        panorama: u32,
        model: Option<&AirModel>,
        sky: MapSky,
        layer: Option<SkyLayer>,
        lights: &mut [LightCapture],
        target: LightTarget,
        settled: bool,
        clock: f32,
        cloud_steps: u32,
        noise: u32,
    ) -> Result<(), RecordError> {
        for map in &mut self.maps {
            let Some(light) = lights.get_mut(map.light) else {
                continue;
            };
            // A capture that landed since the frame before becomes the map's light, whether or not
            // this frame fills it.
            light.take();
            if light.valid {
                map.retries = 0;
            }
            let Some((id, _, generator)) = textures.generated_cube(map.texture) else {
                map.shown = None;
                map.fill = None;
                continue;
            };
            let due = map.shown.is_none_or(|(shown, shown_layer, _)| {
                start_fill(&shown, &sky, settled)
                    || start_layer_fill(shown_layer, map.filled_at, clock, layer)
            });
            if map.fill.is_none() {
                map.since = map.since.saturating_add(1);
            }
            // A layer whose light has not landed may not have reached the thread that draws: the
            // page sends its shader as it installs it, and a fill that starts the same frame can
            // find it still on its way. A fill or two more bring it in, and three stop retrying, so
            // a layer whose light is genuinely zero costs no more.
            let retry = !due
                && !light.valid
                && map.since >= LAYER_GRACE
                && map.retries < LAYER_RETRIES
                && layer.is_some_and(|layer| layer.map != 0)
                && map
                    .shown
                    .is_some_and(|(_, shown_layer, _)| shown_layer.is_some());
            if retry {
                map.retries += 1;
            }
            let start = due || retry;
            let (first, sky, layer, sh) = match map.fill {
                Some(fill) => fill,
                None if !start => continue,
                None if matches!(sky, MapSky::Physical { .. }) && !panorama_drawn => continue,
                None => (0, sky, layer, sky.sh(model)),
            };
            map.since = 0;
            // A map that frames do not draw with yet fills whole at once.
            let copy = map.stages - 1;
            let last = if map.shown.is_none() { copy } else { first };
            // A layer's light is the map's own texels, summed on the GPU once the fill has drawn
            // every face of the chain and read back over the next frames. The capture runs a stage
            // or two before the copy, so that the light this frame takes for the map is ready by
            // the frame whose levels publish: no frame draws a map that the core sky's light alone
            // explains.
            let captured = layer.is_some_and(|layer| layer.map != 0);
            for stage in first..=last {
                let capture = match captured && stage == map.capture {
                    true => Some(&mut *light),
                    false => None,
                };
                push_stage(
                    list,
                    id,
                    generator,
                    stage,
                    &sky,
                    layer,
                    clock,
                    panorama,
                    capture,
                    target,
                    cloud_steps,
                    noise,
                )?;
            }
            map.fill = if last == copy {
                map.shown = Some((sky, layer, sh));
                map.filled_at = clock;
                None
            } else {
                Some((last + 1, sky, layer, sh))
            };
        }
        Ok(())
    }
}

/// Records stage `stage` of the sky map in cube texture `id`, which generator `generator` holds:
/// of the analytic sky's settings, or of the physical sky's panorama in texture `panorama`. A stage
/// with `capture` sums the map's light into the buffer that it names, once the fill has drawn every
/// face of every level of the chain. `cloud_steps` and `noise` reach the generator, which draws the
/// volumetric cloud tier in this stage's shader while the count is above 0.
#[allow(clippy::too_many_arguments)]
fn push_stage(
    list: &mut DrawList,
    id: u32,
    generator: u32,
    stage: u32,
    sky: &MapSky,
    layer: Option<SkyLayer>,
    clock: f32,
    panorama: u32,
    capture: Option<&mut LightCapture>,
    target: LightTarget,
    cloud_steps: u32,
    noise: u32,
) -> Result<(), RecordError> {
    let mut words = [0u32; STEP_WORDS];
    words[..3].copy_from_slice(&[id, generator, stage]);
    words[CLOUD_STEPS_WORD] = cloud_steps;
    words[CLOUD_FIELD_WORD] = noise;
    let values = match sky {
        MapSky::Analytic { sky, .. } => {
            let [x, y, z] = sky.sun_position;
            let [heading, elevation] = sky.second_angles();
            [
                x,
                y,
                z,
                sky.second_sky_weight,
                sky.turbidity,
                sky.rayleigh,
                sky.mie_coefficient,
                sky.mie_directional_g,
                sky.cloud_scale,
                sky.cloud_speed,
                sky.cloud_coverage,
                sky.cloud_density,
                sky.cloud_elevation,
                sky.time,
                heading,
                elevation,
            ]
        }
        MapSky::Physical { atmosphere, .. } => {
            // The panorama's cloud shader takes the lights' directions and the cloud settings,
            // which stand where the analytic sky keeps its airs and second sky.
            words[3] = panorama;
            let [x, y, z] = atmosphere.sun();
            let [mx, my, mz] = atmosphere.moon();
            [
                x,
                y,
                z,
                atmosphere.sun_intensity,
                mx,
                my,
                mz,
                atmosphere.moon_intensity,
                atmosphere.cloud_scale,
                atmosphere.cloud_speed,
                atmosphere.cloud_coverage,
                atmosphere.cloud_density,
                atmosphere.cloud_elevation,
                atmosphere.time,
                0.0,
                0.0,
            ]
        }
    };
    for (word, value) in words[4..20].iter_mut().zip(values) {
        *word = value.to_bits();
    }
    if let Some(layer) = layer {
        words[LAYER_WORD] = layer.map;
        let [coverage, density, elevation, scale] = sky.clouds();
        let values = [
            coverage,
            density,
            elevation,
            scale,
            layer.sun.clamp(0.0, 1.0),
            layer.opacity.clamp(0.0, 1.0),
            clock,
        ];
        for (word, value) in words[LAYER_VALUES..].iter_mut().zip(values) {
            *word = value.to_bits();
        }
    }
    let read = match capture {
        Some(light) => light.next_read(list, target)?,
        None => None,
    };
    if let Some((buffer, _, _)) = read {
        words[LIGHT_BUFFER_WORD] = buffer;
    }
    list.push(Op::SkyMapStep, &words)?;
    if let Some((buffer, destination, slot)) = read {
        list.push(Op::ReadBuffer, &[buffer, 0, LIGHT_BYTES, destination, slot])?;
    }
    Ok(())
}

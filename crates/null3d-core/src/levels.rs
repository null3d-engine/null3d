//! The rule that picks a mesh's level of detail for a source in a view, and the distance band in
//! which a source draws at all.
//!
//! A mesh with levels has simpler meshes for its lower levels, each with a switch measure: an
//! error, a distance, or the share of the screen's height that the bounds cover. Errors are the
//! largest distance between the level's surface and the base mesh's, in the units of the base
//! mesh's positions, as the asset tool measures them. Distances and coverage are set by hand. A
//! source draws the last level whose switch lies under the distance from the camera:
//!
//! ```text
//! error:    error × scale × factor / bias < distance
//! distance: distance_set × scale / bias < distance
//! coverage: radius × P[1][1] / (coverage × bias) < distance
//! ```
//!
//! `scale` is the largest axis scale of the source's world matrix. For a level given by its error,
//! and for the rule that hides a small bound, `distance` is the level distance: the distance from
//! the view's camera to the center of the source's bounding sphere, less half its radius
//! ([`LEVEL_RADIUS_SHARE`]), capped at a multiple of the distance to its nearest point
//! ([`LEVEL_NEAREST_SHARE`]), so a camera beside a large mesh measures the surface below it. For a
//! level given by a distance or by coverage, and for a distance band, it is the distance to the
//! sphere's nearest point. Both are at least [`LEAST_DISTANCE`]. An orthographic camera keeps 1 for
//! an error, whose pixels do not shrink with distance, and the nearest point for a distance, a
//! coverage or a band.
//! `factor` is the render height in pixels times the projection's `P[1][1]`, over twice the
//! threshold in pixels. `bias` raises or lowers the source's own threshold, as Godot's `lod_bias`
//! raises or lowers an object's: a bias above 1 makes every switch happen nearer, so the source
//! draws coarser levels, and a bias below 1 keeps its detail. The bias divides the factor of the
//! level rule and of the rule that hides a bound under the threshold, so both move together. The
//! base level's switch is 0, so it always passes. The rule keeps no state,
//! so every view and both frame builders pick the same level for the same source: the job workers
//! through [`LevelRule::pick`], and the GPU's culling shader by the same steps.
//!
//! A level with a measured error changes the picture by under a pixel at its switch, so it switches
//! at once. A level given by distance or by a hand-set error changes the picture far more, and its
//! bands fade where the switch would show: past each switch distance lies a fading band,
//! [`FADE_BAND`] of the switch distance long, in which the new level and the one before both draw.
//! A fade amount `t` runs from 0 to 1 across the band, and a dither gives each pixel to one level
//! (see [`fade_values`]). The frame builders make a fade bucket only for a level that fades.
//!
//! A source whose bounding sphere covers fewer pixels than the threshold draws nothing: the last
//! level holds no geometry. The sphere's world diameter times the factor measures the pixels it
//! covers, so the source hides while `diameter × factor < distance`, the same comparison that picks
//! every level. Past that hide distance a fading band gives the dither's share of the pixels to
//! nothing, which thins the coarsest level out rather than popping it away.
//!
//! A source also draws only inside its distance band, [`DrawRange`]: nothing nearer than the band's
//! start, and nothing past its end. Both edges fade over the same share of the nearest edge, so a
//! source that fades in or out does not pop. The shader draws the share that a fading band's dither
//! keeps, through the level's fade bucket.
//!
//! The frame builders keep a bucket per level, each with a [`LevelLink`]: the level's switch
//! measure, the bucket of the next coarser level, and the level's fade bucket.

/// The bucket of a link that names none.
pub const NO_LINK: u32 = u32::MAX;

/// The highest level that a level code names, in its lowest bits.
pub const LEVEL_CODE_LEVEL_MAX: u32 = 15;
/// The bit of a level code that marks a source that the size rule or a draw range hid.
pub const LEVEL_CODE_HIDDEN: u32 = 1 << 4;
/// The place of the fade magnitude in a level code.
pub const LEVEL_CODE_FADE_SHIFT: u32 = 5;
/// The largest fade magnitude of a level code, in its own bits.
pub const LEVEL_CODE_FADE_MAX: u32 = 0x3f;
/// The bit of a level code that marks the side of a fading band that keeps the other level.
pub const LEVEL_CODE_NEGATIVE: u32 = 1 << 11;

/// The word that a debug view of levels reads beside an entry: the level of the draw, whether the
/// size rule or a draw range hid the source, and the share of a fading band that its level keeps,
/// with the sign that marks the side of the band. A source outside such a band has a fade of 0,
/// which keeps every pixel. The levels debug view's shader reads the same bits.
#[inline(always)]
pub fn level_code(level: u32, hidden: bool, fade: f32) -> u32 {
    let share = (fade.abs().clamp(0.0, 1.0) * LEVEL_CODE_FADE_MAX as f32).round() as u32;
    (level & LEVEL_CODE_LEVEL_MAX)
        | if hidden { LEVEL_CODE_HIDDEN } else { 0 }
        | (share << LEVEL_CODE_FADE_SHIFT)
        | if fade < 0.0 { LEVEL_CODE_NEGATIVE } else { 0 }
}

/// The share of the switch distance over which two levels hand over.
pub const FADE_BAND: f32 = 0.08;

/// The smallest fade value of the new level in a band, so that its sign marks it even at the
/// band's start, where it covers no pixel yet.
const LEAST_FADE: f32 = 1.0e-6;

/// The smallest distance that the rule compares, in meters. A camera inside a source's bounds
/// measures this distance, so the source keeps its base level.
pub const LEAST_DISTANCE: f32 = 1.0e-3;

/// The share of a bounding sphere's radius that the camera's level distance takes off the distance
/// to the sphere's center. A level's error is its largest anywhere on the mesh, so measuring to the
/// nearest point of the bounds keeps a large mesh's fine levels far out, where its near side shows
/// them and the rest of the mesh does not. Half the radius keeps the near side within the threshold
/// in the desert's held frames, at about 14% fewer triangles than the nearest point; the center
/// itself lets the near side of a large copy show its level (D-137). [`LEVEL_NEAREST_SHARE`] caps
/// the result near a large mesh, where half its radius can be far larger than the surface below the
/// camera.
pub const LEVEL_RADIUS_SHARE: f32 = 0.5;

/// The multiple of the distance to a bounding sphere's nearest point that caps the level distance
/// for an error. The half-radius measure alone treats a camera in the outer half of a large sphere
/// as far from the surface below it: a ground two kilometres across holds the camera 293 m from
/// the surface it stands on. The cap brings a camera near the surface back to the nearest point,
/// at the cost of comparing the error over two pixels there rather than one (D-347).
pub const LEVEL_NEAREST_SHARE: f32 = 2.0;

/// What a level's switch distance is measured by.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum Switch {
    /// The level's error, in the units of the base mesh's positions, from the asset tool's
    /// measurement or set by hand. The default.
    #[default]
    Error = 0,
    /// A distance in meters from the camera to the nearest point of the bounds, for a source of
    /// scale 1.
    Distance = 1,
    /// The share of the render's height that the bounds cover, from 0 to 1: the level draws while
    /// the bounds cover less than this, whatever the distance.
    Coverage = 2,
}

impl Switch {
    /// The measure that a level's stored bits name.
    #[inline(always)]
    pub fn from_bits(bits: u32) -> Switch {
        match bits {
            1 => Switch::Distance,
            2 => Switch::Coverage,
            _ => Switch::Error,
        }
    }
}

/// The distances at which a source draws: from the start distance, which is 0 for none, to the
/// end distance, which is infinite for none. Both edges fade over a band.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DrawRange {
    /// The nearest distance at which the source draws, 0 for none.
    pub start: f32,
    /// The farthest distance at which the source draws, infinite for none.
    pub end: f32,
}

impl DrawRange {
    /// The range of a source that draws at every distance.
    pub const NONE: DrawRange = DrawRange {
        start: 0.0,
        end: f32::INFINITY,
    };

    /// The range from `start` to `end`.
    #[inline(always)]
    pub fn new(start: f32, end: f32) -> Self {
        Self { start, end }
    }

    /// True when the source draws at every distance.
    #[inline(always)]
    pub fn is_none(&self) -> bool {
        self.start <= 0.0 && !self.end.is_finite()
    }
}

impl Default for DrawRange {
    fn default() -> Self {
        Self::NONE
    }
}

/// A bucket's level of detail: the level's switch measure, the bucket of the next coarser level,
/// and the level's fade bucket, each [`NO_LINK`] for none.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LevelLink {
    /// The level's switch value, 0 for a base level.
    pub value: f32,
    /// What the switch distance is measured by.
    pub switch: Switch,
    /// The bucket of the next coarser level.
    pub next: u32,
    /// The level's fade bucket.
    pub fade: u32,
}

impl LevelLink {
    /// The link of a bucket without levels.
    pub const NONE: LevelLink = LevelLink {
        value: 0.0,
        switch: Switch::Error,
        next: NO_LINK,
        fade: NO_LINK,
    };

    /// True when the bucket has a coarser level after it.
    #[inline(always)]
    pub fn has_next(&self) -> bool {
        self.next != NO_LINK
    }
}

impl Default for LevelLink {
    fn default() -> Self {
        Self::NONE
    }
}

/// Where a view measures the errors of levels and patches, and the size of a bound that hides.
///
/// A camera's view measures them on its own screen, at the camera's distance. A light's shadow view
/// measures them in the texels of its own map, so the level that a caster draws in it does not
/// follow the camera: a cached shadow map stays valid while the camera moves. Distance bands, and
/// levels given by a distance or by screen coverage, keep the camera's distance in every view, as
/// their authors set them for the camera.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Measure {
    /// The camera's own distance.
    #[default]
    Camera,
    /// An orthographic light view: the same size of texel at every distance, so the distance is 1.
    Parallel,
    /// A perspective light view from a point relative to the camera: the distance from that point
    /// to the nearest point of the bounds.
    From([f32; 3]),
}

/// The lens of a light's shadow view, by which its rule measures errors in its own texels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LightLens {
    /// An orthographic view whose texels are `texel` meters wide.
    Parallel {
        /// The width of one texel, in meters.
        texel: f32,
    },
    /// A perspective view from `eye`, relative to the camera, whose texels are `texel` meters wide
    /// at one meter from it.
    Point {
        /// The light's place relative to the camera.
        eye: [f32; 3],
        /// The width of one texel at a meter from the light, in meters.
        texel: f32,
    },
}

/// The two distances that a view's rule compares for one bounding sphere: the camera's, which
/// distance bands and levels given by a distance or by coverage read, and the one that errors and
/// the hiding of small bounds read ([`Measure`]). In a camera's view the two are the same.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Distances {
    /// The distance from the camera to the nearest point of the bounds, or 1 for an orthographic
    /// camera.
    pub camera: f32,
    /// The distance at which errors are compared.
    pub error: f32,
}

impl Distances {
    /// Both distances times `k`.
    #[inline(always)]
    pub fn scaled(self, k: f32) -> Self {
        Self {
            camera: self.camera * k,
            error: self.error * k,
        }
    }

    /// The distance that a level's switch measured by `switch` compares with.
    #[inline(always)]
    pub fn of(&self, switch: Switch) -> f32 {
        match switch {
            Switch::Error => self.error,
            Switch::Distance | Switch::Coverage => self.camera,
        }
    }
}

impl From<f32> for Distances {
    /// One distance for both measures, as a camera's view compares them.
    #[inline(always)]
    fn from(distance: f32) -> Self {
        Self {
            camera: distance,
            error: distance,
        }
    }
}

/// What a view's choice of levels reads: the factor of the rule, the projection's `P[1][1]`, true
/// for an orthographic camera, the share of the switch distance that a fading band covers, 0
/// where levels switch at once, and where the view measures errors. A factor of 0 turns the
/// choice off: every source draws its base level.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LevelRule {
    /// The render height times `P[1][1]`, over twice the threshold in pixels. In a light's view, one
    /// over the texel's width times the threshold in texels.
    pub factor: f32,
    /// The camera's projection's `P[1][1]`, which a level given by screen coverage reads.
    pub p11: f32,
    /// True for an orthographic camera.
    pub orthographic: bool,
    /// The share of a switch distance that a fading band covers.
    pub band: f32,
    /// Where the view measures errors.
    pub measure: Measure,
}

/// The buckets that a source draws in a view: one level's bucket, or inside a fading band the fade
/// buckets of the new level and of the level before it, with the fade amount from 0 to 1. A source
/// inside a distance band's edge draws a share of its pixels through its level's fade bucket.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Picked {
    /// One level's bucket.
    One(u32),
    /// Inside a fading band: the fade buckets of the new level and of the old, and the fade
    /// amount.
    Fade {
        /// The new level's fade bucket.
        new: u32,
        /// The old level's fade bucket.
        old: u32,
        /// The fade amount, from 0 to 1.
        t: f32,
    },
    /// Inside the band at the start of the source's distance range: the fade bucket of the level
    /// that draws, and the share of the pixels that it keeps, from 0 to 1.
    FadeIn {
        /// The level's fade bucket.
        bucket: u32,
        /// The share of the pixels that the dither keeps.
        t: f32,
    },
    /// The source covers fewer pixels than the threshold, or lies outside its distance range: it
    /// draws nothing.
    Hidden,
    /// The source lies in the band past its hide distance or its range's end: the level it would
    /// draw keeps the dither's share of the pixels, which thins it out.
    FadeOut {
        /// The level's fade bucket.
        old: u32,
        /// The share of the pixels that the dither drops, from 0 to 1.
        t: f32,
    },
}

/// One bucket that a pick writes: the bucket, the fade value that its word holds (positive for the
/// new level of a band, negative for the old), and whether the source draws only its hidden marker.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PickedEntry {
    /// The bucket that the entry draws in.
    pub bucket: u32,
    /// The fade value of a fading level, or 0 for a level that draws whole.
    pub fade: f32,
    /// True for a source that a levels view draws at its base bucket, marked hidden.
    pub hidden: bool,
}

impl Picked {
    /// The buckets that this pick writes: one, two for a fading band, or the base bucket of a
    /// hidden source in a levels view. Returns the entries, how many are used, and the words that
    /// each takes in a view's list: one for a level without a band or a levels view, two otherwise.
    /// The count pass, the place pass and the copy count all write their lists through this, so
    /// one rule names the buckets and the words they take.
    pub fn entries(&self, home: u32, codes: bool) -> ([PickedEntry; 2], usize, usize) {
        let fading = !matches!(self, Self::One(_));
        let words = if codes || fading { 2 } else { 1 };
        let entry = |bucket, fade, hidden| PickedEntry {
            bucket,
            fade,
            hidden,
        };
        match *self {
            Self::One(bucket) => (
                [entry(bucket, 0.0, false), PickedEntry::default()],
                1,
                words,
            ),
            Self::Fade { new, old, t } => {
                let (fade_new, fade_old) = fade_values(t);
                (
                    [entry(new, fade_new, false), entry(old, fade_old, false)],
                    2,
                    words,
                )
            }
            Self::FadeIn { bucket, t } => (
                [
                    entry(bucket, t.max(LEAST_FADE), false),
                    PickedEntry::default(),
                ],
                1,
                words,
            ),
            Self::FadeOut { old, t } => ([entry(old, -t, false), PickedEntry::default()], 1, words),
            Self::Hidden if codes => ([entry(home, 0.0, true), PickedEntry::default()], 1, words),
            Self::Hidden => ([PickedEntry::default(); 2], 0, words),
        }
    }
}

impl LevelRule {
    /// The rule of a view drawn `render_height` pixels high with the projection's `P[1][1]` of
    /// `p11`, with a threshold of `threshold` pixels and a fading band of `band`.
    pub fn new(
        render_height: f32,
        p11: f32,
        orthographic: bool,
        threshold: f32,
        band: f32,
    ) -> Self {
        let factor = if threshold > 0.0 && render_height > 0.0 {
            render_height * p11.abs() / (2.0 * threshold)
        } else {
            0.0
        };
        Self {
            factor,
            p11: p11.abs(),
            orthographic,
            band,
            measure: Measure::Camera,
        }
    }

    /// The rule of a light's shadow view through `lens`, beside the camera's rule `camera`: a level
    /// draws while its error covers fewer than `threshold` texels of the view's map, and a bound
    /// whose diameter covers fewer hides. Distance bands, and levels given by a distance or by
    /// coverage, keep the camera's measures. Shadow views draw no fading band. Off when the
    /// camera's rule is off or the threshold is 0.
    pub fn for_light(camera: &LevelRule, lens: LightLens, threshold: f32) -> Self {
        let (texel, measure) = match lens {
            LightLens::Parallel { texel } => (texel, Measure::Parallel),
            LightLens::Point { eye, texel } => (texel, Measure::From(eye)),
        };
        let factor = if camera.on() && threshold > 0.0 && texel > 0.0 {
            1.0 / (texel * threshold)
        } else {
            0.0
        };
        Self {
            factor,
            p11: camera.p11,
            orthographic: camera.orthographic,
            band: 0.0,
            measure,
        }
    }

    /// True when the rule picks levels at all.
    #[inline(always)]
    pub fn on(&self) -> bool {
        self.factor > 0.0
    }

    /// The rule as the culling shader's uniform reads it.
    pub fn uniform(&self) -> [f32; 4] {
        let orthographic = if self.orthographic { 1.0 } else { 0.0 };
        [self.factor, orthographic, self.band, self.p11]
    }

    /// Where the view measures errors, as the shaders read it: the point that a perspective light
    /// view measures from, then 0 for the camera's distance, 1 for an orthographic light view and
    /// 2 for a perspective one.
    pub fn measure_uniform(&self) -> [f32; 4] {
        match self.measure {
            Measure::Camera => [0.0; 4],
            Measure::Parallel => [0.0, 0.0, 0.0, 1.0],
            Measure::From([x, y, z]) => [x, y, z, 2.0],
        }
    }

    /// The distance that the rule compares for a bounding sphere whose center lies at `center`
    /// relative to the camera and whose radius is `radius`: the distance to its nearest point, at
    /// least [`LEAST_DISTANCE`]. This is the distance of a level given by a distance, of a level
    /// given by coverage, and of a draw range, which their authors set in meters, and it holds for
    /// an orthographic camera too. A level given by an error compares [`LevelRule::error_distance`]
    /// instead, which stays 1 for an orthographic camera because its pixels do not shrink with
    /// distance.
    #[inline(always)]
    pub fn distance(&self, center: [f32; 3], radius: f32) -> f32 {
        nearest(center, radius)
    }

    /// The distance at which the view compares errors for a bounding sphere whose center lies at
    /// `center` relative to the camera and whose radius is `radius` ([`Measure`]): the camera's
    /// level distance, at [`LEVEL_RADIUS_SHARE`] of the radius inside the bounds but no more than
    /// [`LEVEL_NEAREST_SHARE`] times the nearest point, or a perspective light's distance to the
    /// nearest point. A light keeps the nearest point because a caster's level must stay within a
    /// texel of its surface everywhere, which the normal bias hides.
    #[inline(always)]
    pub fn error_distance(&self, center: [f32; 3], radius: f32) -> f32 {
        match self.measure {
            Measure::Camera if self.orthographic => 1.0,
            Measure::Camera => level_distance(center, radius),
            Measure::Parallel => 1.0,
            Measure::From(eye) => nearest(
                [center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]],
                radius,
            ),
        }
    }

    /// The distance at which a tree of cluster patches compares errors: the nearest point of the
    /// patch's bounds in every view. A patch's sphere encloses its children's, so a nearer measure
    /// never puts a child farther than its parent, and a cut leaves no hole and draws nothing
    /// twice.
    #[inline(always)]
    pub fn patch_distance(&self, center: [f32; 3], radius: f32) -> f32 {
        match self.measure {
            // An orthographic camera compares a patch's error by the shader's measure of 1, since
            // its pixels do not shrink with distance.
            Measure::Camera if self.orthographic => 1.0,
            Measure::Camera => self.distance(center, radius),
            _ => self.error_distance(center, radius),
        }
    }

    /// Both distances that the rule compares for a bounding sphere at `center` relative to the
    /// camera, of radius `radius`.
    #[inline(always)]
    pub fn distances(&self, center: [f32; 3], radius: f32) -> Distances {
        Distances {
            camera: self.distance(center, radius),
            error: self.error_distance(center, radius),
        }
    }

    /// The distance at which a level with `link` switches in, for a source of largest axis scale
    /// `scale` and world radius `radius`, at a threshold bias of `bias`.
    #[inline(always)]
    pub fn switch_distance(&self, link: &LevelLink, scale: f32, radius: f32, bias: f32) -> f32 {
        let bias = if bias > 0.0 { bias } else { 1.0 };
        match link.switch {
            Switch::Error => link.value * scale * (self.factor / bias),
            Switch::Distance => link.value * scale / bias,
            Switch::Coverage => {
                if link.value > 0.0 && self.p11 > 0.0 {
                    radius * self.p11 / (link.value * bias)
                } else {
                    f32::INFINITY
                }
            }
        }
    }

    /// The buckets that a source of base bucket `home` draws, at `distance` ([`Distances`], or one
    /// distance for both) with a world matrix of largest axis scale `scale` and a bounding sphere of
    /// world radius `radius`, given each bucket's link in `links`, inside the distance range
    /// `range`. `bias` raises the source's threshold above 1, for coarser levels, or lowers it
    /// below 1, for finer ones.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub fn pick(
        &self,
        links: &[LevelLink],
        home: u32,
        scale: f32,
        radius: f32,
        distance: impl Into<Distances>,
        bias: f32,
        range: DrawRange,
    ) -> Picked {
        let distance = distance.into();
        let mut before = home;
        let mut level = home;
        let mut next = self.first_link(links, home);
        while next != NO_LINK && {
            let link = &links[next as usize];
            self.switch_distance(link, scale, radius, bias) < distance.of(link.switch)
        } {
            before = level;
            level = next;
            next = links[level as usize].next;
        }
        self.settle(
            links, home, level, before, scale, radius, distance, bias, range,
        )
    }

    /// The buckets that [`LevelRule::pick`] gives at `near` and at `far`, from one walk of the
    /// source's levels: the same two answers as two calls, for `near` no greater than `far`. A
    /// level's switch distance stops the walk at `near` whenever it stops it at `far`, so the walk
    /// to `far` passes the place where the walk to `near` stops.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub fn pick_both(
        &self,
        links: &[LevelLink],
        home: u32,
        scale: f32,
        radius: f32,
        near: impl Into<Distances>,
        far: impl Into<Distances>,
        bias: f32,
        range: DrawRange,
    ) -> [Picked; 2] {
        let (near, far) = (near.into(), far.into());
        debug_assert!(
            !(near.camera > far.camera || near.error > far.error),
            "the near distance lies past the far one"
        );
        let mut before = home;
        let mut level = home;
        let mut stop_near = None;
        let mut next = self.first_link(links, home);
        while next != NO_LINK {
            let link = &links[next as usize];
            let switch = self.switch_distance(link, scale, radius, bias);
            // The same comparisons as the single walk's, so a switch distance that is not a number
            // stops both walks there.
            let (passes_near, passes_far) =
                (switch < near.of(link.switch), switch < far.of(link.switch));
            if stop_near.is_none() && !passes_near {
                stop_near = Some((level, before));
            }
            if !passes_far {
                break;
            }
            before = level;
            level = next;
            next = links[level as usize].next;
        }
        let (near_level, near_before) = stop_near.unwrap_or((level, before));
        [
            self.settle(
                links,
                home,
                near_level,
                near_before,
                scale,
                radius,
                near,
                bias,
                range,
            ),
            self.settle(links, home, level, before, scale, radius, far, bias, range),
        ]
    }

    /// The first link that a source of base bucket `home` walks: none for a rule without a
    /// factor, which keeps every source at its base level.
    #[inline(always)]
    fn first_link(&self, links: &[LevelLink], home: u32) -> u32 {
        if self.on() {
            links[home as usize].next
        } else {
            NO_LINK
        }
    }

    /// The buckets that a source draws at `distance` once the walk of its levels stopped at
    /// `level`, with `before` the level ahead of it: the level's bucket, its fading bands, its
    /// distance range and its hide distance.
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    fn settle(
        &self,
        links: &[LevelLink],
        home: u32,
        level: u32,
        before: u32,
        scale: f32,
        radius: f32,
        distances: Distances,
        bias: f32,
        range: DrawRange,
    ) -> Picked {
        let new_fade = links[level as usize].fade;
        // A source outside its distance range draws nothing. Inside each edge of it, the share of
        // the pixels that the dither keeps grows to one, or falls to none, over the same band that
        // a level switch fades over. The range measures the camera's distance in every view.
        let distance = distances.camera;
        if distance < range.start || distance > range.end {
            return Picked::Hidden;
        }
        if new_fade != NO_LINK && self.band > 0.0 {
            if range.start > 0.0 && distance < range.start * (1.0 + self.band) {
                let t = (distance / range.start - 1.0) / self.band;
                return Picked::FadeIn {
                    bucket: new_fade,
                    t: t.max(0.0),
                };
            }
            if range.end.is_finite() && distance > range.end / (1.0 + self.band) {
                let inner = range.end / (1.0 + self.band);
                let t = (distance - inner) / (range.end - inner);
                return Picked::FadeOut {
                    old: new_fade,
                    t: t.clamp(0.0, 1.0),
                };
            }
        }
        let (new, old) = (new_fade, links[before as usize].fade);
        if level != home && self.band > 0.0 && new != NO_LINK && old != NO_LINK {
            let link = &links[level as usize];
            let switch = self.switch_distance(link, scale, radius, bias);
            let t = (distances.of(link.switch) / switch - 1.0) / self.band;
            if t < 1.0 {
                return Picked::Fade {
                    new,
                    old,
                    t: t.max(0.0),
                };
            }
        }
        // A bound that covers fewer pixels than the threshold draws nothing: the last level holds
        // no geometry. A mesh without levels has no such level. The band past the hide distance
        // thins the level out with the same dither, where the pipeline has a fading build.
        let hide = 2.0 * radius * self.factor / if bias > 0.0 { bias } else { 1.0 };
        let distance = distances.error;
        if self.on() && links[home as usize].has_next() && radius > 0.0 && hide < distance {
            if self.band > 0.0 && new != NO_LINK {
                let t = (distance / hide - 1.0) / self.band;
                if t < 1.0 {
                    return Picked::FadeOut {
                        old: new,
                        t: t.max(0.0),
                    };
                }
            }
            return Picked::Hidden;
        }
        Picked::One(level)
    }
}

/// The distance at which a camera compares a level's error: the distance to the sphere's center
/// less [`LEVEL_RADIUS_SHARE`] of its radius, capped at [`LEVEL_NEAREST_SHARE`] times the distance
/// to its nearest point. The cap keeps a camera beside a large mesh measuring the surface below it
/// rather than a fraction of the mesh's size.
#[inline(always)]
fn level_distance(center: [f32; 3], radius: f32) -> f32 {
    let half = nearest(center, LEVEL_RADIUS_SHARE * radius);
    half.min(LEVEL_NEAREST_SHARE * nearest(center, radius))
}

/// The distance to the nearest point of a sphere at `center` of radius `radius`, at least
/// [`LEAST_DISTANCE`].
#[inline(always)]
fn nearest(center: [f32; 3], radius: f32) -> f32 {
    let length = (center[0] * center[0] + center[1] * center[1] + center[2] * center[2]).sqrt();
    (length - radius).max(LEAST_DISTANCE)
}

/// The fade values that the new level and the old level of a band draw with: the new level keeps
/// the pixels whose dither value lies under `t`, and the old level the others. The sign tells the
/// shader which side it draws.
#[inline(always)]
pub fn fade_values(t: f32) -> (f32, f32) {
    (t.max(LEAST_FADE), -t)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The culling shader writes the code with the same bits, and the levels debug view's shader
    /// reads them, so a change to the layout here must change both.
    #[test]
    fn the_shaders_write_and_read_the_level_code_with_these_bits() {
        let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
        for line in [
            format!("const LEVEL_CODE_LEVEL_MAX: u32 = {LEVEL_CODE_LEVEL_MAX}u;"),
            format!(
                "const LEVEL_CODE_HIDDEN: u32 = 1u << {}u;",
                LEVEL_CODE_HIDDEN.trailing_zeros()
            ),
            format!("const LEVEL_CODE_FADE_SHIFT: u32 = {LEVEL_CODE_FADE_SHIFT}u;"),
            format!("const LEVEL_CODE_FADE_MAX: u32 = {LEVEL_CODE_FADE_MAX}u;"),
            format!(
                "const LEVEL_CODE_NEGATIVE: u32 = 1u << {}u;",
                LEVEL_CODE_NEGATIVE.trailing_zeros()
            ),
        ] {
            assert!(cull.contains(&line), "cull.wgsl lacks `{line}`");
        }
        let view = include_str!("../../null3d-shaders/wgsl/debug_view.wgsl");
        for line in [
            format!("let level = in.level_code & {LEVEL_CODE_LEVEL_MAX}u;"),
            format!("(in.level_code & {LEVEL_CODE_HIDDEN}u) != 0u"),
            format!("(in.level_code >> {LEVEL_CODE_FADE_SHIFT}u) & {LEVEL_CODE_FADE_MAX}u"),
            format!(
                "(in.level_code & (1u << {}u)) == 0u",
                LEVEL_CODE_NEGATIVE.trailing_zeros()
            ),
        ] {
            assert!(view.contains(&line), "debug_view.wgsl lacks `{line}`");
        }
    }

    /// The levels debug view's shader reads the same bits, so a code round-trips through them.
    #[test]
    fn a_level_code_carries_its_level_hidden_mark_and_fade() {
        let code = level_code(3, false, 0.5);
        assert_eq!(code & LEVEL_CODE_LEVEL_MAX, 3);
        assert_eq!(code & LEVEL_CODE_HIDDEN, 0);
        assert_eq!(
            (code >> LEVEL_CODE_FADE_SHIFT) & LEVEL_CODE_FADE_MAX,
            32,
            "0.5 of the fade's bits"
        );
        assert_eq!(code & LEVEL_CODE_NEGATIVE, 0);
        let hid = level_code(0, true, 0.0);
        assert_eq!(hid & LEVEL_CODE_HIDDEN, LEVEL_CODE_HIDDEN);
        assert_eq!((hid >> LEVEL_CODE_FADE_SHIFT) & LEVEL_CODE_FADE_MAX, 0);
        let old = level_code(1, false, -1.0);
        assert_eq!((old >> LEVEL_CODE_FADE_SHIFT) & LEVEL_CODE_FADE_MAX, 63);
        assert_ne!(old & LEVEL_CODE_NEGATIVE, 0);
        // The deepest level keeps its own bits, clear of the hidden mark.
        let deepest = level_code(LEVEL_CODE_LEVEL_MAX, false, 0.0);
        assert_eq!(deepest & LEVEL_CODE_LEVEL_MAX, LEVEL_CODE_LEVEL_MAX);
        assert_eq!(deepest & LEVEL_CODE_HIDDEN, 0);
        // A fade past either end clamps to the code's own bits.
        assert_eq!(
            (level_code(0, false, 9.0) >> LEVEL_CODE_FADE_SHIFT) & LEVEL_CODE_FADE_MAX,
            63
        );
        assert_eq!(
            (level_code(0, false, -9.0) >> LEVEL_CODE_FADE_SHIFT) & LEVEL_CODE_FADE_MAX,
            63
        );
    }

    /// Buckets 0 to 3 are the levels of one mesh, with errors growing, and buckets 4 to 7 their
    /// fade buckets.
    fn links(errors: [f32; 4], fades: bool) -> Vec<LevelLink> {
        let mut links: Vec<LevelLink> = (0..4)
            .map(|k| LevelLink {
                value: errors[k],
                switch: Switch::Error,
                next: if k < 3 { k as u32 + 1 } else { NO_LINK },
                fade: if fades { 4 + k as u32 } else { NO_LINK },
            })
            .collect();
        links.extend([LevelLink::NONE; 4]);
        links
    }

    /// The levels of one mesh, each given by `measure` with `values`.
    fn links_by(values: [f32; 3], switch: Switch, fades: bool) -> Vec<LevelLink> {
        let mut links: Vec<LevelLink> = (0..4)
            .map(|k| LevelLink {
                value: if k == 0 { 0.0 } else { values[k - 1] },
                switch,
                next: if k < 3 { k as u32 + 1 } else { NO_LINK },
                fade: if fades { 4 + k as u32 } else { NO_LINK },
            })
            .collect();
        links.extend([LevelLink::NONE; 4]);
        links
    }

    /// Picks without a distance range, for a source of world radius `radius`.
    fn pick_r(rule: &LevelRule, links: &[LevelLink], radius: f32, distance: f32) -> Picked {
        rule.pick(links, 0, 1.0, radius, distance, 1.0, DrawRange::NONE)
    }

    /// Picks without a distance range, for a source whose world radius is half a meter.
    fn pick(rule: &LevelRule, links: &[LevelLink], distance: f32) -> Picked {
        pick_r(rule, links, 0.5, distance)
    }

    #[test]
    fn the_coarsest_level_whose_error_is_under_the_threshold_draws() {
        // A view 1,000 pixels high and 90 degrees high, threshold 1 pixel: factor 500.
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        assert_eq!(rule.factor, 500.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // Level 1 switches in past 5 m, level 2 past 20 m and level 3 past 100 m. The bound's
        // diameter covers a pixel only past 500 m, so every case draws a level.
        let cases = [
            (1.0, 0),
            (4.99, 0),
            (5.01, 1),
            (19.9, 1),
            (20.1, 2),
            (99.0, 2),
            (101.0, 3),
        ];
        for (distance, level) in cases {
            assert_eq!(
                pick(&rule, &links, distance),
                Picked::One(level),
                "{distance}"
            );
        }
        // Twice the scale doubles every switch distance.
        assert_eq!(
            rule.pick(&links, 0, 2.0, 0.5, 9.9, 1.0, DrawRange::NONE),
            Picked::One(0)
        );
        assert_eq!(
            rule.pick(&links, 0, 2.0, 0.5, 10.1, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
    }

    #[test]
    fn a_level_given_by_distance_switches_at_that_distance_whatever_the_screen() {
        let links = links_by([20.0, 40.0, 80.0], Switch::Distance, false);
        // A distance measures meters for a source of scale 1, so a taller screen changes nothing.
        let small = LevelRule::new(1080.0, 1.0, false, 1.0, 0.0);
        let tall = LevelRule::new(2160.0, 1.0, false, 1.0, 0.0);
        for rule in [small, tall] {
            assert_eq!(pick(&rule, &links, 19.0), Picked::One(0));
            assert_eq!(pick(&rule, &links, 21.0), Picked::One(1));
            assert_eq!(pick(&rule, &links, 45.0), Picked::One(2));
            assert_eq!(pick(&rule, &links, 90.0), Picked::One(3));
        }
        // The scale multiplies the switch distances, so at twice the scale 45 m lies past the
        // first switch only, and a bias above 1 switches nearer.
        assert_eq!(
            small.pick(&links, 0, 2.0, 0.5, 45.0, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
        assert_eq!(
            small.pick(&links, 0, 1.0, 0.5, 45.0, 2.0, DrawRange::NONE),
            Picked::One(3)
        );
    }

    #[test]
    fn a_level_given_by_coverage_switches_where_the_bounds_cover_that_much_of_the_screen() {
        // A view 1,080 pixels high with a 90 degree vertical field of view: P[1][1] is 1.
        let links = links_by([0.25, 0.1, 0.04], Switch::Coverage, false);
        let rule = LevelRule::new(1080.0, 1.0, false, 1.0, 0.0);
        // A world radius of 2 m covers a quarter of the height at 8 m: 2 × 1 / 0.25.
        let sphere = |distance: f32| [0.0, 0.0, -(distance + 2.0)];
        let case = |distance: f32| {
            rule.pick(
                &links,
                0,
                1.0,
                2.0,
                rule.distance(sphere(distance), 2.0),
                1.0,
                DrawRange::NONE,
            )
        };
        assert_eq!(case(7.0), Picked::One(0));
        assert_eq!(case(9.0), Picked::One(1));
        assert_eq!(case(25.0), Picked::One(2));
        assert_eq!(case(60.0), Picked::One(3));
        // A taller screen does not move a switch that is measured by coverage.
        let tall = LevelRule::new(2160.0, 1.0, false, 1.0, 0.0);
        let far = tall.pick(
            &links,
            0,
            1.0,
            2.0,
            tall.distance(sphere(9.0), 2.0),
            1.0,
            DrawRange::NONE,
        );
        assert_eq!(far, Picked::One(1));
        // An orthographic view compares coverage with 1: a draw distance of 1 and a radius that
        // covers less than a quarter of the screen passes the first switch, and a radius that
        // covers more keeps the base level.
        let flat = LevelRule::new(1080.0, 1.0, true, 1.0, 0.0);
        assert_eq!(
            flat.pick(&links, 0, 1.0, 0.2, 1.0, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
        assert_eq!(
            flat.pick(&links, 0, 1.0, 3.0, 1.0, 1.0, DrawRange::NONE),
            Picked::One(0)
        );
    }

    #[test]
    fn the_distance_runs_to_the_nearest_point_of_the_bounds() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        // A sphere of radius 2 m centered 5 m away has its nearest point 3 m away.
        assert_eq!(rule.distance([3.0, 4.0, 0.0], 2.0), 3.0);
        // A sphere that reaches past the camera measures the least distance.
        assert_eq!(rule.distance([0.5, 0.0, 0.0], 2.0), LEAST_DISTANCE);
        assert_eq!(rule.distance([-1.0, 0.0, 0.0], 2.0), LEAST_DISTANCE);
        // An orthographic camera measures the distance to the nearest point too, which a draw
        // range or a level given by a distance compares.
        let flat = LevelRule::new(1000.0, 0.2, true, 1.0, 0.0);
        assert_eq!(flat.distance([1e5, 0.0, 0.0], 1e4), 9.0e4);
    }

    #[test]
    fn a_large_object_switches_by_a_point_halfway_into_its_bounds() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // Level 1 switches in at a level distance of 5 m. A sphere of radius 4 m measures to its
        // center less 2 m: centered at 7 m it measures 5 m, and at 7.1 m it measures 5.1 m.
        let near = rule.distances([0.0, 0.0, -7.0], 4.0);
        assert_eq!(
            rule.pick(&links, 0, 1.0, 4.0, near, 1.0, DrawRange::NONE),
            Picked::One(0)
        );
        let far = rule.distances([0.0, 0.0, -7.1], 4.0);
        assert_eq!(
            rule.pick(&links, 0, 1.0, 4.0, far, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
    }

    #[test]
    fn a_camera_beside_a_large_mesh_measures_the_surface_below_it() {
        let rule = LevelRule::new(1080.0, 1.732, false, 1.0, 0.0);
        // A ground 2 km across has a radius of about 1414 m and a half radius of 707 m. A camera
        // 1,000 m from its centre stands on the surface, where the half-radius measure would be
        // 293 m. The nearest point beside the camera keeps the level distance at the least.
        let ground = rule.error_distance([1000.0, 1.7, 0.0], 1_414.2);
        assert!(ground < 0.01, "a camera on the ground measures {ground} m");
        // Outside the sphere the cap is twice the distance to the nearest point.
        let outside = rule.error_distance([2000.0, 0.0, 0.0], 1_414.2);
        assert!(
            (outside - 2.0 * (2000.0 - 1_414.2)).abs() < 0.01,
            "{outside}"
        );
        // A small sphere keeps the half-radius measure: radius 4 m centred 7 m away measures 5 m.
        assert_eq!(rule.error_distance([0.0, 0.0, -7.0], 4.0), 5.0);
    }

    #[test]
    fn errors_measure_halfway_into_the_bounds_and_hand_set_distances_to_the_nearest_point() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        // A sphere of radius 2 m centered 5 m away: its nearest point lies 3 m away, and its level
        // distance, to the center less half the radius, 4 m.
        let at = rule.distances([3.0, 4.0, 0.0], 2.0);
        assert_eq!((at.camera, at.error), (3.0, 4.0));
        assert_eq!(at.of(Switch::Error), 4.0);
        assert_eq!(at.of(Switch::Distance), 3.0);
        assert_eq!(at.of(Switch::Coverage), 3.0);
        // A camera near the sphere's middle measures the least distance, so the source keeps its
        // base level.
        assert_eq!(rule.error_distance([0.5, 0.0, 0.0], 2.0), LEAST_DISTANCE);
        // A tree of patches keeps the nearest point, so a child is never measured farther than
        // its parent.
        assert_eq!(rule.patch_distance([3.0, 4.0, 0.0], 2.0), 3.0);
        // An orthographic camera measures the nearest point for a distance or a range, and 1 for
        // an error, whose pixels do not shrink with distance.
        let flat = LevelRule::new(1000.0, 0.2, true, 1.0, 0.0);
        let far = flat.distances([1e5, 0.0, 0.0], 1e4);
        assert_eq!((far.camera, far.error), (9.0e4, 1.0));
    }

    #[test]
    fn a_larger_threshold_or_a_lower_render_height_picks_coarser_levels() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        let full = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let half = LevelRule::new(500.0, 1.0, false, 1.0, 0.0);
        let coarse = LevelRule::new(1000.0, 1.0, false, 2.0, 0.0);
        assert_eq!(pick(&full, &links, 12.0), Picked::One(1));
        assert_eq!(pick(&half, &links, 12.0), Picked::One(2));
        assert_eq!(pick(&coarse, &links, 12.0), Picked::One(2));
    }

    #[test]
    fn an_orthographic_view_picks_by_scale_alone() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // A view 10 m high on 1,000 pixels: P[1][1] is 0.2, so 100 pixels a meter at threshold 1.
        let rule = LevelRule::new(1000.0, 0.2, true, 1.0, 0.0);
        let at = rule.distances([1e5, 0.0, 0.0], 1.0);
        // The camera's distance to the sphere is far, and its error distance stays 1, since an
        // orthographic camera's pixels do not shrink with distance.
        assert_eq!((at.camera, at.error), (1e5 - 1.0, 1.0));
        // An error passes while it covers less than a pixel: level 1's 1 cm covers exactly one
        // pixel at scale 1, so the base level draws, and half a pixel at scale 0.5.
        let cases = [(1.0, 0), (0.5, 1), (0.2, 2), (0.04, 3)];
        for (scale, level) in cases {
            assert_eq!(
                rule.pick(&links, 0, scale, 1.0, at, 1.0, DrawRange::NONE),
                Picked::One(level),
                "{scale}"
            );
        }
    }

    #[test]
    fn an_orthographic_view_uses_the_nearest_point_for_a_range_and_a_distance_level() {
        let rule = LevelRule::new(1000.0, 0.2, true, 1.0, 0.0);
        // A sphere of radius 2 m 10 m from the camera has its nearest point 8 m away.
        let at = rule.distances([0.0, 0.0, -10.0], 2.0);
        assert_eq!(at.camera, 8.0);
        // A band that starts at 8 m draws it. Measured as 1, the band would hide it everywhere.
        let range = DrawRange {
            start: 8.0,
            end: 120.0,
        };
        let errors = links([0.0, 100.0, 200.0, 300.0], false);
        assert_eq!(
            rule.pick(&errors, 0, 1.0, 2.0, at, 1.0, range),
            Picked::One(0)
        );
        // A level given by a distance of 6 m switches in past 6 m, so it draws at 8 m and not at
        // the 5 m of a nearer sphere.
        let by_distance = links_by([6.0, 20.0, 100.0], Switch::Distance, false);
        assert_eq!(
            rule.pick(&by_distance, 0, 1.0, 2.0, at, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
        let close = rule.distances([0.0, 0.0, -7.0], 2.0);
        assert_eq!(close.camera, 5.0);
        assert_eq!(
            rule.pick(&by_distance, 0, 1.0, 2.0, close, 1.0, DrawRange::NONE),
            Picked::One(0)
        );
    }

    #[test]
    fn a_bias_moves_every_switch_and_the_hide_distance_together() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // Level 1 switches in past 5 m at a bias of 1: past 2.5 m at 2, and past 10 m at 0.5.
        // Level 2 switches in past 20 m at a bias of 1, and past 10 m at 2.
        let cases = [
            (12.0, 1.0, 1),
            (12.0, 2.0, 2),
            (25.0, 1.0, 2),
            (25.0, 0.5, 1),
        ];
        for (distance, bias, level) in cases {
            assert_eq!(
                rule.pick(&links, 0, 1.0, 0.5, distance, bias, DrawRange::NONE),
                Picked::One(level)
            );
        }
        // A bound covers a pixel past 1,000 m at a bias of 1, so a bias of 2 hides it at 600 m.
        assert_eq!(
            rule.pick(&links, 0, 1.0, 1.0, 600.0, 1.0, DrawRange::NONE),
            Picked::One(3)
        );
        assert_eq!(
            rule.pick(&links, 0, 1.0, 1.0, 600.0, 2.0, DrawRange::NONE),
            Picked::Hidden
        );
        assert_eq!(
            rule.pick(&links, 0, 1.0, 1.0, 1_500.0, 1.0, DrawRange::NONE),
            Picked::Hidden
        );
        assert_eq!(
            rule.pick(&links, 0, 1.0, 1.0, 1_500.0, 0.5, DrawRange::NONE),
            Picked::One(3)
        );
    }

    /// A camera's rule with a factor, 1,000 pixels high and 90 degrees high: factor 500.
    fn camera_rule() -> LevelRule {
        LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND)
    }

    #[test]
    fn an_orthographic_light_picks_by_its_texels_wherever_the_camera_is() {
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        // Texels of 2 cm at a threshold of one texel: an error under 2 cm passes.
        let light = LevelRule::for_light(&camera_rule(), LightLens::Parallel { texel: 0.02 }, 1.0);
        assert_eq!(light.factor, 50.0);
        assert_eq!(light.band, 0.0, "a shadow view draws no fading band");
        for camera in [0.5, 5.0, 50.0, 500.0] {
            let at = light.distances([0.0, 0.0, -camera - 0.5], 0.5);
            assert_eq!(at.error, 1.0);
            // Level 1's 1 cm passes and level 2's 4 cm does not, at every camera distance.
            assert_eq!(
                light.pick(&links, 0, 1.0, 0.5, at, 1.0, DrawRange::NONE),
                Picked::One(1),
                "{camera}"
            );
        }
        // Texels of 5 cm, or a threshold of 2.5 texels of 2 cm, pass level 2's 4 cm, and not level
        // 3's 20 cm.
        let coarse = LevelRule::for_light(&camera_rule(), LightLens::Parallel { texel: 0.05 }, 1.0);
        let double = LevelRule::for_light(&camera_rule(), LightLens::Parallel { texel: 0.02 }, 2.5);
        for rule in [coarse, double] {
            let at = rule.distances([0.0, 0.0, -10.0], 0.5);
            assert_eq!(
                rule.pick(&links, 0, 1.0, 0.5, at, 1.0, DrawRange::NONE),
                Picked::One(2)
            );
        }
    }

    #[test]
    fn a_light_hides_a_caster_that_covers_fewer_texels_than_the_threshold() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        let light = LevelRule::for_light(&camera_rule(), LightLens::Parallel { texel: 0.02 }, 1.0);
        // A diameter of 2 cm covers one texel; 1.8 cm covers fewer, whatever the camera's distance.
        for camera in [1.0, 1000.0] {
            let at = |radius: f32| light.distances([0.0, 0.0, -camera], radius);
            assert_ne!(
                light.pick(&links, 0, 1.0, 0.01, at(0.01), 1.0, DrawRange::NONE),
                Picked::Hidden
            );
            assert_eq!(
                light.pick(&links, 0, 1.0, 0.009, at(0.009), 1.0, DrawRange::NONE),
                Picked::Hidden
            );
        }
    }

    #[test]
    fn a_lights_ranges_and_hand_set_distances_follow_the_camera() {
        let light = LevelRule::for_light(&camera_rule(), LightLens::Parallel { texel: 0.02 }, 1.0);
        // A distance range measures the camera's distance in a light's view too.
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        let range = DrawRange::new(10.0, 20.0);
        let at = |camera: f32| light.distances([0.0, 0.0, -camera - 0.5], 0.5);
        assert_eq!(
            light.pick(&links, 0, 1.0, 0.5, at(5.0), 1.0, range),
            Picked::Hidden
        );
        assert_eq!(
            light.pick(&links, 0, 1.0, 0.5, at(15.0), 1.0, range),
            Picked::One(1)
        );
        assert_eq!(
            light.pick(&links, 0, 1.0, 0.5, at(25.0), 1.0, range),
            Picked::Hidden
        );
        // A level given by a distance switches at the camera's distance, as its author set it.
        let by_distance = links_by([20.0, 40.0, 80.0], Switch::Distance, false);
        assert_eq!(
            light.pick(&by_distance, 0, 1.0, 0.5, at(19.0), 1.0, DrawRange::NONE),
            Picked::One(0)
        );
        assert_eq!(
            light.pick(&by_distance, 0, 1.0, 0.5, at(45.0), 1.0, DrawRange::NONE),
            Picked::One(2)
        );
    }

    #[test]
    fn a_perspective_light_measures_from_the_light() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // A light 100 m from the camera, with texels 1 mm wide a meter from it: an error passes
        // while it covers less than a millimeter for each meter from the light.
        let eye = [100.0, 0.0, 0.0];
        let lens = LightLens::Point { eye, texel: 0.001 };
        let light = LevelRule::for_light(&camera_rule(), lens, 1.0);
        // A source next to the camera, 100 m from the light, passes level 2's 4 cm, and the same
        // source 15 m from the light passes level 1's 1 cm alone.
        let far = light.distances([0.0, 0.0, 0.0], 0.5);
        assert!((far.error - 99.5).abs() < 1e-3, "{far:?}");
        assert_eq!(
            light.pick(&links, 0, 1.0, 0.5, far, 1.0, DrawRange::NONE),
            Picked::One(2)
        );
        let near = light.distances([85.0, 0.0, 0.0], 0.5);
        assert_eq!(
            light.pick(&links, 0, 1.0, 0.5, near, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
        assert_eq!(light.measure_uniform(), [100.0, 0.0, 0.0, 2.0]);
    }

    #[test]
    fn a_light_draws_the_base_level_where_the_camera_or_the_threshold_turns_levels_off() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        let lens = LightLens::Parallel { texel: 0.02 };
        let off = LevelRule::new(1000.0, 1.0, false, 0.0, 0.0);
        for rule in [
            LevelRule::for_light(&off, lens, 1.0),
            LevelRule::for_light(&camera_rule(), lens, 0.0),
        ] {
            assert!(!rule.on());
            let at = rule.distances([0.0, 0.0, -500.0], 0.5);
            assert_eq!(
                rule.pick(&links, 0, 1.0, 0.5, at, 1.0, DrawRange::NONE),
                Picked::One(0)
            );
        }
    }

    #[test]
    fn a_rule_without_a_factor_draws_the_base_level() {
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        let off = LevelRule::new(1000.0, 1.0, false, 0.0, FADE_BAND);
        assert!(!off.on());
        assert_eq!(pick(&off, &links, 1e9), Picked::One(0));
        // Without a factor, a distance range still hides a source outside it.
        let far = DrawRange::new(0.0, 100.0);
        assert_eq!(
            off.pick(&links, 0, 1.0, 1.0, 200.0, 1.0, far),
            Picked::Hidden
        );
    }

    #[test]
    fn the_band_past_a_switch_fades_from_the_old_level_to_the_new() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        // Level 1 switches in at 5 m, and its band runs the share of that distance past it.
        let switch_distance = 5.0;
        let band_end = switch_distance * (1.0 + FADE_BAND);
        let middle = (switch_distance + band_end) / 2.0;
        assert_eq!(pick(&rule, &links, switch_distance - 0.1), Picked::One(0));
        let Picked::Fade { new, old, t } = pick(&rule, &links, middle) else {
            panic!("no fade in the band");
        };
        assert_eq!((new, old), (5, 4));
        assert!((t - 0.5).abs() < 1e-4);
        assert_eq!(pick(&rule, &links, band_end + 0.01), Picked::One(1));
        // Level 2's band, past 20 m, fades from level 1.
        let Picked::Fade { new, old, .. } = pick(&rule, &links, 20.5) else {
            panic!("no fade at 20.5 m");
        };
        assert_eq!((new, old), (6, 5));
        // Without fade buckets, or without a band, levels switch at once.
        let still = links_without_fades();
        assert_eq!(pick(&rule, &still, 5.375), Picked::One(1));
        let no_band = LevelRule { band: 0.0, ..rule };
        assert_eq!(pick(&no_band, &links, 5.375), Picked::One(1));
        let (new, old) = fade_values(0.0);
        assert!(new > 0.0 && old == 0.0);
    }

    fn links_without_fades() -> Vec<LevelLink> {
        links([0.0, 0.01, 0.04, 0.2], false)
    }

    #[test]
    fn a_bucket_without_levels_draws_itself() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = [LevelLink::NONE; 2];
        assert_eq!(
            rule.pick(&links, 1, 1.0, 1.0, 1e9, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
    }

    #[test]
    fn a_bound_that_covers_less_than_the_threshold_draws_nothing() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // A world diameter of 2 m covers 1,000 / distance pixels: one pixel at 1,000 m.
        assert_eq!(pick_r(&rule, &links, 1.0, 999.0), Picked::One(3));
        assert_eq!(pick_r(&rule, &links, 1.0, 1_001.0), Picked::Hidden);
        // A bound of no radius has no size to test, and a mesh without levels has no hidden level.
        assert_eq!(
            rule.pick(&links, 0, 1.0, 0.0, 1e9, 1.0, DrawRange::NONE),
            Picked::One(3)
        );
        let plain = [LevelLink::NONE; 2];
        assert_eq!(
            rule.pick(&plain, 1, 1.0, 1.0, 1e9, 1.0, DrawRange::NONE),
            Picked::One(1)
        );
    }

    #[test]
    fn the_hide_distance_follows_the_threshold_and_the_render_height() {
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        // A threshold of two pixels halves the factor, so the bound hides at half the distance.
        let full = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let low = LevelRule::new(1000.0, 1.0, false, 2.0, 0.0);
        let half = LevelRule::new(500.0, 1.0, false, 1.0, 0.0);
        assert_eq!(pick_r(&full, &links, 1.0, 501.0), Picked::One(3));
        assert_eq!(pick_r(&low, &links, 1.0, 501.0), Picked::Hidden);
        assert_eq!(pick_r(&half, &links, 1.0, 501.0), Picked::Hidden);
    }

    #[test]
    fn the_band_past_the_hide_distance_thins_the_level_out() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        // The coarsest level's fade bucket draws the dither's share near the hide distance of
        // 1,000 m, and nothing past the band.
        let hide = 1_000.0;
        let middle = hide * (1.0 + FADE_BAND / 2.0);
        let Picked::FadeOut { old, t } = pick_r(&rule, &links, 1.0, middle) else {
            panic!("no fade out in the band");
        };
        assert_eq!(old, 7);
        assert!((t - 0.5).abs() < 1e-4);
        assert_eq!(
            pick_r(&rule, &links, 1.0, hide * (1.0 + FADE_BAND) + 0.1),
            Picked::Hidden
        );
        // Without a band or a fading build, the source hides at once.
        let no_band = LevelRule { band: 0.0, ..rule };
        assert_eq!(pick_r(&no_band, &links, 1.0, hide + 0.1), Picked::Hidden);
        assert_eq!(
            pick_r(&rule, &links_without_fades(), 1.0, hide + 0.1),
            Picked::Hidden
        );
    }

    #[test]
    fn an_orthographic_view_hides_a_bound_that_covers_less_than_a_pixel() {
        // A view 10 m high on 1,000 pixels draws 100 pixels a meter at a threshold of one pixel.
        let rule = LevelRule::new(1000.0, 0.2, true, 1.0, 0.0);
        let links = links([0.0, 0.01, 0.04, 0.2], false);
        let at = rule.distances([1e5, 0.0, 0.0], 0.005);
        // The error distance stays 1 for an orthographic camera.
        assert_eq!(at.error, 1.0);
        // A diameter of 1 cm covers exactly one pixel, and 9.8 mm covers under it. The base level
        // draws at a scale of 1, where level 1's error covers exactly a pixel too.
        assert_eq!(
            rule.pick(&links, 0, 1.0, 0.005, at, 1.0, DrawRange::NONE),
            Picked::One(0)
        );
        assert_eq!(
            rule.pick(&links, 0, 1.0, 0.0049, at, 1.0, DrawRange::NONE),
            Picked::Hidden
        );
    }

    #[test]
    fn a_distance_range_hides_a_source_outside_it_and_fades_at_each_edge() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        // Every distance below the first switch, 5 m, so the base level draws and its fade
        // bucket is the one at 4.
        let range = DrawRange::new(1.0, 3.0);
        let at = |distance: f32| rule.pick(&links, 0, 1.0, 0.5, distance, 1.0, range);
        // Outside the range, nothing draws.
        assert_eq!(at(0.9), Picked::Hidden);
        assert_eq!(at(3.1), Picked::Hidden);
        // At the start edge, the share kept grows from nothing to everything.
        let Picked::FadeIn { bucket, t } = at(1.04) else {
            panic!("no fade in at the start edge");
        };
        assert_eq!(bucket, 4);
        assert!((t - 0.5).abs() < 1e-4);
        assert_eq!(at(1.0 + FADE_BAND + 0.1), Picked::One(0));
        // At the end edge, the share kept falls from everything to nothing.
        let inner = 3.0 / (1.0 + FADE_BAND);
        let Picked::FadeOut { old, t } = at((inner + 3.0) / 2.0) else {
            panic!("no fade out at the end edge");
        };
        assert_eq!(old, 4);
        assert!((t - 0.5).abs() < 1e-4);
        assert_eq!(at(inner - 0.1), Picked::One(0));
        // Without a fading band, both edges cut at once.
        let hard = LevelRule { band: 0.0, ..rule };
        assert_eq!(
            hard.pick(&links, 0, 1.0, 0.5, 1.04, 1.0, range),
            Picked::One(0)
        );
        assert_eq!(
            hard.pick(&links, 0, 1.0, 0.5, (inner + 3.0) / 2.0, 1.0, range),
            Picked::One(0)
        );
        // A mesh without levels needs no fade bucket to hide outside its range.
        let plain = [LevelLink::NONE; 2];
        assert_eq!(
            rule.pick(&plain, 0, 1.0, 1.0, 4.0, 1.0, range),
            Picked::Hidden
        );
        assert_eq!(
            rule.pick(&plain, 0, 1.0, 1.0, 2.0, 1.0, range),
            Picked::One(0)
        );
    }

    #[test]
    fn a_range_with_a_hidden_start_keeps_the_source_at_its_own_level() {
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, FADE_BAND);
        let links = links([0.0, 0.01, 0.04, 0.2], true);
        // A source that draws from 100 m to 1,000 m picks its level by the same rule, and its
        // start edge fades that level in.
        let range = DrawRange::new(100.0, 1_000.0);
        let Picked::FadeIn { bucket, .. } = rule.pick(&links, 0, 1.0, 0.5, 101.0, 1.0, range)
        else {
            panic!("no fade in at 101 m");
        };
        assert_eq!(bucket, 7);
    }

    /// The count of a level's copies picks at both edges of its slack in one walk. Over random
    /// chains of levels, rules, ranges and distances, the walk must give exactly what two picks
    /// give, fading amounts included.
    #[test]
    fn one_walk_picks_what_two_picks_give_at_both_distances() {
        let mut state = 0x9e37_79b9_u32;
        let mut random = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            f32::from(u16::try_from(state >> 16).unwrap()) / f32::from(u16::MAX)
        };
        let switches = [Switch::Error, Switch::Distance, Switch::Coverage];
        for _ in 0..20_000 {
            let levels = 1 + (random() * 4.0) as u32;
            let fades = random() < 0.6;
            let mut links: Vec<LevelLink> = (0..levels * 2)
                .map(|bucket| LevelLink {
                    value: if bucket == 0 || bucket >= levels {
                        0.0
                    } else {
                        random() * 0.5
                    },
                    switch: switches[(random() * 2.99) as usize],
                    next: if bucket + 1 < levels {
                        bucket + 1
                    } else {
                        NO_LINK
                    },
                    fade: if fades && bucket < levels {
                        levels + bucket
                    } else {
                        NO_LINK
                    },
                })
                .collect();
            for link in &mut links[levels as usize..] {
                link.next = NO_LINK;
            }
            let rule = LevelRule::new(
                if random() < 0.1 {
                    0.0
                } else {
                    400.0 + random() * 2000.0
                },
                0.5 + random() * 2.0,
                false,
                1.0 + random() * 4.0,
                if random() < 0.3 { 0.0 } else { random() * 0.3 },
            );
            let range = match (random() * 3.0) as u32 {
                0 => DrawRange::NONE,
                1 => DrawRange::new(random() * 50.0, f32::INFINITY),
                _ => DrawRange::new(random() * 20.0, 20.0 + random() * 400.0),
            };
            let scale = 0.1 + random() * 4.0;
            let radius = random() * 5.0;
            let bias = if random() < 0.2 {
                0.0
            } else {
                0.25 + random() * 3.0
            };
            let distance = 0.01 + random() * random() * 2000.0;
            let slack = if random() < 0.5 {
                1.0e-3
            } else {
                random() * 0.5
            };
            let (near, far) = (distance * (1.0 - slack), distance * (1.0 + slack));
            let both = rule.pick_both(&links, 0, scale, radius, near, far, bias, range);
            let one = [near, far].map(|at| rule.pick(&links, 0, scale, radius, at, bias, range));
            assert_eq!(
                format!("{both:?}"),
                format!("{one:?}"),
                "{links:?} {rule:?} {range:?} {scale} {radius} {bias} {near} {far}"
            );
        }
    }
}

//! Reflection probes (decision record D-149): the light around a point of the scene, captured in
//! the browser and filtered for each roughness as the environment's map is. A probe lights the
//! surfaces inside its box in place of the environment, and its box projects its reflections, so
//! a room's walls reflect where they stand.
//!
//! Every probe's map is one layer of the frame group's shared 2D texture array of half floats at
//! binding 3, which the light tables share ([`crate::light_tables`]): an octahedral map, which
//! folds the whole sphere into one square, with mip levels down to 4 texels across. Level `i` of
//! `n` holds the light of perceptual roughness `1 - sqrt(1 - i / (n - 1))`, as an environment
//! map's levels do, so the shaders find a roughness's level the same way for both. The probes take
//! a layer for each slot up to the highest in use, rounded up to a power of two, in the layers
//! after the light tables'. A new size, or more layers, makes the array again in the other of two
//! pairs of texture ids, copies the layers that survive into it, and the next frame's list destroys
//! the old pair, so no probe captures again.
//!
//! A probe captures through six capture views, one per face of a cube, which the scene's view list
//! holds while it has a probe (see [`crate::view::View::probe_face`]). They draw what any view
//! draws, the background included, from the probe's capture point. One probe captures per frame:
//! first each probe that waits for a capture, then in turns each probe that refreshes always. In
//! the same frame, after the capture views' passes and before the camera's, [`Op::ProbeFilter`]
//! makes the probe's map from the views' images, so the probe lights surfaces in the frame that
//! captured it. The capture views list no probe, so a probe sees the environment alone, and no
//! probe reads its own map.
//!
//! Each view lists up to [`LISTED`] probes for its shaders, in a uniform block of its own:
//! positions relative to its camera, and inner probes first, by priority and then by the size of
//! their boxes. A probe whose box lies wholly outside the view stays out of its list.

use null3d_core::cells::{CellPosition, split64};
use null3d_core::culling::Frustum;
use null3d_core::layers::DEFAULT_LAYERS;

use crate::light_tables::{FIRST_IMAGE_LAYER, Shape};
use null3d_gpu::drawlist::{DrawList, Op, format, texture_usage, view};

use crate::camera::{Affine, Lens, Perspective};
use crate::frame::RecordError;
use crate::view::CameraTransform;

/// The most reflection probes a scene has.
pub const MAX_PROBES: usize = 16;

/// The most probes that one view lists for its shaders.
pub const LISTED: usize = 8;

/// The frame group's binding of the probes' texture array, on both GPU paths.
pub const ARRAY_BINDING: u32 = 3;

/// The frame group's binding of a view's list of probes on WebGPU.
pub const LIST_BINDING: u32 = 18;

/// The frame group's binding of a view's list of probes on WebGL2, whose frame group holds
/// bindings below 16 only.
pub const LIST_BINDING_WEBGL2: u32 = 14;

/// Bytes of a view's list: a head of four floats, then four `vec4f` per probe.
pub const LIST_BYTES: u32 = 16 + 64 * LISTED as u32;

/// Bytes between two views' lists in the buffer of every view's, a multiple of 256, as uniform
/// offsets need.
pub const LIST_STRIDE: u32 = LIST_BYTES.div_ceil(256) * 256;

/// The texels across the smallest mip level of a probe's map.
const SMALLEST_LEVEL: u32 = 4;

/// The distance from a capture point to its views' near plane, in meters.
const CAPTURE_NEAR: f32 = 0.05;

/// The probe sizes that the quality setting takes, in texels across a map's largest level.
pub const SIZES: [u32; 3] = [128, 256, 512];

/// A probe's settings, as the sketch gives them. Positions are in the world, in 64-bit floats.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProbeSettings {
    /// The corner of the probe's box with the least x, y and z, and the opposite corner.
    pub low: [f64; 3],
    pub high: [f64; 3],
    /// The point that the probe captures the scene from, inside its box.
    pub capture: [f64; 3],
    /// How far beyond the box's sides the probe fades out, in meters. 0 gives a hard edge.
    pub blend: f32,
    /// The factor of the probe's light.
    pub intensity: f32,
    /// True when the probe projects its reflections onto its box, false when it reads them as
    /// light from infinitely far away, as an environment's.
    pub box_projection: bool,
    /// True when the probe captures again in turns, as long as it exists.
    pub always: bool,
    /// The layers of the objects that the probe's captures draw.
    pub layers: u32,
    /// The probe's priority: a probe of a higher priority lights the surfaces in both boxes.
    pub priority: f32,
}

impl Default for ProbeSettings {
    fn default() -> Self {
        Self {
            low: [-1.0; 3],
            high: [1.0; 3],
            capture: [0.0; 3],
            blend: 1.0,
            intensity: 1.0,
            box_projection: true,
            always: false,
            layers: DEFAULT_LAYERS,
            priority: 0.0,
        }
    }
}

impl ProbeSettings {
    /// True when going from `self` to `next` changes what the probe captures.
    fn captures_differently(&self, next: &ProbeSettings) -> bool {
        self.capture != next.capture || self.layers != next.layers
    }

    /// The volume of the box, which orders probes of one priority: the smaller first.
    fn volume(&self) -> f64 {
        (0..3)
            .map(|k| (self.high[k] - self.low[k]).max(0.0))
            .product()
    }
}

/// One probe of the scene.
#[derive(Clone, Copy, Debug)]
struct Probe {
    settings: ProbeSettings,
    /// True once the probe's layer holds its map.
    ready: bool,
    /// True while the probe waits for a capture.
    due: bool,
}

/// The four texture ids from `first` on that a builder gives the probes: two pairs of the probes'
/// array and the chain that each filter draws through. A new array takes the other pair, so a
/// frame's list never destroys a texture that it binds itself, as a capture replays the list
/// again; the next frame's list destroys the old pair.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProbeTextures {
    pub first: u32,
}

impl ProbeTextures {
    /// The ids of the array and the chain of pair `pair`, 0 or 1.
    fn pair(self, pair: usize) -> (u32, u32) {
        let array = self.first + 2 * pair as u32;
        (array, array + 1)
    }
}

/// A view's list of probes, laid out as the shaders' `ReflectionProbes` reads it.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ProbeList {
    /// The count, the maps' last mip level, the texels across their largest level, and a spare.
    pub head: [f32; 4],
    /// Each probe's box corners with its blend and intensity, its capture point with its layer,
    /// and its flags.
    pub probes: [[[f32; 4]; 4]; LISTED],
}

const _: () = assert!(std::mem::size_of::<ProbeList>() == LIST_BYTES as usize);

impl ProbeList {
    /// The list as bytes, for an upload.
    pub fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of 4-byte fields, so it has no padding,
        // and any bytes of it are initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

/// The error of a probe that the scene cannot take.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProbeError {
    /// The slot is past [`MAX_PROBES`].
    BadSlot,
    /// The view list has no room for the six capture views.
    NoViews,
}

/// The scene's reflection probes.
#[derive(Debug)]
pub struct Probes {
    probes: [Option<Probe>; MAX_PROBES],
    /// The texels across the largest level of each map, from the quality preset.
    size: u32,
    /// The ids a builder gave, once it gave them.
    textures: Option<ProbeTextures>,
    /// The size, the layers and the mip levels of the array on the GPU.
    made: Option<(u32, u32, u32)>,
    /// Counts the arrays made, so builders bind each new one.
    generation: u32,
    /// The pair of texture ids that the array and the chain take now, and a pair that the next
    /// frame destroys.
    pair: usize,
    retired: Option<usize>,
    /// The probe whose views draw in this frame.
    capturing: Option<usize>,
    /// The words of this frame's filter command, which the render graph records after the
    /// capture views' passes.
    filter: Option<[u32; 10]>,
    /// The next probe to refresh in turns.
    turn: usize,
    /// The textures of the capture views' targets in this frame, by face.
    faces: [Option<u32>; 6],
    /// The image id of the generator that the thread that draws runs each probe's filter with,
    /// once the sketch sent it.
    generator: Option<u32>,
}

impl Default for Probes {
    fn default() -> Self {
        Self {
            probes: [None; MAX_PROBES],
            size: SIZES[1],
            textures: None,
            made: None,
            generation: 0,
            pair: 0,
            retired: None,
            capturing: None,
            filter: None,
            turn: 0,
            faces: [None; 6],
            generator: None,
        }
    }
}

impl Probes {
    /// True while the scene has a probe.
    pub fn any(&self) -> bool {
        self.probes.iter().any(Option::is_some)
    }

    /// Sets the probe of `slot`, from 0, adding it when the slot is empty. A new probe, or one that
    /// captures from elsewhere or other layers, captures again.
    pub fn set(&mut self, slot: usize, settings: ProbeSettings) -> Result<(), ProbeError> {
        let probe = self.probes.get_mut(slot).ok_or(ProbeError::BadSlot)?;
        match probe {
            Some(probe) => {
                probe.due |= probe.settings.captures_differently(&settings);
                probe.settings = settings;
            }
            None => {
                *probe = Some(Probe {
                    settings,
                    ready: false,
                    due: true,
                });
            }
        }
        Ok(())
    }

    /// Removes the probe of `slot`. Its layer stays as it is until another probe takes it.
    pub fn remove(&mut self, slot: usize) {
        if let Some(probe) = self.probes.get_mut(slot) {
            *probe = None;
        }
        if self.capturing == Some(slot) {
            self.capturing = None;
        }
    }

    /// Makes the probe of `slot` capture again.
    pub fn capture(&mut self, slot: usize) {
        if let Some(Some(probe)) = self.probes.get_mut(slot) {
            probe.due = true;
        }
    }

    /// Sets the texels across each map's largest level, one of [`SIZES`], from the next frame on.
    /// A new size makes the array again, and every probe captures again.
    pub fn set_size(&mut self, size: u32) {
        self.size = SIZES
            .iter()
            .copied()
            .find(|&s| s >= size)
            .unwrap_or(SIZES[SIZES.len() - 1]);
    }

    /// The texels across each map's largest level.
    pub fn size(&self) -> u32 {
        self.size
    }

    /// The texels across a side of each capture view's target: half the map's size, which holds
    /// about as many texels per angle as the octahedral map.
    pub fn face_size(&self) -> u32 {
        self.size / 2
    }

    /// The mip levels of each map: down to [`SMALLEST_LEVEL`] texels across.
    pub fn levels(&self) -> u32 {
        self.size.ilog2() - SMALLEST_LEVEL.ilog2() + 1
    }

    /// The image id of the generator that runs each probe's filter, once the sketch sent it.
    pub fn generator(&self) -> Option<u32> {
        self.generator
    }

    /// Notes the image id of the generator that runs each probe's filter. Probes capture once the
    /// thread that draws holds it.
    pub fn set_generator(&mut self, id: u32) {
        self.generator = Some(id);
    }

    /// Gives the probes the texture ids of a builder.
    pub fn set_textures(&mut self, textures: ProbeTextures) {
        self.textures = Some(textures);
    }

    /// The array of the probes' maps that frame groups bind, and its generation, once the GPU
    /// holds one.
    pub fn array(&self) -> Option<(u32, u32)> {
        let textures = self.textures?;
        self.made
            .map(|_| (textures.pair(self.pair).0, self.generation))
    }

    /// The probe whose capture views draw in this frame, and its settings.
    pub fn capturing(&self) -> Option<ProbeSettings> {
        let slot = self.capturing?;
        self.probes[slot].map(|probe| probe.settings)
    }

    /// Picks the probe that captures in this frame, once the thread that draws holds the filter's
    /// code, which `code_ready` says: the first that waits for a capture, or else the next of
    /// those that refresh always. A builder calls it once per frame, before the views move on.
    pub fn pick_capture(&mut self, code_ready: bool) {
        self.capturing = None;
        if !code_ready || self.generator.is_none() {
            return;
        }
        if let Some(slot) = self
            .probes
            .iter()
            .position(|probe| probe.is_some_and(|p| p.due))
        {
            self.capturing = Some(slot);
            return;
        }
        for k in 0..MAX_PROBES {
            let slot = (self.turn + k) % MAX_PROBES;
            if self.probes[slot].is_some_and(|p| p.settings.always) {
                self.capturing = Some(slot);
                self.turn = slot + 1;
                return;
            }
        }
    }

    /// Takes the textures that the capture views draw into in this frame, by face.
    pub fn set_faces(&mut self, faces: [Option<u32>; 6]) {
        self.faces = faces;
    }

    /// The words of this frame's filter command, which the render graph records after the
    /// capture views' passes and before the camera's, or `None` in a frame that captures nothing.
    pub fn filter(&self) -> Option<[u32; 10]> {
        self.filter
    }

    /// True while a probe waits for its first capture, so a held frame draws without it.
    pub fn waiting(&self) -> bool {
        self.probes.iter().flatten().any(|probe| !probe.ready)
    }

    /// Records the frame's work on the probes' maps, ahead of the frame's passes: the array and
    /// the chain when the size or the layers changed. Then readies the filter of the probe that
    /// captures in this frame, whose map the frame's lit passes read.
    pub(crate) fn record(&mut self, list: &mut DrawList, light: Shape) -> Result<(), RecordError> {
        self.filter = None;
        let Some(textures) = self.textures else {
            return Ok(());
        };
        if let Some(old) = self.retired.take() {
            let (array, chain) = textures.pair(old);
            list.push(Op::DestroyTexture, &[array])?;
            list.push(Op::DestroyTexture, &[chain])?;
        }
        let layers = self.probe_layers();
        let levels = if layers > 0 {
            self.levels().max(light.levels)
        } else {
            light.levels
        };
        let wanted = (light.size, light.layers, levels);
        if Some(wanted) != self.made {
            let old = self.made.map(|made| (textures.pair(self.pair).0, made));
            if self.made.is_some() {
                self.retired = Some(self.pair);
                self.pair ^= 1;
            }
            let (array, chain) = textures.pair(self.pair);
            self.create(list, (array, chain), wanted)?;
            if let Some((from, (size, old_layers, old_levels))) = old {
                // Copy the layers that survive into the new array, so no probe captures again and
                // the images keep their texels.
                let levels = old_levels.min(levels);
                let layers = old_layers.min(wanted.1);
                for level in 0..levels {
                    let side = size.min(wanted.0) >> level;
                    if side == 0 {
                        break;
                    }
                    list.push(
                        Op::CopyTextureToTexture,
                        &[
                            from, level, 0, 0, 0, array, level, 0, 0, 0, side, side, layers,
                        ],
                    )?;
                }
            }
            self.made = Some(wanted);
            self.generation = self.generation.wrapping_add(1);
        }
        if let (Some(slot), Some(code), [Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)]) =
            (self.capturing, self.generator, self.faces)
            && let Some(probe) = &mut self.probes[slot]
            && self.made.is_some()
        {
            let (array, chain) = textures.pair(self.pair);
            self.filter = Some([array, chain, slot as u32, code, a, b, c, d, e, f]);
            probe.ready = true;
            probe.due = false;
        }
        Ok(())
    }

    /// The layers the array needs: one for each slot up to the highest in use, rounded up to a
    /// power of two, and at least 2. None while the scene has no probe.
    pub fn probe_layers(&self) -> u32 {
        match self.probes.iter().rposition(Option::is_some) {
            Some(last) => (last as u32 + 1).next_power_of_two().max(2),
            None => 0,
        }
    }

    fn create(
        &self,
        list: &mut DrawList,
        (array, chain): (u32, u32),
        (size, layers, levels): (u32, u32, u32),
    ) -> Result<(), RecordError> {
        // The filter draws into the array, the light tables upload into it, and a regrow copies
        // its layers into the new array.
        let usage = texture_usage::RENDER_ATTACHMENT
            | texture_usage::TEXTURE_BINDING
            | texture_usage::COPY_SRC
            | texture_usage::COPY_DST;
        list.push(
            Op::CreateTexture,
            &[
                array,
                size,
                size,
                layers,
                format::RGBA16_FLOAT,
                usage,
                1,
                levels,
                view::D2_ARRAY,
            ],
        )?;
        let face = self.face_size();
        list.push(
            Op::CreateTexture,
            &[
                chain,
                face,
                face,
                6,
                format::RGBA16_FLOAT,
                usage,
                1,
                face.ilog2() + 1,
                view::D2_ARRAY,
            ],
        )?;
        Ok(())
    }

    /// The list of probes for a view whose camera stands at `camera` and sees `frustum`, relative
    /// to the camera: each ready probe whose box the view may see, inner probes first, at most
    /// [`LISTED`]. A capture view lists none.
    pub fn list(&self, camera: &CellPosition, frustum: &Frustum, capture: bool) -> ProbeList {
        let mut out = ProbeList::default();
        if capture || self.made.is_none() {
            return out;
        }
        let eye = camera.absolute();
        let mut order = [(0usize, 0.0f32, 0.0f64); MAX_PROBES];
        let mut count = 0;
        for (slot, probe) in self.probes.iter().enumerate() {
            let Some(probe) = probe.as_ref().filter(|p| p.ready) else {
                continue;
            };
            let s = &probe.settings;
            let center: [f64; 3] = std::array::from_fn(|k| (s.low[k] + s.high[k]) * 0.5 - eye[k]);
            let radius = (0..3)
                .map(|k| (s.high[k] - s.low[k]) * 0.5 + f64::from(s.blend))
                .map(|half| half * half)
                .sum::<f64>()
                .sqrt();
            let [x, y, z] = center.map(|v| v as f32);
            if !frustum.contains_sphere(x, y, z, radius as f32) {
                continue;
            }
            order[count] = (slot, s.priority, s.volume());
            count += 1;
        }
        let order = &mut order[..count];
        order.sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then(a.2.total_cmp(&b.2)));
        let listed = order.len().min(LISTED);
        for (out, &(slot, _, _)) in out.probes.iter_mut().zip(&order[..listed]) {
            let s = &self.probes[slot].expect("listed probes exist").settings;
            let relative =
                |p: [f64; 3]| -> [f32; 3] { std::array::from_fn(|k| (p[k] - eye[k]) as f32) };
            let [lx, ly, lz] = relative(s.low);
            let [hx, hy, hz] = relative(s.high);
            let [cx, cy, cz] = relative(s.capture);
            *out = [
                [lx, ly, lz, s.blend],
                [hx, hy, hz, s.intensity],
                [cx, cy, cz, (FIRST_IMAGE_LAYER as usize + slot) as f32],
                [f32::from(u8::from(s.box_projection)), 0.0, 0.0, 0.0],
            ];
        }
        out.head = [
            listed as f32,
            (self.levels() - 1) as f32,
            self.size as f32,
            0.0,
        ];
        out
    }

    /// Forgets every map after the thread that draws replaced the GPU: the array is made again,
    /// and every probe captures again.
    pub fn reset_gpu(&mut self) {
        self.made = None;
        self.retired = None;
        self.filter = None;
        self.capturing = None;
        for probe in self.probes.iter_mut().flatten() {
            probe.ready = false;
            probe.due = true;
        }
    }
}

/// Records the creation of the blank texture array of one texel that frame groups bind while the
/// scene has no probe and no light table, which the shaders then do not read.
pub(crate) fn create_blank(list: &mut DrawList, id: u32) -> Result<(), RecordError> {
    list.push(
        Op::CreateTexture,
        &[
            id,
            1,
            1,
            1,
            format::RGBA16_FLOAT,
            texture_usage::TEXTURE_BINDING,
            1,
            1,
            view::D2_ARRAY,
        ],
    )?;
    Ok(())
}

/// The direction that capture view `face` looks along, and its up direction, for the faces of
/// the cube map table that every GPU path shares: +X, -X, +Y, -Y, +Z, -Z. Each view looks along
/// its face's middle direction, with its up direction toward the face's first row. So its right
/// direction runs against the face's columns: the table is mirrored against a camera's view, and
/// the probe's filter turns each image around as it copies it (`probe.wgsl`).
pub const FACES: [([f32; 3], [f32; 3]); 6] = [
    ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    ([-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    ([0.0, 1.0, 0.0], [0.0, 0.0, -1.0]),
    ([0.0, -1.0, 0.0], [0.0, 0.0, 1.0]),
    ([0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
    ([0.0, 0.0, -1.0], [0.0, 1.0, 0.0]),
];

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// Where capture view `face` of a probe that captures from `position` stands and how it sees: a
/// square view of 90 degrees, out to `far`.
pub(crate) fn face_transform(position: [f64; 3], face: usize, far: f32) -> CameraTransform {
    let (forward, up) = FACES[face % 6];
    let right = cross(forward, up);
    let back = forward.map(|v| -v);
    // The camera's axes are the columns of its world matrix's rotation.
    let world: Affine = [
        right[0], up[0], back[0], 0.0, right[1], up[1], back[1], 0.0, right[2], up[2], back[2], 0.0,
    ];
    let lens = Lens::Perspective(Perspective {
        fov_degrees: 90.0,
        near: CAPTURE_NEAR,
        far: far.max(CAPTURE_NEAR * 2.0),
    });
    let (cell, local) = split64(position);
    CameraTransform {
        view_proj: lens.relative_view_projection(&world, 1.0),
        view: lens.relative_view(&world),
        projection: lens.projection(1.0),
        eye: lens.eye(&world),
        cell: CellPosition { cell, local },
        depth: lens.depth(&world),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use null3d_gpu::drawlist::DrawList;

    /// The cube map table of `null3d::cubemap::face_direction`.
    fn face_direction(face: usize, sc: f32, tc: f32) -> [f32; 3] {
        match face {
            0 => [1.0, -tc, -sc],
            1 => [-1.0, -tc, sc],
            2 => [sc, 1.0, tc],
            3 => [sc, -1.0, -tc],
            4 => [sc, -tc, 1.0],
            _ => [-sc, -tc, -1.0],
        }
    }

    #[test]
    fn each_capture_view_sees_its_face_turned_around() {
        for (face, &(forward, up)) in FACES.iter().enumerate() {
            assert_eq!(
                face_direction(face, 0.0, 0.0),
                forward,
                "face {face} looks along it"
            );
            // Up runs toward the face's first row, and right against its columns.
            let down: [f32; 3] = std::array::from_fn(|k| {
                face_direction(face, 0.0, 1.0)[k] - face_direction(face, 0.0, 0.0)[k]
            });
            assert_eq!(up, down.map(|v| -v), "face {face}'s up");
            let across: [f32; 3] = std::array::from_fn(|k| {
                face_direction(face, 1.0, 0.0)[k] - face_direction(face, 0.0, 0.0)[k]
            });
            assert_eq!(
                cross(forward, up),
                across.map(|v| -v),
                "face {face}'s right"
            );
        }
    }

    #[test]
    fn a_capture_view_puts_its_face_center_in_the_middle_of_its_image() {
        for (face, &(forward, _)) in FACES.iter().enumerate() {
            let t = face_transform([10.0, 2.0, -3.0], face, 100.0);
            let m = t.view_proj;
            let clip: [f32; 4] = std::array::from_fn(|row| {
                m[row] * forward[0]
                    + m[4 + row] * forward[1]
                    + m[8 + row] * forward[2]
                    + m[12 + row]
            });
            assert!(clip[3] > 0.0, "face {face} sees ahead");
            assert!((clip[0] / clip[3]).abs() < 1e-5 && (clip[1] / clip[3]).abs() < 1e-5);
            // The face's corner with tc = -1, its first row, lies at the top of the image.
            let d = face_direction(face, 0.0, -1.0);
            let y: f32 = (0..4)
                .map(|k| m[4 * k + 1] * [d[0], d[1], d[2], 1.0][k])
                .sum();
            let w: f32 = (0..4)
                .map(|k| m[4 * k + 3] * [d[0], d[1], d[2], 1.0][k])
                .sum();
            assert!(
                (y / w - 1.0).abs() < 1e-5,
                "face {face}'s first row is at the top"
            );
        }
    }

    fn probe_at(x: f64) -> ProbeSettings {
        ProbeSettings {
            low: [x - 1.0, 0.0, -1.0],
            high: [x + 1.0, 2.0, 1.0],
            capture: [x, 1.0, 0.0],
            ..ProbeSettings::default()
        }
    }

    const TEXTURES: ProbeTextures = ProbeTextures { first: 7 };

    /// The shape the light tables ask of the shared array beside the probes' layers.
    fn light(probes: &Probes) -> Shape {
        Shape {
            size: probes.size(),
            layers: FIRST_IMAGE_LAYER + probes.probe_layers(),
            levels: 1,
        }
    }

    /// One frame of the probes: the capture's pick, the graph's targets, then the record.
    fn frame(probes: &mut Probes, list: &mut DrawList) {
        probes.pick_capture(true);
        probes.set_faces([Some(20); 6]);
        let shape = light(probes);
        probes.record(list, shape).unwrap();
    }

    fn all() -> (CellPosition, Frustum) {
        (
            CellPosition::default(),
            Frustum::from_planes([[0.0, 0.0, 0.0, 1.0]; 6]),
        )
    }

    #[test]
    fn a_probe_captures_and_filters_in_one_frame_then_lights_surfaces() {
        let mut probes = Probes::default();
        probes.set_textures(TEXTURES);
        probes.set_generator(3);
        let mut list = DrawList::with_capacity(1024);
        probes.set(0, probe_at(0.0)).unwrap();
        assert!(probes.waiting());
        frame(&mut probes, &mut list);
        assert_eq!(probes.array(), Some((7, 1)));
        assert_eq!(
            probes.filter(),
            Some([7, 8, 0, 3, 20, 20, 20, 20, 20, 20]),
            "the frame that captures filters"
        );
        assert!(!probes.waiting());
        let (camera, all) = all();
        let listed = probes.list(&camera, &all, false);
        assert_eq!(listed.head, [1.0, 6.0, 256.0, 0.0]);
        assert_eq!(
            listed.probes[0][2],
            [0.0, 1.0, 0.0, 3.0],
            "the probe's layer follows the light tables"
        );
        assert_eq!(
            probes.list(&camera, &all, true).head[0],
            0.0,
            "captures list none"
        );
        frame(&mut probes, &mut list);
        assert_eq!(probes.filter(), None, "a probe captures once");
    }

    #[test]
    fn no_probe_captures_before_the_filter_code_arrives() {
        let mut probes = Probes::default();
        probes.set_textures(TEXTURES);
        let mut list = DrawList::with_capacity(1024);
        probes.set(0, probe_at(0.0)).unwrap();
        frame(&mut probes, &mut list);
        assert_eq!(probes.filter(), None, "no generator yet");
        probes.set_generator(3);
        probes.pick_capture(false);
        let shape = light(&probes);
        probes.record(&mut list, shape).unwrap();
        assert_eq!(probes.filter(), None, "the generator has not arrived");
        frame(&mut probes, &mut list);
        assert!(probes.filter().is_some());
    }

    #[test]
    fn inner_probes_come_first_and_new_layers_make_the_array_again() {
        let mut probes = Probes::default();
        probes.set_textures(TEXTURES);
        probes.set_generator(3);
        let mut list = DrawList::with_capacity(1024);
        let mut big = probe_at(0.0);
        big.low = [-10.0; 3];
        big.high = [10.0; 3];
        probes.set(0, big).unwrap();
        probes.set(1, probe_at(0.0)).unwrap();
        frame(&mut probes, &mut list);
        frame(&mut probes, &mut list);
        let (camera, all) = all();
        let listed = probes.list(&camera, &all, false);
        assert_eq!(listed.head[0], 2.0);
        assert_eq!(
            listed.probes[0][2][3],
            (FIRST_IMAGE_LAYER + 1) as f32,
            "the smaller box first, in the layer after the light tables"
        );
        let generation = probes.array().unwrap().1;
        probes.set(2, probe_at(5.0)).unwrap();
        probes.pick_capture(true);
        probes.set_faces([None; 6]);
        let shape = light(&probes);
        probes.record(&mut list, shape).unwrap();
        assert_ne!(
            probes.array().unwrap().1,
            generation,
            "four layers make a new array"
        );
        assert_eq!(
            probes.list(&camera, &all, false).head[0],
            2.0,
            "the layers are copied, so the ready probes stay ready"
        );
    }

    /// The ids of the textures that a list creates and destroys.
    fn made_and_destroyed(list: &DrawList) -> (Vec<u32>, Vec<u32>) {
        let (mut made, mut destroyed) = (Vec::new(), Vec::new());
        for command in null3d_gpu::drawlist::decode(list.words()) {
            let command = command.unwrap();
            match command.op {
                Op::CreateTexture => made.push(command.operands[0]),
                Op::DestroyTexture => destroyed.push(command.operands[0]),
                _ => {}
            }
        }
        (made, destroyed)
    }

    /// The copies of texture layers that a list records.
    fn copies(list: &DrawList) -> usize {
        null3d_gpu::drawlist::decode(list.words())
            .filter(|command| {
                command
                    .as_ref()
                    .is_ok_and(|c| c.op == Op::CopyTextureToTexture)
            })
            .count()
    }

    #[test]
    fn a_new_array_takes_the_other_ids_and_copies_the_layers() {
        let mut probes = Probes::default();
        probes.set_textures(TEXTURES);
        probes.set_generator(3);
        probes.set(0, probe_at(0.0)).unwrap();
        let mut list = DrawList::with_capacity(1024);
        let shape = light(&probes);
        probes.record(&mut list, shape).unwrap();
        assert_eq!(made_and_destroyed(&list), (vec![7, 8], vec![]));
        probes.set(2, probe_at(5.0)).unwrap();
        let mut list = DrawList::with_capacity(1024);
        let shape = light(&probes);
        probes.record(&mut list, shape).unwrap();
        assert_eq!(
            made_and_destroyed(&list),
            (vec![9, 10], vec![]),
            "the frame that binds the old array keeps it"
        );
        assert!(
            copies(&list) > 0,
            "the layers are copied into the new array"
        );
        assert_eq!(probes.array().unwrap().0, 9);
        // The next frame destroys the ids of the pair it replaced.
        let mut list = DrawList::with_capacity(1024);
        let shape = light(&probes);
        probes.record(&mut list, shape).unwrap();
        assert_eq!(made_and_destroyed(&list), (vec![], vec![7, 8]));
        assert_eq!(probes.array().unwrap().0, 9, "the shared array stays");
    }

    #[test]
    fn a_probe_that_refreshes_always_takes_turns() {
        let mut probes = Probes::default();
        probes.set_textures(TEXTURES);
        probes.set_generator(3);
        let mut list = DrawList::with_capacity(1024);
        let mut always = probe_at(0.0);
        always.always = true;
        probes.set(0, always).unwrap();
        probes.set(3, always).unwrap();
        let mut order = Vec::new();
        for _ in 0..6 {
            frame(&mut probes, &mut list);
            order.push(probes.filter().unwrap()[2]);
        }
        assert_eq!(order, [0, 3, 0, 3, 0, 3]);
    }

    #[test]
    fn sizes_and_levels() {
        let mut probes = Probes::default();
        assert_eq!(
            (probes.size(), probes.levels(), probes.face_size()),
            (256, 7, 128)
        );
        probes.set_size(128);
        assert_eq!(probes.levels(), 6);
        probes.set_size(9999);
        assert_eq!(probes.size(), 512);
        assert!(probes.set(MAX_PROBES, ProbeSettings::default()).is_err());
    }
}

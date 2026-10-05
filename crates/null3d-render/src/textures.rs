//! Textures on the GPU: the 2D texture arrays that textures of one size, format and mip count
//! share, the samplers and bind groups that materials draw them with, and the uploads that fill
//! them.
//!
//! # Arrays and layers
//!
//! Each texture takes one layer of an array whose key is its size, format and mip count. Materials
//! that sample textures of one array with one sampler share one bind group, and each material's
//! entry in the maps table names its layer. An array starts with a few layers and doubles when it
//! fills: the draw list makes the larger texture, copies every mip level of the old one into it,
//! and the next frame's list releases the old one. An array holds at most [`MAX_LAYERS`] layers,
//! the iPad's limit, and a key with more textures starts another array. A texture of several
//! layers has an array of its own, with exactly its layers. So does a texture in a compressed
//! format: compatibility mode copies no compressed texels, so its array could never grow.
//!
//! # Images, data and uploads
//!
//! A texture's texels come from an image or from data. An image travels to the thread that draws
//! on its own, and gets the next image id. That thread counts the images it received, and ids
//! count in the order they were sent, so every id up to the count has arrived. Data lives in
//! engine memory, in a slot of the store, and is ready at once. Uploads take turns in the order
//! the textures got their texels. Each frame uploads at most its byte budget: a large texture goes
//! up a band of rows per frame, or of rows of blocks in a compressed format. Texels that bring
//! their own mip levels, as a KTX2 file's do, upload each level in turn. After a frame's uploads,
//! each texture that finished and asked for mip levels makes them on the GPU. A material draws
//! without its map until the map's texels are on the GPU, so a texture on its way looks like no
//! texture.
//!
//! A capture replays a frame's list a second time. A list therefore never releases what it uses
//! itself, and replaying it again gives the same textures. An image is released by a later
//! frame's list; data is freed once the thread that draws has taken a later frame.
//!
//! Texels of another size move a texture to an array of that size, and so to another bind group.
//!
//! # 3D textures
//!
//! A 3D texture, such as a color grading table (see [`crate::grading`]), has a texture of its own
//! whose layers are its depth slices, and filtering blends between the slices. Its texels come
//! from data alone, a band of rows of a slice at a time, as the layers of an array do. It has no
//! mip levels and no bind group of the store's: the pass that reads it binds it by its GPU id,
//! which [`TextureStore::ready_volume`] gives once its texels are on the GPU.
//!
//! # Cube textures
//!
//! A cube texture, such as an environment map (see [`crate::environment`]), has a texture of its
//! own whose six layers are its faces, in the order +X, -X, +Y, -Y, +Z, -Z. Its texels come from
//! data alone, with every mip level, each level's faces in turn, as a KTX2 file holds them. Like a
//! 3D texture, it has no bind group of the store's: the frame's group binds it by its GPU id, which
//! [`TextureStore::ready_cube`] gives once its texels are on the GPU.
//!
//! A cube texture's texels can also come from a generator, which the thread that draws runs on
//! the GPU, such as the built-in room environment's. A generator takes the next image id and waits
//! for the thread that draws as an image does: that thread counts it once the generator's code has
//! loaded and its pipelines are built, so the generator runs as soon as the list names it. The
//! first frame after the generator arrives records one command that fills every level, outside
//! the upload budget and before the frame's passes, so that frame already draws with the texture.
//! The store keeps the generator, so a new GPU device fills the texture again.
//!
//! Formats come by code, and every byte count goes through [`format::level_bytes`], so formats
//! stored in blocks of texels can join the array keys and the uploads.
//!
//! # A new GPU device
//!
//! The thread that draws closes an image once the frame whose list releases it has run. When the
//! browser replaces the GPU, a texture whose image or data is still there uploads again. A texture
//! whose texels are gone keeps its layer and draws as without a map until it gets new texels.

use null3d_core::error::CoreError;
use null3d_core::frames::frame_after;
use null3d_core::handle::{Handle, SlotAllocator};
use null3d_gpu::caps::{CUBE_TEXTURE_SIZE, TEXTURE_3D_SIZE};
use null3d_gpu::drawlist::{
    DrawList, Op, address, compare, filter, format, layout, resource_kind, texture_usage,
    upload_flags, view,
};

use crate::frame::{RecordError, address as memory_address, words_as_bytes};

/// The most layers in one texture array: WebGPU's default limit, which the iPad keeps.
pub const MAX_LAYERS: u32 = 256;
/// The layers of an array when it is first made.
pub const FIRST_LAYERS: u32 = 4;
/// The most textures that live at once.
pub const MAX_TEXTURES: u32 = 4095;
/// The group of a texture that has no bind group of the store's: a 3D or a cube texture.
const NO_GROUP: u32 = u32::MAX;
/// The bytes that one frame uploads, until the quality preset sets another budget.
pub const DEFAULT_UPLOAD_BUDGET: u32 = 4 * 1024 * 1024;
/// The largest anisotropy that samplers use, until the quality preset caps it lower.
pub const DEFAULT_MAX_ANISOTROPY: u32 = 16;

/// The GPU ids that the store gives its objects, which the frame builder keeps free for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextureIds {
    /// Array `a` takes texture ids `first_texture + 2a` and the one after it, in turn, as it grows.
    pub first_texture: u32,
    /// Sampler `s` has id `first_sampler + s`.
    pub first_sampler: u32,
    /// Bind group `g` has id `first_group + g`.
    pub first_group: u32,
}

/// How a texture is sampled.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Sampling {
    /// The address modes (`address::*`) along u and v.
    pub wrap: [u32; 2],
    /// The filters (`filter::*`) of magnified texels, of minified texels and between mip levels.
    pub mag_filter: u32,
    pub min_filter: u32,
    pub mip_filter: u32,
    /// The anisotropy asked for, 1 for none. Samplers use at most the store's cap, and none when
    /// a filter is nearest.
    pub anisotropy: u32,
}

impl Default for Sampling {
    /// three.js's defaults: clamped at the edges, linear filters, no anisotropy.
    fn default() -> Self {
        Self {
            wrap: [address::CLAMP_TO_EDGE; 2],
            mag_filter: filter::LINEAR,
            min_filter: filter::LINEAR,
            mip_filter: filter::LINEAR,
            anisotropy: 1,
        }
    }
}

/// How a texture's colors hold its alpha. The browser multiplies an image's stored colors by
/// their alpha as it decodes the image, so an sRGB texture's colors are multiplied while encoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Premultiplied {
    /// The colors are straight, or the texture has no image.
    No,
    /// The colors were multiplied by their alpha in sRGB encoding, before sampling decodes them.
    Srgb,
    /// The colors are linear values multiplied by their alpha.
    Linear,
}

/// A texture as its creator describes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextureDesc {
    pub width: u32,
    pub height: u32,
    /// Its layers: 1 for a texture that shares an array with others of its key, and up to
    /// [`MAX_LAYERS`] for a texture with an array of its own.
    pub depth: u32,
    /// `format::RGBA8_UNORM_SRGB` for colors, `format::RGBA8_UNORM` for data,
    /// `format::RGBA16_FLOAT` for data in half floats, which has no mip levels and takes no images,
    /// or a compressed format, whose texels come as data with all their mip levels.
    pub format: u32,
    /// True for a whole chain of mip levels, which the GPU makes from each upload.
    pub mipmaps: bool,
    /// The mip levels that the texture's data brings: 1, or more without `mipmaps`.
    pub levels: u32,
    pub sampling: Sampling,
}

/// Why the store refused a call.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextureError {
    /// The handle names no live texture, or the memory for its data could not grow.
    Core(CoreError),
    /// The texture is wider or taller than `limit` texels, the most that every array allows.
    TooLarge { limit: u32 },
    /// [`MAX_TEXTURES`] textures live already.
    Full,
    /// A format, a sampler setting, a depth or an image size that the texture cannot use.
    Unsupported,
}

/// What the uploads of recent frames did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UploadStats {
    /// Texel bytes that the last recorded frame uploads.
    pub last_frame_bytes: u32,
    /// The most texel bytes that any frame uploaded.
    pub largest_frame_bytes: u32,
    /// Textures whose texels are not on the GPU yet.
    pub waiting: u32,
}

/// Where a texture's texels come from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Source {
    /// Image `id`, which the thread that draws holds, uploaded with the `upload_flags` in `flags`.
    Image { id: u32, flags: u32 },
    /// Tightly packed rows, layer after layer, in the store's data slot `slot`.
    Data { slot: u32 },
    /// Generator `id`, which the thread that draws holds under an image id and runs on the GPU in
    /// one command. The store keeps it until the texture gets other texels or is destroyed, so a
    /// new GPU device runs it again.
    Generated { id: u32 },
}

/// Where a texture is on its way to the GPU.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    /// No texels to upload: none came yet, or they were lost with the GPU.
    Empty,
    /// `source` uploads next, and `rows` of its rows are up, counting through every layer.
    Queued { source: Source, rows: u32 },
    /// `source` is on the GPU. `released_in` is the frame whose recording released it, or 0 while
    /// the store still holds it.
    Uploaded { source: Source, released_in: u32 },
}

/// Texels that the store releases once no list that reads them can run again.
#[derive(Clone, Copy, Debug)]
struct Release {
    source: Source,
    /// The last frame whose list may read the texels. An image is released in a later frame's
    /// list; data is freed once the thread that draws has taken a later frame.
    after: u32,
    /// The texture that the texels went to, which notes the frame of the release, or
    /// `Handle::NONE` for texels that went nowhere.
    texture: Handle,
}

#[derive(Clone, Copy, Debug)]
struct TextureSlot {
    array: u32,
    layer: u32,
    group: u32,
    sampler: u32,
    /// True for a whole chain of mip levels, at any size the texture takes.
    mipmaps: bool,
    /// The mip levels that the texels bring, at most the whole chain of the texture's size.
    levels: u32,
    state: State,
}

impl TextureSlot {
    /// The mip levels of the texture at `width` x `height`: a whole chain that the GPU makes, or
    /// the levels that the texels bring, at most the chain of that size.
    fn mips(&self, width: u32, height: u32) -> u32 {
        let chain = format::full_chain(width, height);
        if self.mipmaps {
            chain
        } else {
            self.levels.min(chain)
        }
    }

    /// The mip levels that the texels of an array of `key` hold: level 0 alone when the GPU makes
    /// the rest, and every level otherwise.
    fn source_levels(&self, key: ArrayKey) -> u32 {
        if self.mipmaps { 1 } else { key.mips }
    }
}

/// How shaders see an array's GPU texture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// Layers of 2D images, which textures of one key share.
    Layers,
    /// A 3D texture, whose layers are its depth slices.
    Volume,
    /// A cube texture, whose six layers are its faces.
    Cube,
}

/// What makes textures share an array.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ArrayKey {
    width: u32,
    height: u32,
    format: u32,
    mips: u32,
    /// The layers of each texture: an array of textures of more than one has one texture.
    depth: u32,
    /// How shaders see the texture. A 3D or a cube texture has a texture of its own.
    kind: Kind,
}

/// Where a band of texels starts: a row of blocks of one layer of one mip level.
#[derive(Clone, Copy, Debug)]
struct Band {
    level: u32,
    layer: u32,
    /// The first row of blocks.
    row: u32,
    /// The rows of blocks from `row` to the end of the layer.
    rows_left: u32,
    row_bytes: u64,
    /// The first row's place in the texels, which hold each level's layers in turn.
    offset: u64,
}

impl ArrayKey {
    fn layer_bytes(&self) -> u64 {
        format::layer_bytes(self.format, self.width, self.height, self.mips)
    }

    /// True when textures share the array. A texture of several layers, of a compressed format,
    /// of three dimensions or of a cube's faces has an array of its own.
    fn shared(&self) -> bool {
        self.depth == 1 && !format::is_compressed(self.format) && self.kind == Kind::Layers
    }

    /// The view dimension that bind groups see the GPU texture as.
    fn view(&self) -> u32 {
        match self.kind {
            Kind::Layers => view::D2_ARRAY,
            Kind::Volume => view::D3,
            Kind::Cube => view::CUBE,
        }
    }

    /// The rows of blocks of the first `levels` mip levels, through every layer.
    fn rows(&self, levels: u32) -> u32 {
        (0..levels)
            .map(|level| format::blocks(self.format, self.height, level) * self.depth)
            .sum()
    }

    /// Where row `rows` falls in texels of `levels` mip levels, which hold the rows of blocks of
    /// each layer of each level in turn. `rows` is below [`Self::rows`] of `levels`.
    fn band(&self, rows: u32, levels: u32) -> Band {
        let (mut first, mut offset) = (0, 0);
        for level in 0..levels {
            let per_layer = format::blocks(self.format, self.height, level);
            let row_bytes = format::row_bytes(self.format, self.width, level);
            if rows < first + per_layer * self.depth {
                let within = rows - first;
                return Band {
                    level,
                    layer: within / per_layer,
                    row: within % per_layer,
                    rows_left: per_layer - within % per_layer,
                    row_bytes,
                    offset: offset + u64::from(within) * row_bytes,
                };
            }
            first += per_layer * self.depth;
            offset += u64::from(per_layer * self.depth) * row_bytes;
        }
        unreachable!("row {rows} is past the texels of {levels} mip levels")
    }
}

#[derive(Debug)]
struct TextureArray {
    key: ArrayKey,
    /// Which layers hold a texture.
    used: [u64; (MAX_LAYERS / 64) as usize],
    /// Layers that hold a texture.
    live: u32,
    /// Layers of the GPU texture, 0 while it has none.
    capacity: u32,
    /// Which of its two texture ids the GPU texture has.
    generation: u32,
}

impl TextureArray {
    /// Marks the texture's layers from `layer` used or free.
    fn mark(&mut self, layer: u32, used: bool) {
        for layer in layer..layer + self.key.depth {
            let bit = 1 << (layer % 64);
            let word = &mut self.used[(layer / 64) as usize];
            if used {
                *word |= bit;
                self.live += 1;
            } else {
                *word &= !bit;
                self.live -= 1;
            }
        }
    }

    /// The lowest free layer for another texture, or `None` when the array takes no more.
    fn free_layer(&self) -> Option<u32> {
        if !self.key.shared() && self.live > 0 {
            return None;
        }
        let (word, bits) = self
            .used
            .iter()
            .enumerate()
            .find(|(_, bits)| **bits != u64::MAX)?;
        Some(word as u32 * 64 + (!bits).trailing_zeros())
    }

    /// One past the highest layer in use.
    fn layers_in_use(&self) -> u32 {
        self.used
            .iter()
            .enumerate()
            .rev()
            .find(|(_, bits)| **bits != 0)
            .map_or(0, |(word, bits)| {
                word as u32 * 64 + 64 - bits.leading_zeros()
            })
    }

    /// The layers that the GPU texture needs: a power of two for arrays that textures share, and
    /// exactly its texture's layers for an array of one texture.
    fn layers_needed(&self) -> u32 {
        let needed = self.layers_in_use();
        if self.key.shared() {
            needed.next_power_of_two().clamp(FIRST_LAYERS, MAX_LAYERS)
        } else {
            needed
        }
    }
}

/// A sampler: what textures ask for, and whether the GPU has it.
#[derive(Clone, Copy, Debug)]
struct SamplerSlot {
    sampling: Sampling,
    created: bool,
}

/// The maps of one map set's bind group, in the order of the material's map slots.
pub const MAP_SET_SLOTS: usize = 6;

/// What a bind group binds: one array and its sampler, or a map set of an array and a sampler
/// for each map slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GroupKey {
    Single {
        array: u32,
        sampler: u32,
    },
    /// Each slot's array, then its sampler.
    Maps([(u32, u32); MAP_SET_SLOTS]),
}

impl GroupKey {
    fn binds_array(&self, array: u32) -> bool {
        match self {
            GroupKey::Single { array: a, .. } => *a == array,
            GroupKey::Maps(slots) => slots.iter().any(|&(a, _)| a == array),
        }
    }
}

/// A bind group, and whether the GPU has it.
#[derive(Clone, Copy, Debug)]
struct GroupSlot {
    key: GroupKey,
    created: bool,
}

/// Every texture, the arrays that hold them, their samplers and bind groups, and their uploads.
pub struct TextureStore {
    ids: TextureIds,
    /// The widest and tallest texture: the portable budget, or less where the device allows less.
    max_size: u32,
    handles: SlotAllocator,
    /// Each texture, by slot.
    textures: Vec<TextureSlot>,
    arrays: Vec<TextureArray>,
    samplers: Vec<SamplerSlot>,
    groups: Vec<GroupSlot>,
    /// Texels in engine memory, by data slot; a free slot holds no memory.
    data: Vec<Vec<u32>>,
    /// The textures with texels to upload, in the order they got them.
    queue: Vec<Handle>,
    /// Texels to release once no list that reads them can run again.
    releases: Vec<Release>,
    /// Array textures that an array outgrew, which the next frame's list destroys.
    retired: Vec<u32>,
    /// Each finished upload of the frame being recorded: its array's texture id, and its layer.
    finished: Vec<(u32, u32)>,
    /// The last image id handed out; ids count from 1.
    last_image: u32,
    /// The images that the thread that draws received.
    arrived: u32,
    /// The newest frame that the thread that draws took.
    frames_taken: u32,
    /// The last frame recorded.
    recorded: u32,
    budget: u32,
    /// True while the next frame uploads everything, whatever its budget.
    unbudgeted: bool,
    max_anisotropy: u32,
    /// True when a map became ready or stopped drawing since the last check.
    layers_changed: bool,
    stats: UploadStats,
    /// A white texture of one texel, which the empty slots of map sets bind, once a map set
    /// needs it.
    placeholder: Handle,
}

impl TextureStore {
    /// A store whose GPU objects take ids from `ids`, for textures of at most `max_size` texels
    /// on each side.
    pub fn new(ids: TextureIds, max_size: u32) -> Self {
        Self {
            ids,
            max_size,
            handles: SlotAllocator::with_capacity(MAX_TEXTURES),
            textures: Vec::new(),
            arrays: Vec::new(),
            samplers: Vec::new(),
            groups: Vec::new(),
            data: Vec::new(),
            queue: Vec::new(),
            releases: Vec::new(),
            retired: Vec::new(),
            finished: Vec::new(),
            last_image: 0,
            arrived: 0,
            frames_taken: 0,
            recorded: 0,
            budget: DEFAULT_UPLOAD_BUDGET,
            unbudgeted: false,
            max_anisotropy: DEFAULT_MAX_ANISOTROPY,
            layers_changed: false,
            stats: UploadStats::default(),
            placeholder: Handle::NONE,
        }
    }

    /// The widest and tallest texture the store takes.
    pub fn max_size(&self) -> u32 {
        self.max_size
    }

    fn slot(&self, texture: Handle) -> Result<&TextureSlot, TextureError> {
        let slot = self.handles.resolve(texture).map_err(TextureError::Core)?;
        Ok(&self.textures[slot as usize])
    }

    fn slot_mut(&mut self, texture: Handle) -> Result<&mut TextureSlot, TextureError> {
        let slot = self.handles.resolve(texture).map_err(TextureError::Core)?;
        Ok(&mut self.textures[slot as usize])
    }

    /// The GPU texture id of an array.
    fn array_id(&self, array: u32) -> u32 {
        self.ids.first_texture + 2 * array + self.arrays[array as usize].generation
    }

    /// Checks a size of a format against the store's limit. A compressed texture holds whole
    /// blocks, as WebGPU requires.
    fn check_size(&self, format: u32, width: u32, height: u32) -> Result<(), TextureError> {
        let limit = self.max_size;
        if width > limit || height > limit {
            return Err(TextureError::TooLarge { limit });
        }
        let block = format::block_size(format);
        if width == 0
            || height == 0
            || !width.is_multiple_of(block)
            || !height.is_multiple_of(block)
        {
            return Err(TextureError::Unsupported);
        }
        Ok(())
    }

    /// Creates a texture with no texels yet, in a free layer of an array of its key.
    pub fn create(&mut self, desc: TextureDesc) -> Result<Handle, TextureError> {
        self.create_in(desc, Kind::Layers)
    }

    /// Creates a 3D texture of `width` x `height` x `depth` texels in `format::RGBA8_UNORM` or
    /// `format::RGBA16_FLOAT`, with no texels yet, read with a linear filter and clamped at its
    /// edges. Each side takes at most [`TEXTURE_3D_SIZE`] texels, the least that WebGL2 allows.
    pub fn create_volume(
        &mut self,
        width: u32,
        height: u32,
        depth: u32,
        format: u32,
    ) -> Result<Handle, TextureError> {
        let limit = TEXTURE_3D_SIZE;
        if width > limit || height > limit || depth > limit {
            return Err(TextureError::TooLarge { limit });
        }
        if !matches!(format, format::RGBA8_UNORM | format::RGBA16_FLOAT) {
            return Err(TextureError::Unsupported);
        }
        let desc = TextureDesc {
            width,
            height,
            depth,
            format,
            mipmaps: false,
            levels: 1,
            sampling: Sampling::default(),
        };
        self.create_in(desc, Kind::Volume)
    }

    /// Creates a cube texture with faces of `size` x `size` texels in `format::RGB9E5_UFLOAT` or
    /// `format::RGBA16_FLOAT`, with `levels` mip levels and no texels yet. It is read with linear
    /// filters within and between levels, and its texels bring every level. A face takes at most
    /// [`CUBE_TEXTURE_SIZE`] texels a side, the least that WebGL2 allows.
    pub fn create_cube(
        &mut self,
        size: u32,
        levels: u32,
        format: u32,
    ) -> Result<Handle, TextureError> {
        let limit = CUBE_TEXTURE_SIZE.min(self.max_size);
        if size > limit {
            return Err(TextureError::TooLarge { limit });
        }
        if !matches!(format, format::RGB9E5_UFLOAT | format::RGBA16_FLOAT) {
            return Err(TextureError::Unsupported);
        }
        let desc = TextureDesc {
            width: size,
            height: size,
            depth: view::CUBE_FACES,
            format,
            mipmaps: false,
            levels,
            sampling: Sampling::default(),
        };
        self.create_in(desc, Kind::Cube)
    }

    /// Creates a texture of `desc` that shaders see as `kind`.
    fn create_in(&mut self, desc: TextureDesc, kind: Kind) -> Result<Handle, TextureError> {
        self.check_size(desc.format, desc.width, desc.height)?;
        let sampling = desc.sampling;
        let known = |code: u32, last: u32| code <= last;
        let levels = (1..=format::full_chain(desc.width, desc.height)).contains(&desc.levels)
            && !(desc.mipmaps && desc.levels > 1);
        let supported = (1..=MAX_LAYERS).contains(&desc.depth)
            && levels
            && match desc.format {
                format::RGBA8_UNORM | format::RGBA8_UNORM_SRGB => true,
                format::RGBA16_FLOAT => !desc.mipmaps,
                format::RGB9E5_UFLOAT => kind == Kind::Cube,
                code => format::is_compressed(code) && !desc.mipmaps,
            }
            && sampling
                .wrap
                .iter()
                .all(|&mode| known(mode, address::MIRROR_REPEAT))
            && [
                sampling.mag_filter,
                sampling.min_filter,
                sampling.mip_filter,
            ]
            .iter()
            .all(|&mode| known(mode, filter::LINEAR))
            && sampling.anisotropy >= 1;
        if !supported {
            return Err(TextureError::Unsupported);
        }
        let handle = self.handles.reserve().map_err(|_| TextureError::Full)?;
        let sampler = self.sampler_for(sampling);
        let mut slot = TextureSlot {
            array: 0,
            layer: 0,
            group: 0,
            sampler,
            mipmaps: desc.mipmaps,
            levels: desc.levels,
            state: State::Empty,
        };
        let key = ArrayKey {
            width: desc.width,
            height: desc.height,
            format: desc.format,
            mips: slot.mips(desc.width, desc.height),
            depth: desc.depth,
            kind,
        };
        self.settle(&mut slot, key);
        let index = handle.slot() as usize;
        if self.textures.len() <= index {
            self.textures.resize(index + 1, slot);
        }
        self.textures[index] = slot;
        Ok(handle)
    }

    /// Gives a texture a layer of an array of `key`, and the bind group of that array and its
    /// sampler, or none for a 3D or a cube texture.
    fn settle(&mut self, slot: &mut TextureSlot, key: ArrayKey) {
        let (array, layer) = self.place(key);
        self.arrays[array as usize].mark(layer, true);
        slot.array = array;
        slot.layer = layer;
        slot.group = if key.kind != Kind::Layers {
            NO_GROUP
        } else {
            self.group_for(array, slot.sampler)
        };
    }

    /// The array and the layer for a new texture of `key`: the lowest free layer of the first
    /// array of the key with room, or the first layer of a new array.
    fn place(&mut self, key: ArrayKey) -> (u32, u32) {
        for (index, array) in self.arrays.iter().enumerate() {
            if array.key == key
                && let Some(layer) = array.free_layer()
            {
                return (index as u32, layer);
            }
        }
        self.arrays.push(TextureArray {
            key,
            used: [0; (MAX_LAYERS / 64) as usize],
            live: 0,
            capacity: 0,
            generation: 0,
        });
        (self.arrays.len() as u32 - 1, 0)
    }

    fn sampler_for(&mut self, sampling: Sampling) -> u32 {
        if let Some(index) = self.samplers.iter().position(|s| s.sampling == sampling) {
            return index as u32;
        }
        self.samplers.push(SamplerSlot {
            sampling,
            created: false,
        });
        self.samplers.len() as u32 - 1
    }

    fn group_for(&mut self, array: u32, sampler: u32) -> u32 {
        self.group_of_key(GroupKey::Single { array, sampler })
    }

    /// The index of the bind group of `key`, which is new when no group binds it yet.
    fn group_of_key(&mut self, key: GroupKey) -> u32 {
        if let Some(index) = self.groups.iter().position(|g| g.key == key) {
            return index as u32;
        }
        self.groups.push(GroupSlot {
            key,
            created: false,
        });
        self.groups.len() as u32 - 1
    }

    /// The GPU id of the bind group that samples a material's maps, one per map slot: each live
    /// texture's array with its sampler, and a white texel where a slot has none. Materials whose
    /// maps share arrays and samplers share the group. A texture that moves to another array needs
    /// its material's group again.
    pub fn map_set_group(&mut self, maps: &[Handle; MAP_SET_SLOTS]) -> Result<u32, TextureError> {
        if !self.is_live(self.placeholder) {
            self.placeholder = self.create(TextureDesc {
                width: 1,
                height: 1,
                depth: 1,
                format: format::RGBA8_UNORM,
                mipmaps: false,
                levels: 1,
                sampling: Sampling::default(),
            })?;
            let (texels, _) = self.set_data(self.placeholder, 1, 1)?;
            texels.fill(u32::MAX);
        }
        let empty = *self.slot(self.placeholder)?;
        let mut slots = [(empty.array, empty.sampler); MAP_SET_SLOTS];
        for (slot, &map) in slots.iter_mut().zip(maps) {
            if let Ok(texture) = self.slot(map)
                && texture.group != NO_GROUP
            {
                *slot = (texture.array, texture.sampler);
            }
        }
        Ok(self.ids.first_group + self.group_of_key(GroupKey::Maps(slots)))
    }

    /// Gives a texture a new image of `width` x `height` pixels, uploaded with the
    /// `upload_flags` in `flags`, and returns the image's id, with true when the texture moved to
    /// an array of the image's size. The caller sends the image to the thread that draws under
    /// that id, in the order of the ids. Texels that were waiting are released unused.
    pub fn set_image(
        &mut self,
        texture: Handle,
        width: u32,
        height: u32,
        flags: u32,
    ) -> Result<(u32, bool), TextureError> {
        let slot = *self.slot(texture)?;
        let key = self.arrays[slot.array as usize].key;
        let layers = key.kind == Kind::Layers;
        if key.depth > 1 || !layers || !format::makes_mipmaps(key.format) || slot.levels > 1 {
            return Err(TextureError::Unsupported);
        }
        let moved = self.resize(texture, width, height)?;
        self.last_image += 1;
        let id = self.last_image;
        self.queue_source(texture, Source::Image { id, flags })?;
        Ok((id, moved))
    }

    /// Gives a cube texture of `format::RGB9E5_UFLOAT` texels that a generator makes on the GPU,
    /// all in the first frame after the generator arrives, and returns the generator's id, which it
    /// takes from the images' ids. The caller sends the generator to the thread that draws under
    /// that id, in the order of the ids, as it sends images. Texels that were waiting are released
    /// unused.
    pub fn set_generated(&mut self, texture: Handle) -> Result<u32, TextureError> {
        let slot = *self.slot(texture)?;
        let key = self.arrays[slot.array as usize].key;
        if key.kind != Kind::Cube || key.format != format::RGB9E5_UFLOAT {
            return Err(TextureError::Unsupported);
        }
        self.last_image += 1;
        let id = self.last_image;
        self.queue_source(texture, Source::Generated { id })?;
        Ok(id)
    }

    /// Gives a texture new texels of `width` x `height` in each of its layers, and returns the
    /// words that the caller fills with them, with true when the texture moved to an array of that
    /// size. The texels are tightly packed rows, of blocks in a compressed format, layer after
    /// layer, and level after level when they bring their own mip levels. Texels that were waiting
    /// are released unused.
    pub fn set_data(
        &mut self,
        texture: Handle,
        width: u32,
        height: u32,
    ) -> Result<(&mut [u32], bool), TextureError> {
        let slot = *self.slot(texture)?;
        let key = self.arrays[slot.array as usize].key;
        self.check_size(key.format, width, height)?;
        let levels = if slot.mipmaps {
            1
        } else {
            slot.mips(width, height)
        };
        let bytes = format::layer_bytes(key.format, width, height, levels) * u64::from(key.depth);
        let words = usize::try_from(bytes.div_ceil(4)).map_err(|_| out_of_memory(bytes))?;
        let mut data = Vec::new();
        data.try_reserve_exact(words)
            .map_err(|_| out_of_memory(bytes))?;
        data.resize(words, 0);
        let moved = self.resize(texture, width, height)?;
        let slot = match self.data.iter().position(|d| d.capacity() == 0) {
            Some(slot) => slot,
            None => {
                self.data.push(Vec::new());
                self.data.len() - 1
            }
        };
        self.data[slot] = data;
        self.queue_source(texture, Source::Data { slot: slot as u32 })?;
        Ok((&mut self.data[slot], moved))
    }

    /// Moves a texture to an array of `width` x `height` when its size is another, and returns
    /// true when it moved. Its bind group then changes, and its old layer is free.
    fn resize(&mut self, texture: Handle, width: u32, height: u32) -> Result<bool, TextureError> {
        let mut slot = *self.slot(texture)?;
        let key = self.arrays[slot.array as usize].key;
        if (width, height) == (key.width, key.height) {
            return Ok(false);
        }
        self.check_size(key.format, width, height)?;
        self.arrays[slot.array as usize].mark(slot.layer, false);
        let key = ArrayKey {
            width,
            height,
            mips: slot.mips(width, height),
            ..key
        };
        self.settle(&mut slot, key);
        *self.slot_mut(texture)? = slot;
        self.layers_changed = true;
        Ok(true)
    }

    /// Makes `source` the texels that a texture uploads next, and releases texels that were
    /// waiting.
    fn queue_source(&mut self, texture: Handle, source: Source) -> Result<(), TextureError> {
        let slot = self.slot_mut(texture)?;
        let old = slot.state;
        slot.state = State::Queued { source, rows: 0 };
        match old {
            State::Queued { source, .. } => self.release_unused(source),
            State::Uploaded { source, .. } => {
                if let Source::Generated { .. } = source {
                    self.release_unused(source);
                }
                self.layers_changed = true;
                self.queue.push(texture);
            }
            State::Empty => self.queue.push(texture),
        }
        Ok(())
    }

    /// Destroys a texture in frame `frame`: its layer is free for the next texture of its key,
    /// and texels that are still waiting are released.
    pub fn destroy(&mut self, texture: Handle, frame: u32) -> Result<(), TextureError> {
        let slot = *self.slot(texture)?;
        self.handles
            .release(texture, frame)
            .map_err(TextureError::Core)?;
        match slot.state {
            State::Queued { source, .. } => {
                self.release_unused(source);
                self.queue.retain(|&queued| queued != texture);
            }
            State::Uploaded { source, .. } => {
                if let Source::Generated { .. } = source {
                    self.release_unused(source);
                }
                self.layers_changed = true;
            }
            State::Empty => {}
        }
        self.arrays[slot.array as usize].mark(slot.layer, false);
        Ok(())
    }

    /// Releases texels that went to no texture: an image in the next frame's list, and data once
    /// the lists recorded so far cannot run again.
    fn release_unused(&mut self, source: Source) {
        self.releases.push(Release {
            source,
            after: match source {
                Source::Image { .. } | Source::Generated { .. } => 0,
                Source::Data { .. } => self.recorded,
            },
            texture: Handle::NONE,
        });
    }

    /// True when the handle names a live texture.
    pub fn is_live(&self, texture: Handle) -> bool {
        self.handles.is_live(texture)
    }

    /// The layer that a material samples a texture from, once its texels are on the GPU.
    pub fn ready_layer(&self, texture: Handle) -> Option<u32> {
        let slot = self.slot(texture).ok()?;
        matches!(slot.state, State::Uploaded { .. }).then_some(slot.layer)
    }

    /// Whether a texture's texels on the GPU come from an image that holds colors multiplied by
    /// their alpha, and in which encoding the colors were multiplied.
    pub fn premultiplied(&self, texture: Handle) -> Premultiplied {
        let Ok(slot) = self.slot(texture) else {
            return Premultiplied::No;
        };
        match slot.state {
            State::Uploaded {
                source: Source::Image { flags, .. },
                ..
            } if flags & upload_flags::PREMULTIPLIED_ALPHA != 0 => {
                if self.arrays[slot.array as usize].key.format == format::RGBA8_UNORM_SRGB {
                    Premultiplied::Srgb
                } else {
                    Premultiplied::Linear
                }
            }
            _ => Premultiplied::No,
        }
    }

    /// The GPU id of the bind group that samples a live texture: its array with its sampler. A 3D
    /// texture has none.
    pub fn group_id(&self, texture: Handle) -> Option<u32> {
        let slot = self.slot(texture).ok()?;
        (slot.group != NO_GROUP).then(|| self.ids.first_group + slot.group)
    }

    /// The GPU id of a 3D texture and its size in texels along each axis, once its texels are on
    /// the GPU.
    pub fn ready_volume(&self, texture: Handle) -> Option<(u32, [u32; 3])> {
        let slot = self.slot(texture).ok()?;
        let key = self.arrays[slot.array as usize].key;
        (key.kind == Kind::Volume && matches!(slot.state, State::Uploaded { .. })).then(|| {
            (
                self.array_id(slot.array),
                [key.width, key.height, key.depth],
            )
        })
    }

    /// The GPU id of a cube texture and its mip levels, once its texels are on the GPU.
    pub fn ready_cube(&self, texture: Handle) -> Option<(u32, u32)> {
        let slot = self.slot(texture).ok()?;
        let key = self.arrays[slot.array as usize].key;
        (key.kind == Kind::Cube && matches!(slot.state, State::Uploaded { .. }))
            .then(|| (self.array_id(slot.array), key.mips))
    }

    /// The GPU bytes of a texture: its layers, with every mip level.
    pub fn bytes(&self, texture: Handle) -> Result<u64, TextureError> {
        let key = self.arrays[self.slot(texture)?.array as usize].key;
        Ok(key.layer_bytes() * u64::from(key.depth))
    }

    /// The GPU bytes that every array holds, its free layers included.
    pub fn memory_bytes(&self) -> u64 {
        self.arrays
            .iter()
            .map(|array| u64::from(array.capacity) * array.key.layer_bytes())
            .sum()
    }

    /// Sets the bytes that one frame may upload.
    pub fn set_budget(&mut self, bytes: u32) {
        self.budget = bytes;
    }

    /// The bytes that one frame may upload.
    pub fn budget(&self) -> u32 {
        self.budget
    }

    /// Makes the next recorded frame upload every texel that is ready, whatever its budget, as a
    /// held frame, the only one drawn, must.
    pub fn upload_all_next_frame(&mut self) {
        self.unbudgeted = true;
    }

    /// Caps the anisotropy of every sampler, which the GPU makes again when the cap changes.
    pub fn set_max_anisotropy(&mut self, cap: u32) {
        let cap = cap.max(1);
        if cap == self.max_anisotropy {
            return;
        }
        self.max_anisotropy = cap;
        for sampler in &mut self.samplers {
            sampler.created = false;
        }
        for group in &mut self.groups {
            group.created = false;
        }
    }

    /// The largest anisotropy that samplers use.
    pub fn max_anisotropy(&self) -> u32 {
        self.max_anisotropy
    }

    /// Notes what the thread that draws has: the images it received, and the newest frame it took.
    pub fn sync(&mut self, images_arrived: u32, frames_taken: u32) {
        self.arrived = images_arrived;
        self.frames_taken = frames_taken;
    }

    /// The last image id handed out, which is the number of images sent so far.
    pub fn images_sent(&self) -> u32 {
        self.last_image
    }

    /// What the uploads did.
    pub fn stats(&self) -> UploadStats {
        UploadStats {
            waiting: self.queue.len() as u32,
            ..self.stats
        }
    }

    /// True once after a map became ready to draw or stopped drawing, so the maps table uploads
    /// again.
    pub fn take_layers_changed(&mut self) -> bool {
        std::mem::take(&mut self.layers_changed)
    }

    /// Records the frame's texture work: arrays made or grown, releases, uploads within the
    /// budget, mip levels, samplers and bind groups. Returns true when it made a bind group
    /// again, which render bundles that bind it must see.
    pub fn record(&mut self, list: &mut DrawList, frame: u32) -> Result<bool, RecordError> {
        self.recorded = frame;
        for &id in &self.retired {
            list.push(Op::DestroyTexture, &[id])?;
        }
        self.retired.clear();
        let copied = self.size_arrays(list)?;
        if copied {
            // The copies land before the uploads that follow, which WebGPU would otherwise run
            // first, and which may fill layers that the copies write.
            list.push(Op::Submit, &[])?;
        }
        self.record_releases(list, frame)?;
        self.upload(list, frame)?;
        for &(id, layer) in &self.finished {
            list.push(Op::GenerateMipmaps, &[id, layer])?;
        }
        self.create_samplers(list)?;
        self.create_groups(list)
    }

    /// Makes each array's GPU texture big enough for its layers in use, copying what a smaller
    /// one held, and releases the texture of an array that holds none. Returns true when it
    /// copied.
    fn size_arrays(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        let mut copied = false;
        for index in 0..self.arrays.len() as u32 {
            let array = &self.arrays[index as usize];
            let (key, old_capacity) = (array.key, array.capacity);
            if array.live == 0 {
                if old_capacity > 0 {
                    list.push(Op::DestroyTexture, &[self.array_id(index)])?;
                    self.arrays[index as usize].capacity = 0;
                    self.forget_groups_of(index);
                }
                continue;
            }
            if array.layers_in_use() <= old_capacity {
                continue;
            }
            let capacity = array.layers_needed();
            let old_id = self.array_id(index);
            let new_id = if old_capacity > 0 {
                self.arrays[index as usize].generation ^= 1;
                self.array_id(index)
            } else {
                old_id
            };
            // Images upload into and mip levels draw into a texture that textures share, and a
            // larger one copies its layers. A compressed texture, a 3D texture and a cube texture
            // take writes only.
            let usage = if format::is_compressed(key.format) || key.kind != Kind::Layers {
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST
            } else {
                texture_usage::TEXTURE_BINDING
                    | texture_usage::COPY_DST
                    | texture_usage::COPY_SRC
                    | texture_usage::RENDER_ATTACHMENT
            };
            list.push(
                Op::CreateTexture,
                &[
                    new_id,
                    key.width,
                    key.height,
                    capacity,
                    key.format,
                    usage,
                    1,
                    key.mips,
                    key.view(),
                ],
            )?;
            if old_capacity > 0 {
                for level in 0..key.mips {
                    let width = format::level_size(key.width, level);
                    let height = format::level_size(key.height, level);
                    list.push(
                        Op::CopyTextureToTexture,
                        &[
                            old_id,
                            level,
                            0,
                            0,
                            0,
                            new_id,
                            level,
                            0,
                            0,
                            0,
                            width,
                            height,
                            old_capacity,
                        ],
                    )?;
                }
                self.retired.push(old_id);
                copied = true;
            }
            self.arrays[index as usize].capacity = capacity;
            self.forget_groups_of(index);
        }
        Ok(copied)
    }

    /// Releases the texels that no list of this frame or a later one reads, and notes the frame
    /// of the release on their texture. The thread that draws must hold an image before a list
    /// releases it, and must have taken a frame after the last list that reads data before the
    /// data is freed.
    fn record_releases(&mut self, list: &mut DrawList, frame: u32) -> Result<(), RecordError> {
        let (arrived, taken) = (self.arrived, self.frames_taken);
        let due = |r: &Release| match r.source {
            Source::Image { id, .. } | Source::Generated { id, .. } => {
                id <= arrived && (r.after == 0 || frame_after(frame, r.after))
            }
            Source::Data { .. } => frame_after(taken, r.after),
        };
        for release in self.releases.iter().filter(|r| due(r)) {
            match release.source {
                Source::Image { id, .. } | Source::Generated { id, .. } => {
                    list.push(Op::ReleaseImage, &[id])?;
                }
                Source::Data { slot } => self.data[slot as usize] = Vec::new(),
            }
            if let Ok(slot) = self.handles.resolve(release.texture) {
                let state = &mut self.textures[slot as usize].state;
                if let State::Uploaded { source, .. } = *state
                    && source == release.source
                {
                    *state = State::Uploaded {
                        source,
                        released_in: frame,
                    };
                }
            }
        }
        self.releases.retain(|r| !due(r));
        Ok(())
    }

    fn forget_groups_of(&mut self, array: u32) {
        for group in self.groups.iter_mut().filter(|g| g.key.binds_array(array)) {
            group.created = false;
        }
    }

    /// Uploads waiting texels in the order the textures got them, until the frame's budget is
    /// spent: a band of rows of blocks of one layer of one mip level at a time. Each frame uploads
    /// at least one row, so a budget below a row still makes progress. Notes each layer of a
    /// texture whose last rows went up, and whose GPU makes its mip levels, in [`Self::finished`].
    fn upload(&mut self, list: &mut DrawList, frame: u32) -> Result<(), RecordError> {
        self.finished.clear();
        let budget = if self.unbudgeted {
            u64::MAX
        } else {
            u64::from(self.budget)
        };
        self.unbudgeted = false;
        let mut spent: u64 = 0;
        let mut spent_all = false;
        for k in 0..self.queue.len() {
            if spent_all {
                break;
            }
            let handle = self.queue[k];
            let Ok(index) = self.handles.resolve(handle) else {
                continue;
            };
            let slot = self.textures[index as usize];
            let State::Queued { source, mut rows } = slot.state else {
                continue;
            };
            if let Source::Image { id, .. } | Source::Generated { id, .. } = source
                && id > self.arrived
            {
                continue;
            }
            let key = self.arrays[slot.array as usize].key;
            let id = self.array_id(slot.array);
            let levels = slot.source_levels(key);
            let block = format::block_size(key.format);
            let total = match source {
                Source::Generated { .. } => 1,
                _ => key.rows(levels),
            };
            if let Source::Generated { id: generator } = source {
                // The generator makes the whole map in one command, outside the upload budget, so
                // the frame that records it already draws with the map.
                list.push(Op::GenerateTexture, &[id, generator])?;
                rows = total;
            }
            while rows < total {
                let band = key.band(rows, levels);
                let left = budget.saturating_sub(spent);
                let mut take = u64::from(band.rows_left).min(left / band.row_bytes) as u32;
                if take == 0 {
                    if spent > 0 {
                        spent_all = true;
                        break;
                    }
                    take = 1;
                }
                let layer = slot.layer + band.layer;
                let y = band.row * block;
                if let Source::Image { id: image, flags } = source {
                    list.push(
                        Op::UploadImage,
                        &[id, 0, 0, y, layer, key.width, take, image, flags, 0, y],
                    )?;
                } else if let Source::Data { slot: data } = source {
                    let bytes = words_as_bytes(&self.data[data as usize]);
                    let length = u64::from(take) * band.row_bytes;
                    let texels = &bytes[band.offset as usize..(band.offset + length) as usize];
                    // The last row of blocks may reach past the level's edge.
                    let level_height = format::level_size(key.height, band.level);
                    list.push(
                        Op::WriteTexture,
                        &[
                            id,
                            band.level,
                            0,
                            y,
                            layer,
                            format::level_size(key.width, band.level),
                            (take * block).min(level_height - y),
                            1,
                            memory_address(texels),
                            length as u32,
                        ],
                    )?;
                }
                spent += u64::from(take) * band.row_bytes;
                rows += take;
            }
            self.textures[index as usize].state = if rows == total {
                if slot.mipmaps && key.mips > 1 {
                    for layer in slot.layer..slot.layer + key.depth {
                        self.finished.push((id, layer));
                    }
                }
                // A generator stays for a new GPU device, which runs it again.
                if !matches!(source, Source::Generated { .. }) {
                    self.releases.push(Release {
                        source,
                        after: frame,
                        texture: handle,
                    });
                }
                self.layers_changed = true;
                State::Uploaded {
                    source,
                    released_in: 0,
                }
            } else {
                State::Queued { source, rows }
            };
        }
        let handles = &self.handles;
        let textures = &self.textures;
        self.queue.retain(|&handle| {
            handles
                .resolve(handle)
                .is_ok_and(|index| matches!(textures[index as usize].state, State::Queued { .. }))
        });
        let spent = spent.min(u64::from(u32::MAX)) as u32;
        self.stats.last_frame_bytes = spent;
        self.stats.largest_frame_bytes = self.stats.largest_frame_bytes.max(spent);
        Ok(())
    }

    fn create_samplers(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        let cap = self.max_anisotropy;
        for (index, sampler) in self.samplers.iter_mut().enumerate() {
            if sampler.created {
                continue;
            }
            let s = sampler.sampling;
            let linear = [s.mag_filter, s.min_filter, s.mip_filter]
                .iter()
                .all(|&f| f == filter::LINEAR);
            let anisotropy = if linear { s.anisotropy.min(cap) } else { 1 };
            list.push(
                Op::CreateSampler,
                &[
                    self.ids.first_sampler + index as u32,
                    s.wrap[0],
                    s.wrap[1],
                    address::CLAMP_TO_EDGE,
                    s.mag_filter,
                    s.min_filter,
                    s.mip_filter,
                    0f32.to_bits(),
                    32f32.to_bits(),
                    compare::NONE,
                    anisotropy,
                ],
            )?;
            sampler.created = true;
        }
        Ok(())
    }

    /// Makes each bind group of an array whose GPU texture exists, when the GPU lacks it or holds
    /// it for an older texture. Returns true when it made any.
    fn create_groups(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        let mut made = false;
        for index in 0..self.groups.len() {
            let group = self.groups[index];
            let without_texture = |array: u32| self.arrays[array as usize].capacity == 0;
            let id = self.ids.first_group + index as u32;
            match group.key {
                _ if group.created => continue,
                GroupKey::Single { array, sampler } => {
                    if without_texture(array) {
                        continue;
                    }
                    list.push(
                        Op::CreateBindGroup,
                        &[
                            id,
                            layout::TEXTURES,
                            2,
                            0,
                            resource_kind::TEXTURE,
                            self.array_id(array),
                            0,
                            0,
                            1,
                            resource_kind::SAMPLER,
                            self.ids.first_sampler + sampler,
                            0,
                            0,
                        ],
                    )?;
                }
                GroupKey::Maps(slots) => {
                    if slots.iter().any(|&(array, _)| without_texture(array)) {
                        continue;
                    }
                    // Each slot's array at the binding of its slot, then each slot's sampler
                    // after every array.
                    let mut words = [0; 3 + 2 * MAP_SET_SLOTS * 5];
                    words[..3].copy_from_slice(&[
                        id,
                        layout::MATERIAL_MAPS,
                        2 * MAP_SET_SLOTS as u32,
                    ]);
                    for (k, &(array, sampler)) in slots.iter().enumerate() {
                        let texture = 3 + 5 * k;
                        words[texture..texture + 5].copy_from_slice(&[
                            k as u32,
                            resource_kind::TEXTURE,
                            self.array_id(array),
                            0,
                            0,
                        ]);
                        let at = 3 + 5 * (MAP_SET_SLOTS + k);
                        words[at..at + 5].copy_from_slice(&[
                            (MAP_SET_SLOTS + k) as u32,
                            resource_kind::SAMPLER,
                            self.ids.first_sampler + sampler,
                            0,
                            0,
                        ]);
                    }
                    list.push(Op::CreateBindGroup, &words)?;
                }
            }
            self.groups[index].created = true;
            made = true;
        }
        Ok(made)
    }

    /// Forgets every GPU object after the thread that draws replaced the GPU. Textures whose
    /// images the thread still holds, or whose data the store still holds, upload again from the
    /// start; the rest wait for new texels.
    pub fn reset_gpu(&mut self) {
        self.retired.clear();
        for array in &mut self.arrays {
            array.capacity = 0;
            array.generation = 0;
        }
        for sampler in &mut self.samplers {
            sampler.created = false;
        }
        for group in &mut self.groups {
            group.created = false;
        }
        let taken = self.frames_taken;
        for slot in self.handles.live().iter_ones() {
            let texture = &mut self.textures[slot as usize];
            let held = |source: Source, released_in: u32| match source {
                // The list that releases the image never ran, so the image is still there.
                Source::Image { .. } => released_in == 0 || released_in > taken,
                // The store frees data as it records the release.
                Source::Data { .. } => released_in == 0,
                // The store keeps a generator until the texture no longer uses it.
                Source::Generated { .. } => true,
            };
            texture.state = match texture.state {
                State::Queued { source, .. } => State::Queued { source, rows: 0 },
                State::Uploaded {
                    source,
                    released_in,
                } if held(source, released_in) => {
                    self.releases.retain(|release| release.source != source);
                    let generation = u32::from(self.handles.generations()[slot as usize]);
                    self.queue.push(Handle::new(slot, generation));
                    State::Queued { source, rows: 0 }
                }
                State::Uploaded { .. } | State::Empty => State::Empty,
            };
        }
        self.layers_changed = true;
    }
}

fn out_of_memory(bytes: u64) -> TextureError {
    TextureError::Core(CoreError::OutOfMemory {
        bytes: u32::try_from(bytes).unwrap_or(u32::MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use null3d_gpu::caps::Capabilities;
    use null3d_gpu::drawlist::{Command, decode, upload_flags};
    use null3d_gpu::mock::MockBackend;

    const IDS: TextureIds = TextureIds {
        first_texture: 100,
        first_sampler: 1,
        first_group: 50,
    };

    fn desc(width: u32, height: u32) -> TextureDesc {
        TextureDesc {
            width,
            height,
            depth: 1,
            format: format::RGBA8_UNORM_SRGB,
            mipmaps: true,
            levels: 1,
            sampling: Sampling::default(),
        }
    }

    fn layer_bytes(width: u32, height: u32) -> u64 {
        let mips = format::full_chain(width, height);
        format::layer_bytes(format::RGBA8_UNORM_SRGB, width, height, mips)
    }

    /// The store with a mock backend that replays each frame's list twice, as a capture does, and
    /// the images that the thread that draws holds.
    struct Harness {
        store: TextureStore,
        gpu: MockBackend,
        list: DrawList,
        frame: u32,
        /// Each image's size, in id order.
        images: Vec<(u32, u32)>,
        arrived: u32,
    }

    impl Harness {
        fn new() -> Self {
            Self::with_capabilities(Capabilities::empty())
        }

        /// A harness whose mock GPU offers `caps`, such as a compressed format's family.
        fn with_capabilities(caps: Capabilities) -> Self {
            Self {
                store: TextureStore::new(IDS, 4096),
                gpu: MockBackend::with_capabilities(caps),
                list: DrawList::with_capacity(4096),
                frame: 0,
                images: Vec::new(),
                arrived: 0,
            }
        }

        fn texture(&mut self, width: u32, height: u32) -> Handle {
            self.store.create(desc(width, height)).unwrap()
        }

        /// Gives a texture an image of its size, which is on its way to the thread that draws.
        fn image(&mut self, texture: Handle, width: u32, height: u32) -> u32 {
            let (image, _) = self.store.set_image(texture, width, height, 0).unwrap();
            assert_eq!(image as usize, self.images.len() + 1, "image ids count up");
            self.images.push((width, height));
            image
        }

        /// The thread that draws receives the images up to `count`.
        fn arrive(&mut self, count: u32) {
            for id in self.arrived + 1..=count {
                let (width, height) = self.images[id as usize - 1];
                self.gpu.provide_image(id, width, height);
            }
            self.arrived = count;
        }

        /// Records one frame and replays it twice, and returns its commands and whether it made
        /// bind groups again.
        fn frame(&mut self) -> (Vec<(Op, Vec<u32>)>, bool) {
            // The thread that draws took the frame recorded before this one, if any.
            let taken = self.frame;
            self.frame = null3d_core::frames::next_frame(self.frame);
            self.list.clear();
            self.store.sync(self.arrived, taken);
            let groups = self.store.record(&mut self.list, self.frame).unwrap();
            self.list.push(Op::Submit, &[]).unwrap();
            for _ in 0..2 {
                self.gpu.replay(self.list.words()).unwrap();
            }
            let commands = decode(self.list.words())
                .map(Result::unwrap)
                .map(|Command { op, operands }| (op, operands.to_vec()))
                .collect();
            (commands, groups)
        }
    }

    #[test]
    fn images_and_data_are_released_across_the_wrap_of_the_frame_count() {
        let mut h = Harness::new();
        h.frame = u32::MAX - 3;
        let texture = h.texture(4, 4);
        h.image(texture, 4, 4);
        h.arrive(1);
        let data = h.texture(4, 4);
        let (_, _) = h.store.set_data(data, 4, 4).unwrap();
        let mut released = Vec::new();
        for _ in 0..6 {
            let (commands, _) = h.frame();
            released.extend(ops(&commands, Op::ReleaseImage));
        }
        assert_eq!(
            h.frame, 4,
            "the frames went round past the last of the count"
        );
        assert_eq!(released, [vec![1]]);
        assert_eq!(h.store.ready_layer(texture), Some(0));
        // The data's texels are freed once a frame after the list that read them was taken.
        assert!(h.store.data.iter().all(Vec::is_empty));
    }

    fn ops(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
        commands
            .iter()
            .filter(|(o, _)| *o == op)
            .map(|(_, operands)| operands.clone())
            .collect()
    }

    #[test]
    fn textures_of_one_size_and_format_share_an_array_and_a_group_per_sampler() {
        let mut store = TextureStore::new(IDS, 4096);
        let a = store.create(desc(64, 32)).unwrap();
        let b = store.create(desc(64, 32)).unwrap();
        let linear = store
            .create(TextureDesc {
                format: format::RGBA8_UNORM,
                ..desc(64, 32)
            })
            .unwrap();
        let repeat = store
            .create(TextureDesc {
                sampling: Sampling {
                    wrap: [address::REPEAT; 2],
                    ..Sampling::default()
                },
                ..desc(64, 32)
            })
            .unwrap();
        let flat = store
            .create(TextureDesc {
                mipmaps: false,
                ..desc(64, 32)
            })
            .unwrap();
        let slot = |t: Handle| *store.slot(t).unwrap();
        assert_eq!((slot(a).array, slot(a).layer), (0, 0));
        assert_eq!((slot(b).array, slot(b).layer), (0, 1));
        assert_eq!((slot(repeat).array, slot(repeat).layer), (0, 2));
        assert_eq!(
            slot(linear).array,
            1,
            "a data format has an array of its own"
        );
        assert_eq!(slot(flat).array, 2, "so does a texture without mip levels");
        assert_eq!(store.group_id(a), Some(IDS.first_group));
        assert_eq!(store.group_id(a), store.group_id(b));
        assert_ne!(store.group_id(a), store.group_id(repeat));
        assert_ne!(store.group_id(a), store.group_id(linear));
    }

    #[test]
    fn a_texture_the_store_cannot_hold_is_refused() {
        let mut store = TextureStore::new(IDS, 2048);
        assert_eq!(
            store.create(desc(4096, 16)),
            Err(TextureError::TooLarge { limit: 2048 })
        );
        assert_eq!(store.create(desc(0, 16)), Err(TextureError::Unsupported));
        let float = TextureDesc {
            format: format::RGBA32_FLOAT,
            ..desc(16, 16)
        };
        assert_eq!(store.create(float), Err(TextureError::Unsupported));
        let half_float = TextureDesc {
            format: format::RGBA16_FLOAT,
            ..desc(16, 16)
        };
        assert_eq!(
            store.create(half_float),
            Err(TextureError::Unsupported),
            "half floats make no mip levels"
        );
        for depth in [0, MAX_LAYERS + 1] {
            let layers = TextureDesc {
                depth,
                ..desc(16, 16)
            };
            assert_eq!(store.create(layers), Err(TextureError::Unsupported));
        }
        let texture = store.create(desc(16, 16)).unwrap();
        assert_eq!(
            store.set_image(texture, 4096, 8, 0),
            Err(TextureError::TooLarge { limit: 2048 }),
            "an image past the limit"
        );
        let data = store
            .create(TextureDesc {
                mipmaps: false,
                ..half_float
            })
            .unwrap();
        assert_eq!(
            store.set_image(data, 16, 16, 0),
            Err(TextureError::Unsupported),
            "images fill 8-bit textures"
        );
        store.destroy(texture, 3).unwrap();
        assert!(matches!(
            store.set_image(texture, 16, 16, 0),
            Err(TextureError::Core(CoreError::StaleHandle { .. }))
        ));
    }

    #[test]
    fn uploads_wait_for_their_images_then_go_up_in_bands_within_the_budget() {
        let mut h = Harness::new();
        // Rows of 64 texels take 256 bytes, so a budget of 1,000 bytes takes 3 rows a frame.
        assert_eq!(h.store.budget(), DEFAULT_UPLOAD_BUDGET);
        h.store.set_budget(1000);
        assert_eq!(h.store.budget(), 1000);
        let first = h.texture(64, 16);
        let second = h.texture(64, 16);
        h.image(first, 64, 16);
        h.image(second, 64, 16);
        let (commands, groups) = h.frame();
        assert!(groups, "the first frame makes the array's bind group");
        assert!(
            ops(&commands, Op::UploadImage).is_empty(),
            "no image arrived"
        );
        assert_eq!(h.store.ready_layer(first), None);
        assert_eq!(h.store.stats().waiting, 2);

        h.arrive(1);
        let mut bands = Vec::new();
        for _ in 0..6 {
            let (commands, _) = h.frame();
            let uploads = ops(&commands, Op::UploadImage);
            let bytes: u32 = uploads.iter().map(|u| u[5] * u[6] * 4).sum();
            assert!(bytes <= 1000, "a frame uploads {bytes} bytes");
            assert_eq!(h.store.stats().last_frame_bytes, bytes);
            assert!(ops(&commands, Op::ReleaseImage).is_empty());
            bands.extend(uploads.iter().map(|u| (u[7], u[3], u[6], u[8], u[10])));
        }
        // Image 1 goes up in bands of 3 rows, and image 2 has not arrived.
        let expected: Vec<(u32, u32, u32, u32, u32)> = (0..6)
            .map(|k| (1, k * 3, if k == 5 { 1 } else { 3 }, 0, k * 3))
            .collect();
        assert_eq!(bands, expected);
        assert_eq!(h.store.ready_layer(first), Some(0));
        assert_eq!(h.store.ready_layer(second), None);
        assert!(h.store.take_layers_changed());
        assert!(!h.store.take_layers_changed());
        assert_eq!(h.store.stats().largest_frame_bytes, 768);
        assert_eq!(h.store.stats().waiting, 1);
        // The next frame's list releases the image, after every list that uploads it.
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::ReleaseImage), [vec![1]]);
    }

    #[test]
    fn a_finished_upload_makes_its_mip_levels_after_the_frame_uploads() {
        let mut h = Harness::new();
        let first = h.texture(32, 32);
        let second = h.texture(32, 32);
        h.image(first, 32, 32);
        h.image(second, 32, 32);
        h.arrive(2);
        let (commands, _) = h.frame();
        let order: Vec<Op> = commands
            .iter()
            .map(|(op, _)| *op)
            .filter(|op| matches!(op, Op::UploadImage | Op::GenerateMipmaps))
            .collect();
        assert_eq!(
            order,
            [
                Op::UploadImage,
                Op::UploadImage,
                Op::GenerateMipmaps,
                Op::GenerateMipmaps
            ]
        );
        let array = IDS.first_texture;
        assert_eq!(
            ops(&commands, Op::GenerateMipmaps),
            [vec![array, 0], vec![array, 1]]
        );
        // A texture without mip levels makes none.
        let flat = h
            .store
            .create(TextureDesc {
                mipmaps: false,
                ..desc(8, 8)
            })
            .unwrap();
        h.image(flat, 8, 8);
        h.arrive(3);
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::UploadImage).len(), 1);
        assert!(ops(&commands, Op::GenerateMipmaps).is_empty());
    }

    #[test]
    fn a_frame_uploads_a_row_at_least_and_a_held_frame_uploads_everything() {
        let mut h = Harness::new();
        h.store.set_budget(16);
        let texture = h.texture(64, 4);
        h.image(texture, 64, 4);
        h.arrive(1);
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::UploadImage)[0][6], 1, "one row a frame");
        h.store.upload_all_next_frame();
        let (commands, _) = h.frame();
        let uploads = ops(&commands, Op::UploadImage);
        assert_eq!(uploads.len(), 1);
        assert_eq!(
            (uploads[0][3], uploads[0][6]),
            (1, 3),
            "the other rows at once"
        );
        // The frame after keeps the budget again.
        let other = h.texture(64, 4);
        h.image(other, 64, 4);
        h.arrive(2);
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::UploadImage)[0][6], 1);
    }

    #[test]
    fn an_array_grows_by_copying_every_mip_level_into_a_texture_twice_its_size() {
        let mut h = Harness::new();
        for k in 0..FIRST_LAYERS {
            let texture = h.texture(16, 8);
            h.image(texture, 16, 8);
            h.arrive(k + 1);
        }
        let (commands, _) = h.frame();
        let created = ops(&commands, Op::CreateTexture);
        assert_eq!(created.len(), 1);
        assert_eq!((created[0][0], created[0][3], created[0][7]), (100, 4, 5));
        assert_eq!(h.store.memory_bytes(), 4 * layer_bytes(16, 8));

        let fifth = h.texture(16, 8);
        h.image(fifth, 16, 8);
        h.arrive(5);
        let (commands, groups) = h.frame();
        assert!(groups, "the group binds the new texture");
        let created = ops(&commands, Op::CreateTexture);
        assert_eq!((created[0][0], created[0][3]), (101, 8));
        let copies = ops(&commands, Op::CopyTextureToTexture);
        assert_eq!(copies.len(), 5, "one copy per mip level");
        assert_eq!(copies[0], [100, 0, 0, 0, 0, 101, 0, 0, 0, 0, 16, 8, 4]);
        assert_eq!(copies[4], [100, 4, 0, 0, 0, 101, 4, 0, 0, 0, 1, 1, 4]);
        assert!(
            ops(&commands, Op::DestroyTexture).is_empty(),
            "the copies' source stays"
        );
        // A submit comes between the copies and the upload, so the copies land first.
        let at = |op: Op| commands.iter().position(|(o, _)| *o == op).unwrap();
        assert!(at(Op::CopyTextureToTexture) < at(Op::Submit));
        assert!(at(Op::Submit) < at(Op::UploadImage));
        assert_eq!(ops(&commands, Op::UploadImage)[0][0], 101);
        assert_eq!(ops(&commands, Op::CreateBindGroup)[0][5], 101);
        assert_eq!(h.store.ready_layer(fifth), Some(4));
        assert_eq!(h.store.memory_bytes(), 8 * layer_bytes(16, 8));
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::DestroyTexture), [vec![100]]);
        // Growing again takes the first id back.
        for _ in 0..4 {
            let texture = h.texture(16, 8);
            h.image(texture, 16, 8);
        }
        h.arrive(9);
        let (commands, _) = h.frame();
        let created = ops(&commands, Op::CreateTexture);
        assert_eq!((created[0][0], created[0][3]), (100, 16));
        assert_eq!(ops(&commands, Op::CopyTextureToTexture)[0][12], 8);
    }

    #[test]
    fn a_full_array_leaves_more_textures_of_its_key_to_another() {
        let mut store = TextureStore::new(IDS, 4096);
        let textures: Vec<Handle> = (0..=MAX_LAYERS)
            .map(|_| store.create(desc(1, 1)).unwrap())
            .collect();
        let last = *store.slot(textures[MAX_LAYERS as usize]).unwrap();
        assert_eq!((last.array, last.layer), (1, 0));
        // A freed layer takes the next texture of the key.
        store.destroy(textures[7], 1).unwrap();
        let next = store.create(desc(1, 1)).unwrap();
        let slot = *store.slot(next).unwrap();
        assert_eq!((slot.array, slot.layer), (0, 7));
    }

    #[test]
    fn destroying_a_texture_frees_its_layer_and_releases_its_image_once_it_arrived() {
        let mut h = Harness::new();
        let kept = h.texture(8, 8);
        let dropped = h.texture(8, 8);
        h.image(kept, 8, 8);
        h.image(dropped, 8, 8);
        h.arrive(1);
        h.store.destroy(dropped, 1).unwrap();
        let (commands, _) = h.frame();
        assert!(
            ops(&commands, Op::ReleaseImage).is_empty(),
            "image 2 is on its way"
        );
        assert_eq!(ops(&commands, Op::UploadImage).len(), 1);
        h.arrive(2);
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::ReleaseImage), [vec![2], vec![1]]);
        assert!(ops(&commands, Op::UploadImage).is_empty());
        // The array's last texture goes, and its GPU texture with it.
        h.store.take_layers_changed();
        h.store.destroy(kept, 3).unwrap();
        assert!(h.store.take_layers_changed());
        let (commands, _) = h.frame();
        assert_eq!(
            ops(&commands, Op::DestroyTexture),
            [vec![IDS.first_texture]]
        );
        assert_eq!(h.store.memory_bytes(), 0);
        assert!(!h.store.is_live(kept));
    }

    #[test]
    fn a_new_image_replaces_one_that_waits_and_stops_the_map_until_it_is_up() {
        let mut h = Harness::new();
        let texture = h.texture(8, 8);
        h.image(texture, 8, 8);
        h.image(texture, 8, 8);
        h.arrive(2);
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::ReleaseImage), [vec![1]]);
        assert_eq!(ops(&commands, Op::UploadImage)[0][7], 2);
        assert!(h.store.take_layers_changed());
        h.image(texture, 8, 8);
        assert!(h.store.take_layers_changed());
        assert_eq!(h.store.ready_layer(texture), None);
        h.arrive(3);
        h.frame();
        assert_eq!(h.store.ready_layer(texture), Some(0));
    }

    #[test]
    fn after_a_gpu_reset_textures_upload_again_from_images_the_thread_still_holds() {
        let mut h = Harness::new();
        let early = h.texture(8, 8);
        h.image(early, 8, 8);
        h.arrive(1);
        h.frame();
        let late = h.texture(8, 8);
        h.image(late, 8, 8);
        h.arrive(2);
        h.frame();
        // The thread that draws took frame 2, which released image 1, but not frame 3, whose list
        // releases image 2.
        h.frame();
        h.store.sync(2, 2);
        h.store.reset_gpu();
        assert_eq!(h.store.ready_layer(early), None);
        assert_eq!(h.store.ready_layer(late), None);
        assert!(h.store.take_layers_changed());
        h.gpu = MockBackend::default();
        h.gpu.provide_image(2, 8, 8);
        let (commands, groups) = h.frame();
        assert!(groups);
        assert_eq!(ops(&commands, Op::CreateTexture).len(), 1);
        assert_eq!(ops(&commands, Op::CreateSampler).len(), 1);
        let uploads = ops(&commands, Op::UploadImage);
        assert_eq!(uploads.len(), 1);
        assert_eq!(
            uploads[0][7], 2,
            "image 1 is gone, and image 2 uploads again"
        );
        assert_eq!(h.store.ready_layer(late), Some(1));
        assert_eq!(h.store.ready_layer(early), None);
        // The texture that lost its image uploads once it gets a new one.
        let image = h.image(early, 8, 8);
        h.arrive(image);
        h.frame();
        assert_eq!(h.store.ready_layer(early), Some(0));
    }

    #[test]
    fn samplers_follow_the_textures_settings_under_the_anisotropy_cap() {
        let mut h = Harness::new();
        let sharp = h
            .store
            .create(TextureDesc {
                sampling: Sampling {
                    anisotropy: 8,
                    ..Sampling::default()
                },
                ..desc(8, 8)
            })
            .unwrap();
        let pixelated = h
            .store
            .create(TextureDesc {
                sampling: Sampling {
                    wrap: [address::REPEAT, address::MIRROR_REPEAT],
                    mag_filter: filter::NEAREST,
                    anisotropy: 8,
                    ..Sampling::default()
                },
                ..desc(8, 8)
            })
            .unwrap();
        assert_eq!(h.store.max_anisotropy(), DEFAULT_MAX_ANISOTROPY);
        h.store.set_max_anisotropy(4);
        assert_eq!(h.store.max_anisotropy(), 4);
        let (commands, _) = h.frame();
        let samplers = ops(&commands, Op::CreateSampler);
        assert_eq!(samplers.len(), 2);
        assert_eq!(samplers[0][10], 4, "the cap lowers the anisotropy");
        assert_eq!(samplers[1][10], 1, "a nearest filter takes no anisotropy");
        assert_eq!(
            samplers[1][1..5],
            [
                address::REPEAT,
                address::MIRROR_REPEAT,
                address::CLAMP_TO_EDGE,
                filter::NEAREST
            ]
        );
        assert_ne!(h.store.group_id(sharp), h.store.group_id(pixelated));
        // A new cap makes the samplers and their groups again.
        h.store.set_max_anisotropy(16);
        let (commands, groups) = h.frame();
        assert!(groups);
        assert_eq!(ops(&commands, Op::CreateSampler)[0][10], 8);
        assert_eq!(ops(&commands, Op::CreateBindGroup).len(), 2);
        let (commands, groups) = h.frame();
        assert!(!groups);
        assert_eq!(commands.len(), 1, "a steady frame records only its submit");
    }

    #[test]
    fn each_texture_counts_its_layer_with_every_mip_level() {
        let mut store = TextureStore::new(IDS, 4096);
        let texture = store.create(desc(256, 128)).unwrap();
        let expected: u64 = (0..9)
            .map(|level| {
                let width = format::level_size(256, level);
                let height = format::level_size(128, level);
                u64::from(width * height * 4)
            })
            .sum();
        assert_eq!(store.bytes(texture), Ok(expected));
        assert_eq!(store.memory_bytes(), 0, "no GPU texture yet");
        let mut list = DrawList::with_capacity(256);
        store.record(&mut list, 1).unwrap();
        assert_eq!(store.memory_bytes(), u64::from(FIRST_LAYERS) * expected);
    }

    /// A texture for data: RGBA8 without mip levels, in `depth` layers.
    fn data_desc(width: u32, height: u32, depth: u32) -> TextureDesc {
        TextureDesc {
            depth,
            format: format::RGBA8_UNORM,
            mipmaps: false,
            ..desc(width, height)
        }
    }

    /// Gives a texture data of its size, each word its index, and returns the data's address.
    fn fill(store: &mut TextureStore, texture: Handle, width: u32, height: u32) -> u32 {
        let (words, _) = store.set_data(texture, width, height).unwrap();
        for (k, word) in words.iter_mut().enumerate() {
            *word = k as u32;
        }
        memory_address(words_as_bytes(words))
    }

    /// The data slots that hold memory.
    fn data_held(store: &TextureStore) -> usize {
        store.data.iter().filter(|d| d.capacity() > 0).count()
    }

    #[test]
    fn data_uploads_in_bands_from_engine_memory_and_is_freed_once_a_later_frame_was_taken() {
        let mut h = Harness::new();
        // Rows of 16 texels take 64 bytes, so a budget of 200 bytes takes 3 rows a frame.
        h.store.set_budget(200);
        let texture = h.store.create(data_desc(16, 4, 1)).unwrap();
        let at = fill(&mut h.store, texture, 16, 4);
        let (commands, _) = h.frame();
        assert_eq!(
            ops(&commands, Op::WriteTexture),
            [vec![IDS.first_texture, 0, 0, 0, 0, 16, 3, 1, at, 192]],
            "data waits for no image: its first band goes up at once"
        );
        assert_eq!(h.store.ready_layer(texture), None);
        let (commands, _) = h.frame();
        let writes = ops(&commands, Op::WriteTexture);
        assert_eq!(writes[0][3..], [3, 0, 16, 1, 1, at + 192, 64]);
        assert_eq!(h.store.ready_layer(texture), Some(0));
        assert!(ops(&commands, Op::GenerateMipmaps).is_empty());
        // Frame 2's list is the last that reads the data. The thread that draws has taken frame
        // 3 once frame 4 records, which frees it.
        h.frame();
        assert_eq!(data_held(&h.store), 1);
        let (commands, _) = h.frame();
        assert_eq!(data_held(&h.store), 0, "freed");
        assert!(ops(&commands, Op::ReleaseImage).is_empty());
        // Data that replaces data waiting for its turn frees it once no list can read it.
        let first = fill(&mut h.store, texture, 16, 4);
        let second = fill(&mut h.store, texture, 16, 4);
        assert_ne!(first, second);
        let (commands, _) = h.frame();
        assert_eq!(ops(&commands, Op::WriteTexture)[0][8], second);
        assert_eq!(data_held(&h.store), 2);
        for _ in 0..3 {
            h.frame();
        }
        assert_eq!(data_held(&h.store), 0);
    }

    /// A texture in ASTC with the mip levels that its data brings, as a KTX2 file's.
    fn astc_desc(width: u32, height: u32, levels: u32) -> TextureDesc {
        TextureDesc {
            format: format::ASTC_4X4_UNORM_SRGB,
            mipmaps: false,
            levels,
            ..desc(width, height)
        }
    }

    #[test]
    fn compressed_textures_upload_every_level_of_their_data_in_rows_of_blocks() {
        let mut h = Harness::with_capabilities(Capabilities::TEXTURE_ASTC);
        let texture = h.store.create(astc_desc(16, 8, 5)).unwrap();
        let other = h.store.create(astc_desc(16, 8, 5)).unwrap();
        let array = |h: &Harness, t: Handle| h.store.slot(t).unwrap().array;
        assert_ne!(
            array(&h, texture),
            array(&h, other),
            "compressed textures never share an array, which could not grow"
        );
        h.store.destroy(other, 0).unwrap();
        // Levels of 16 x 8, 8 x 4, 4 x 2, 2 x 1 and 1 x 1 texels: 4 x 2, 2 x 1 and then single
        // blocks of 16 bytes.
        let bytes = (8 + 2 + 1 + 1 + 1) * 16;
        assert_eq!(h.store.bytes(texture), Ok(bytes));
        let at = fill(&mut h.store, texture, 16, 8);
        assert_eq!(h.store.data[0].len() as u64 * 4, bytes);
        // A row of blocks of level 0 takes 64 bytes, so a budget of 100 bytes takes one row, then
        // the rows of the smaller levels that fit.
        h.store.set_budget(100);
        let (commands, _) = h.frame();
        let created = ops(&commands, Op::CreateTexture);
        let id = created[0][0];
        assert_eq!(
            created[0][1..],
            [
                16,
                8,
                1,
                format::ASTC_4X4_UNORM_SRGB,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                5,
                view::D2_ARRAY
            ],
            "a compressed texture is sampled and written, never drawn into or copied"
        );
        assert_eq!(
            ops(&commands, Op::WriteTexture),
            [vec![id, 0, 0, 0, 0, 16, 4, 1, at, 64]]
        );
        let (commands, _) = h.frame();
        assert_eq!(
            ops(&commands, Op::WriteTexture),
            [
                vec![id, 0, 0, 4, 0, 16, 4, 1, at + 64, 64],
                vec![id, 1, 0, 0, 0, 8, 4, 1, at + 128, 32]
            ],
        );
        assert_eq!(h.store.ready_layer(texture), None);
        let (commands, _) = h.frame();
        assert_eq!(
            ops(&commands, Op::WriteTexture),
            [
                vec![id, 2, 0, 0, 0, 4, 2, 1, at + 160, 16],
                vec![id, 3, 0, 0, 0, 2, 1, 1, at + 176, 16],
                vec![id, 4, 0, 0, 0, 1, 1, 1, at + 192, 16]
            ],
            "a level smaller than a block writes one block"
        );
        assert!(
            ops(&commands, Op::GenerateMipmaps).is_empty(),
            "the data brought its mip levels"
        );
        assert_eq!(h.store.ready_layer(texture), Some(0));
        assert_eq!(h.store.memory_bytes(), bytes);
    }

    #[test]
    fn data_with_its_own_mip_levels_shares_an_array_and_makes_none() {
        let mut h = Harness::new();
        let made = h.texture(4, 4);
        let brought = h
            .store
            .create(TextureDesc {
                mipmaps: false,
                levels: 3,
                ..desc(4, 4)
            })
            .unwrap();
        let slot = |h: &Harness, t: Handle| *h.store.slot(t).unwrap();
        assert_eq!(
            slot(&h, made).array,
            slot(&h, brought).array,
            "one key: 4 x 4 in 3 levels"
        );
        let image = h.image(made, 4, 4);
        h.arrive(image);
        let at = fill(&mut h.store, brought, 4, 4);
        assert_eq!(
            h.store.set_image(brought, 4, 4, 0),
            Err(TextureError::Unsupported),
            "an image brings level 0 alone"
        );
        let (commands, _) = h.frame();
        let id = ops(&commands, Op::CreateTexture)[0][0];
        assert_eq!(
            ops(&commands, Op::WriteTexture),
            [
                vec![id, 0, 0, 0, 1, 4, 4, 1, at, 64],
                vec![id, 1, 0, 0, 1, 2, 2, 1, at + 64, 16],
                vec![id, 2, 0, 0, 1, 1, 1, 1, at + 80, 4]
            ]
        );
        assert_eq!(
            ops(&commands, Op::GenerateMipmaps),
            [vec![id, 0]],
            "only the texture from an image makes its levels"
        );
    }

    #[test]
    fn the_store_refuses_compressed_textures_it_cannot_hold() {
        let mut store = TextureStore::new(IDS, 4096);
        for (desc, why) in [
            (astc_desc(6, 8, 1), "WebGPU needs whole blocks at level 0"),
            (
                TextureDesc {
                    mipmaps: true,
                    ..astc_desc(8, 8, 1)
                },
                "the GPU draws no mip levels of compressed texels",
            ),
            (
                astc_desc(8, 8, 5),
                "an 8 x 8 texture has at most 4 mip levels",
            ),
            (
                TextureDesc {
                    levels: 2,
                    ..desc(8, 8)
                },
                "levels that the GPU makes come from level 0 alone",
            ),
        ] {
            assert_eq!(store.create(desc), Err(TextureError::Unsupported), "{why}");
        }
        let astc = store.create(astc_desc(8, 8, 4)).unwrap();
        assert_eq!(
            store.set_image(astc, 8, 8, 0),
            Err(TextureError::Unsupported),
            "images upload into RGBA8 textures only"
        );
        assert_eq!(
            store.set_data(astc, 10, 8).err(),
            Some(TextureError::Unsupported),
            "new data keeps whole blocks"
        );
    }

    #[test]
    fn a_texture_of_several_layers_has_an_array_of_its_own() {
        let mut h = Harness::new();
        let shared = h.store.create(data_desc(8, 8, 1)).unwrap();
        let layers = h.store.create(data_desc(8, 8, 3)).unwrap();
        let other = h.store.create(data_desc(8, 8, 3)).unwrap();
        let place = |h: &Harness, t: Handle| {
            let s = h.store.slot(t).unwrap();
            (s.array, s.layer)
        };
        assert_eq!(place(&h, shared), (0, 0));
        assert_eq!(place(&h, layers), (1, 0));
        assert_eq!(place(&h, other), (2, 0), "no two textures of layers share");
        let layer_bytes = 8 * 8 * 4;
        assert_eq!(h.store.bytes(layers), Ok(3 * layer_bytes));
        // A band stays within a layer: a budget of 32 rows takes the 3 layers of 8 rows.
        h.store.set_budget(8 * 32 * 4);
        fill(&mut h.store, layers, 8, 8);
        let (commands, _) = h.frame();
        let created = ops(&commands, Op::CreateTexture);
        assert_eq!(
            created.iter().map(|c| c[3]).collect::<Vec<_>>(),
            [FIRST_LAYERS, 3, 3],
            "an array of one texture has exactly its layers"
        );
        let writes = ops(&commands, Op::WriteTexture);
        let bands: Vec<(u32, u32, u32)> = writes.iter().map(|w| (w[4], w[3], w[6])).collect();
        assert_eq!(bands, [(0, 0, 8), (1, 0, 8), (2, 0, 8)]);
        assert_eq!(h.store.ready_layer(layers), Some(0));
        assert_eq!(
            h.store.memory_bytes(),
            u64::from(FIRST_LAYERS) * layer_bytes + 6 * layer_bytes
        );
        // A texture of layers with mip levels makes them for each layer.
        let mipped = h
            .store
            .create(TextureDesc {
                depth: 2,
                ..desc(4, 4)
            })
            .unwrap();
        fill(&mut h.store, mipped, 4, 4);
        let (commands, _) = h.frame();
        let array = ops(&commands, Op::CreateTexture)[0][0];
        assert_eq!(
            ops(&commands, Op::GenerateMipmaps),
            [vec![array, 0], vec![array, 1]]
        );
        assert_eq!(
            h.store.set_image(mipped, 4, 4, 0),
            Err(TextureError::Unsupported),
            "an image fills one layer"
        );
    }

    #[test]
    fn texels_of_another_size_move_the_texture_to_an_array_of_that_size() {
        let mut h = Harness::new();
        let texture = h.texture(8, 8);
        let neighbour = h.texture(8, 8);
        h.image(texture, 8, 8);
        h.arrive(1);
        h.frame();
        let group = h.store.group_id(texture);
        assert_eq!(h.store.ready_layer(texture), Some(0));
        h.store.take_layers_changed();

        let (image, moved) = h
            .store
            .set_image(texture, 16, 4, upload_flags::PREMULTIPLIED_ALPHA)
            .unwrap();
        h.images.push((16, 4));
        assert!(moved);
        assert!(h.store.take_layers_changed());
        assert_ne!(h.store.group_id(texture), group, "another array's group");
        assert_eq!(h.store.ready_layer(texture), None);
        assert_eq!(
            h.store.bytes(texture),
            Ok(layer_bytes(16, 4)),
            "a whole chain of mip levels at the new size"
        );
        h.arrive(image);
        let (commands, _) = h.frame();
        let uploads = ops(&commands, Op::UploadImage);
        assert_eq!(
            (uploads[0][5], uploads[0][6], uploads[0][8]),
            (16, 4, upload_flags::PREMULTIPLIED_ALPHA)
        );
        assert_eq!(h.store.ready_layer(texture), Some(0));
        // The old layer is free for the next texture of its size.
        let next = h.texture(8, 8);
        assert_eq!(h.store.slot(next).unwrap().layer, 0);
        assert_eq!(h.store.slot(neighbour).unwrap().layer, 1);
        let (_, moved) = h.store.set_image(texture, 16, 4, 0).unwrap();
        assert!(!moved, "the same size stays");
    }

    #[test]
    fn after_a_gpu_reset_data_uploads_again_until_it_is_freed() {
        let mut h = Harness::new();
        let kept = h.store.create(data_desc(4, 4, 1)).unwrap();
        let freed = h.store.create(data_desc(4, 4, 1)).unwrap();
        fill(&mut h.store, freed, 4, 4);
        for _ in 0..3 {
            h.frame();
        }
        fill(&mut h.store, kept, 4, 4);
        h.frame();
        h.store.reset_gpu();
        h.gpu = MockBackend::default();
        let (commands, _) = h.frame();
        let writes = ops(&commands, Op::WriteTexture);
        assert_eq!(writes.len(), 1, "only the data still held uploads again");
        assert_eq!(h.store.ready_layer(kept), Some(0));
        assert_eq!(h.store.ready_layer(freed), None);
    }
}

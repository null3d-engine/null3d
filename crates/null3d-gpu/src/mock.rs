//! A backend for tests: it replays draw lists against simple resource tables and reports the first
//! command that a real GPU would reject, or that would draw differently on the two GPU paths. It
//! holds the device to the portable budget, plus the capabilities a test gives it.

use crate::caps::{BUDGET, Capabilities, Limit, OFFSET_ALIGNMENT};
use crate::drawlist::{
    Command, NO_TARGET, Op, address, compare, decode, filter, format, permutation, resource_kind,
    state_flags, texture_usage, upload_flags, vertex, view,
};
use std::collections::{HashMap, HashSet};

#[derive(Debug, PartialEq, Eq)]
pub enum MockError {
    Decode(String),
    Missing {
        op: Op,
        what: &'static str,
        id: u32,
    },
    OutOfRange {
        op: Op,
        id: u32,
    },
    Unaligned {
        op: Op,
        offset: u32,
    },
    Outside {
        op: Op,
        needs: &'static str,
    },
    NotReady {
        op: Op,
        what: &'static str,
    },
    /// The command breaks a rule of WebGPU, of its compatibility mode or of WebGL2.
    Invalid {
        op: Op,
        rule: &'static str,
    },
    /// A write or an upload after a command that used the resource in the same submit. WebGPU
    /// would apply the write before that command, and WebGL2 after it.
    WriteAfterUse {
        op: Op,
        what: &'static str,
        id: u32,
    },
}

/// A texture, as its creation described it.
#[derive(Clone, Copy, Debug)]
struct Texture {
    width: u32,
    height: u32,
    layers: u32,
    mips: u32,
    format: u32,
    usage: u32,
    samples: u32,
    /// The view dimension that bind groups see it as.
    binding_view: u32,
}

/// A view of one mip level and one layer of a texture: the texture, the generation it had when
/// the view was made, and the level, which sets the view's size.
#[derive(Clone, Copy, Debug)]
struct View {
    texture: u32,
    generation: u32,
    level: u32,
}

/// The open render pass: the size of its targets, and the textures it draws into.
#[derive(Clone, Copy, Debug)]
struct Pass {
    width: u32,
    height: u32,
    targets: [Option<u32>; 3],
}

/// A render target of a pass: the texture it draws into, and what the pass checks it against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Target {
    /// The texture id, or `None` for the canvas.
    texture: Option<u32>,
    width: u32,
    height: u32,
    format: u32,
    samples: u32,
}

/// A GPU resource that a write can reach, for the check of writes after use.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Resource {
    Buffer(u32),
    Texture(u32),
}

/// Where a copy or a write starts: a texture, a mip level, and the first texel and layer.
#[derive(Clone, Copy, Debug)]
struct Location {
    texture: u32,
    level: u32,
    x: u32,
    y: u32,
    layer: u32,
}

impl Location {
    fn read(words: &[u32]) -> Self {
        Self {
            texture: words[0],
            level: words[1],
            x: words[2],
            y: words[3],
            layer: words[4],
        }
    }
}

/// The formats that `UploadImage` writes on both paths.
const IMAGE_FORMATS: [u32; 4] = [
    format::RGBA8_UNORM,
    format::RGBA8_UNORM_SRGB,
    format::RGBA16_FLOAT,
    format::RGBA32_FLOAT,
];

#[derive(Default)]
pub struct MockBackend {
    /// What the device offers beyond the portable budget.
    caps: Capabilities,
    buffers: HashMap<u32, u32>,
    textures: HashMap<u32, Texture>,
    views: HashMap<u32, View>,
    /// How many times each texture id was made or released, so a view can tell that its texture
    /// is gone.
    generations: HashMap<u32, u32>,
    samplers: HashSet<u32>,
    /// Width and height of each image a test provided.
    images: HashMap<u32, (u32, u32)>,
    render_pipelines: HashSet<u32>,
    compute_pipelines: HashSet<u32>,
    /// The buffers and textures of each bind group.
    bind_groups: HashMap<u32, Vec<Resource>>,
    /// The buffers and textures that each bundle's commands use.
    bundles: HashMap<u32, Vec<Resource>>,
    /// The open render pass, or `None` outside one. A pass into the canvas before any
    /// `ResizeCanvas` has an unknown size, which nothing is checked against.
    pass: Option<Pass>,
    in_compute_pass: bool,
    /// The bundle being recorded, and what its commands use.
    recording: Option<(u32, Vec<Resource>)>,
    canvas: Option<(u32, u32)>,
    pipeline_set: bool,
    vertex_buffer_set: bool,
    index_buffer_set: bool,
    /// The resources that commands used since the last submit.
    used: HashSet<Resource>,
    pub draws: u32,
    pub dispatches: u32,
    pub submits: u32,
}

fn missing(op: Op, what: &'static str, id: u32) -> MockError {
    MockError::Missing { op, what, id }
}

fn invalid(op: Op, rule: &'static str) -> MockError {
    MockError::Invalid { op, rule }
}

/// Fails with `rule` unless `holds`.
fn check(holds: bool, op: Op, rule: &'static str) -> Result<(), MockError> {
    if holds {
        Ok(())
    } else {
        Err(invalid(op, rule))
    }
}

/// The size of a mip level.
fn level_size(size: u32, level: u32) -> u32 {
    format::level_size(size, level)
}

impl MockBackend {
    /// A backend whose device offers `caps` beyond the portable budget.
    pub fn with_capabilities(caps: Capabilities) -> Self {
        Self {
            caps,
            ..Self::default()
        }
    }

    /// Gives the backend an image of `width` x `height` pixels to upload, as the page gives the
    /// real backends image bitmaps.
    pub fn provide_image(&mut self, id: u32, width: u32, height: u32) {
        self.images.insert(id, (width, height));
    }

    pub fn replay(&mut self, words: &[u32]) -> Result<(), MockError> {
        for command in decode(words) {
            let command = command.map_err(|e| MockError::Decode(format!("{e:?}")))?;
            self.execute(command)?;
        }
        Ok(())
    }

    fn require(set: bool, op: Op, what: &'static str, id: u32) -> Result<(), MockError> {
        if set {
            Ok(())
        } else {
            Err(missing(op, what, id))
        }
    }

    fn in_draw_scope(&self) -> bool {
        self.pass.is_some() || self.recording.is_some()
    }

    /// Fails unless no pass or bundle is open, as encoder commands and submits need.
    fn outside_passes(&self, op: Op) -> Result<(), MockError> {
        if self.in_draw_scope() || self.in_compute_pass {
            return Err(MockError::Outside {
                op,
                needs: "no open pass or bundle",
            });
        }
        Ok(())
    }

    /// Notes that a command used a resource: at once, or when its bundle runs.
    fn use_resource(&mut self, resource: Resource) {
        match &mut self.recording {
            Some((_, uses)) => uses.push(resource),
            None => {
                self.used.insert(resource);
            }
        }
    }

    /// Notes a resource that a bind group or a bundle reads. The open render pass must not draw
    /// into it: WebGPU rejects that, and WebGL2 calls it a feedback loop.
    fn read_resource(&mut self, op: Op, resource: Resource) -> Result<(), MockError> {
        if let (Resource::Texture(id), Some(pass)) = (resource, self.pass) {
            check(
                !pass.targets.contains(&Some(id)),
                op,
                "a pass cannot read a texture that it draws into",
            )?;
        }
        self.use_resource(resource);
        Ok(())
    }

    /// Fails when a command in this submit already used the resource that `op` writes.
    fn write(&self, op: Op, resource: Resource) -> Result<(), MockError> {
        if !self.used.contains(&resource) {
            return Ok(());
        }
        let (what, id) = match resource {
            Resource::Buffer(id) => ("buffer", id),
            Resource::Texture(id) => ("texture", id),
        };
        Err(MockError::WriteAfterUse { op, what, id })
    }

    fn texture(&self, op: Op, id: u32) -> Result<Texture, MockError> {
        if self.views.contains_key(&id) {
            return Err(invalid(
                op,
                "a view is only a render target: copies, writes and bind groups name the texture",
            ));
        }
        self.textures
            .get(&id)
            .copied()
            .ok_or(missing(op, "texture", id))
    }

    /// Checks that a box of texels fits its texture, and returns the texture.
    fn texel_box(
        &self,
        op: Op,
        at: Location,
        width: u32,
        height: u32,
        layers: u32,
    ) -> Result<Texture, MockError> {
        let texture = self.texture(op, at.texture)?;
        check(
            texture.samples == 1,
            op,
            "multisampled textures do not copy",
        )?;
        let fits = at.level < texture.mips
            && width > 0
            && height > 0
            && layers > 0
            && at.x + width <= level_size(texture.width, at.level)
            && at.y + height <= level_size(texture.height, at.level)
            && at.layer + layers <= texture.layers;
        if !fits {
            return Err(MockError::OutOfRange { op, id: at.texture });
        }
        Ok(texture)
    }

    /// A render target by id: the canvas for 0, a texture of one layer and one mip level, or a
    /// view of a texture that still exists.
    fn target(&self, op: Op, id: u32) -> Result<Target, MockError> {
        if id == 0 {
            let (width, height) = self.canvas.unwrap_or((u32::MAX, u32::MAX));
            return Ok(Target {
                texture: None,
                width,
                height,
                format: format::CANVAS,
                samples: 1,
            });
        }
        let (texture_id, texture, level) = match self.views.get(&id) {
            Some(view) => {
                let texture = self
                    .textures
                    .get(&view.texture)
                    .filter(|_| self.generations.get(&view.texture) == Some(&view.generation))
                    .ok_or(invalid(
                        op,
                        "a view outlived its texture: make the view again after the texture",
                    ))?;
                (view.texture, *texture, view.level)
            }
            None => {
                let texture = *self
                    .textures
                    .get(&id)
                    .ok_or(missing(op, "render target", id))?;
                check(
                    texture.layers == 1 && texture.mips == 1,
                    op,
                    "a render target has one layer and one mip level: draw into a view of one",
                )?;
                (id, texture, 0)
            }
        };
        check(
            texture.usage & texture_usage::RENDER_ATTACHMENT != 0,
            op,
            "a render target needs RENDER_ATTACHMENT usage",
        )?;
        Ok(Target {
            texture: Some(texture_id),
            width: level_size(texture.width, level),
            height: level_size(texture.height, level),
            format: texture.format,
            samples: texture.samples,
        })
    }

    /// Fails unless a rectangle fits the open render pass's targets.
    fn in_pass_rectangle(&self, op: Op, rectangle: &[u32]) -> Result<(), MockError> {
        let Some(Pass { width, height, .. }) = self.pass else {
            return Err(MockError::Outside {
                op,
                needs: "a render pass (bundles keep the pass's rectangles)",
            });
        };
        let [x, y, w, h] = [rectangle[0], rectangle[1], rectangle[2], rectangle[3]];
        if x.checked_add(w).is_none_or(|right| right > width)
            || y.checked_add(h).is_none_or(|bottom| bottom > height)
        {
            return Err(MockError::OutOfRange { op, id: 0 });
        }
        Ok(())
    }

    fn create_texture(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        let texture = Texture {
            width: o[1],
            height: o[2],
            layers: o[3],
            format: o[4],
            usage: o[5],
            samples: o[6],
            mips: o[7],
            binding_view: o[8],
        };
        let binding_view = texture.binding_view;
        let largest = texture.width.max(texture.height).max(1);
        let most_mips = u32::BITS - largest.leading_zeros();
        let size_limit = BUDGET[Limit::TextureDimension2D as usize];
        let layer_limit = BUDGET[Limit::TextureArrayLayers as usize];
        check(
            (1..=size_limit).contains(&texture.width)
                && (1..=size_limit).contains(&texture.height)
                && (1..=layer_limit).contains(&texture.layers)
                && (1..=most_mips).contains(&texture.mips),
            op,
            "a texture's size, layers and mip levels must be at least 1 and within the portable budget",
        )?;
        check(
            texture.format != format::NONE && (texture.format as usize) < format::ALL.len(),
            op,
            "unknown texture format",
        )?;
        check(
            texture.format != format::BGRA8_UNORM,
            op,
            "WebGL2 has no BGRA texture: use CANVAS or RGBA8_UNORM",
        )?;
        check(
            binding_view == view::D2_ARRAY || (binding_view == view::D2 && texture.layers == 1),
            op,
            "the binding view is 2d for one layer or 2d-array",
        )?;
        let transient = texture.usage & texture_usage::TRANSIENT_ATTACHMENT != 0;
        check(
            !transient
                || (self.caps.contains(Capabilities::TRANSIENT_ATTACHMENTS)
                    && texture.usage
                        == texture_usage::RENDER_ATTACHMENT | texture_usage::TRANSIENT_ATTACHMENT),
            op,
            "a transient attachment needs its capability, and no usage but RENDER_ATTACHMENT",
        )?;
        match texture.samples {
            1 => {}
            4 => {
                check(
                    texture.layers == 1
                        && texture.mips == 1
                        && texture.usage & texture_usage::RENDER_ATTACHMENT != 0
                        && texture.usage & texture_usage::TEXTURE_BINDING == 0,
                    op,
                    "a multisampled texture is a render target of one layer and one mip level, which no bind group reads",
                )?;
                let float16 = texture.format == format::RGBA16_FLOAT
                    && self.caps.contains(Capabilities::MSAA_FLOAT16);
                check(
                    float16
                        || matches!(
                            texture.format,
                            format::CANVAS
                                | format::RGBA8_UNORM
                                | format::RGBA8_UNORM_SRGB
                                | format::DEPTH24_PLUS
                                | format::DEPTH32_FLOAT
                        ),
                    op,
                    "this format cannot be multisampled on every device",
                )?;
            }
            _ => return Err(invalid(op, "the sample count is 1 or 4")),
        }
        self.views.remove(&o[0]);
        self.textures.insert(o[0], texture);
        *self.generations.entry(o[0]).or_default() += 1;
        Ok(())
    }

    fn create_view(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        let texture = self.texture(op, o[1])?;
        if o[2] >= texture.mips || o[3] >= texture.layers {
            return Err(MockError::OutOfRange { op, id: o[1] });
        }
        check(
            texture.usage & texture_usage::RENDER_ATTACHMENT != 0,
            op,
            "a view is a render target, so its texture needs RENDER_ATTACHMENT usage",
        )?;
        let view = View {
            texture: o[1],
            generation: self.generations.get(&o[1]).copied().unwrap_or_default(),
            level: o[2],
        };
        self.textures.remove(&o[0]);
        self.views.insert(o[0], view);
        *self.generations.entry(o[0]).or_default() += 1;
        Ok(())
    }

    fn write_texture(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        let at = Location::read(o);
        let texture = self.texel_box(op, at, o[5], o[6], o[7])?;
        check(
            texture.usage & texture_usage::COPY_DST != 0,
            op,
            "a written texture needs COPY_DST usage",
        )?;
        let texel = format::texel_bytes(texture.format);
        check(
            texel > 0 && !format::is_depth(texture.format),
            op,
            "depth textures take no writes",
        )?;
        check(
            o[9] == o[5] * o[6] * o[7] * texel,
            op,
            "the byte length must match the box, in tightly packed rows",
        )?;
        self.write(op, Resource::Texture(at.texture))
    }

    fn upload_image(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        let at = Location::read(o);
        let (width, height, image, flags) = (o[5], o[6], o[7], o[8]);
        let (source_x, source_y) = (o[9], o[10]);
        let texture = self.texel_box(op, at, width, height, 1)?;
        let usage = texture_usage::COPY_DST | texture_usage::RENDER_ATTACHMENT;
        check(
            texture.usage & usage == usage,
            op,
            "an image upload needs COPY_DST and RENDER_ATTACHMENT usage",
        )?;
        check(
            IMAGE_FORMATS.contains(&texture.format),
            op,
            "images upload into RGBA8, sRGB RGBA8 and float RGBA textures",
        )?;
        check(
            flags & !(upload_flags::PREMULTIPLIED_ALPHA | upload_flags::RELEASE) == 0,
            op,
            "unknown upload flags",
        )?;
        let &(image_width, image_height) =
            self.images.get(&image).ok_or(missing(op, "image", image))?;
        let right = source_x.checked_add(width);
        let bottom = source_y.checked_add(height);
        if right.is_none_or(|r| r > image_width) || bottom.is_none_or(|b| b > image_height) {
            return Err(MockError::OutOfRange { op, id: image });
        }
        self.write(op, Resource::Texture(at.texture))?;
        if flags & upload_flags::RELEASE != 0 {
            self.images.remove(&image);
        }
        Ok(())
    }

    fn copy_texture(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        self.outside_passes(op)?;
        let (source, destination) = (Location::read(&o[0..5]), Location::read(&o[5..10]));
        let (width, height, layers) = (o[10], o[11], o[12]);
        let from = self.texel_box(op, source, width, height, layers)?;
        let to = self.texel_box(op, destination, width, height, layers)?;
        check(
            from.usage & texture_usage::COPY_SRC != 0 && to.usage & texture_usage::COPY_DST != 0,
            op,
            "a copy reads a texture with COPY_SRC usage into one with COPY_DST usage",
        )?;
        check(
            from.format == to.format,
            op,
            "a copy keeps the format: compatibility mode cannot reinterpret texels",
        )?;
        check(
            !format::is_depth(from.format),
            op,
            "depth textures do not copy, because WebGL2 cannot copy them",
        )?;
        let overlaps = source.texture == destination.texture
            && source.level == destination.level
            && source.layer < destination.layer + layers
            && destination.layer < source.layer + layers;
        check(
            !overlaps,
            op,
            "a copy within one texture reads and writes different layers or mip levels",
        )?;
        self.use_resource(Resource::Texture(source.texture));
        self.use_resource(Resource::Texture(destination.texture));
        Ok(())
    }

    /// Makes the mip levels of one layer, in render passes on WebGPU and blits on WebGL2: the
    /// texture must be an array that both paths can draw into and filter.
    fn generate_mipmaps(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        self.outside_passes(op)?;
        let texture = self.texture(op, o[0])?;
        let usage = texture_usage::TEXTURE_BINDING | texture_usage::RENDER_ATTACHMENT;
        check(
            texture.usage & usage == usage,
            op,
            "a texture whose mip levels are made needs TEXTURE_BINDING and RENDER_ATTACHMENT usage",
        )?;
        check(
            texture.binding_view == view::D2_ARRAY && texture.samples == 1,
            op,
            "mip levels are made for 2d-array textures of one sample",
        )?;
        check(
            format::makes_mipmaps(texture.format),
            op,
            "mip levels are made for RGBA8 and sRGB RGBA8 textures",
        )?;
        check(
            texture.mips > 1,
            op,
            "the texture has more than one mip level",
        )?;
        if o[1] >= texture.layers {
            return Err(MockError::OutOfRange { op, id: o[0] });
        }
        self.use_resource(Resource::Texture(o[0]));
        Ok(())
    }

    fn create_sampler(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        check(
            o[1..4].iter().all(|&mode| mode <= address::MIRROR_REPEAT),
            op,
            "unknown address mode",
        )?;
        check(
            o[4..7].iter().all(|&mode| mode <= filter::LINEAR),
            op,
            "unknown filter",
        )?;
        let (lod_min, lod_max) = (f32::from_bits(o[7]), f32::from_bits(o[8]));
        check(
            lod_min >= 0.0 && lod_max >= lod_min,
            op,
            "the lod clamps need 0 <= min <= max",
        )?;
        check(o[9] <= compare::ALWAYS, op, "unknown compare function")?;
        check(o[10] >= 1, op, "the anisotropy is at least 1")?;
        check(
            o[10] == 1 || o[4..7].iter().all(|&mode| mode == filter::LINEAR),
            op,
            "anisotropy needs every filter linear",
        )?;
        self.samplers.insert(o[0]);
        Ok(())
    }

    fn create_bind_group(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        let mut resources = Vec::new();
        for entry in o[3..].chunks(5) {
            let id = entry[2];
            match entry[1] {
                resource_kind::BUFFER => {
                    Self::require(self.buffers.contains_key(&id), op, "buffer", id)?;
                    resources.push(Resource::Buffer(id));
                }
                resource_kind::TEXTURE => {
                    let texture = self.texture(op, id)?;
                    check(
                        texture.usage & texture_usage::TEXTURE_BINDING != 0,
                        op,
                        "a bound texture needs TEXTURE_BINDING usage",
                    )?;
                    resources.push(Resource::Texture(id));
                }
                resource_kind::SAMPLER => {
                    Self::require(self.samplers.contains(&id), op, "sampler", id)?;
                }
                _ => return Err(invalid(op, "unknown resource kind")),
            }
        }
        self.bind_groups.insert(o[0], resources);
        Ok(())
    }

    fn begin_render_pass(&mut self, op: Op, o: &[u32]) -> Result<(), MockError> {
        self.outside_passes(op)?;
        let optional = |id: u32| -> Result<Option<Target>, MockError> {
            if id == NO_TARGET {
                Ok(None)
            } else {
                self.target(op, id).map(Some)
            }
        };
        let (color, resolve, depth) = (optional(o[0])?, optional(o[1])?, optional(o[2])?);
        check(
            color.is_some() || depth.is_some(),
            op,
            "a render pass draws into a color target, a depth target or both",
        )?;
        if let Some(color) = color {
            check(
                !format::is_depth(color.format),
                op,
                "the color target has a color format",
            )?;
        }
        if let Some(depth) = depth {
            check(
                format::is_depth(depth.format),
                op,
                "the depth target has a depth format",
            )?;
        }
        if let Some(resolve) = resolve {
            let Some(color) = color else {
                return Err(invalid(op, "a resolve needs a color target"));
            };
            check(
                color.samples > 1 && resolve.samples == 1,
                op,
                "a resolve reads a multisampled color target into one sample",
            )?;
            check(
                (color.width, color.height) == (resolve.width, resolve.height)
                    || resolve.texture.is_none() && self.canvas.is_none(),
                op,
                "a resolve target has the color target's size",
            )?;
            check(
                color.format == resolve.format,
                op,
                "a resolve target has the color target's format",
            )?;
        }
        if let (Some(color), Some(depth)) = (color, depth) {
            check(
                color.samples == depth.samples,
                op,
                "the color and depth targets have one sample count",
            )?;
            check(
                (color.width, color.height) == (depth.width, depth.height)
                    || color.texture.is_none() && self.canvas.is_none(),
                op,
                "the color and depth targets have one size",
            )?;
        }
        let targets = [color, resolve, depth].map(|target| target.and_then(|t| t.texture));
        for texture in targets.into_iter().flatten() {
            self.use_resource(Resource::Texture(texture));
        }
        let size = color.or(depth).expect("checked above");
        self.pass = Some(Pass {
            width: size.width,
            height: size.height,
            targets,
        });
        self.pipeline_set = false;
        self.vertex_buffer_set = false;
        self.index_buffer_set = false;
        Ok(())
    }

    fn execute(&mut self, Command { op, operands: o }: Command<'_>) -> Result<(), MockError> {
        match op {
            Op::CreateBuffer => {
                self.buffers.insert(o[0], o[1]);
            }
            Op::WriteBuffer => {
                let size = *self.buffers.get(&o[0]).ok_or(missing(op, "buffer", o[0]))?;
                if o[1] + o[3] > size {
                    return Err(MockError::OutOfRange { op, id: o[0] });
                }
                self.write(op, Resource::Buffer(o[0]))?;
            }
            Op::ClearBuffer => {
                self.outside_passes(op)?;
                let size = *self.buffers.get(&o[0]).ok_or(missing(op, "buffer", o[0]))?;
                if o[1] + o[2] > size {
                    return Err(MockError::OutOfRange { op, id: o[0] });
                }
                self.use_resource(Resource::Buffer(o[0]));
            }
            Op::WriteTexture => self.write_texture(op, o)?,
            Op::DestroyBuffer => {
                self.buffers.remove(&o[0]);
            }
            Op::CreateTexture => self.create_texture(op, o)?,
            Op::CreateTextureView => self.create_view(op, o)?,
            Op::DestroyTexture => {
                self.textures.remove(&o[0]);
                self.views.remove(&o[0]);
                *self.generations.entry(o[0]).or_default() += 1;
            }
            Op::UploadImage => self.upload_image(op, o)?,
            Op::GenerateMipmaps => self.generate_mipmaps(op, o)?,
            Op::ReleaseImage => {
                self.images.remove(&o[0]);
            }
            Op::CopyTextureToTexture => self.copy_texture(op, o)?,
            Op::CreateSampler => self.create_sampler(op, o)?,
            Op::ResizeCanvas => {
                self.outside_passes(op)?;
                if o[0] == 0 || o[1] == 0 {
                    return Err(MockError::OutOfRange { op, id: 0 });
                }
                self.canvas = Some((o[0], o[1]));
            }
            Op::CreateRenderPipeline => {
                check(
                    o.len() == 8 && o[7] & !vertex::ALL == 0,
                    op,
                    "a render pipeline names a vertex format of known attributes",
                )?;
                check(
                    o[2] & !permutation::ALL == 0,
                    op,
                    "a render pipeline's permutation word holds known bits only",
                )?;
                check(
                    o[3] == format::NONE || !format::is_depth(o[3]),
                    op,
                    "the color format is a color format or NONE",
                )?;
                check(
                    o[4] == format::NONE || format::is_depth(o[4]),
                    op,
                    "the depth format is a depth format or NONE",
                )?;
                check(
                    o[3] != format::NONE || o[4] != format::NONE,
                    op,
                    "a render pipeline writes color, depth or both",
                )?;
                check(matches!(o[5], 1 | 4), op, "the sample count is 1 or 4")?;
                check(
                    o[6] & !state_flags::ALL == 0,
                    op,
                    "a render pipeline sets known state flags",
                )?;
                self.render_pipelines.insert(o[0]);
            }
            Op::CreateComputePipeline => {
                self.compute_pipelines.insert(o[0]);
            }
            Op::CreateBindGroup => self.create_bind_group(op, o)?,
            Op::BeginRenderPass => self.begin_render_pass(op, o)?,
            Op::BeginBundle => {
                self.outside_passes(op)?;
                self.recording = Some((o[0], Vec::new()));
                self.pipeline_set = false;
                self.vertex_buffer_set = false;
                self.index_buffer_set = false;
            }
            Op::EndBundle => {
                let (id, uses) = self.recording.take().ok_or(MockError::Outside {
                    op,
                    needs: "a bundle",
                })?;
                self.bundles.insert(id, uses);
            }
            Op::SetPipeline => {
                if !self.in_draw_scope() {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass or bundle",
                    });
                }
                Self::require(
                    self.render_pipelines.contains(&o[0]),
                    op,
                    "render pipeline",
                    o[0],
                )?;
                self.pipeline_set = true;
            }
            Op::SetBindGroup => {
                if !self.in_draw_scope() && !self.in_compute_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass, bundle or compute pass",
                    });
                }
                let resources =
                    self.bind_groups
                        .get(&o[1])
                        .cloned()
                        .ok_or(missing(op, "bind group", o[1]))?;
                if let Some(&offset) = o[3..3 + o[2] as usize]
                    .iter()
                    .find(|&&offset| offset % OFFSET_ALIGNMENT != 0)
                {
                    return Err(MockError::Unaligned { op, offset });
                }
                for resource in resources {
                    self.read_resource(op, resource)?;
                }
            }
            Op::SetVertexBuffer => {
                Self::require(self.buffers.contains_key(&o[1]), op, "buffer", o[1])?;
                self.use_resource(Resource::Buffer(o[1]));
                self.vertex_buffer_set = true;
            }
            Op::SetIndexBuffer => {
                Self::require(self.buffers.contains_key(&o[0]), op, "buffer", o[0])?;
                self.use_resource(Resource::Buffer(o[0]));
                self.index_buffer_set = true;
            }
            Op::SetViewport => {
                self.in_pass_rectangle(op, o)?;
                let (near, far) = (f32::from_bits(o[4]), f32::from_bits(o[5]));
                check(
                    (0.0..=1.0).contains(&near) && (near..=1.0).contains(&far),
                    op,
                    "the depth range needs 0 <= min <= max <= 1",
                )?;
            }
            Op::SetScissor => self.in_pass_rectangle(op, o)?,
            Op::Draw | Op::DrawIndexed | Op::DrawIndexedIndirect | Op::MultiDrawIndexed => {
                if !self.in_draw_scope() {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass or bundle",
                    });
                }
                if !self.pipeline_set {
                    return Err(MockError::NotReady {
                        op,
                        what: "a pipeline",
                    });
                }
                // Indexed draws draw the engine's meshes, which always read vertex buffers. A
                // non-indexed draw may make its vertices in the shader.
                if op != Op::Draw && !self.vertex_buffer_set {
                    return Err(MockError::NotReady {
                        op,
                        what: "a vertex buffer",
                    });
                }
                if op != Op::Draw && !self.index_buffer_set {
                    return Err(MockError::NotReady {
                        op,
                        what: "an index buffer",
                    });
                }
                if op == Op::DrawIndexedIndirect {
                    Self::require(
                        self.buffers.contains_key(&o[0]),
                        op,
                        "indirect buffer",
                        o[0],
                    )?;
                    self.use_resource(Resource::Buffer(o[0]));
                }
                self.draws += if op == Op::MultiDrawIndexed { o[0] } else { 1 };
            }
            Op::ExecuteBundles => {
                if self.pass.is_none() {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass",
                    });
                }
                for &id in &o[1..1 + o[0] as usize] {
                    let uses = self
                        .bundles
                        .get(&id)
                        .ok_or(missing(op, "bundle", id))?
                        .clone();
                    for resource in uses {
                        self.read_resource(op, resource)?;
                    }
                }
                // WebGPU clears the pass's pipeline and buffers after it replays bundles, so a
                // draw after them sets its own.
                self.pipeline_set = false;
                self.vertex_buffer_set = false;
                self.index_buffer_set = false;
            }
            Op::EndRenderPass => {
                if self.pass.take().is_none() {
                    return Err(MockError::Outside {
                        op,
                        needs: "a render pass",
                    });
                }
            }
            Op::BeginComputePass => {
                self.outside_passes(op)?;
                self.in_compute_pass = true;
            }
            Op::SetComputePipeline => {
                if !self.in_compute_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "a compute pass",
                    });
                }
                Self::require(
                    self.compute_pipelines.contains(&o[0]),
                    op,
                    "compute pipeline",
                    o[0],
                )?;
            }
            Op::Dispatch => {
                if !self.in_compute_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "a compute pass",
                    });
                }
                self.dispatches += 1;
            }
            Op::EndComputePass => {
                if !self.in_compute_pass {
                    return Err(MockError::Outside {
                        op,
                        needs: "a compute pass",
                    });
                }
                self.in_compute_pass = false;
            }
            Op::CopyBufferToBuffer => {
                self.outside_passes(op)?;
                for (id, offset) in [(o[0], o[1]), (o[2], o[3])] {
                    let size = *self.buffers.get(&id).ok_or(missing(op, "buffer", id))?;
                    if offset + o[4] > size {
                        return Err(MockError::OutOfRange { op, id });
                    }
                    if offset % 4 != 0 {
                        return Err(MockError::Unaligned { op, offset });
                    }
                    self.use_resource(Resource::Buffer(id));
                }
            }
            Op::Submit => {
                self.outside_passes(op)?;
                self.used.clear();
                self.submits += 1;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawlist::{DrawList, buffer_usage, index_format, layout, pass_flags, template};

    const MSAA_COLOR: u32 = 5;
    const MSAA_DEPTH: u32 = 1;

    fn setup(list: &mut DrawList) {
        list.push(
            Op::CreateBuffer,
            &[1, 4096, buffer_usage::VERTEX | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(
            Op::CreateBuffer,
            &[2, 1024, buffer_usage::INDEX | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(
            Op::CreateBuffer,
            &[3, 512, buffer_usage::UNIFORM | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(
            Op::CreateBuffer,
            &[4, 64, buffer_usage::INDIRECT | buffer_usage::STORAGE],
        )
        .unwrap();
        list.push(
            Op::CreateRenderPipeline,
            &[1, 1, 0, format::CANVAS, format::DEPTH32_FLOAT, 4, 0, 0],
        )
        .unwrap();
        list.push(Op::CreateBindGroup, &[1, layout::FRAME, 1, 0, 0, 3, 0, 256])
            .unwrap();
        for (id, target_format) in [
            (MSAA_DEPTH, format::DEPTH32_FLOAT),
            (MSAA_COLOR, format::CANVAS),
        ] {
            list.push(
                Op::CreateTexture,
                &[
                    id,
                    64,
                    64,
                    1,
                    target_format,
                    texture_usage::RENDER_ATTACHMENT,
                    4,
                    1,
                    view::D2,
                ],
            )
            .unwrap();
        }
    }

    /// Begins the scene pass as the frame builders do: 4x MSAA color resolved into the canvas,
    /// with MSAA depth.
    fn begin_scene_pass(list: &mut DrawList) {
        let flags = pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH;
        list.push(
            Op::BeginRenderPass,
            &[MSAA_COLOR, 0, MSAA_DEPTH, 0, 0, 0, 0x3f80_0000, 0, flags],
        )
        .unwrap();
    }

    fn draw_bucket(list: &mut DrawList) {
        list.push(Op::SetPipeline, &[1]).unwrap();
        list.push(Op::SetBindGroup, &[0, 1, 1, 256]).unwrap();
        list.push(Op::SetVertexBuffer, &[0, 1, 0, 0]).unwrap();
        list.push(Op::SetIndexBuffer, &[2, index_format::UINT16, 0, 0])
            .unwrap();
        list.push(Op::DrawIndexedIndirect, &[4, 0]).unwrap();
    }

    #[test]
    fn a_valid_frame_with_a_bundle_replays() {
        let mut list = DrawList::with_capacity(256);
        setup(&mut list);
        list.push(Op::ResizeCanvas, &[64, 64]).unwrap();
        list.push(Op::WriteBuffer, &[1, 0, 0x1000, 4096]).unwrap();
        list.push(
            Op::BeginBundle,
            &[9, format::CANVAS, format::DEPTH32_FLOAT, 4],
        )
        .unwrap();
        draw_bucket(&mut list);
        list.push(Op::EndBundle, &[]).unwrap();
        begin_scene_pass(&mut list);
        list.push(Op::ExecuteBundles, &[1, 9]).unwrap();
        list.push(Op::EndRenderPass, &[]).unwrap();
        list.push(Op::Submit, &[]).unwrap();

        let mut backend = MockBackend::default();
        assert_eq!(backend.replay(list.words()), Ok(()));
        assert_eq!((backend.draws, backend.submits), (1, 1));
    }

    /// A frame that replays a bundle, then draws lines from a vertex buffer of their own with
    /// `lines`, the commands after the bundle.
    fn lines_after_a_bundle(lines: &[(Op, &[u32])]) -> DrawList {
        let mut list = DrawList::with_capacity(256);
        setup(&mut list);
        list.push(
            Op::CreateRenderPipeline,
            &[
                2,
                template::DEBUG_LINES,
                0,
                format::CANVAS,
                format::DEPTH32_FLOAT,
                4,
                state_flags::LINE_LIST,
                0,
            ],
        )
        .unwrap();
        list.push(
            Op::CreateBuffer,
            &[5, 256, buffer_usage::VERTEX | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(Op::ResizeCanvas, &[64, 64]).unwrap();
        list.push(
            Op::BeginBundle,
            &[9, format::CANVAS, format::DEPTH32_FLOAT, 4],
        )
        .unwrap();
        draw_bucket(&mut list);
        list.push(Op::EndBundle, &[]).unwrap();
        begin_scene_pass(&mut list);
        list.push(Op::ExecuteBundles, &[1, 9]).unwrap();
        for &(op, operands) in lines {
            list.push(op, operands).unwrap();
        }
        list.push(Op::EndRenderPass, &[]).unwrap();
        list
    }

    #[test]
    fn draws_after_a_bundle_set_their_own_pipeline_and_lines_draw_from_a_vertex_buffer() {
        let lines = lines_after_a_bundle(&[
            (Op::SetPipeline, &[2]),
            (Op::SetBindGroup, &[0, 1, 1, 256]),
            (Op::SetVertexBuffer, &[0, 5, 0, 64]),
            (Op::Draw, &[4, 1, 0, 0]),
        ]);
        let mut backend = MockBackend::default();
        assert_eq!(backend.replay(lines.words()), Ok(()));
        assert_eq!(backend.draws, 2);

        // WebGPU forgets the bundle's pipeline once the pass has replayed it.
        let no_pipeline = lines_after_a_bundle(&[(Op::Draw, &[4, 1, 0, 0])]);
        assert_eq!(
            MockBackend::default().replay(no_pipeline.words()),
            Err(MockError::NotReady {
                op: Op::Draw,
                what: "a pipeline"
            })
        );

        let mut unknown = DrawList::with_capacity(64);
        let flags = state_flags::ALL + 1;
        unknown
            .push(
                Op::CreateRenderPipeline,
                &[1, 1, 0, format::CANVAS, format::NONE, 1, flags, 0],
            )
            .unwrap();
        assert_eq!(
            MockBackend::default().replay(unknown.words()),
            Err(MockError::Invalid {
                op: Op::CreateRenderPipeline,
                rule: "a render pipeline sets known state flags"
            })
        );
    }

    #[test]
    fn a_frame_that_reads_instances_from_data_textures_replays() {
        let mut list = DrawList::with_capacity(256);
        setup(&mut list);
        list.push(
            Op::CreateTexture,
            &[
                2,
                1536,
                4,
                1,
                format::RGBA32_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )
        .unwrap();
        list.push(
            Op::CreateBindGroup,
            &[2, layout::INSTANCES, 1, 0, resource_kind::TEXTURE, 2, 0, 0],
        )
        .unwrap();
        list.push(
            Op::WriteTexture,
            &[2, 0, 0, 0, 0, 1536, 4, 1, 0x1000, 1536 * 4 * 16],
        )
        .unwrap();
        begin_scene_pass(&mut list);
        list.push(Op::SetPipeline, &[1]).unwrap();
        list.push(Op::SetBindGroup, &[2, 2, 0]).unwrap();
        list.push(Op::SetVertexBuffer, &[0, 1, 0, 0]).unwrap();
        list.push(Op::SetIndexBuffer, &[2, index_format::UINT16, 0, 0])
            .unwrap();
        list.push(Op::MultiDrawIndexed, &[3, 0x2000, 0x2010, 0x2020])
            .unwrap();
        list.push(Op::EndRenderPass, &[]).unwrap();

        let mut backend = MockBackend::default();
        assert_eq!(backend.replay(list.words()), Ok(()));
        assert_eq!(backend.draws, 3, "each draw of a multi-draw counts");

        let mut past_the_edge = DrawList::with_capacity(256);
        setup(&mut past_the_edge);
        past_the_edge
            .push(
                Op::CreateTexture,
                &[
                    2,
                    64,
                    64,
                    1,
                    format::RGBA32_FLOAT,
                    texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                    1,
                    1,
                    view::D2,
                ],
            )
            .unwrap();
        past_the_edge
            .push(
                Op::WriteTexture,
                &[2, 0, 32, 60, 0, 64, 8, 1, 0x1000, 64 * 8 * 16],
            )
            .unwrap();
        assert!(matches!(
            MockBackend::default().replay(past_the_edge.words()),
            Err(MockError::OutOfRange { .. })
        ));
    }

    #[test]
    fn the_mock_rejects_what_a_real_gpu_would() {
        let run = |build: &dyn Fn(&mut DrawList)| {
            let mut list = DrawList::with_capacity(256);
            setup(&mut list);
            build(&mut list);
            MockBackend::default().replay(list.words())
        };
        assert!(matches!(
            run(&|l| l.push(Op::WriteBuffer, &[1, 4000, 0, 200]).unwrap()),
            Err(MockError::OutOfRange { .. })
        ));
        assert!(matches!(
            run(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[0, NO_TARGET, NO_TARGET, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
                l.push(Op::DrawIndexed, &[36, 1, 0, 0, 0]).unwrap();
            }),
            Err(MockError::NotReady {
                what: "a pipeline",
                ..
            })
        ));
        assert!(matches!(
            run(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[0, NO_TARGET, NO_TARGET, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
                l.push(Op::SetBindGroup, &[0, 1, 1, 100]).unwrap();
            }),
            Err(MockError::Unaligned { offset: 100, .. })
        ));
        assert!(matches!(
            run(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[0, NO_TARGET, NO_TARGET, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
                l.push(Op::ExecuteBundles, &[1, 42]).unwrap();
            }),
            Err(MockError::Missing {
                what: "bundle",
                id: 42,
                ..
            })
        ));
        assert!(matches!(
            run(&|l| l.push(Op::Dispatch, &[1, 1, 1]).unwrap()),
            Err(MockError::Outside { .. })
        ));
        assert!(
            matches!(
                run(&|l| {
                    l.push(
                        Op::BeginRenderPass,
                        &[0, NO_TARGET, MSAA_DEPTH, 0, 0, 0, 0, 0, 0],
                    )
                    .unwrap();
                }),
                Err(MockError::Invalid { .. })
            ),
            "the one-sample canvas cannot pair with multisampled depth"
        );
    }

    // Ids of the texture test below.
    const PATTERN: u32 = 10;
    const DEPTHS: u32 = 11;
    const DEPTH_LAYER: u32 = 12;
    const IMAGES: u32 = 13;
    const SRGB: u32 = 14;
    const MIPS: u32 = 15;
    const MIP_VIEW: u32 = 16;
    const COLOR_SAMPLER: u32 = 1;
    const COMPARE_SAMPLER: u32 = 2;
    const IMAGE: u32 = 7;

    fn sampler(list: &mut DrawList, id: u32, filtering: u32, function: u32, anisotropy: u32) {
        let [lod_min, lod_max] = [0f32.to_bits(), 32f32.to_bits()];
        list.push(
            Op::CreateSampler,
            &[
                id,
                address::REPEAT,
                address::MIRROR_REPEAT,
                address::CLAMP_TO_EDGE,
                filtering,
                filtering,
                filtering,
                lod_min,
                lod_max,
                function,
                anisotropy,
            ],
        )
        .unwrap();
    }

    fn texture(
        list: &mut DrawList,
        id: u32,
        size: [u32; 4],
        texels: u32,
        usage: u32,
        dimension: u32,
    ) {
        let [width, height, layers, mips] = size;
        list.push(
            Op::CreateTexture,
            &[id, width, height, layers, texels, usage, 1, mips, dimension],
        )
        .unwrap();
    }

    /// Textures, views and samplers for every texture command, before any of them is used.
    fn texture_setup(list: &mut DrawList) {
        use texture_usage::{COPY_DST, COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING};
        let sampled = TEXTURE_BINDING | COPY_DST;
        texture(
            list,
            PATTERN,
            [8, 8, 2, 1],
            format::RGBA8_UNORM,
            sampled,
            view::D2_ARRAY,
        );
        texture(
            list,
            DEPTHS,
            [64, 64, 2, 1],
            format::DEPTH32_FLOAT,
            RENDER_ATTACHMENT | TEXTURE_BINDING,
            view::D2_ARRAY,
        );
        texture(
            list,
            IMAGES,
            [64, 64, 2, 1],
            format::RGBA8_UNORM,
            sampled | COPY_SRC | RENDER_ATTACHMENT,
            view::D2_ARRAY,
        );
        texture(
            list,
            SRGB,
            [4, 4, 1, 1],
            format::RGBA8_UNORM_SRGB,
            sampled,
            view::D2,
        );
        texture(
            list,
            MIPS,
            [16, 16, 1, 3],
            format::RGBA8_UNORM,
            sampled | RENDER_ATTACHMENT,
            view::D2_ARRAY,
        );
        list.push(Op::CreateTextureView, &[DEPTH_LAYER, DEPTHS, 0, 1])
            .unwrap();
        list.push(Op::CreateTextureView, &[MIP_VIEW, MIPS, 2, 0])
            .unwrap();
        sampler(list, COLOR_SAMPLER, filter::LINEAR, compare::NONE, 4);
        sampler(list, COMPARE_SAMPLER, filter::LINEAR, compare::LESS, 1);
        list.push(
            Op::CreateBindGroup,
            &[
                3,
                20,
                4,
                0,
                resource_kind::TEXTURE,
                PATTERN,
                0,
                0,
                1,
                resource_kind::SAMPLER,
                COLOR_SAMPLER,
                0,
                0,
                2,
                resource_kind::TEXTURE,
                DEPTHS,
                0,
                0,
                3,
                resource_kind::SAMPLER,
                COMPARE_SAMPLER,
                0,
                0,
            ],
        )
        .unwrap();
        list.push(
            Op::CreateRenderPipeline,
            &[2, 20, 0, format::NONE, format::DEPTH32_FLOAT, 1, 0, 0],
        )
        .unwrap();
        list.push(
            Op::CreateRenderPipeline,
            &[3, 20, 0, format::RGBA8_UNORM, format::NONE, 1, 0, 0],
        )
        .unwrap();
        list.push(
            Op::CreateRenderPipeline,
            &[4, 20, 0, format::CANVAS, format::NONE, 1, 0, 0],
        )
        .unwrap();
    }

    /// Uploads and copies, then depth into one layer, color into one mip level, and a pass into
    /// the canvas that samples it all through viewports and a scissor.
    fn texture_frame(list: &mut DrawList) {
        list.push(
            Op::WriteTexture,
            &[PATTERN, 0, 0, 0, 0, 8, 8, 2, 0x1000, 8 * 8 * 2 * 4],
        )
        .unwrap();
        list.push(
            Op::WriteTexture,
            &[SRGB, 0, 0, 0, 0, 4, 4, 1, 0x2000, 4 * 4 * 4],
        )
        .unwrap();
        list.push(
            Op::UploadImage,
            &[
                IMAGES,
                0,
                16,
                8,
                0,
                32,
                32,
                IMAGE,
                upload_flags::RELEASE,
                0,
                0,
            ],
        )
        .unwrap();
        list.push(
            Op::CopyTextureToTexture,
            &[IMAGES, 0, 16, 8, 0, IMAGES, 0, 0, 40, 1, 32, 16, 1],
        )
        .unwrap();
        list.push(
            Op::BeginRenderPass,
            &[
                NO_TARGET,
                NO_TARGET,
                DEPTH_LAYER,
                0,
                0,
                0,
                0,
                0,
                pass_flags::CLEAR_DEPTH | pass_flags::STORE_DEPTH,
            ],
        )
        .unwrap();
        list.push(Op::SetPipeline, &[2]).unwrap();
        list.push(Op::SetScissor, &[16, 16, 32, 32]).unwrap();
        list.push(Op::Draw, &[6, 1, 0, 0]).unwrap();
        list.push(Op::EndRenderPass, &[]).unwrap();
        list.push(
            Op::BeginRenderPass,
            &[
                MIP_VIEW,
                NO_TARGET,
                NO_TARGET,
                0,
                0,
                0,
                0,
                0,
                pass_flags::CLEAR_COLOR | pass_flags::STORE_COLOR,
            ],
        )
        .unwrap();
        list.push(Op::SetPipeline, &[3]).unwrap();
        list.push(Op::SetViewport, &[0, 0, 2, 2, 0, 1f32.to_bits()])
            .unwrap();
        list.push(Op::Draw, &[6, 1, 0, 0]).unwrap();
        list.push(Op::EndRenderPass, &[]).unwrap();
        list.push(
            Op::BeginRenderPass,
            &[
                0,
                NO_TARGET,
                NO_TARGET,
                0,
                0,
                0,
                0,
                0,
                pass_flags::CLEAR_COLOR | pass_flags::STORE_COLOR,
            ],
        )
        .unwrap();
        list.push(Op::SetPipeline, &[4]).unwrap();
        list.push(Op::SetBindGroup, &[1, 3, 0]).unwrap();
        list.push(Op::SetViewport, &[64, 0, 64, 64, 0, 1f32.to_bits()])
            .unwrap();
        list.push(Op::SetScissor, &[64, 0, 32, 16]).unwrap();
        list.push(Op::Draw, &[6, 1, 0, 0]).unwrap();
        list.push(Op::EndRenderPass, &[]).unwrap();
        list.push(Op::Submit, &[]).unwrap();
    }

    /// Replays the shared setup, a canvas of 256 x 256, the texture setup and the image, then `build`.
    fn run_textures(build: &dyn Fn(&mut DrawList)) -> Result<(), MockError> {
        let mut list = DrawList::with_capacity(1024);
        setup(&mut list);
        list.push(Op::ResizeCanvas, &[256, 256]).unwrap();
        texture_setup(&mut list);
        build(&mut list);
        let mut backend = MockBackend::default();
        backend.provide_image(IMAGE, 32, 32);
        backend.replay(list.words())
    }

    #[test]
    fn a_frame_that_uses_every_texture_command_replays() {
        let mut list = DrawList::with_capacity(1024);
        setup(&mut list);
        list.push(Op::ResizeCanvas, &[256, 256]).unwrap();
        texture_setup(&mut list);
        texture_frame(&mut list);
        let mut backend = MockBackend::default();
        backend.provide_image(IMAGE, 32, 32);
        assert_eq!(backend.replay(list.words()), Ok(()));
        assert_eq!((backend.draws, backend.submits), (3, 1));
        assert!(backend.images.is_empty(), "the upload released its image");
    }

    #[test]
    fn render_targets_are_one_layer_and_one_level_of_a_live_texture() {
        let several_layers = run_textures(&|l| {
            l.push(
                Op::BeginRenderPass,
                &[
                    NO_TARGET,
                    NO_TARGET,
                    DEPTHS,
                    0,
                    0,
                    0,
                    0,
                    0,
                    pass_flags::CLEAR_DEPTH,
                ],
            )
            .unwrap();
        });
        assert!(matches!(several_layers, Err(MockError::Invalid { .. })));
        let remade = run_textures(&|l| {
            texture(
                l,
                MIPS,
                [16, 16, 1, 3],
                format::RGBA8_UNORM,
                texture_usage::RENDER_ATTACHMENT,
                view::D2,
            );
            l.push(
                Op::BeginRenderPass,
                &[
                    MIP_VIEW,
                    NO_TARGET,
                    NO_TARGET,
                    0,
                    0,
                    0,
                    0,
                    0,
                    pass_flags::CLEAR_COLOR,
                ],
            )
            .unwrap();
        });
        assert!(
            matches!(remade, Err(MockError::Invalid { rule, .. }) if rule.contains("outlived")),
            "{remade:?}"
        );
        assert!(matches!(
            run_textures(&|l| l.push(Op::CreateTextureView, &[20, MIPS, 3, 0]).unwrap()),
            Err(MockError::OutOfRange { .. })
        ));
        assert!(matches!(
            run_textures(&|l| {
                l.push(
                    Op::CreateBindGroup,
                    &[9, 20, 1, 0, resource_kind::TEXTURE, MIP_VIEW, 0, 0],
                )
                .unwrap();
            }),
            Err(MockError::Invalid { .. })
        ));
    }

    #[test]
    fn viewports_and_scissors_stay_inside_render_passes_and_their_targets() {
        let in_pass = |command: (Op, [u32; 6])| {
            run_textures(&move |l| {
                l.push(
                    Op::BeginRenderPass,
                    &[
                        MIP_VIEW,
                        NO_TARGET,
                        NO_TARGET,
                        0,
                        0,
                        0,
                        0,
                        0,
                        pass_flags::CLEAR_COLOR,
                    ],
                )
                .unwrap();
                let (op, operands) = command;
                let count = if op == Op::SetScissor { 4 } else { 6 };
                l.push(op, &operands[..count]).unwrap();
            })
        };
        let one = 1f32.to_bits();
        assert_eq!(in_pass((Op::SetViewport, [0, 0, 4, 4, 0, one])), Ok(()));
        assert!(matches!(
            in_pass((Op::SetViewport, [2, 0, 4, 4, 0, one])),
            Err(MockError::OutOfRange { .. })
        ));
        assert!(matches!(
            in_pass((Op::SetViewport, [0, 0, 4, 4, one, 0])),
            Err(MockError::Invalid { .. })
        ));
        assert!(matches!(
            in_pass((Op::SetScissor, [0, 3, 4, 2, 0, 0])),
            Err(MockError::OutOfRange { .. })
        ));
        let in_bundle = run_textures(&|l| {
            l.push(Op::BeginBundle, &[1, format::CANVAS, format::NONE, 1])
                .unwrap();
            l.push(Op::SetScissor, &[0, 0, 1, 1]).unwrap();
        });
        assert!(matches!(in_bundle, Err(MockError::Outside { .. })));
    }

    #[test]
    fn copies_and_uploads_follow_the_rules_of_both_paths() {
        let rejects = |build: &dyn Fn(&mut DrawList)| {
            matches!(run_textures(build), Err(MockError::Invalid { .. }))
        };
        assert!(
            rejects(&|l| l
                .push(
                    Op::CopyTextureToTexture,
                    &[PATTERN, 0, 0, 0, 0, IMAGES, 0, 0, 0, 0, 8, 8, 1]
                )
                .unwrap()),
            "a copy source needs COPY_SRC usage"
        );
        assert!(
            rejects(&|l| l
                .push(
                    Op::CopyTextureToTexture,
                    &[IMAGES, 0, 0, 0, 0, IMAGES, 0, 8, 8, 0, 8, 8, 1]
                )
                .unwrap()),
            "a copy within one layer overlaps itself"
        );
        assert!(
            rejects(&|l| l
                .push(
                    Op::UploadImage,
                    &[PATTERN, 0, 0, 0, 0, 8, 8, IMAGE, 0, 0, 0]
                )
                .unwrap()),
            "an image needs RENDER_ATTACHMENT usage on its texture"
        );
        assert!(
            rejects(&|l| l
                .push(Op::WriteTexture, &[DEPTHS, 0, 0, 0, 0, 4, 4, 1, 0, 64])
                .unwrap()),
            "depth textures take no writes"
        );
        assert!(
            rejects(&|l| l
                .push(Op::WriteTexture, &[PATTERN, 0, 0, 0, 0, 8, 8, 1, 0, 100])
                .unwrap()),
            "the byte length matches the box"
        );
        assert!(matches!(
            run_textures(&|l| {
                l.push(
                    Op::UploadImage,
                    &[
                        IMAGES,
                        0,
                        0,
                        0,
                        0,
                        32,
                        32,
                        IMAGE,
                        upload_flags::RELEASE,
                        0,
                        0,
                    ],
                )
                .unwrap();
                l.push(
                    Op::UploadImage,
                    &[IMAGES, 0, 0, 0, 1, 32, 32, IMAGE, 0, 0, 0],
                )
                .unwrap();
            }),
            Err(MockError::Missing { what: "image", .. })
        ));
        assert!(matches!(
            run_textures(&|l| l
                .push(
                    Op::UploadImage,
                    &[IMAGES, 0, 0, 0, 0, 33, 32, IMAGE, 0, 0, 0]
                )
                .unwrap()),
            Err(MockError::OutOfRange { .. })
        ));
        assert!(matches!(
            run_textures(&|l| l
                .push(
                    Op::UploadImage,
                    &[IMAGES, 0, 0, 0, 0, 32, 8, IMAGE, 0, 0, 25]
                )
                .unwrap()),
            Err(MockError::OutOfRange { .. })
        ));
        assert!(matches!(
            run_textures(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[
                        0,
                        NO_TARGET,
                        NO_TARGET,
                        0,
                        0,
                        0,
                        0,
                        0,
                        pass_flags::CLEAR_COLOR,
                    ],
                )
                .unwrap();
                l.push(
                    Op::CopyTextureToTexture,
                    &[IMAGES, 0, 0, 0, 0, IMAGES, 0, 0, 0, 1, 8, 8, 1],
                )
                .unwrap();
            }),
            Err(MockError::Outside { .. })
        ));
    }

    #[test]
    fn mip_levels_are_made_for_color_arrays_outside_passes_and_images_release_once() {
        let upload = |l: &mut DrawList, flags: u32| {
            l.push(
                Op::UploadImage,
                &[IMAGES, 0, 0, 0, 0, 32, 16, IMAGE, flags, 0, 16],
            )
            .unwrap();
        };
        assert_eq!(
            run_textures(&|l| {
                l.push(Op::WriteTexture, &[MIPS, 0, 0, 0, 0, 16, 16, 1, 0, 1024])
                    .unwrap();
                l.push(Op::GenerateMipmaps, &[MIPS, 0]).unwrap();
                upload(l, 0);
                l.push(Op::ReleaseImage, &[IMAGE]).unwrap();
            }),
            Ok(())
        );
        let rule = |build: &dyn Fn(&mut DrawList)| match run_textures(build) {
            Err(MockError::Invalid { rule, .. }) => rule,
            other => panic!("expected a broken rule, got {other:?}"),
        };
        assert!(rule(&|l| l.push(Op::GenerateMipmaps, &[PATTERN, 0]).unwrap()).contains("usage"));
        assert!(
            rule(&|l| {
                texture(
                    l,
                    40,
                    [16, 16, 1, 3],
                    format::RGBA8_UNORM,
                    texture_usage::TEXTURE_BINDING | texture_usage::RENDER_ATTACHMENT,
                    view::D2,
                );
                l.push(Op::GenerateMipmaps, &[40, 0]).unwrap();
            })
            .contains("2d-array")
        );
        assert!(
            rule(&|l| {
                texture(
                    l,
                    40,
                    [16, 16, 1, 1],
                    format::RGBA8_UNORM,
                    texture_usage::TEXTURE_BINDING | texture_usage::RENDER_ATTACHMENT,
                    view::D2_ARRAY,
                );
                l.push(Op::GenerateMipmaps, &[40, 0]).unwrap();
            })
            .contains("more than one mip level")
        );
        assert!(matches!(
            run_textures(&|l| l.push(Op::GenerateMipmaps, &[MIPS, 1]).unwrap()),
            Err(MockError::OutOfRange { .. })
        ));
        assert!(matches!(
            run_textures(&|l| {
                l.push(
                    Op::BeginRenderPass,
                    &[0, NO_TARGET, NO_TARGET, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
                l.push(Op::GenerateMipmaps, &[MIPS, 0]).unwrap();
            }),
            Err(MockError::Outside { .. })
        ));
        // A released image is gone: an upload after it names nothing, and a second release does
        // nothing, as a capture's second replay of a list needs.
        let result = run_textures(&|l| {
            upload(l, upload_flags::RELEASE);
            upload(l, 0);
        });
        assert!(
            matches!(result, Err(MockError::Missing { what: "image", .. })),
            "an upload after the release: {result:?}"
        );
        assert_eq!(
            run_textures(&|l| {
                upload(l, upload_flags::RELEASE);
                l.push(Op::ReleaseImage, &[IMAGE]).unwrap();
            }),
            Ok(())
        );
    }

    #[test]
    fn a_pass_cannot_read_a_texture_it_draws_into() {
        let loop_back = run_textures(&|l| {
            l.push(
                Op::BeginRenderPass,
                &[
                    NO_TARGET,
                    NO_TARGET,
                    DEPTH_LAYER,
                    0,
                    0,
                    0,
                    0,
                    0,
                    pass_flags::CLEAR_DEPTH,
                ],
            )
            .unwrap();
            l.push(Op::SetPipeline, &[2]).unwrap();
            l.push(Op::SetBindGroup, &[1, 3, 0]).unwrap();
        });
        assert!(
            matches!(loop_back, Err(MockError::Invalid { rule, .. }) if rule.contains("draws into")),
            "{loop_back:?}"
        );
    }

    #[test]
    fn a_write_after_a_use_in_the_same_submit_is_rejected() {
        let late_write = run_textures(&|l| {
            l.push(
                Op::BeginRenderPass,
                &[
                    0,
                    NO_TARGET,
                    NO_TARGET,
                    0,
                    0,
                    0,
                    0,
                    0,
                    pass_flags::CLEAR_COLOR,
                ],
            )
            .unwrap();
            l.push(Op::SetPipeline, &[4]).unwrap();
            l.push(Op::SetBindGroup, &[1, 3, 0]).unwrap();
            l.push(Op::Draw, &[6, 1, 0, 0]).unwrap();
            l.push(Op::EndRenderPass, &[]).unwrap();
            l.push(
                Op::WriteTexture,
                &[PATTERN, 0, 0, 0, 1, 8, 8, 1, 0x1000, 8 * 8 * 4],
            )
            .unwrap();
        });
        assert_eq!(
            late_write,
            Err(MockError::WriteAfterUse {
                op: Op::WriteTexture,
                what: "texture",
                id: PATTERN
            })
        );
        let after_submit = run_textures(&|l| {
            l.push(
                Op::BeginRenderPass,
                &[
                    0,
                    NO_TARGET,
                    NO_TARGET,
                    0,
                    0,
                    0,
                    0,
                    0,
                    pass_flags::CLEAR_COLOR,
                ],
            )
            .unwrap();
            l.push(Op::SetPipeline, &[4]).unwrap();
            l.push(Op::SetBindGroup, &[1, 3, 0]).unwrap();
            l.push(Op::Draw, &[6, 1, 0, 0]).unwrap();
            l.push(Op::EndRenderPass, &[]).unwrap();
            l.push(Op::Submit, &[]).unwrap();
            l.push(
                Op::WriteTexture,
                &[PATTERN, 0, 0, 0, 1, 8, 8, 1, 0x1000, 8 * 8 * 4],
            )
            .unwrap();
        });
        assert_eq!(after_submit, Ok(()), "a submit ends the uses");
        let buffer_after_clear = run_textures(&|l| {
            l.push(Op::ClearBuffer, &[3, 0, 256]).unwrap();
            l.push(Op::WriteBuffer, &[3, 0, 0x1000, 64]).unwrap();
        });
        assert!(matches!(
            buffer_after_clear,
            Err(MockError::WriteAfterUse {
                what: "buffer",
                id: 3,
                ..
            })
        ));
    }

    #[test]
    fn samplers_and_textures_stay_within_the_portable_budget() {
        let rejects = |build: &dyn Fn(&mut DrawList)| {
            matches!(run_textures(build), Err(MockError::Invalid { .. }))
        };
        assert!(
            rejects(&|l| sampler(l, 5, filter::NEAREST, compare::NONE, 4)),
            "anisotropy needs linear filters"
        );
        assert!(
            rejects(&|l| texture(
                l,
                30,
                [8192, 8, 1, 1],
                format::RGBA8_UNORM,
                texture_usage::COPY_DST,
                view::D2
            )),
            "8192 pixels is past the portable budget"
        );
        assert!(
            rejects(&|l| texture(
                l,
                30,
                [8, 8, 2, 1],
                format::RGBA8_UNORM,
                texture_usage::COPY_DST,
                view::D2
            )),
            "a 2d binding view has one layer"
        );
        assert!(
            rejects(&|l| texture(
                l,
                30,
                [8, 8, 1, 5],
                format::RGBA8_UNORM,
                texture_usage::COPY_DST,
                view::D2
            )),
            "an 8 x 8 texture has at most 4 mip levels"
        );
        let msaa_float16 = |l: &mut DrawList| {
            l.push(
                Op::CreateTexture,
                &[
                    30,
                    8,
                    8,
                    1,
                    format::RGBA16_FLOAT,
                    texture_usage::RENDER_ATTACHMENT,
                    4,
                    1,
                    view::D2,
                ],
            )
            .unwrap();
        };
        assert!(
            rejects(&msaa_float16),
            "compatibility mode has no MSAA on 16-bit floats"
        );
        let mut list = DrawList::with_capacity(16);
        msaa_float16(&mut list);
        let caps = Capabilities::MSAA_FLOAT16;
        assert_eq!(
            MockBackend::with_capabilities(caps).replay(list.words()),
            Ok(())
        );
    }
}

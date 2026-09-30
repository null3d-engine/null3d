//! Binary draw lists: every GPU command the engine issues, as 32-bit words in shared memory.
//!
//! Any thread can record a draw list, so recording runs in parallel on the job workers; the thread
//! that owns the GPU replays the lists in order. Each command starts with a header word holding the
//! opcode in its low 8 bits and the command's length in words (header included) above them, so a
//! decoder can check every command and step over it. Operands are `u32`, or `f32` and `i32` stored
//! as their bits.
//!
//! Commands that write or copy texels name a texture location in five words: the texture id, the
//! mip level, then x, y and the array layer of the first texel. Their rows count from the first row
//! that an upload writes, on both GPU paths.
//!
//! Writes and uploads take effect when the GPU queue receives them. On WebGPU that is before the
//! commands recorded since the previous `Submit`, so a list writes a buffer or a texture before the
//! commands that read it, never after a command that used it in the same submit.
//!
//! Rectangles of `SetViewport` and `SetScissor` are in pixels of the render target, from its
//! top-left corner with y down, as WebGPU counts them. WebGL2 counts from the bottom-left corner,
//! so its backend flips them, and each rectangle covers the same part of the image on both paths.
//! WebGL2 keeps the rows of whatever a render pass draws in GL's order, bottom row first, so a
//! shader that samples a rendered target by texture coordinates flips them on that path.

/// Command opcodes. The TypeScript replay loop uses the generated constants in
/// `packages/engine/src/generated/gpu.ts`, which a test keeps equal to these values. Numbers group
/// by kind: resources from 1, render pass commands from 16, bundles from 32, compute from 40,
/// copies from 48, and `Submit` last. [`reserved`] holds the numbers of commands still to come.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Op {
    /// [buffer id, size in bytes, usage flags]
    CreateBuffer = 1,
    /// [buffer id, destination offset, source address in engine memory, byte length]
    WriteBuffer = 2,
    /// [buffer id]
    DestroyBuffer = 3,
    /// [texture id, width, height, layers, format, usage flags, sample count, mip levels, binding
    /// view]: `binding view` is the view dimension (`view::*`) that bind groups see the texture
    /// as. Compatibility mode allows one per texture, and WebGL2 fixes it at creation too.
    CreateTexture = 4,
    /// [texture id]: destroys a texture, or releases a view.
    DestroyTexture = 5,
    /// [width, height]: the canvas's drawing buffer size in device pixels. Recorded in the frame
    /// built for that size, so the canvas and the frame's render targets always match.
    ResizeCanvas = 6,
    /// [render pipeline id, template, permutation bits, color format, depth format, sample count,
    /// state flags, vertex format]: the vertex format (`vertex::*` bits) places the attributes that
    /// the template's vertex shader reads, in the vertex buffer of slot 0.
    CreateRenderPipeline = 7,
    /// [compute pipeline id, template, permutation bits]
    CreateComputePipeline = 8,
    /// [bind group id, standard layout, entry count, then per entry: binding, resource kind,
    /// resource id, offset, size]. A texture entry binds the whole texture, in the view dimension
    /// it was created with; a view cannot be bound.
    CreateBindGroup = 9,
    /// [buffer id, offset, size]
    ClearBuffer = 10,
    /// [texture location (5 words), width, height, layer count, source address in engine memory,
    /// byte length]: writes a box of texels from tightly packed rows, layer after layer.
    WriteTexture = 11,
    /// [sampler id, address mode u, v and w, mag filter, min filter, mipmap filter, lod min clamp
    /// (f32), lod max clamp (f32), compare function, max anisotropy]. A sampler with a compare
    /// function other than `compare::NONE` samples depth textures by comparison. Anisotropy above
    /// 1 needs every filter linear.
    CreateSampler = 12,
    /// [view id, texture id, mip level, layer]: a view of one mip level and one layer of a texture,
    /// to draw into as a render target. Views take their ids from the texture ids, and
    /// `DestroyTexture` releases them. A view lasts as long as its texture.
    CreateTextureView = 13,
    /// [texture location (5 words), width, height, image id, flags, source x, source y]: copies
    /// the `width` x `height` pixels at (`source x`, `source y`) of an image that the backend
    /// holds into a texture with `COPY_DST` and `RENDER_ATTACHMENT` usage. Rows count from the
    /// image's first row. The image keeps its own orientation and alpha, so the thread that
    /// decodes it chooses both. Uploads of a few rows at a time spread a large image over frames.
    UploadImage = 14,
    /// [texture id, layer]: makes mip levels 1 and up of one layer from its level 0, each from the
    /// level before it, with a linear filter in linear color. The texture is a 2D array of
    /// `RGBA8_UNORM` or `RGBA8_UNORM_SRGB`, with `TEXTURE_BINDING` and `RENDER_ATTACHMENT` usage.
    /// Both backends draw each level with the mip shader, which samples the level before it.
    /// WebGL2's `generateMipmap` would remake every layer of an array.
    GenerateMipmaps = 15,
    /// [color target texture id or 0 for the canvas or `NO_TARGET`, resolve target texture id or
    /// 0 for the canvas or `NO_TARGET`, depth texture id or `NO_TARGET`, clear red, green, blue,
    /// alpha (f32), clear depth (f32), pass flags]. A target is a texture of one layer and one mip
    /// level, or a view of one. A pass without a color target draws depth only.
    BeginRenderPass = 16,
    /// [render pipeline id]
    SetPipeline = 17,
    /// [group index, bind group id, dynamic offset count, offsets...]
    SetBindGroup = 18,
    /// [slot, buffer id, offset, size or 0 for the rest of the buffer]
    SetVertexBuffer = 19,
    /// [buffer id, index format, offset, size or 0 for the rest of the buffer]
    SetIndexBuffer = 20,
    /// [vertex count, instance count, first vertex, first instance]
    Draw = 21,
    /// [index count, instance count, first index, base vertex (i32), first instance]
    DrawIndexed = 22,
    /// [indirect buffer id, offset]
    DrawIndexedIndirect = 23,
    /// [bundle count, bundle ids...]
    ExecuteBundles = 24,
    /// []
    EndRenderPass = 25,
    /// [draw count, index counts address, index byte offsets address, instance counts address]:
    /// many indexed draws in one call, each with one entry in each of the three `i32` arrays in
    /// engine memory. Only on devices with `Capabilities::MULTI_DRAW`.
    MultiDrawIndexed = 26,
    /// [x, y, width, height, min depth (f32), max depth (f32)]: the rectangle that clip space maps
    /// to, inside the pass's targets. Each render pass starts with its whole target. Not in bundles.
    SetViewport = 27,
    /// [x, y, width, height]: the rectangle outside which draws write nothing, inside the pass's
    /// targets. Each render pass starts with its whole target. Not in bundles.
    SetScissor = 28,
    /// [bundle id, color format, depth format, sample count]; the commands up to `EndBundle` record
    /// the bundle, which then replays with `ExecuteBundles` until it is recorded again.
    BeginBundle = 32,
    /// []
    EndBundle = 33,
    /// []
    BeginComputePass = 40,
    /// [compute pipeline id]
    SetComputePipeline = 41,
    /// [workgroups x, y, z]
    Dispatch = 42,
    /// []
    EndComputePass = 44,
    /// [source buffer id, source offset, destination buffer id, destination offset, size]
    CopyBufferToBuffer = 48,
    /// [source texture location (5 words), destination texture location (5 words), width, height,
    /// layer count]: copies texels between two textures of the same format, one sample each. Depth
    /// textures do not copy, because WebGL2 cannot copy them.
    CopyTextureToTexture = 49,
    /// [image id]: closes an image that the backend holds, once no later command uploads it. A
    /// backend that holds no such image does nothing, as when a capture replays a list again.
    ReleaseImage = 51,
    /// []: submits everything recorded since the previous submit.
    Submit = 63,
}

impl Op {
    pub const ALL: [Op; 38] = [
        Op::CreateBuffer,
        Op::WriteBuffer,
        Op::DestroyBuffer,
        Op::CreateTexture,
        Op::DestroyTexture,
        Op::ResizeCanvas,
        Op::CreateRenderPipeline,
        Op::CreateComputePipeline,
        Op::CreateBindGroup,
        Op::ClearBuffer,
        Op::WriteTexture,
        Op::CreateSampler,
        Op::CreateTextureView,
        Op::UploadImage,
        Op::GenerateMipmaps,
        Op::BeginRenderPass,
        Op::SetPipeline,
        Op::SetBindGroup,
        Op::SetVertexBuffer,
        Op::SetIndexBuffer,
        Op::Draw,
        Op::DrawIndexed,
        Op::DrawIndexedIndirect,
        Op::ExecuteBundles,
        Op::EndRenderPass,
        Op::MultiDrawIndexed,
        Op::SetViewport,
        Op::SetScissor,
        Op::BeginBundle,
        Op::EndBundle,
        Op::BeginComputePass,
        Op::SetComputePipeline,
        Op::Dispatch,
        Op::EndComputePass,
        Op::CopyBufferToBuffer,
        Op::CopyTextureToTexture,
        Op::ReleaseImage,
        Op::Submit,
    ];

    pub fn from_u8(value: u8) -> Option<Op> {
        Self::ALL.iter().copied().find(|op| *op as u8 == value)
    }

    fn name(self) -> &'static str {
        match self {
            Op::CreateBuffer => "CREATE_BUFFER",
            Op::WriteBuffer => "WRITE_BUFFER",
            Op::DestroyBuffer => "DESTROY_BUFFER",
            Op::CreateTexture => "CREATE_TEXTURE",
            Op::DestroyTexture => "DESTROY_TEXTURE",
            Op::ResizeCanvas => "RESIZE_CANVAS",
            Op::CreateRenderPipeline => "CREATE_RENDER_PIPELINE",
            Op::CreateComputePipeline => "CREATE_COMPUTE_PIPELINE",
            Op::CreateBindGroup => "CREATE_BIND_GROUP",
            Op::ClearBuffer => "CLEAR_BUFFER",
            Op::WriteTexture => "WRITE_TEXTURE",
            Op::CreateSampler => "CREATE_SAMPLER",
            Op::CreateTextureView => "CREATE_TEXTURE_VIEW",
            Op::UploadImage => "UPLOAD_IMAGE",
            Op::GenerateMipmaps => "GENERATE_MIPMAPS",
            Op::BeginRenderPass => "BEGIN_RENDER_PASS",
            Op::SetPipeline => "SET_PIPELINE",
            Op::SetBindGroup => "SET_BIND_GROUP",
            Op::SetVertexBuffer => "SET_VERTEX_BUFFER",
            Op::SetIndexBuffer => "SET_INDEX_BUFFER",
            Op::Draw => "DRAW",
            Op::DrawIndexed => "DRAW_INDEXED",
            Op::DrawIndexedIndirect => "DRAW_INDEXED_INDIRECT",
            Op::ExecuteBundles => "EXECUTE_BUNDLES",
            Op::EndRenderPass => "END_RENDER_PASS",
            Op::MultiDrawIndexed => "MULTI_DRAW_INDEXED",
            Op::SetViewport => "SET_VIEWPORT",
            Op::SetScissor => "SET_SCISSOR",
            Op::BeginBundle => "BEGIN_BUNDLE",
            Op::EndBundle => "END_BUNDLE",
            Op::BeginComputePass => "BEGIN_COMPUTE_PASS",
            Op::SetComputePipeline => "SET_COMPUTE_PIPELINE",
            Op::Dispatch => "DISPATCH",
            Op::EndComputePass => "END_COMPUTE_PASS",
            Op::CopyBufferToBuffer => "COPY_BUFFER_TO_BUFFER",
            Op::CopyTextureToTexture => "COPY_TEXTURE_TO_TEXTURE",
            Op::ReleaseImage => "RELEASE_IMAGE",
            Op::Submit => "SUBMIT",
        }
    }
}

/// Opcode numbers kept for commands that the renderer will need, so that work on several of them
/// at once does not collide. The change that adds such a command moves its number into [`Op`].
pub mod reserved {
    /// Copies texels into a buffer, to read a frame or computed values back.
    pub const COPY_TEXTURE_TO_BUFFER: u8 = 50;

    pub const ALL: [u8; 1] = [COPY_TEXTURE_TO_BUFFER];
}

/// A target slot left empty in `BeginRenderPass`.
pub const NO_TARGET: u32 = u32::MAX;

/// Buffer usage flags, with WebGPU's values.
pub mod buffer_usage {
    pub const MAP_READ: u32 = 0x0001;
    pub const COPY_SRC: u32 = 0x0004;
    pub const COPY_DST: u32 = 0x0008;
    pub const INDEX: u32 = 0x0010;
    pub const VERTEX: u32 = 0x0020;
    pub const UNIFORM: u32 = 0x0040;
    pub const STORAGE: u32 = 0x0080;
    pub const INDIRECT: u32 = 0x0100;
}

/// Texture usage flags, with WebGPU's values.
pub mod texture_usage {
    pub const COPY_SRC: u32 = 0x01;
    pub const COPY_DST: u32 = 0x02;
    pub const TEXTURE_BINDING: u32 = 0x04;
    /// Written by compute shaders.
    pub const STORAGE_BINDING: u32 = 0x08;
    pub const RENDER_ATTACHMENT: u32 = 0x10;
    /// Only after checking `Capabilities::TRANSIENT_ATTACHMENTS`.
    pub const TRANSIENT_ATTACHMENT: u32 = 0x20;
}

/// Texture formats, by engine code. The replay loop maps each code to the browser's format name;
/// `CANVAS` means the canvas's preferred format. A change that adds a format takes the next code.
pub mod format {
    pub const NONE: u32 = 0;
    pub const CANVAS: u32 = 1;
    pub const RGBA8_UNORM: u32 = 2;
    pub const BGRA8_UNORM: u32 = 3;
    pub const RGBA16_FLOAT: u32 = 4;
    pub const DEPTH24_PLUS: u32 = 5;
    pub const DEPTH32_FLOAT: u32 = 6;
    /// Four 32-bit floats per texel: rows of world matrices in a data texture.
    pub const RGBA32_FLOAT: u32 = 7;
    /// One 32-bit unsigned integer per texel: indices in a data texture.
    pub const R32_UINT: u32 = 8;
    /// 8-bit color stored with the sRGB curve: sampling decodes it to linear values, and drawing
    /// encodes linear values. WebGL2 calls it `SRGB8_ALPHA8`.
    pub const RGBA8_UNORM_SRGB: u32 = 9;

    /// Every format, by code.
    pub const ALL: [u32; 10] = [
        NONE,
        CANVAS,
        RGBA8_UNORM,
        BGRA8_UNORM,
        RGBA16_FLOAT,
        DEPTH24_PLUS,
        DEPTH32_FLOAT,
        RGBA32_FLOAT,
        R32_UINT,
        RGBA8_UNORM_SRGB,
    ];

    /// Bytes per texel of each format, by code: 0 for `NONE`, and for `DEPTH24_PLUS`, whose
    /// texels have no layout that writes and copies can use.
    pub const TEXEL_BYTES: [u32; ALL.len()] = [0, 4, 4, 4, 8, 0, 4, 16, 4, 4];

    /// True for the depth formats.
    pub const fn is_depth(format: u32) -> bool {
        matches!(format, DEPTH24_PLUS | DEPTH32_FLOAT)
    }

    /// Bytes per texel, or 0 for an unknown code.
    pub const fn texel_bytes(format: u32) -> u32 {
        if (format as usize) < TEXEL_BYTES.len() {
            TEXEL_BYTES[format as usize]
        } else {
            0
        }
    }

    /// True for the formats whose mip levels `GenerateMipmaps` makes: 8-bit color, which every
    /// device can filter and draw into.
    pub const fn makes_mipmaps(format: u32) -> bool {
        matches!(format, RGBA8_UNORM | RGBA8_UNORM_SRGB)
    }

    /// The width or height of a mip level, from the size of level 0.
    pub const fn level_size(size: u32, level: u32) -> u32 {
        let size = if level < u32::BITS { size >> level } else { 0 };
        if size == 0 { 1 } else { size }
    }

    /// The mip levels of a whole chain, from a texture's size down to 1 x 1.
    pub const fn full_chain(width: u32, height: u32) -> u32 {
        let largest = if width > height { width } else { height };
        u32::BITS - (largest | 1).leading_zeros()
    }

    /// Bytes of one layer of one mip level, which every upload, budget and memory count of
    /// textures reads, so a format stored in blocks of texels changes this one place.
    pub const fn level_bytes(format: u32, width: u32, height: u32, level: u32) -> u64 {
        texel_bytes(format) as u64
            * level_size(width, level) as u64
            * level_size(height, level) as u64
    }

    /// Bytes of one layer with its first `mips` mip levels.
    pub const fn layer_bytes(format: u32, width: u32, height: u32, mips: u32) -> u64 {
        let mut bytes = 0;
        let mut level = 0;
        while level < mips {
            bytes += level_bytes(format, width, height, level);
            level += 1;
        }
        bytes
    }
}

/// View dimensions that bind groups see a texture as, fixed when the texture is created.
pub mod view {
    /// One 2D image: the texture has one layer.
    pub const D2: u32 = 0;
    /// An array of 2D layers, which shaders index. It may have one layer.
    pub const D2_ARRAY: u32 = 1;
}

/// Address modes of samplers: what a coordinate outside 0 to 1 reads.
pub mod address {
    pub const CLAMP_TO_EDGE: u32 = 0;
    pub const REPEAT: u32 = 1;
    pub const MIRROR_REPEAT: u32 = 2;
}

/// Filters of samplers.
pub mod filter {
    pub const NEAREST: u32 = 0;
    pub const LINEAR: u32 = 1;
}

/// Compare functions of samplers, in WebGL's order. A comparison sampler passes where the
/// reference value compares as the function says with the texel.
pub mod compare {
    /// The sampler reads texels and compares nothing.
    pub const NONE: u32 = 0;
    pub const NEVER: u32 = 1;
    pub const LESS: u32 = 2;
    pub const EQUAL: u32 = 3;
    pub const LESS_EQUAL: u32 = 4;
    pub const GREATER: u32 = 5;
    pub const NOT_EQUAL: u32 = 6;
    pub const GREATER_EQUAL: u32 = 7;
    pub const ALWAYS: u32 = 8;
}

/// Flags of `UploadImage`.
pub mod upload_flags {
    /// Stores color multiplied by alpha. The image must hold premultiplied values too, because
    /// WebGL2 copies an image as it is.
    pub const PREMULTIPLIED_ALPHA: u32 = 1;
    /// Closes the image after the copy, and frees its id.
    pub const RELEASE: u32 = 2;
}

/// Index formats for `SetIndexBuffer`.
pub mod index_format {
    pub const UINT16: u32 = 0;
    pub const UINT32: u32 = 1;
}

/// Flags of `BeginRenderPass`.
pub mod pass_flags {
    /// Clear the color target instead of loading it.
    pub const CLEAR_COLOR: u32 = 1;
    /// Clear the depth target instead of loading it.
    pub const CLEAR_DEPTH: u32 = 2;
    /// Store the color target; without it the target is discarded (for example an MSAA target
    /// after its resolve).
    pub const STORE_COLOR: u32 = 4;
    /// Store the depth target; without it the depth is discarded, which tile-based GPUs need.
    pub const STORE_DEPTH: u32 = 8;
}

/// Resource kinds in `CreateBindGroup` entries.
pub mod resource_kind {
    pub const BUFFER: u32 = 0;
    pub const TEXTURE: u32 = 1;
    pub const SAMPLER: u32 = 2;
}

/// Standard bind group layouts. Every pipeline shares them, so switching pipelines never forces a
/// rebind of the per-frame group.
pub mod layout {
    /// Group 0 of render pipelines: per-frame constants and the material table.
    pub const FRAME: u32 = 0;
    /// Group 0 of the culling compute pipeline.
    pub const CULL: u32 = 1;
    /// Group 1 of render pipelines that read instances from data textures: the draw records.
    pub const DRAWS: u32 = 2;
    /// Group 2 of render pipelines that read instances from data textures: the textures.
    pub const INSTANCES: u32 = 3;
    /// The maps of render pipelines that sample them: a 2D array texture, then its sampler. It is
    /// group 1 on WebGPU, and group 3 on WebGL2, after the groups of the data textures.
    pub const TEXTURES: u32 = 5;
}

/// Bits of a render pipeline's permutation word, which pick a shader variant. A feature that
/// changes what a shader costs is a bit, so a pipeline without the feature does not pay for it. A
/// cheap option is a uniform value instead. A shader reads each bit as the shader def of the bit's
/// name in [`NAMES`], and the shader manifest lists the bits that each shader is built with. A bit
/// that no shader reads yet is reserved for the feature it names, so no two features share one.
pub mod permutation {
    /// The vertex shader reads its draw's index, from `WEBGL_multi_draw`.
    pub const DRAW_INDEX: u32 = 1;
    /// The fragment shader applies the exposure and the tone mapping, and encodes sRGB, itself.
    pub const TONE_MAP: u32 = 2;
    /// The mesh's vertex colors multiply the material's base color.
    pub const VERTEX_COLOR: u32 = 4;
    /// A normal map bends the surface's normals.
    pub const NORMAL_MAP: u32 = 8;
    /// Fragments whose alpha is below the material's cutoff draw nothing.
    pub const ALPHA_MASK: u32 = 16;
    /// The surface reads the shadow maps, so shadows fall on it.
    pub const RECEIVE_SHADOWS: u32 = 32;
    /// Bones move the mesh's vertices.
    pub const SKIN: u32 = 64;
    /// Morph targets move the mesh's vertices.
    pub const MORPH: u32 = 128;

    /// Every bit with its name: the shader def that turns its code on, in bit order.
    pub const NAMES: [(&str, u32); 8] = [
        ("DRAW_INDEX", DRAW_INDEX),
        ("TONE_MAP", TONE_MAP),
        ("VERTEX_COLOR", VERTEX_COLOR),
        ("NORMAL_MAP", NORMAL_MAP),
        ("ALPHA_MASK", ALPHA_MASK),
        ("RECEIVE_SHADOWS", RECEIVE_SHADOWS),
        ("SKIN", SKIN),
        ("MORPH", MORPH),
    ];

    /// Every bit.
    pub const ALL: u32 = {
        let mut all = 0;
        let mut k = 0;
        while k < NAMES.len() {
            all |= NAMES[k].1;
            k += 1;
        }
        all
    };

    /// The bit of a name in [`NAMES`], or `None` for a name that is not a bit.
    pub fn bit(name: &str) -> Option<u32> {
        NAMES.iter().find(|(n, _)| *n == name).map(|&(_, bit)| bit)
    }
}

/// Bits of a render pipeline's state flags.
pub mod state_flags {
    /// Draws both faces of each triangle.
    pub const CULL_NONE: u32 = 1;
}

/// Vertex formats. Every vertex has a position and a normal, three floats each. A format adds
/// optional attributes after them, and is the set of those attributes as bits. Each attribute sits
/// at its place in [`ATTRIBUTES`](vertex::ATTRIBUTES) order, so a format's layout follows from its
/// bits alone. Every attribute is 32-bit floats, and each has a fixed vertex shader location.
pub mod vertex {
    /// The first texture coordinates: two floats.
    pub const UV0: u32 = 1;
    /// The second texture coordinates: two floats.
    pub const UV1: u32 = 2;
    /// A tangent and its handedness, +1 or -1, as three.js and glTF store them: four floats.
    pub const TANGENT: u32 = 4;
    /// A linear color and its alpha: four floats.
    pub const COLOR: u32 = 8;
    /// Every optional attribute. Formats run from 0, a position and a normal only, to this.
    pub const ALL: u32 = UV0 | UV1 | TANGENT | COLOR;
    /// The first vertex shader location of the per-instance attributes, after every location
    /// that a vertex attribute can take.
    pub const INSTANCE_LOCATION: u32 = 8;

    /// One vertex attribute.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct Attribute {
        /// The attribute's format bit, or 0 for the position and the normal, which every
        /// format has.
        pub bit: u32,
        /// Its 32-bit floats.
        pub floats: u32,
        /// The vertex shader location that reads it.
        pub location: u32,
    }

    /// Every attribute, in the order they sit in a vertex: the position, the normal, then the
    /// optional attributes in bit order.
    pub const ATTRIBUTES: [Attribute; 6] = [
        Attribute {
            bit: 0,
            floats: 3,
            location: 0,
        },
        Attribute {
            bit: 0,
            floats: 3,
            location: 1,
        },
        Attribute {
            bit: UV0,
            floats: 2,
            location: 2,
        },
        Attribute {
            bit: UV1,
            floats: 2,
            location: 3,
        },
        Attribute {
            bit: TANGENT,
            floats: 4,
            location: 4,
        },
        Attribute {
            bit: COLOR,
            floats: 4,
            location: 5,
        },
    ];

    /// Floats per vertex of a format.
    pub const fn floats(format: u32) -> u32 {
        let mut floats = 0;
        let mut k = 0;
        while k < ATTRIBUTES.len() {
            let attribute = ATTRIBUTES[k];
            if (attribute.bit & format) == attribute.bit {
                floats += attribute.floats;
            }
            k += 1;
        }
        floats
    }

    /// Bytes per vertex of a format.
    pub const fn stride(format: u32) -> u32 {
        floats(format) * 4
    }

    /// The first float of an optional attribute (`bit`) in a vertex of a format, or `None` when
    /// the format lacks it.
    pub const fn offset(format: u32, bit: u32) -> Option<u32> {
        if bit == 0 || (format & bit) != bit {
            return None;
        }
        let mut floats = 0;
        let mut k = 0;
        while k < ATTRIBUTES.len() {
            let attribute = ATTRIBUTES[k];
            if attribute.bit == bit {
                return Some(floats);
            }
            if (attribute.bit & format) == attribute.bit {
                floats += attribute.floats;
            }
            k += 1;
        }
        None
    }
}

/// Sizes of the data that the render pipelines read. The shaders in `crates/null3d-shaders/wgsl/`
/// declare the same sizes, and a test checks that they agree.
pub mod sizes {
    /// Bytes per compacted instance: three rows of the world matrix, then a vector of ids.
    pub const INSTANCE_STRIDE: u32 = 64;
    /// Bytes of the per-frame uniform block: the view-projection matrix and four vectors.
    pub const FRAME_UNIFORM_BYTES: u32 = 128;
    /// Threads per workgroup of the culling shader.
    pub const CULL_WORKGROUP_SIZE: u32 = 128;
    /// 32-bit words per indexed indirect draw.
    pub const INDIRECT_WORDS: u32 = 5;
    /// WebGPU's default `maxStorageBufferBindingSize`: the largest storage buffer that every device
    /// lets a shader bind. Many devices offer more.
    pub const PORTABLE_STORAGE_BINDING_BYTES: u32 = 128 * 1024 * 1024;
    /// Texels of an `RGBA32_FLOAT` data texture per world matrix: one per matrix row.
    pub const MATRIX_TEXELS: u32 = 3;
    /// World matrices per row of a data texture. The texture is 1,536 texels wide, inside the
    /// 2,048 that every WebGL2 device allows.
    pub const MATRICES_PER_TEXTURE_ROW: u32 = 512;
    /// Indices per row of an index list texture: WebGL2's smallest allowed texture width.
    pub const INDICES_PER_TEXTURE_ROW: u32 = 2048;
    /// Bytes of one draw record: the start of the draw's slice of the index list, its material
    /// and the data texture its instances come from, and one spare word.
    pub const DRAW_RECORD_BYTES: u32 = 16;
    /// Draw records one multi-draw call reads: a 4 KiB uniform block.
    pub const MULTI_DRAW_RECORDS: u32 = 256;
    /// Materials in the material table.
    pub const MAX_MATERIALS: u32 = 1024;
    /// Bytes of one material's row in the material table: eight `vec4f`s. On WebGL2 each row is a
    /// row of eight `RGBA32_FLOAT` texels of a data texture.
    pub const MATERIAL_BYTES: u32 = 128;
    /// Grid cells in use at most, which the shaders' tables of offsets from the camera to each
    /// cell hold, one `vec4f` each.
    pub const MAX_CELLS: u32 = 512;
    /// Where a cell index starts in a word that packs it above a bucket or a row: a bucket table
    /// entry of the culling shader, or an index list entry.
    pub const CELL_SHIFT: u32 = 23;
}

/// Shader templates for `CreateRenderPipeline` and `CreateComputePipeline`.
pub mod template {
    /// Instanced meshes with Lambert lighting.
    pub const INSTANCED_LIT: u32 = 1;
    /// Instanced meshes without lighting.
    pub const INSTANCED_UNLIT: u32 = 2;
    /// Instanced meshes colored by their first texture coordinates, for the engine's own tests of
    /// vertex formats.
    pub const INSTANCED_TEXCOORDS: u32 = 3;
    /// Instanced meshes without lighting, whose base color is multiplied by a map that the first
    /// texture coordinates place.
    pub const INSTANCED_UNLIT_MAP: u32 = 5;
    /// The GPU culling compute shader.
    pub const CULL: u32 = 16;
}

/// Why recording failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DrawListError {
    /// The fixed buffer has no room for the command.
    Full,
}

/// A draw list recorded into a buffer allocated once, at creation.
#[derive(Debug)]
pub struct DrawList {
    words: Vec<u32>,
    len: usize,
}

impl DrawList {
    pub fn with_capacity(words: usize) -> Self {
        Self {
            words: vec![0; words],
            len: 0,
        }
    }

    /// Forgets every recorded command, keeping the buffer.
    pub fn clear(&mut self) {
        self.len = 0;
    }

    /// Forgets the commands recorded after the first `len` words, a length that [`DrawList::len`]
    /// returned between two commands.
    pub fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len);
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The recorded words.
    pub fn words(&self) -> &[u32] {
        &self.words[..self.len]
    }

    /// Address of the first word, for the replay loop's view on engine memory.
    pub fn as_ptr(&self) -> *const u32 {
        self.words.as_ptr()
    }

    /// Appends one command with its operands.
    /// Appends whole commands that another list recorded.
    pub fn append(&mut self, words: &[u32]) -> Result<(), DrawListError> {
        if self.len + words.len() > self.words.len() {
            return Err(DrawListError::Full);
        }
        self.words[self.len..self.len + words.len()].copy_from_slice(words);
        self.len += words.len();
        Ok(())
    }

    pub fn push(&mut self, op: Op, operands: &[u32]) -> Result<(), DrawListError> {
        let length = operands.len() + 1;
        if self.len + length > self.words.len() {
            return Err(DrawListError::Full);
        }
        self.words[self.len] = op as u32 | ((length as u32) << 8);
        self.words[self.len + 1..self.len + length].copy_from_slice(operands);
        self.len += length;
        Ok(())
    }
}

/// One decoded command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Command<'a> {
    pub op: Op,
    pub operands: &'a [u32],
}

/// Why decoding failed, with the word index where it happened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeError {
    UnknownOp { at: usize, op: u8 },
    Truncated { at: usize },
}

/// Walks the commands of a recorded draw list.
pub fn decode(words: &[u32]) -> impl Iterator<Item = Result<Command<'_>, DecodeError>> + '_ {
    let mut at = 0;
    std::iter::from_fn(move || {
        if at >= words.len() {
            return None;
        }
        let header = words[at];
        let length = (header >> 8) as usize;
        let op_value = (header & 0xff) as u8;
        let start = at;
        if length == 0 || start + length > words.len() {
            at = words.len();
            return Some(Err(DecodeError::Truncated { at: start }));
        }
        at += length;
        Some(match Op::from_u8(op_value) {
            Some(op) => Ok(Command {
                op,
                operands: &words[start + 1..start + length],
            }),
            None => Err(DecodeError::UnknownOp {
                at: start,
                op: op_value,
            }),
        })
    })
}

/// The TypeScript constants for the replay loop, generated from the definitions above.
pub fn typescript_constants() -> String {
    let mut out = String::from(
        "// Generated by `cargo test -p null3d-gpu` from crates/null3d-gpu/src/drawlist.rs.\n\
         // Do not edit: set NULL3D_UPDATE_GENERATED=1 and run that command to rewrite it.\n\n",
    );
    for op in Op::ALL {
        out.push_str(&format!("export const OP_{} = {};\n", op.name(), op as u8));
    }
    out.push_str(&format!("\nexport const NO_TARGET = {NO_TARGET};\n\n"));
    let groups: [(&str, &[(&str, u32)]); 17] = [
        (
            "FORMAT",
            &[
                ("NONE", format::NONE),
                ("CANVAS", format::CANVAS),
                ("RGBA8_UNORM", format::RGBA8_UNORM),
                ("BGRA8_UNORM", format::BGRA8_UNORM),
                ("RGBA16_FLOAT", format::RGBA16_FLOAT),
                ("DEPTH24_PLUS", format::DEPTH24_PLUS),
                ("DEPTH32_FLOAT", format::DEPTH32_FLOAT),
                ("RGBA32_FLOAT", format::RGBA32_FLOAT),
                ("R32_UINT", format::R32_UINT),
                ("RGBA8_UNORM_SRGB", format::RGBA8_UNORM_SRGB),
            ],
        ),
        ("VIEW", &[("2D", view::D2), ("2D_ARRAY", view::D2_ARRAY)]),
        (
            "ADDRESS",
            &[
                ("CLAMP_TO_EDGE", address::CLAMP_TO_EDGE),
                ("REPEAT", address::REPEAT),
                ("MIRROR_REPEAT", address::MIRROR_REPEAT),
            ],
        ),
        (
            "FILTER",
            &[("NEAREST", filter::NEAREST), ("LINEAR", filter::LINEAR)],
        ),
        (
            "COMPARE",
            &[
                ("NONE", compare::NONE),
                ("NEVER", compare::NEVER),
                ("LESS", compare::LESS),
                ("EQUAL", compare::EQUAL),
                ("LESS_EQUAL", compare::LESS_EQUAL),
                ("GREATER", compare::GREATER),
                ("NOT_EQUAL", compare::NOT_EQUAL),
                ("GREATER_EQUAL", compare::GREATER_EQUAL),
                ("ALWAYS", compare::ALWAYS),
            ],
        ),
        (
            "UPLOAD",
            &[
                ("PREMULTIPLIED_ALPHA", upload_flags::PREMULTIPLIED_ALPHA),
                ("RELEASE", upload_flags::RELEASE),
            ],
        ),
        (
            "INDEX_FORMAT",
            &[
                ("UINT16", index_format::UINT16),
                ("UINT32", index_format::UINT32),
            ],
        ),
        (
            "PASS",
            &[
                ("CLEAR_COLOR", pass_flags::CLEAR_COLOR),
                ("CLEAR_DEPTH", pass_flags::CLEAR_DEPTH),
                ("STORE_COLOR", pass_flags::STORE_COLOR),
                ("STORE_DEPTH", pass_flags::STORE_DEPTH),
            ],
        ),
        (
            "RESOURCE",
            &[
                ("BUFFER", resource_kind::BUFFER),
                ("TEXTURE", resource_kind::TEXTURE),
                ("SAMPLER", resource_kind::SAMPLER),
            ],
        ),
        (
            "LAYOUT",
            &[
                ("FRAME", layout::FRAME),
                ("CULL", layout::CULL),
                ("DRAWS", layout::DRAWS),
                ("INSTANCES", layout::INSTANCES),
                ("TEXTURES", layout::TEXTURES),
            ],
        ),
        ("PERMUTATION", &permutation::NAMES),
        (
            "VERTEX",
            &[
                ("UV0", vertex::UV0),
                ("UV1", vertex::UV1),
                ("TANGENT", vertex::TANGENT),
                ("COLOR", vertex::COLOR),
                ("ALL", vertex::ALL),
                ("INSTANCE_LOCATION", vertex::INSTANCE_LOCATION),
            ],
        ),
        ("STATE", &[("CULL_NONE", state_flags::CULL_NONE)]),
        (
            "TEMPLATE",
            &[
                ("INSTANCED_LIT", template::INSTANCED_LIT),
                ("INSTANCED_UNLIT", template::INSTANCED_UNLIT),
                ("INSTANCED_TEXCOORDS", template::INSTANCED_TEXCOORDS),
                ("INSTANCED_UNLIT_MAP", template::INSTANCED_UNLIT_MAP),
                ("CULL", template::CULL),
            ],
        ),
        (
            "BUFFER_USAGE",
            &[
                ("MAP_READ", buffer_usage::MAP_READ),
                ("COPY_SRC", buffer_usage::COPY_SRC),
                ("COPY_DST", buffer_usage::COPY_DST),
                ("INDEX", buffer_usage::INDEX),
                ("VERTEX", buffer_usage::VERTEX),
                ("UNIFORM", buffer_usage::UNIFORM),
                ("STORAGE", buffer_usage::STORAGE),
                ("INDIRECT", buffer_usage::INDIRECT),
            ],
        ),
        (
            "TEXTURE_USAGE",
            &[
                ("COPY_SRC", texture_usage::COPY_SRC),
                ("COPY_DST", texture_usage::COPY_DST),
                ("TEXTURE_BINDING", texture_usage::TEXTURE_BINDING),
                ("STORAGE_BINDING", texture_usage::STORAGE_BINDING),
                ("RENDER_ATTACHMENT", texture_usage::RENDER_ATTACHMENT),
                ("TRANSIENT_ATTACHMENT", texture_usage::TRANSIENT_ATTACHMENT),
            ],
        ),
        (
            "SIZE",
            &[
                ("INSTANCE_STRIDE", sizes::INSTANCE_STRIDE),
                ("FRAME_UNIFORM_BYTES", sizes::FRAME_UNIFORM_BYTES),
                ("CULL_WORKGROUP_SIZE", sizes::CULL_WORKGROUP_SIZE),
                ("INDIRECT_WORDS", sizes::INDIRECT_WORDS),
                ("MATRIX_TEXELS", sizes::MATRIX_TEXELS),
                ("MATRICES_PER_TEXTURE_ROW", sizes::MATRICES_PER_TEXTURE_ROW),
                ("INDICES_PER_TEXTURE_ROW", sizes::INDICES_PER_TEXTURE_ROW),
                ("DRAW_RECORD_BYTES", sizes::DRAW_RECORD_BYTES),
                ("MULTI_DRAW_RECORDS", sizes::MULTI_DRAW_RECORDS),
                ("MAX_MATERIALS", sizes::MAX_MATERIALS),
                ("MATERIAL_BYTES", sizes::MATERIAL_BYTES),
                ("MAX_CELLS", sizes::MAX_CELLS),
                ("CELL_SHIFT", sizes::CELL_SHIFT),
            ],
        ),
    ];
    for (prefix, entries) in groups {
        for (name, value) in entries {
            out.push_str(&format!("export const {prefix}_{name} = {value};\n"));
        }
        out.push('\n');
    }
    let texel_bytes: Vec<String> = format::TEXEL_BYTES.iter().map(u32::to_string).collect();
    out.push_str(&format!(
        "/** Bytes per texel of each format, by format code. */\nexport const FORMAT_TEXEL_BYTES: readonly number[] = [{}];\n",
        texel_bytes.join(", ")
    ));
    let attributes: Vec<String> = vertex::ATTRIBUTES
        .iter()
        .map(|a| format!("[{}, {}, {}]", a.bit, a.floats, a.location))
        .collect();
    out.push_str(&format!(
        "/** Each vertex attribute in vertex order: its format bit (0 for one every format has), its floats and its shader location. */\nexport const VERTEX_ATTRIBUTES: readonly (readonly [bit: number, floats: number, location: number])[] = [{}];\n",
        attributes.join(", ")
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_culling_shader_declares_the_same_sizes() {
        let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
        let workgroup = format!("@workgroup_size({})", sizes::CULL_WORKGROUP_SIZE);
        assert!(cull.contains(&workgroup), "cull.wgsl lacks {workgroup}");
        for line in [
            format!("const INDIRECT_WORDS: u32 = {}u;", sizes::INDIRECT_WORDS),
            format!("const CELL_SHIFT: u32 = {}u;", sizes::CELL_SHIFT),
            format!("const MAX_CELLS: u32 = {}u;", sizes::MAX_CELLS),
        ] {
            assert!(cull.contains(&line), "cull.wgsl lacks {line}");
        }
    }

    #[test]
    fn a_cell_index_fits_above_its_shift() {
        assert_eq!(sizes::MAX_CELLS, 1 << (32 - sizes::CELL_SHIFT));
    }

    #[test]
    fn the_mesh_shaders_declare_the_same_sizes() {
        let mesh = include_str!("../../null3d-shaders/wgsl/lib/mesh.wgsl");
        let shift = |per_row: u32| per_row.trailing_zeros();
        assert!(sizes::MATRICES_PER_TEXTURE_ROW.is_power_of_two());
        assert!(sizes::INDICES_PER_TEXTURE_ROW.is_power_of_two());
        assert_eq!(
            sizes::MATRIX_TEXELS,
            3,
            "the shader reads three texels per matrix"
        );
        for line in [
            format!(
                "const MATRIX_ROW_SHIFT: u32 = {}u;",
                shift(sizes::MATRICES_PER_TEXTURE_ROW)
            ),
            format!(
                "const INDEX_ROW_SHIFT: u32 = {}u;",
                shift(sizes::INDICES_PER_TEXTURE_ROW)
            ),
            format!("const DRAW_RECORDS: u32 = {}u;", sizes::MULTI_DRAW_RECORDS),
            format!("const MAX_MATERIALS: u32 = {}u;", sizes::MAX_MATERIALS),
            format!("const CELL_SHIFT: u32 = {}u;", sizes::CELL_SHIFT),
            format!("const MAX_CELLS: u32 = {}u;", sizes::MAX_CELLS),
        ] {
            assert!(mesh.contains(&line), "lib/mesh.wgsl lacks {line}");
        }
        assert_eq!(sizes::DRAW_RECORD_BYTES, 16, "a draw record is one vec4u");
        // The instance attributes come after every vertex attribute's location.
        let instance = vertex::INSTANCE_LOCATION;
        for line in [
            format!("@location({instance}) row_x: vec4f"),
            format!("@location({}) ids: vec4u", instance + 3),
        ] {
            assert!(mesh.contains(&line), "lib/mesh.wgsl lacks {line}");
        }
        // Each template reads the vertex attributes at their formats' locations.
        let [position, normal, uv0, ..] = vertex::ATTRIBUTES;
        let templates = [
            ("lit", include_str!("../../null3d-shaders/wgsl/lit.wgsl")),
            (
                "unlit",
                include_str!("../../null3d-shaders/wgsl/unlit.wgsl"),
            ),
            (
                "texcoords",
                include_str!("../../null3d-shaders/wgsl/texcoords.wgsl"),
            ),
            (
                "unlit_map",
                include_str!("../../null3d-shaders/wgsl/unlit_map.wgsl"),
            ),
        ];
        for (name, source) in templates {
            let line = format!("@location({}) position: vec3f", position.location);
            assert!(source.contains(&line), "{name}.wgsl lacks {line}");
        }
        let normal_line = format!("@location({}) normal: vec3f", normal.location);
        assert!(
            templates[0].1.contains(&normal_line),
            "lit.wgsl lacks {normal_line}"
        );
        let uv0_line = format!("@location({}) uv0: vec2f", uv0.location);
        for (name, source) in &templates[2..] {
            assert!(source.contains(&uv0_line), "{name}.wgsl lacks {uv0_line}");
        }
        assert_eq!(uv0.bit, vertex::UV0);
    }

    #[test]
    fn permutation_bits_are_distinct_single_bits_with_their_names() {
        let mut seen = 0;
        for (name, bit) in permutation::NAMES {
            assert!(bit.is_power_of_two(), "{name}");
            assert_eq!(seen & bit, 0, "{name} shares a bit");
            seen |= bit;
            assert_eq!(permutation::bit(name), Some(bit));
        }
        assert_eq!(seen, permutation::ALL);
        assert_eq!(permutation::bit("SHINY"), None);
    }

    #[test]
    fn vertex_formats_place_each_attribute_after_the_ones_before_it() {
        assert_eq!(vertex::stride(0), 24);
        assert_eq!(vertex::stride(vertex::ALL), 72);
        assert_eq!(vertex::offset(vertex::UV0, vertex::UV0), Some(6));
        assert_eq!(vertex::offset(vertex::UV1, vertex::UV1), Some(6));
        assert_eq!(
            vertex::offset(vertex::UV0 | vertex::TANGENT, vertex::TANGENT),
            Some(8)
        );
        assert_eq!(vertex::offset(vertex::ALL, vertex::COLOR), Some(14));
        assert_eq!(vertex::offset(vertex::UV1, vertex::UV0), None);
        assert_eq!(vertex::offset(vertex::ALL, 0), None);
        for format in 0..=vertex::ALL {
            // Each optional attribute of the format starts where the ones before it end, and the
            // last ends at the stride.
            let mut end = 6;
            for attribute in &vertex::ATTRIBUTES[2..] {
                if format & attribute.bit != 0 {
                    assert_eq!(vertex::offset(format, attribute.bit), Some(end));
                    end += attribute.floats;
                } else {
                    assert_eq!(vertex::offset(format, attribute.bit), None);
                }
            }
            assert_eq!(vertex::floats(format), end, "format {format}");
            assert_eq!(vertex::stride(format), end * 4);
        }
        // Every attribute has its own location, below the instance attributes' first one.
        for (k, attribute) in vertex::ATTRIBUTES.iter().enumerate() {
            assert!(attribute.location < vertex::INSTANCE_LOCATION);
            assert!(
                vertex::ATTRIBUTES[k + 1..]
                    .iter()
                    .all(|other| other.location != attribute.location)
            );
        }
        // WebGPU's default maxVertexAttributes: the instance attributes' four locations fit.
        const { assert!(vertex::INSTANCE_LOCATION + 4 <= 16) };
    }

    #[test]
    fn commands_round_trip_through_the_decoder() {
        let mut list = DrawList::with_capacity(64);
        list.push(
            Op::CreateBuffer,
            &[7, 1024, buffer_usage::VERTEX | buffer_usage::COPY_DST],
        )
        .unwrap();
        list.push(Op::SetBindGroup, &[0, 3, 2, 256, 512]).unwrap();
        list.push(Op::DrawIndexed, &[36, 100, 0, (-4i32) as u32, 0])
            .unwrap();
        list.push(Op::EndRenderPass, &[]).unwrap();
        list.push(Op::Submit, &[]).unwrap();

        let commands: Vec<_> = decode(list.words()).map(Result::unwrap).collect();
        assert_eq!(commands.len(), 5);
        assert_eq!(
            commands[0],
            Command {
                op: Op::CreateBuffer,
                operands: &[7, 1024, 0x28]
            }
        );
        assert_eq!(commands[1].operands, &[0, 3, 2, 256, 512]);
        assert_eq!(commands[2].operands[3] as i32, -4);
        assert!(commands[3].operands.is_empty());
        assert_eq!(commands[4].op, Op::Submit);
    }

    #[test]
    fn a_full_list_refuses_commands_and_keeps_what_it_has() {
        let mut list = DrawList::with_capacity(4);
        list.push(Op::SetPipeline, &[1]).unwrap();
        assert_eq!(
            list.push(Op::Dispatch, &[1, 1, 1]),
            Err(DrawListError::Full)
        );
        assert_eq!(list.len(), 2);
        list.clear();
        assert!(list.is_empty());
    }

    #[test]
    fn the_decoder_reports_unknown_and_truncated_commands() {
        let unknown = [99 | (1 << 8)];
        assert_eq!(
            decode(&unknown).next(),
            Some(Err(DecodeError::UnknownOp { at: 0, op: 99 }))
        );
        let truncated = [Op::Dispatch as u32 | (4 << 8), 1];
        assert_eq!(
            decode(&truncated).next(),
            Some(Err(DecodeError::Truncated { at: 0 }))
        );
    }

    #[test]
    fn every_op_has_a_unique_value_and_decodes_back() {
        for (i, a) in Op::ALL.iter().enumerate() {
            assert_eq!(Op::from_u8(*a as u8), Some(*a));
            for b in &Op::ALL[i + 1..] {
                assert_ne!(*a as u8, *b as u8);
            }
        }
    }

    #[test]
    fn reserved_numbers_are_unique_and_no_op_takes_one() {
        for (i, &number) in reserved::ALL.iter().enumerate() {
            assert_eq!(
                Op::from_u8(number),
                None,
                "an op took reserved number {number}"
            );
            assert!(!reserved::ALL[i + 1..].contains(&number));
        }
    }

    #[test]
    fn every_format_code_is_its_place_and_has_a_texel_size() {
        for (code, &value) in format::ALL.iter().enumerate() {
            assert_eq!(value as usize, code, "format codes run from 0 without gaps");
        }
        assert_eq!(format::texel_bytes(format::RGBA8_UNORM_SRGB), 4);
        assert_eq!(format::texel_bytes(format::RGBA32_FLOAT), 16);
        assert_eq!(format::texel_bytes(format::DEPTH24_PLUS), 0);
        assert_eq!(format::texel_bytes(99), 0);
        assert!(format::is_depth(format::DEPTH32_FLOAT));
        assert!(!format::is_depth(format::RGBA8_UNORM_SRGB));
    }

    #[test]
    fn mip_chains_and_their_bytes_follow_the_level_sizes() {
        assert_eq!(format::full_chain(1, 1), 1);
        assert_eq!(format::full_chain(256, 256), 9);
        assert_eq!(format::full_chain(300, 20), 9);
        assert_eq!(format::full_chain(5, 1024), 11);
        assert_eq!(format::level_size(300, 2), 75);
        assert_eq!(format::level_size(300, 9), 1);
        assert_eq!(format::level_size(7, 40), 1);
        let rgba = format::RGBA8_UNORM_SRGB;
        assert_eq!(format::level_bytes(rgba, 256, 128, 0), 256 * 128 * 4);
        assert_eq!(format::level_bytes(rgba, 256, 128, 8), 4);
        // Levels of 4 x 2, 2 x 1 and 1 x 1 texels.
        assert_eq!(format::layer_bytes(rgba, 4, 2, 3), (8 + 2 + 1) * 4);
        assert_eq!(
            format::layer_bytes(format::RGBA32_FLOAT, 2, 2, 2),
            (4 + 1) * 16
        );
        assert!(format::makes_mipmaps(format::RGBA8_UNORM));
        assert!(!format::makes_mipmaps(format::RGBA16_FLOAT));
    }

    #[test]
    fn texture_and_sampler_commands_round_trip_with_their_float_operands() {
        let mut list = DrawList::with_capacity(128);
        list.push(
            Op::CreateSampler,
            &[
                3,
                address::REPEAT,
                address::MIRROR_REPEAT,
                address::CLAMP_TO_EDGE,
                filter::LINEAR,
                filter::LINEAR,
                filter::NEAREST,
                0.5f32.to_bits(),
                8f32.to_bits(),
                compare::GREATER,
                4,
            ],
        )
        .unwrap();
        list.push(Op::CreateTextureView, &[12, 4, 2, 1]).unwrap();
        list.push(
            Op::WriteTexture,
            &[4, 1, 8, 16, 0, 32, 16, 2, 0x400, 32 * 16 * 2 * 4],
        )
        .unwrap();
        list.push(
            Op::UploadImage,
            &[4, 0, 16, 8, 1, 32, 8, 7, upload_flags::RELEASE, 0, 24],
        )
        .unwrap();
        list.push(Op::GenerateMipmaps, &[4, 1]).unwrap();
        list.push(Op::ReleaseImage, &[9]).unwrap();
        list.push(
            Op::CopyTextureToTexture,
            &[4, 0, 16, 8, 0, 5, 0, 0, 40, 1, 32, 16, 1],
        )
        .unwrap();
        list.push(
            Op::SetViewport,
            &[8, 16, 32, 64, 0f32.to_bits(), 1f32.to_bits()],
        )
        .unwrap();
        list.push(Op::SetScissor, &[0, 0, 16, 8]).unwrap();

        let commands: Vec<_> = decode(list.words()).map(Result::unwrap).collect();
        let ops: Vec<Op> = commands.iter().map(|c| c.op).collect();
        assert_eq!(
            ops,
            [
                Op::CreateSampler,
                Op::CreateTextureView,
                Op::WriteTexture,
                Op::UploadImage,
                Op::GenerateMipmaps,
                Op::ReleaseImage,
                Op::CopyTextureToTexture,
                Op::SetViewport,
                Op::SetScissor,
            ]
        );
        let lengths: Vec<usize> = commands.iter().map(|c| c.operands.len()).collect();
        assert_eq!(lengths, [11, 4, 10, 11, 2, 1, 13, 6, 4]);
        assert_eq!(f32::from_bits(commands[0].operands[7]), 0.5);
        assert_eq!(f32::from_bits(commands[0].operands[8]), 8.0);
        assert_eq!(commands[0].operands[9], compare::GREATER);
        assert_eq!(commands[3].operands[9..11], [0, 24]);
        assert_eq!(f32::from_bits(commands[7].operands[5]), 1.0);
        assert_eq!(commands[6].operands[5..10], [5, 0, 0, 40, 1]);
    }

    /// Keeps the generated TypeScript constants equal to the Rust definitions.
    #[test]
    fn generated_typescript_constants_are_current() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/engine/src/generated/gpu.ts"
        );
        let expected = typescript_constants();
        if std::env::var_os("NULL3D_UPDATE_GENERATED").is_some() {
            std::fs::write(path, &expected).unwrap();
        }
        let actual = std::fs::read_to_string(path).unwrap_or_default();
        assert!(
            actual == expected,
            "{path} is out of date: run `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-gpu`"
        );
    }
}

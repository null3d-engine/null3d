//! Binary draw lists: every GPU command the engine issues, as 32-bit words in shared memory.
//!
//! Any thread can record a draw list, so recording runs in parallel on the job workers; the thread
//! that owns the GPU replays the lists in order. Each command starts with a header word holding the
//! opcode in its low 8 bits and the command's length in words (header included) above them, so a
//! decoder can check every command and step over it. Operands are `u32`, or `f32` and `i32` stored
//! as their bits.
//!
//! Commands that write or copy texels name a texture location in five words: the texture id, the
//! mip level, then x, y and the array layer of the first texel. The layer of a cube texture is a
//! face, and the layer of a 3D texture is a depth slice. Their rows count from the first row that
//! an upload writes, on both GPU paths.
//!
//! Writes and uploads take effect when the GPU queue receives them. On WebGPU that is before the
//! commands recorded since the previous `Submit`, so a list writes a buffer or a texture before the
//! commands that read it, never after a command that used it in the same submit.
//!
//! A frame's list creates its pipelines before any other command. The thread that draws then
//! starts to build them, without waiting, before it replays the rest of the list. A draw with a
//! pipeline that is still building draws nothing, and the first frame on a GPU device waits until
//! every pipeline that it creates is built.
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
    /// as. Compatibility mode allows one per texture, and WebGL2 fixes it at creation too. A cube
    /// texture has 6 layers, its faces. A 3D texture's layers are its depth, which halves at each
    /// mip level as its width and height do.
    CreateTexture = 4,
    /// [texture id]: destroys a texture, or releases a view.
    DestroyTexture = 5,
    /// [width, height]: the canvas's drawing buffer size in device pixels. Recorded in the frame
    /// built for that size, so the canvas and the frame's render targets always match.
    ResizeCanvas = 6,
    /// [render pipeline id, template, permutation bits, color format, depth format, sample count,
    /// state flags, vertex format, depth bias (i32), depth bias slope scale (f32)]: the vertex
    /// format (`vertex::*` bits) places the attributes that the template's vertex shader reads, in
    /// the vertex buffer of slot 0. The depth bias adds to each fragment's depth as WebGPU's does,
    /// in reversed depth, so a positive bias moves a surface toward the camera. Its clamp is 0, as
    /// compatibility mode requires.
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
    /// [pipeline id]: releases a render pipeline that no later command uses, such as the pipelines
    /// of a custom material whose last material was destroyed. A backend that holds no such
    /// pipeline does nothing, as when a capture replays a list again.
    DestroyPipeline = 52,
    /// [texture id, image id]: runs the generator that the backend holds under the image id, which
    /// fills every mip level of every face of a cube texture on the GPU in one submit, ahead of the
    /// frame's passes. The thread that draws counts a generator among the images it received once
    /// its code has loaded and its pipelines are built, so the generator runs at once. The texture
    /// is a cube of `RGB9E5_UFLOAT` with `COPY_DST` usage. The backend keeps the entry until
    /// `ReleaseImage`, so a new GPU device can fill the texture again. A list that runs again, as
    /// a capture's does, fills the texture again with the same texels.
    GenerateTexture = 54,
    /// []: submits everything recorded since the previous submit.
    Submit = 63,
}

impl Op {
    pub const ALL: [Op; 40] = [
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
        Op::DestroyPipeline,
        Op::GenerateTexture,
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
            Op::DestroyPipeline => "DESTROY_PIPELINE",
            Op::GenerateTexture => "GENERATE_TEXTURE",
            Op::Submit => "SUBMIT",
        }
    }
}

/// Opcode numbers kept for commands that the renderer will need, so that work on several of them
/// at once does not collide. The change that adds such a command moves its number into [`Op`].
pub mod reserved {
    /// Runs a compute pipeline with workgroup counts that the GPU reads from a buffer: skinning
    /// only the meshes that culling found visible, and the second phase of occlusion culling.
    pub const DISPATCH_INDIRECT: u8 = 43;
    /// Copies texels into a buffer, to read a frame or computed values back.
    pub const COPY_TEXTURE_TO_BUFFER: u8 = 50;
    /// Reads part of a buffer back into engine memory once the GPU has run the commands before it,
    /// a frame or more later: the object ids that GPU picking draws under the pointer.
    pub const READ_BUFFER: u8 = 53;

    pub const ALL: [u8; 3] = [DISPATCH_INDIRECT, COPY_TEXTURE_TO_BUFFER, READ_BUFFER];
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
///
/// Compressed formats store blocks of 4 x 4 texels. Each needs its family's capability flag, and
/// neither draws nor copies, so a texture of one gets all its texels and mip levels from writes.
pub mod format {
    use crate::caps::Capabilities;

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
    /// Three small unsigned floats in 32 bits, with no alpha: high dynamic range color in half the
    /// bytes of `RGBA16_FLOAT`. WebGPU draws into it only with `Capabilities::RG11B10_RENDERABLE`.
    pub const RG11B10_UFLOAT: u32 = 10;
    /// ASTC in blocks of 4 x 4 texels, 16 bytes each (`Capabilities::TEXTURE_ASTC`).
    pub const ASTC_4X4_UNORM: u32 = 11;
    pub const ASTC_4X4_UNORM_SRGB: u32 = 12;
    /// BC7 in blocks of 4 x 4 texels, 16 bytes each (`Capabilities::TEXTURE_BC`).
    pub const BC7_RGBA_UNORM: u32 = 13;
    pub const BC7_RGBA_UNORM_SRGB: u32 = 14;
    /// ETC2 without alpha, in blocks of 4 x 4 texels, 8 bytes each (`Capabilities::TEXTURE_ETC2`).
    pub const ETC2_RGB8_UNORM: u32 = 15;
    pub const ETC2_RGB8_UNORM_SRGB: u32 = 16;
    /// ETC2 with alpha, in blocks of 4 x 4 texels, 16 bytes each (`Capabilities::TEXTURE_ETC2`).
    pub const ETC2_RGBA8_UNORM: u32 = 17;
    pub const ETC2_RGBA8_UNORM_SRGB: u32 = 18;
    /// Three small unsigned floats with nine bits each and one shared exponent, in 32 bits, with no
    /// alpha: high dynamic range color in half the bytes of `RGBA16_FLOAT`, which every path
    /// filters. No path draws into it, and WebGL2 cannot copy it, because it reads copies through
    /// a framebuffer.
    pub const RGB9E5_UFLOAT: u32 = 19;
    /// One 32-bit float per texel, which draws and is read with `textureLoad`, unfiltered:
    /// ambient occlusion's copy of the depth. WebGL2 calls it `R32F`, and draws into it with
    /// `EXT_color_buffer_float`.
    pub const R32_FLOAT: u32 = 20;
    /// BC6H in blocks of 4 x 4 texels, 16 bytes each, with three unsigned half floats per texel
    /// and no alpha: high dynamic range color in an eighth of the bytes of `RGBA16_FLOAT`
    /// (`Capabilities::TEXTURE_BC`).
    pub const BC6H_RGB_UFLOAT: u32 = 21;
    /// Depth as a 16-bit unsigned normalized number: half the bytes of `DEPTH32_FLOAT`, with even
    /// steps of 1 / 65,535 from 0 to 1. WebGL2 calls it `DEPTH_COMPONENT16`.
    pub const DEPTH16_UNORM: u32 = 22;

    /// Every format.
    pub const ALL: [u32; 23] = [
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
        RG11B10_UFLOAT,
        ASTC_4X4_UNORM,
        ASTC_4X4_UNORM_SRGB,
        BC7_RGBA_UNORM,
        BC7_RGBA_UNORM_SRGB,
        ETC2_RGB8_UNORM,
        ETC2_RGB8_UNORM_SRGB,
        ETC2_RGBA8_UNORM,
        ETC2_RGBA8_UNORM_SRGB,
        RGB9E5_UFLOAT,
        R32_FLOAT,
        BC6H_RGB_UFLOAT,
        DEPTH16_UNORM,
    ];

    /// One past the highest format code, the length of the tables that the replay loop indexes by
    /// code.
    pub const CODES: u32 = {
        let mut highest = 0;
        let mut k = 0;
        while k < ALL.len() {
            if ALL[k] > highest {
                highest = ALL[k];
            }
            k += 1;
        }
        highest + 1
    };

    /// True for a code that names a format.
    pub const fn is_known(format: u32) -> bool {
        let mut k = 0;
        while k < ALL.len() {
            if ALL[k] == format {
                return true;
            }
            k += 1;
        }
        false
    }

    /// True for the depth formats.
    pub const fn is_depth(format: u32) -> bool {
        matches!(format, DEPTH16_UNORM | DEPTH24_PLUS | DEPTH32_FLOAT)
    }

    /// True for the formats stored in compressed blocks of texels.
    pub const fn is_compressed(format: u32) -> bool {
        block_size(format) > 1
    }

    /// The capability flag that a device needs for a format: none for uncompressed formats.
    pub const fn capability(format: u32) -> Capabilities {
        match format {
            ASTC_4X4_UNORM | ASTC_4X4_UNORM_SRGB => Capabilities::TEXTURE_ASTC,
            BC7_RGBA_UNORM | BC7_RGBA_UNORM_SRGB | BC6H_RGB_UFLOAT => Capabilities::TEXTURE_BC,
            ETC2_RGB8_UNORM | ETC2_RGB8_UNORM_SRGB | ETC2_RGBA8_UNORM | ETC2_RGBA8_UNORM_SRGB => {
                Capabilities::TEXTURE_ETC2
            }
            _ => Capabilities::empty(),
        }
    }

    /// Texels on each side of a block: 4 for the compressed formats, and 1 for the rest.
    pub const fn block_size(format: u32) -> u32 {
        match format {
            ASTC_4X4_UNORM..=ETC2_RGBA8_UNORM_SRGB | BC6H_RGB_UFLOAT => 4,
            _ => 1,
        }
    }

    /// Bytes of one block: one texel of an uncompressed format. 0 for `NONE`, for unknown codes,
    /// and for `DEPTH24_PLUS`, whose texels have no layout that writes and copies can use.
    pub const fn block_bytes(format: u32) -> u32 {
        match format {
            CANVAS | RGBA8_UNORM | BGRA8_UNORM | DEPTH32_FLOAT | R32_UINT | RGBA8_UNORM_SRGB
            | RG11B10_UFLOAT | RGB9E5_UFLOAT | R32_FLOAT => 4,
            DEPTH16_UNORM => 2,
            RGBA16_FLOAT | ETC2_RGB8_UNORM | ETC2_RGB8_UNORM_SRGB => 8,
            RGBA32_FLOAT
            | ASTC_4X4_UNORM
            | ASTC_4X4_UNORM_SRGB
            | BC7_RGBA_UNORM
            | BC7_RGBA_UNORM_SRGB
            | BC6H_RGB_UFLOAT
            | ETC2_RGBA8_UNORM
            | ETC2_RGBA8_UNORM_SRGB => 16,
            _ => 0,
        }
    }

    /// Bytes per texel of an uncompressed format, or 0 for a compressed or unknown one.
    pub const fn texel_bytes(format: u32) -> u32 {
        if is_compressed(format) {
            0
        } else {
            block_bytes(format)
        }
    }

    /// Blocks along one side of a mip level.
    pub const fn blocks(format: u32, size: u32, level: u32) -> u32 {
        level_size(size, level).div_ceil(block_size(format))
    }

    /// Bytes of one row of blocks of a mip level: a row of texels for an uncompressed format.
    pub const fn row_bytes(format: u32, width: u32, level: u32) -> u64 {
        blocks(format, width, level) as u64 * block_bytes(format) as u64
    }

    /// True for the formats whose textures get their texels from writes alone: the compressed
    /// formats and `RGB9E5_UFLOAT`, which no path draws into or copies.
    pub const fn writes_only(format: u32) -> bool {
        is_compressed(format) || format == RGB9E5_UFLOAT
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
    /// textures reads. A compressed level holds whole blocks, so it rounds up to them.
    pub const fn level_bytes(format: u32, width: u32, height: u32, level: u32) -> u64 {
        row_bytes(format, width, level) * blocks(format, height, level) as u64
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
    use super::format;

    /// One 2D image: the texture has one layer.
    pub const D2: u32 = 0;
    /// An array of 2D layers, which shaders index. It may have one layer.
    pub const D2_ARRAY: u32 = 1;
    /// Six square layers, the faces of a cube, in the order +X, -X, +Y, -Y, +Z, -Z. Shaders sample
    /// it by direction, and filtering blends across the edges between faces. Compatibility mode
    /// has no arrays of cubes.
    pub const CUBE: u32 = 2;
    /// A 3D texture, whose layers are its depth slices. Shaders sample it with three coordinates,
    /// and filtering blends between slices, as a color grading lookup table needs.
    pub const D3: u32 = 3;

    /// The faces of a cube texture.
    pub const CUBE_FACES: u32 = 6;

    /// The layers of one mip level of a texture with `layers` layers: a 3D texture's depth halves at
    /// each level, and the other kinds keep every layer.
    pub const fn level_layers(view: u32, layers: u32, level: u32) -> u32 {
        if view == D3 {
            format::level_size(layers, level)
        } else {
            layers
        }
    }
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
    /// Group 0 of the culling compute pipelines, plain and of the two occlusion phases: the
    /// view's parameters, the scene's tables, its compacted instances and indirect draws, then its
    /// depth pyramid or a placeholder.
    pub const CULL: u32 = 1;
    /// Group 1 of render pipelines that read instances from data textures: the draw records.
    pub const DRAWS: u32 = 2;
    /// Group 2 of render pipelines that read instances from data textures: the textures.
    pub const INSTANCES: u32 = 3;
    /// Group 0 of the final pass: its settings and the scene color it reads, then at bindings 9
    /// and 10 the color grading table, a 3D texture, and its linear sampler, and at binding 11 the
    /// outline effect's mask, which the table's sampler reads.
    pub const FINAL: u32 = 4;
    /// The maps of render pipelines that sample them: a 2D array texture, then its sampler. It is
    /// group 1 on WebGPU, and group 3 on WebGL2, after the groups of the data textures.
    pub const TEXTURES: u32 = 5;
    /// The maps of the standard material, in the order of a material's map slots: a 2D array
    /// texture at each binding from 0, then each one's sampler at the bindings after every
    /// texture. It sits where [`TEXTURES`] sits.
    pub const MATERIAL_MAPS: u32 = 6;
    /// Group 0 of depth-only pipelines, such as shadow casters': per-frame constants and the
    /// material table. It has no shadow map, so a pass that draws into the shadow map never binds
    /// it.
    pub const DEPTH: u32 = 7;
    /// Group 0 of the light clustering compute pipelines: their parameters' uniform block, the
    /// light list, and the light grid that they write.
    pub const LIGHT_CLUSTERS: u32 = 8;
    /// Group 0 of a step of bloom's chain: the step's uniform block, the texture it reads and a
    /// linear sampler.
    pub const BLOOM: u32 = 9;
    /// Group 0 of the final pass that adds bloom: [`FINAL`]'s first two bindings, then bloom's
    /// uniform block, the texture of each of bloom's levels and their linear sampler, then
    /// [`FINAL`]'s color grading table and its sampler at bindings 9 and 10, and its outline mask
    /// at binding 11.
    pub const FINAL_BLOOM: u32 = 10;
    /// Group 2 of render pipelines that skin in the vertex shader: the texture of every animated
    /// instance's skinning matrices, which vertex shaders read.
    pub const JOINTS: u32 = 11;
    /// Group 0 of the skinning compute pipeline: its table of formats and parts, a mesh page's
    /// vertices, the skinned vertices that it writes, the texture of skinning matrices, and the
    /// morph textures of deltas and of weights.
    pub const SKIN: u32 = 12;
    /// Group 0 of the depth pyramid's compute pipeline: the level's parameters at a dynamic
    /// offset, the pyramid, which it writes, and the view's depth target of one sample, which it
    /// reads as a float texture.
    pub const DEPTH_PYRAMID: u32 = 14;
    /// Group 0 of ambient occlusion's depth step on a depth target of one sample: the steps'
    /// uniform block, then the depth target, which the step reads as unfilterable floats with
    /// `textureLoad`. Compatibility mode reads no depth texture type with `textureLoad`, so the
    /// binding is a plain float texture on every path.
    pub const AO_DEPTH: u32 = 16;
    /// [`AO_DEPTH`] for a multisampled depth target, of which the step reads sample 0. Only
    /// WebGPU has it: WebGL2 reads a copy of one sample that the backend keeps.
    pub const AO_DEPTH_MS: u32 = 17;
    /// Group 0 of ambient occlusion's other steps: the steps' uniform block, then the two
    /// textures that the step reads with `textureLoad`.
    pub const AO: u32 = 18;
}

/// Bits of a render pipeline's permutation word, which pick a shader variant. A feature that
/// changes what a shader costs is a bit, so a pipeline without the feature does not pay for it. A
/// cheap option is a uniform value instead. A shader reads each bit as the shader def of the bit's
/// name in [`NAMES`], and the shader manifest lists the bits that each shader is built with. A bit
/// that no shader reads yet is reserved for the feature it names, so no two features share one.
pub mod permutation {
    /// The vertex shader reads its draw's index, from `WEBGL_multi_draw`.
    pub const DRAW_INDEX: u32 = 1;
    /// The fragment shader applies the exposure and the tone mapping and encodes sRGB itself, for
    /// an 8-bit target that resolves straight into the canvas. Without it, the shader writes
    /// linear color for the final pass.
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
    /// The final pass smooths edges with FXAA before the output transform.
    pub const FXAA: u32 = 256;
    /// The normal map's frame comes from the mesh's tangents, not from how the texture
    /// coordinates change between pixels.
    pub const VERTEX_TANGENT: u32 = 512;
    /// The low bit of the debug view's number in the debug view template's variants: 0 normals,
    /// 1 depth, 2 overdraw, 3 wireframe.
    pub const DEBUG_VIEW_LOW: u32 = 1024;
    /// The high bit of the debug view's number.
    pub const DEBUG_VIEW_HIGH: u32 = 2048;
    /// The pipeline draws the camera's depth prepass. On WebGPU it is a build of the depth
    /// template, which clips what lies in front of the near plane, as the templates that shade
    /// do; without the bit, the shadow passes flatten casters there onto the near face. On WebGL2
    /// it marks a mesh template's pipeline, which the backend draws with the vertex shader of the
    /// template's build without the bit and a fragment shader that writes nothing.
    pub const PREPASS: u32 = 4096;
    /// The fragment shader does its color math at half precision: lighting, tone mapping and
    /// sRGB encoding. WebGPU builds use 16-bit floats, which need the device feature
    /// `shader-f16`, and WebGL2 builds run that math at `mediump`.
    pub const HALF: u32 = 8192;
    /// The shadow depth template moves the back faces of a caster that draws only those toward
    /// the light, by up to a texel of the map it draws into. A back face that lies on a receiver,
    /// such as a box's bottom on the ground, then stays in front of it. Without it, a caster's
    /// faces keep their depth, as the faces of a double-sided caster must: they hold its own lit
    /// side.
    pub const CASTER_OFFSET: u32 = 16384;
    /// The final pass adds bloom's levels to the scene color before the output transform.
    pub const BLOOM: u32 = 32768;
    /// The outline mask template marks the parts of outlined objects that nothing hides. Without
    /// it, the template marks every part, hidden or not.
    pub const OUTLINE_VISIBLE: u32 = 65536;

    /// Every bit with its name: the shader def that turns its code on, in bit order.
    pub const NAMES: [(&str, u32); 17] = [
        ("DRAW_INDEX", DRAW_INDEX),
        ("TONE_MAP", TONE_MAP),
        ("VERTEX_COLOR", VERTEX_COLOR),
        ("NORMAL_MAP", NORMAL_MAP),
        ("ALPHA_MASK", ALPHA_MASK),
        ("RECEIVE_SHADOWS", RECEIVE_SHADOWS),
        ("SKIN", SKIN),
        ("MORPH", MORPH),
        ("FXAA", FXAA),
        ("VERTEX_TANGENT", VERTEX_TANGENT),
        ("DEBUG_VIEW_LOW", DEBUG_VIEW_LOW),
        ("DEBUG_VIEW_HIGH", DEBUG_VIEW_HIGH),
        ("PREPASS", PREPASS),
        ("HALF", HALF),
        ("CASTER_OFFSET", CASTER_OFFSET),
        ("BLOOM", BLOOM),
        ("OUTLINE_VISIBLE", OUTLINE_VISIBLE),
    ];

    /// The bits that a device fixes when the engine starts, the same in every pipeline it builds:
    /// the draw index where WebGL2 has multi-draw, tone mapping in the shader where the device
    /// draws scene color in 8 bits, and half precision where the device draws with it. The shader
    /// build writes the engine's variants into one module for each GPU path and each value of
    /// these bits, and a page loads only its own.
    pub const DEVICE: u32 = DRAW_INDEX | TONE_MAP | HALF;

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
    /// Draws each pair of vertices as a line one pixel wide, instead of each three as a triangle.
    pub const LINE_LIST: u32 = 2;
    /// Draws only the back faces of triangles, as shadow casters draw into shadow maps.
    pub const CULL_FRONT: u32 = 4;
    /// Writes no depth.
    pub const NO_DEPTH_WRITE: u32 = 8;
    /// Draws every fragment whatever the depth target holds, and writes no depth.
    pub const NO_DEPTH_TEST: u32 = 16;
    /// The blend field: how the fragment's color, premultiplied by its alpha, meets the target's.
    /// Without it the fragment replaces the target's color.
    pub const BLEND: u32 = 96;
    /// Blending over the target: `src + dst * (1 - src alpha)`, for color and alpha.
    pub const BLEND_NORMAL: u32 = 32;
    /// Light added to the target: `src + dst`, for color and alpha.
    pub const BLEND_ADDITIVE: u32 = 64;
    /// The target tinted by the fragment: `src * dst + dst * (1 - src alpha)`, as three.js's
    /// premultiplied multiply blending; the target's alpha stays.
    pub const BLEND_MULTIPLY: u32 = 96;
    /// Draws only where the fragment's depth equals what the depth target holds, as the opaque
    /// pass draws the surfaces that the depth prepass found nearest.
    pub const DEPTH_EQUAL: u32 = 128;
    /// Writes no color, as the depth prepass draws into the color target's render pass.
    pub const NO_COLOR_WRITE: u32 = 256;
    /// Every flag.
    pub const ALL: u32 = CULL_NONE
        | LINE_LIST
        | CULL_FRONT
        | NO_DEPTH_WRITE
        | NO_DEPTH_TEST
        | BLEND
        | DEPTH_EQUAL
        | NO_COLOR_WRITE;
}

/// Vertex formats. Every vertex has a position and a normal. A format adds optional attributes
/// after them, each with its bit, and gives every attribute a type: 32-bit floats, or one of the
/// 8-bit and 16-bit integer types that glTF's `KHR_mesh_quantization` allows for it. Normalized
/// integers read as fractions, from 0 to 1 or from -1 to 1, and plain integers read as their whole
/// values. Each attribute's type is a field of the format above the attribute bits, which holds
/// the type's place in the attribute's list of types. The first type in each list is the default,
/// so a format of floats is the set of its attribute bits alone.
///
/// Each attribute sits at its place in [`ATTRIBUTES`](vertex::ATTRIBUTES) order and takes whole
/// 4-byte words, as glTF aligns them, so a format's layout follows from the format alone. GPUs
/// read each attribute's whole slot, padding included, and shaders take the components they
/// declare. Each attribute has a fixed vertex shader location: its place in that order.
pub mod vertex {
    /// The first texture coordinates: two values.
    pub const UV0: u32 = 1;
    /// The second texture coordinates: two values.
    pub const UV1: u32 = 2;
    /// A tangent and its handedness, +1 or -1, as three.js and glTF store them: four values.
    pub const TANGENT: u32 = 4;
    /// A linear color and its alpha: four values.
    pub const COLOR: u32 = 8;
    /// The four joints that move a skinned vertex, as whole numbers.
    pub const JOINTS: u32 = 16;
    /// How much each of the four joints moves a skinned vertex.
    pub const WEIGHTS: u32 = 32;
    /// Where a morphed vertex's morph target deltas start, and how many there are: two whole
    /// numbers as floats.
    pub const MORPH: u32 = 1 << 27;
    /// Every optional attribute's bit.
    pub const ALL: u32 = UV0 | UV1 | TANGENT | COLOR | JOINTS | WEIGHTS | MORPH;
    /// The first vertex shader location of the per-instance attributes, after every location
    /// that a vertex attribute can take.
    pub const INSTANCE_LOCATION: u32 = 9;
    /// The location of the position.
    pub const POSITION: usize = 0;
    /// The location of the normal.
    pub const NORMAL: usize = 1;

    /// How an attribute's values sit in a vertex. The codes are the TypeScript constants'.
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    #[repr(u32)]
    pub enum Type {
        F32 = 0,
        Unorm8 = 1,
        Snorm8 = 2,
        Unorm16 = 3,
        Snorm16 = 4,
        Uint8 = 5,
        Sint8 = 6,
        Uint16 = 7,
        Sint16 = 8,
    }

    impl Type {
        /// Every type, by code.
        pub const ALL: [Type; 9] = [
            Type::F32,
            Type::Unorm8,
            Type::Snorm8,
            Type::Unorm16,
            Type::Snorm16,
            Type::Uint8,
            Type::Sint8,
            Type::Uint16,
            Type::Sint16,
        ];

        /// Bytes of one value.
        pub const fn bytes(self) -> u32 {
            match self {
                Type::F32 => 4,
                Type::Unorm8 | Type::Snorm8 | Type::Uint8 | Type::Sint8 => 1,
                Type::Unorm16 | Type::Snorm16 | Type::Uint16 | Type::Sint16 => 2,
            }
        }

        /// True for integers that read as fractions.
        pub const fn normalized(self) -> bool {
            matches!(
                self,
                Type::Unorm8 | Type::Snorm8 | Type::Unorm16 | Type::Snorm16
            )
        }

        /// The largest value of an integer type, which a normalized read divides by, or 1 for
        /// floats.
        pub const fn max(self) -> u32 {
            match self {
                Type::F32 => 1,
                Type::Unorm8 | Type::Uint8 => u8::MAX as u32,
                Type::Snorm8 | Type::Sint8 => i8::MAX as u32,
                Type::Unorm16 | Type::Uint16 => u16::MAX as u32,
                Type::Snorm16 | Type::Sint16 => i16::MAX as u32,
            }
        }

        /// What a shader reads from a value of the type that holds the number `whole`: a fraction
        /// for a normalized integer, which glTF clamps at -1, and `whole` itself otherwise.
        pub fn read(self, whole: f32) -> f32 {
            if self.normalized() {
                (whole / self.max() as f32).max(-1.0)
            } else {
                whole
            }
        }

        /// The value that the little-endian `bytes` hold, as a shader reads it.
        pub fn decode(self, bytes: &[u8]) -> f32 {
            self.read(match self {
                Type::F32 => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
                Type::Unorm8 | Type::Uint8 => f32::from(bytes[0]),
                Type::Snorm8 | Type::Sint8 => f32::from(bytes[0].cast_signed()),
                Type::Unorm16 | Type::Uint16 => f32::from(u16::from_le_bytes([bytes[0], bytes[1]])),
                Type::Snorm16 | Type::Sint16 => f32::from(i16::from_le_bytes([bytes[0], bytes[1]])),
            })
        }
    }

    /// The types of positions and texture coordinates, by code: floats, and 8-bit and 16-bit
    /// integers, normalized or plain.
    const ANY: &[Type] = &Type::ALL;
    /// The types of normals and tangents: floats, and normalized signed integers.
    const DIRECTION: &[Type] = &[Type::F32, Type::Snorm8, Type::Snorm16];
    /// The types of colors and joint weights: floats, and normalized unsigned integers.
    const FRACTION: &[Type] = &[Type::F32, Type::Unorm8, Type::Unorm16];
    /// The types of joint indices: plain unsigned integers.
    const INDEX: &[Type] = &[Type::Uint8, Type::Uint16];
    /// The type of the morph attribute: floats alone.
    const FLOAT: &[Type] = &[Type::F32];

    /// One vertex attribute.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct Attribute {
        /// The attribute's format bit, or 0 for the position and the normal, which every
        /// format has.
        pub bit: u32,
        /// Its values per vertex.
        pub components: u32,
        /// The vertex shader location that reads it: its place in [`ATTRIBUTES`].
        pub location: u32,
        /// The first bit of its type field in a format.
        pub shift: u32,
        /// The types it may have, by the value of its type field. The first is the default.
        pub types: &'static [Type],
        /// True when shaders read it as whole numbers, false when they read floats.
        pub integer: bool,
    }

    impl Attribute {
        /// Bits of its type field: enough for the place of its last type.
        pub const fn width(&self) -> u32 {
            u32::BITS - ((self.types.len() - 1) as u32).leading_zeros()
        }

        /// The bits of its type field.
        pub const fn mask(&self) -> u32 {
            ((1 << self.width()) - 1) << self.shift
        }

        /// Bytes that it takes in a vertex with the type `ty`: whole 4-byte words.
        pub const fn size(&self, ty: Type) -> u32 {
            (self.components * ty.bytes()).next_multiple_of(4)
        }

        /// Its type field for `ty`, or `None` when it may not have that type.
        pub const fn field(&self, ty: Type) -> Option<u32> {
            let mut k = 0;
            while k < self.types.len() {
                if self.types[k] as u32 == ty as u32 {
                    return Some((k as u32) << self.shift);
                }
                k += 1;
            }
            None
        }
    }

    /// Every attribute, in the order they sit in a vertex: the position, the normal, then the
    /// optional attributes in bit order. The type fields follow the attribute bits in the same
    /// order.
    pub const ATTRIBUTES: [Attribute; 9] = [
        Attribute {
            bit: 0,
            components: 3,
            location: 0,
            shift: 6,
            types: ANY,
            integer: false,
        },
        Attribute {
            bit: 0,
            components: 3,
            location: 1,
            shift: 10,
            types: DIRECTION,
            integer: false,
        },
        Attribute {
            bit: UV0,
            components: 2,
            location: 2,
            shift: 12,
            types: ANY,
            integer: false,
        },
        Attribute {
            bit: UV1,
            components: 2,
            location: 3,
            shift: 16,
            types: ANY,
            integer: false,
        },
        Attribute {
            bit: TANGENT,
            components: 4,
            location: 4,
            shift: 20,
            types: DIRECTION,
            integer: false,
        },
        Attribute {
            bit: COLOR,
            components: 4,
            location: 5,
            shift: 22,
            types: FRACTION,
            integer: false,
        },
        Attribute {
            bit: JOINTS,
            components: 4,
            location: 6,
            shift: 24,
            types: INDEX,
            integer: true,
        },
        Attribute {
            bit: WEIGHTS,
            components: 4,
            location: 7,
            shift: 25,
            types: FRACTION,
            integer: false,
        },
        Attribute {
            bit: MORPH,
            components: 2,
            location: 8,
            shift: 27,
            types: FLOAT,
            integer: false,
        },
    ];

    /// Every bit that a format may set: the attribute bits and the type fields.
    pub const BITS: u32 = {
        let mut bits = ALL;
        let mut k = 0;
        while k < ATTRIBUTES.len() {
            bits |= ATTRIBUTES[k].mask();
            k += 1;
        }
        bits
    };

    /// True when a format has the attribute at `location`.
    pub const fn has(format: u32, location: usize) -> bool {
        location < ATTRIBUTES.len()
            && (format & ATTRIBUTES[location].bit) == ATTRIBUTES[location].bit
    }

    /// The type of the attribute at `location` in a format, or `None` when the format lacks it or
    /// its type field names no type.
    pub const fn type_of(format: u32, location: usize) -> Option<Type> {
        if !has(format, location) {
            return None;
        }
        let attribute = ATTRIBUTES[location];
        let place = ((format & attribute.mask()) >> attribute.shift) as usize;
        if place < attribute.types.len() {
            Some(attribute.types[place])
        } else {
            None
        }
    }

    /// The format with the attribute at `location` added, or changed, to the type `ty`, or `None`
    /// when the attribute may not have that type.
    pub const fn with(format: u32, location: usize, ty: Type) -> Option<u32> {
        let attribute = ATTRIBUTES[location];
        match attribute.field(ty) {
            Some(field) => Some((format & !attribute.mask()) | attribute.bit | field),
            None => None,
        }
    }

    /// True when a format sets only known bits, names a type in each of its attributes' fields,
    /// and leaves the fields of the attributes it lacks at 0, so each layout has one format.
    pub const fn valid(format: u32) -> bool {
        if format & !BITS != 0 {
            return false;
        }
        let mut k = 0;
        while k < ATTRIBUTES.len() {
            let present = has(format, k);
            if (present && type_of(format, k).is_none())
                || (!present && format & ATTRIBUTES[k].mask() != 0)
            {
                return false;
            }
            k += 1;
        }
        true
    }

    /// Bytes per vertex of a format.
    pub const fn stride(format: u32) -> u32 {
        let mut bytes = 0;
        let mut k = 0;
        while k < ATTRIBUTES.len() {
            if let Some(ty) = type_of(format, k) {
                bytes += ATTRIBUTES[k].size(ty);
            }
            k += 1;
        }
        bytes
    }

    /// The first byte of the attribute at `location` in a vertex of a format, or `None` when the
    /// format lacks it.
    pub const fn offset(format: u32, location: usize) -> Option<u32> {
        if !has(format, location) {
            return None;
        }
        let mut bytes = 0;
        let mut k = 0;
        while k < location {
            if let Some(ty) = type_of(format, k) {
                bytes += ATTRIBUTES[k].size(ty);
            }
            k += 1;
        }
        Some(bytes)
    }
}

/// Sizes of the data that the render pipelines read. The shaders in `crates/null3d-shaders/wgsl/`
/// declare the same sizes, and a test checks that they agree.
pub mod sizes {
    /// Bytes per compacted instance: three rows of the world matrix, then a vector of ids.
    pub const INSTANCE_STRIDE: u32 = 64;
    /// Bytes of the per-frame uniform block: the view-projection matrix, four vectors, the output
    /// settings, the fog's 48 bytes, the light grid's two vectors, three vectors that custom
    /// materials read, the camera's near and far distances, ambient occlusion's values, and the
    /// environment's 208 bytes.
    pub const FRAME_UNIFORM_BYTES: u32 = 512;
    /// Bytes of the output settings: the exposure, the tone mapping and two spare words.
    pub const OUTPUT_UNIFORM_BYTES: u32 = 16;
    /// Threads per workgroup of the culling shader.
    pub const CULL_WORKGROUP_SIZE: u32 = 128;
    /// 32-bit words per indexed indirect draw.
    pub const INDIRECT_WORDS: u32 = 5;
    /// 32-bit words per bucket record of the culling shader: its slice's base, its material, its
    /// local sphere's radius, its first draw and draw count, the sphere's centre, and the first
    /// joint of a skin that the vertex shader skins.
    pub const BUCKET_WORDS: u32 = 9;
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
    /// Bytes of one point or spot light's record, which fragment shaders read from the light
    /// list: four vectors of four 32-bit values.
    pub const LIGHT_RECORD_BYTES: u32 = 64;
    /// Light records per row of the WebGL2 light list's data texture, four texels each. A
    /// power of two.
    pub const LIGHTS_PER_TEXTURE_ROW: u32 = 512;
    /// Bytes of one draw record: the start of the draw's slice of the index list, its material
    /// and the data texture its instances come from, and one spare word.
    pub const DRAW_RECORD_BYTES: u32 = 16;
    /// Draw records one multi-draw call reads: a 4 KiB uniform block.
    pub const MULTI_DRAW_RECORDS: u32 = 256;
    /// Materials in the material table.
    pub const MAX_MATERIALS: u32 = 1024;
    /// Bytes of one material's row in the material table: nine `vec4f`s. On WebGL2 each row is a
    /// row of nine `RGBA32_FLOAT` texels of a data texture.
    pub const MATERIAL_BYTES: u32 = 144;
    /// The map slots of a material: the textures of the [`super::layout::MATERIAL_MAPS`] layout,
    /// at bindings from 0, with each one's sampler at the bindings after every texture.
    pub const MAP_SLOTS: u32 = 8;
    /// Grid cells in use at most, which the shaders' tables of offsets from the camera to each
    /// cell hold, one `vec4f` each.
    pub const MAX_CELLS: u32 = 512;
    /// Where a cell index starts in a word that packs it above a bucket or a row: a bucket table
    /// entry of the culling shader, or an index list entry.
    pub const CELL_SHIFT: u32 = 23;
    /// Runs of sources in cell order that one culling dispatch covers at most: the culling
    /// parameters list them for the cells a view can see. Runs that follow each other join, so
    /// there is at most one per pair of cells, and one more for the sources that move.
    pub const MAX_CULL_RANGES: u32 = MAX_CELLS / 2 + 1;
    /// Bytes of the occlusion phases' values at the end of the culling parameters: the
    /// view-projection matrix, the render size, the depth pyramid's levels, where the second
    /// phase's draws and the history start, and an occluder's least span. Views that cull in one
    /// phase leave them unset, but the parameters have room for them.
    pub const CULL_OCCLUSION_BYTES: u32 = 96;
    /// Bytes of one vertex of the debug lines: its position relative to the camera, three 32-bit
    /// floats, then its sRGB color, four bytes from red to alpha.
    pub const LINE_VERTEX_BYTES: u32 = 16;
    /// Bytes of the uniform block of the directional light's shadow cascades: four matrices, then
    /// seven vectors.
    pub const SHADOW_UNIFORM_BYTES: u32 = 368;
    /// Bytes of the uniform block of the shadow atlas's tiles: a matrix for each of the 24 tiles,
    /// then a vector for each, then the filter's vector.
    pub const SHADOW_TILES_UNIFORM_BYTES: u32 = 1936;
}

/// Shader templates for `CreateRenderPipeline` and `CreateComputePipeline`.
pub mod template {
    /// Instanced meshes with the standard material.
    pub const INSTANCED_LIT: u32 = 1;
    /// Instanced meshes without lighting.
    pub const INSTANCED_UNLIT: u32 = 2;
    /// Instanced meshes colored by their first texture coordinates, for the engine's own tests of
    /// vertex formats.
    pub const INSTANCED_TEXCOORDS: u32 = 3;
    /// Debug lines: vertices relative to the camera with an sRGB color each, from a vertex buffer
    /// of [`LINE_VERTEX_BYTES`](super::sizes::LINE_VERTEX_BYTES) per vertex. Only development
    /// builds of the engine have it.
    pub const DEBUG_LINES: u32 = 4;
    /// Instanced meshes without lighting, whose base color is multiplied by a map that the first
    /// texture coordinates place.
    pub const INSTANCED_UNLIT_MAP: u32 = 5;
    /// Instanced meshes with the standard material and its texture maps, which the first texture
    /// coordinates place, or the second for a map on the second set.
    pub const INSTANCED_STANDARD_MAPS: u32 = 6;
    /// The final pass: one triangle over the canvas, which scales the scene color up to it and
    /// tone maps HDR color.
    pub const FINAL: u32 = 7;
    /// The depth of instanced shadow casters, drawn from a light into a layer of a shadow map.
    /// Casters between the light and the layer's view flatten onto its near face.
    pub const SHADOW_DEPTH: u32 = 8;
    /// A texture behind every object: one triangle over the whole view, with no vertex buffer, that
    /// samples a layer of a texture array. The bind group of index 0 is the frame's and that of
    /// index 1 the texture's. The draw's first vertex is the layer times three.
    pub const BACKGROUND: u32 = 9;
    /// The debug views of instanced meshes: normals, depth, overdraw or wireframe, which the
    /// permutation's debug view bits pick, in place of each mesh's material. Only development
    /// builds of the engine have it.
    pub const DEBUG_VIEW: u32 = 12;
    /// One step of bloom's chain: one triangle over the step's target that reads the step before
    /// it. Its uniform block makes it the bright pass or one direction of a level's blur.
    pub const BLOOM: u32 = 13;
    /// The final pass with bloom: [`FINAL`]'s pass, which adds bloom's levels to the scene color
    /// before the output transform.
    pub const FINAL_BLOOM: u32 = 14;
    /// The GPU culling compute shader.
    pub const CULL: u32 = 16;
    /// Light clustering, first step: counts the lights of each cluster of the light grid.
    pub const LIGHT_COUNT: u32 = 17;
    /// Light clustering, second step: gives each cluster its place in the light index list.
    pub const LIGHT_PLACE: u32 = 18;
    /// Light clustering, last step: writes each cluster's lights into its place in the list.
    pub const LIGHT_WRITE: u32 = 19;
    /// The skinning compute shader, which skins the parts of skinned meshes into a buffer of
    /// skinned vertices.
    pub const SKIN: u32 = 20;
    /// The outline mask of instanced meshes: each outlined object's coverage, and with
    /// [`OUTLINE_VISIBLE`](super::permutation::OUTLINE_VISIBLE) the parts of it that nothing
    /// hides. It binds as the depth template does.
    pub const OUTLINE_MASK: u32 = 21;
    /// Sprites: quads of instance batch rows that face the camera, whose world matrices hold each
    /// sprite's size, rotation, color and atlas frame packed (see `null3d_core::sprites`), in the
    /// material's color.
    pub const SPRITE: u32 = 22;
    /// [`SPRITE`] times the material's map, at each sprite's frame of the atlas. The bind group of
    /// index 1 is the map's, as for [`INSTANCED_UNLIT_MAP`].
    pub const SPRITE_MAP: u32 = 23;
    /// The first phase of occlusion culling: the culling shader's `early` entry point, which
    /// keeps the instances in view that drew in the view's last frame.
    pub const OCCLUSION_EARLY: u32 = 24;
    /// The second phase of occlusion culling: the culling shader's `late` entry point, which
    /// tests the instances in view against the depth pyramid.
    pub const OCCLUSION_LATE: u32 = 25;
    /// One level of the depth pyramid that the second phase of occlusion culling tests against.
    pub const DEPTH_PYRAMID: u32 = 28;
    /// Wide lines: a quad with round ends for each instance batch row, whose world matrix holds a
    /// segment's middle, its half, its end colors and its distance along the line packed (see
    /// `null3d_core::lines`), in the material's color times the segment's colors.
    pub const LINE: u32 = 29;
    /// [`LINE`] lit as a standard material that faces the camera: the sun, the point and spot
    /// lights and the ambient light shade each line.
    pub const LINE_LIT: u32 = 30;
    /// Ambient occlusion's first step: one triangle over a target at a fraction of the render
    /// size, which copies one texel of the depth target of one sample per pixel, as unfilterable
    /// floats.
    pub const AO_DEPTH: u32 = 31;
    /// [`AO_DEPTH`] from a multisampled depth target, whose sample 0 it reads. WebGPU only.
    pub const AO_DEPTH_MS: u32 = 32;
    /// Ambient occlusion's horizon search, three.js's GTAO: it writes how open each pixel is to
    /// the sky, and the normal that it rebuilt from the depth.
    pub const AO: u32 = 33;
    /// Ambient occlusion's edge-aware blur, three.js's Poisson denoise: it writes the occlusion
    /// that the opaque pass reads, beside the depth it blurred at.
    pub const AO_DENOISE: u32 = 34;
    /// The first template of custom materials: each compiled custom material's WGSL has its own
    /// template from here up, which the thread that draws receives from the sketch.
    pub const CUSTOM_FIRST: u32 = 64;
}

/// Why recording failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DrawListError {
    /// The command would take the list past its limit.
    Full {
        /// The most words the list holds.
        limit: usize,
    },
    /// Memory could not grow for the command.
    OutOfMemory {
        /// The words the list needed.
        words: usize,
    },
}

/// The most words a list holds unless it is given a lower limit: the words that 32-bit addresses
/// of engine memory reach.
pub const MAX_WORDS: usize = (u32::MAX / 4) as usize;

/// A draw list in engine memory. When a command needs more room than the list has, the list grows
/// to at least twice its size, so frames of one size allocate only in the first of them. Growing
/// moves the words, so the thread that replays the list reads its address with each frame.
#[derive(Debug)]
pub struct DrawList {
    words: Vec<u32>,
    limit: usize,
}

impl DrawList {
    /// An empty list with room for `words` words, which grows up to [`MAX_WORDS`].
    pub fn with_capacity(words: usize) -> Self {
        Self::with_limit(words, MAX_WORDS)
    }

    /// An empty list with room for `words` words, which grows up to `limit` words.
    pub fn with_limit(words: usize, limit: usize) -> Self {
        Self {
            words: Vec::with_capacity(words.min(limit)),
            limit,
        }
    }

    /// Forgets every recorded command, keeping the buffer.
    pub fn clear(&mut self) {
        self.words.clear();
    }

    /// Forgets the commands recorded after the first `len` words, a length that [`DrawList::len`]
    /// returned between two commands.
    pub fn truncate(&mut self, len: usize) {
        self.words.truncate(len);
    }

    pub fn len(&self) -> usize {
        self.words.len()
    }

    pub fn is_empty(&self) -> bool {
        self.words.is_empty()
    }

    /// The recorded words.
    pub fn words(&self) -> &[u32] {
        &self.words
    }

    /// Address of the first word, for the replay loop's view on engine memory.
    pub fn as_ptr(&self) -> *const u32 {
        self.words.as_ptr()
    }

    /// Makes room for `more` words after the recorded ones, growing the list to at least twice its
    /// size when it has too little.
    fn make_room(&mut self, more: usize) -> Result<(), DrawListError> {
        let needed = self.words.len() + more;
        if needed <= self.words.capacity() {
            return Ok(());
        }
        if needed > self.limit {
            return Err(DrawListError::Full { limit: self.limit });
        }
        let grown = needed.max(self.words.capacity() * 2).min(self.limit);
        self.words
            .try_reserve_exact(grown - self.words.len())
            .map_err(|_| DrawListError::OutOfMemory { words: needed })
    }

    /// Appends whole commands that another list recorded.
    pub fn append(&mut self, words: &[u32]) -> Result<(), DrawListError> {
        self.make_room(words.len())?;
        self.words.extend_from_slice(words);
        Ok(())
    }

    /// Appends one command with its operands.
    pub fn push(&mut self, op: Op, operands: &[u32]) -> Result<(), DrawListError> {
        let length = operands.len() + 1;
        self.make_room(length)?;
        self.words.push(op as u32 | ((length as u32) << 8));
        self.words.extend_from_slice(operands);
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
    let groups: &[(&str, &[(&str, u32)])] = &[
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
                ("RG11B10_UFLOAT", format::RG11B10_UFLOAT),
                ("ASTC_4X4_UNORM", format::ASTC_4X4_UNORM),
                ("ASTC_4X4_UNORM_SRGB", format::ASTC_4X4_UNORM_SRGB),
                ("BC7_RGBA_UNORM", format::BC7_RGBA_UNORM),
                ("BC7_RGBA_UNORM_SRGB", format::BC7_RGBA_UNORM_SRGB),
                ("ETC2_RGB8_UNORM", format::ETC2_RGB8_UNORM),
                ("ETC2_RGB8_UNORM_SRGB", format::ETC2_RGB8_UNORM_SRGB),
                ("ETC2_RGBA8_UNORM", format::ETC2_RGBA8_UNORM),
                ("ETC2_RGBA8_UNORM_SRGB", format::ETC2_RGBA8_UNORM_SRGB),
                ("RGB9E5_UFLOAT", format::RGB9E5_UFLOAT),
                ("R32_FLOAT", format::R32_FLOAT),
                ("BC6H_RGB_UFLOAT", format::BC6H_RGB_UFLOAT),
                ("DEPTH16_UNORM", format::DEPTH16_UNORM),
            ],
        ),
        (
            "VIEW",
            &[
                ("2D", view::D2),
                ("2D_ARRAY", view::D2_ARRAY),
                ("CUBE", view::CUBE),
                ("3D", view::D3),
                ("CUBE_FACES", view::CUBE_FACES),
            ],
        ),
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
                ("FINAL", layout::FINAL),
                ("TEXTURES", layout::TEXTURES),
                ("MATERIAL_MAPS", layout::MATERIAL_MAPS),
                ("DEPTH", layout::DEPTH),
                ("LIGHT_CLUSTERS", layout::LIGHT_CLUSTERS),
                ("BLOOM", layout::BLOOM),
                ("FINAL_BLOOM", layout::FINAL_BLOOM),
                ("JOINTS", layout::JOINTS),
                ("SKIN", layout::SKIN),
                ("DEPTH_PYRAMID", layout::DEPTH_PYRAMID),
                ("AO_DEPTH", layout::AO_DEPTH),
                ("AO_DEPTH_MS", layout::AO_DEPTH_MS),
                ("AO", layout::AO),
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
                ("JOINTS", vertex::JOINTS),
                ("WEIGHTS", vertex::WEIGHTS),
                ("MORPH", vertex::MORPH),
                ("ALL", vertex::ALL),
                ("INSTANCE_LOCATION", vertex::INSTANCE_LOCATION),
            ],
        ),
        (
            "VERTEX_TYPE",
            &[
                ("F32", vertex::Type::F32 as u32),
                ("UNORM8", vertex::Type::Unorm8 as u32),
                ("SNORM8", vertex::Type::Snorm8 as u32),
                ("UNORM16", vertex::Type::Unorm16 as u32),
                ("SNORM16", vertex::Type::Snorm16 as u32),
                ("UINT8", vertex::Type::Uint8 as u32),
                ("SINT8", vertex::Type::Sint8 as u32),
                ("UINT16", vertex::Type::Uint16 as u32),
                ("SINT16", vertex::Type::Sint16 as u32),
            ],
        ),
        (
            "STATE",
            &[
                ("CULL_NONE", state_flags::CULL_NONE),
                ("LINE_LIST", state_flags::LINE_LIST),
                ("CULL_FRONT", state_flags::CULL_FRONT),
                ("NO_DEPTH_WRITE", state_flags::NO_DEPTH_WRITE),
                ("NO_DEPTH_TEST", state_flags::NO_DEPTH_TEST),
                ("BLEND", state_flags::BLEND),
                ("BLEND_NORMAL", state_flags::BLEND_NORMAL),
                ("BLEND_ADDITIVE", state_flags::BLEND_ADDITIVE),
                ("BLEND_MULTIPLY", state_flags::BLEND_MULTIPLY),
                ("DEPTH_EQUAL", state_flags::DEPTH_EQUAL),
                ("NO_COLOR_WRITE", state_flags::NO_COLOR_WRITE),
            ],
        ),
        (
            "TEMPLATE",
            &[
                ("INSTANCED_LIT", template::INSTANCED_LIT),
                ("INSTANCED_UNLIT", template::INSTANCED_UNLIT),
                ("INSTANCED_TEXCOORDS", template::INSTANCED_TEXCOORDS),
                ("DEBUG_LINES", template::DEBUG_LINES),
                ("INSTANCED_UNLIT_MAP", template::INSTANCED_UNLIT_MAP),
                ("INSTANCED_STANDARD_MAPS", template::INSTANCED_STANDARD_MAPS),
                ("FINAL", template::FINAL),
                ("SHADOW_DEPTH", template::SHADOW_DEPTH),
                ("BACKGROUND", template::BACKGROUND),
                ("DEBUG_VIEW", template::DEBUG_VIEW),
                ("BLOOM", template::BLOOM),
                ("FINAL_BLOOM", template::FINAL_BLOOM),
                ("CULL", template::CULL),
                ("LIGHT_COUNT", template::LIGHT_COUNT),
                ("LIGHT_PLACE", template::LIGHT_PLACE),
                ("LIGHT_WRITE", template::LIGHT_WRITE),
                ("SKIN", template::SKIN),
                ("OUTLINE_MASK", template::OUTLINE_MASK),
                ("SPRITE", template::SPRITE),
                ("SPRITE_MAP", template::SPRITE_MAP),
                ("OCCLUSION_EARLY", template::OCCLUSION_EARLY),
                ("OCCLUSION_LATE", template::OCCLUSION_LATE),
                ("DEPTH_PYRAMID", template::DEPTH_PYRAMID),
                ("LINE", template::LINE),
                ("LINE_LIT", template::LINE_LIT),
                ("AO_DEPTH", template::AO_DEPTH),
                ("AO_DEPTH_MS", template::AO_DEPTH_MS),
                ("AO", template::AO),
                ("AO_DENOISE", template::AO_DENOISE),
                ("CUSTOM_FIRST", template::CUSTOM_FIRST),
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
                ("OUTPUT_UNIFORM_BYTES", sizes::OUTPUT_UNIFORM_BYTES),
                ("CULL_WORKGROUP_SIZE", sizes::CULL_WORKGROUP_SIZE),
                ("INDIRECT_WORDS", sizes::INDIRECT_WORDS),
                ("BUCKET_WORDS", sizes::BUCKET_WORDS),
                ("MATRIX_TEXELS", sizes::MATRIX_TEXELS),
                ("MATRICES_PER_TEXTURE_ROW", sizes::MATRICES_PER_TEXTURE_ROW),
                ("INDICES_PER_TEXTURE_ROW", sizes::INDICES_PER_TEXTURE_ROW),
                ("LIGHT_RECORD_BYTES", sizes::LIGHT_RECORD_BYTES),
                ("LIGHTS_PER_TEXTURE_ROW", sizes::LIGHTS_PER_TEXTURE_ROW),
                ("DRAW_RECORD_BYTES", sizes::DRAW_RECORD_BYTES),
                ("MULTI_DRAW_RECORDS", sizes::MULTI_DRAW_RECORDS),
                ("MAX_MATERIALS", sizes::MAX_MATERIALS),
                ("MATERIAL_BYTES", sizes::MATERIAL_BYTES),
                ("MAP_SLOTS", sizes::MAP_SLOTS),
                ("MAX_CELLS", sizes::MAX_CELLS),
                ("CELL_SHIFT", sizes::CELL_SHIFT),
                ("MAX_CULL_RANGES", sizes::MAX_CULL_RANGES),
                ("CULL_OCCLUSION_BYTES", sizes::CULL_OCCLUSION_BYTES),
                ("LINE_VERTEX_BYTES", sizes::LINE_VERTEX_BYTES),
                ("SHADOW_UNIFORM_BYTES", sizes::SHADOW_UNIFORM_BYTES),
                (
                    "SHADOW_TILES_UNIFORM_BYTES",
                    sizes::SHADOW_TILES_UNIFORM_BYTES,
                ),
            ],
        ),
    ];
    for &(prefix, entries) in groups {
        for (name, value) in entries {
            out.push_str(&format!("export const {prefix}_{name} = {value};\n"));
        }
        out.push('\n');
    }
    let by_code = |value: fn(u32) -> u32| -> String {
        (0..format::CODES)
            .map(|code| value(code).to_string())
            .collect::<Vec<_>>()
            .join(", ")
    };
    out.push_str(&format!(
        "/** Bytes of one block of texels of each format, by format code: one texel unless compressed. */\nexport const FORMAT_BLOCK_BYTES: readonly number[] = [{}];\n",
        by_code(format::block_bytes)
    ));
    out.push_str(&format!(
        "/** Texels on each side of a block of each format, by format code. */\nexport const FORMAT_BLOCK_SIZE: readonly number[] = [{}];\n",
        by_code(format::block_size)
    ));
    let attributes: Vec<String> = vertex::ATTRIBUTES
        .iter()
        .map(|a| {
            let types: Vec<String> = a.types.iter().map(|&t| (t as u32).to_string()).collect();
            format!(
                "[{}, {}, {}, [{}], {}]",
                a.bit,
                a.components,
                a.shift,
                types.join(", "),
                a.integer
            )
        })
        .collect();
    let types: Vec<String> = vertex::Type::ALL
        .iter()
        .map(|t| format!("[{}, {}, {}]", t.bytes(), t.max(), t.normalized()))
        .collect();
    out.push_str(&format!(
        "/** Each vertex attribute type by code: its bytes per value, its largest value (1 for floats), and whether it reads as fractions. */\nexport const VERTEX_TYPES: readonly (readonly [bytes: number, max: number, normalized: boolean])[] = [{}];\n",
        types.join(", ")
    ));
    out.push_str(&format!(
        "/** Each vertex attribute in vertex order, which is also its shader location: its format bit (0 for one every format has), its values per vertex, the first bit of its type field, its types by the field's value, and whether shaders read whole numbers. */\nexport const VERTEX_ATTRIBUTES: readonly (readonly [bit: number, components: number, shift: number, types: readonly number[], integer: boolean])[] = [{}];\n",
        attributes.join(", ")
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::caps::Capabilities;

    #[test]
    fn the_culling_shader_declares_the_same_sizes() {
        let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
        let workgroup = format!("@workgroup_size({})", sizes::CULL_WORKGROUP_SIZE);
        assert!(cull.contains(&workgroup), "cull.wgsl lacks {workgroup}");
        for line in [
            format!("const INDIRECT_WORDS: u32 = {}u;", sizes::INDIRECT_WORDS),
            format!("const CELL_SHIFT: u32 = {}u;", sizes::CELL_SHIFT),
            format!("const MAX_CELLS: u32 = {}u;", sizes::MAX_CELLS),
            format!("const MAX_RANGES: u32 = {}u;", sizes::MAX_CULL_RANGES),
            format!(
                "const WORKGROUP_SIZE: u32 = {}u;",
                sizes::CULL_WORKGROUP_SIZE
            ),
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
            // The last of a material row's texels on WebGL2, one per vec4f.
            format!(
                "textureLoad(materials, vec2u({}u, id), 0)",
                sizes::MATERIAL_BYTES / 16 - 1
            ),
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
            (
                "sprite",
                include_str!("../../null3d-shaders/wgsl/sprite.wgsl"),
            ),
            ("line", include_str!("../../null3d-shaders/wgsl/line.wgsl")),
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
        for (name, source) in &templates[2..5] {
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
        use vertex::ATTRIBUTES;
        assert_eq!(vertex::stride(0), 24);
        assert_eq!(vertex::stride(vertex::ALL), 100);
        assert_eq!(vertex::offset(vertex::UV0, 2), Some(24));
        assert_eq!(vertex::offset(vertex::UV1, 3), Some(24));
        assert_eq!(vertex::offset(vertex::UV0 | vertex::TANGENT, 4), Some(32));
        assert_eq!(vertex::offset(vertex::ALL, 5), Some(56));
        assert_eq!(vertex::offset(vertex::UV1, 2), None);
        assert_eq!(vertex::offset(0, 0), Some(0));
        assert_eq!(vertex::offset(0, 1), Some(12));
        // Every combination of the optional attributes' bits.
        let optional: Vec<u32> = ATTRIBUTES
            .iter()
            .map(|a| a.bit)
            .filter(|&b| b != 0)
            .collect();
        for combination in 0..1u32 << optional.len() {
            let bits = (0..optional.len())
                .filter(|k| combination & (1 << k) != 0)
                .fold(0, |bits, k| bits | optional[k]);
            // Each attribute of a format of floats starts where the ones before it end, and the
            // last ends at the stride.
            let mut end = 0;
            for (k, attribute) in ATTRIBUTES.iter().enumerate() {
                if bits & attribute.bit == attribute.bit {
                    assert_eq!(vertex::offset(bits, k), Some(end));
                    assert_eq!(vertex::type_of(bits, k), Some(attribute.types[0]));
                    end += attribute.size(attribute.types[0]);
                } else {
                    assert_eq!(vertex::offset(bits, k), None);
                }
            }
            assert_eq!(vertex::stride(bits), end, "format {bits}");
            assert!(vertex::valid(bits));
        }
        // Every attribute has its own location, its place in the table, below the instance
        // attributes' first one, and its own type field above the attribute bits.
        let mut fields = vertex::ALL;
        for (k, attribute) in ATTRIBUTES.iter().enumerate() {
            assert_eq!(attribute.location as usize, k);
            assert!(attribute.location < vertex::INSTANCE_LOCATION);
            assert_eq!(fields & attribute.mask(), 0, "location {k} shares bits");
            fields |= attribute.mask();
            assert!(attribute.types.len() <= 1 << attribute.width());
        }
        assert_eq!(fields, vertex::BITS);
        // WebGPU's default maxVertexAttributes: the instance attributes' four locations fit.
        const { assert!(vertex::INSTANCE_LOCATION + 4 <= 16) };
    }

    #[test]
    fn vertex_types_keep_whole_words_and_their_place_in_the_format() {
        use vertex::{ATTRIBUTES, Type, with};
        // 16-bit positions take two words, as glTF pads them; 8-bit normals and 16-bit texture
        // coordinates one each.
        let quantized = [(0, Type::Uint16), (1, Type::Snorm8), (2, Type::Unorm16)]
            .iter()
            .fold(0, |format, &(k, ty)| with(format, k, ty).unwrap());
        assert_eq!(vertex::stride(quantized), 8 + 4 + 4);
        assert_eq!(vertex::offset(quantized, 1), Some(8));
        assert_eq!(vertex::offset(quantized, 2), Some(12));
        assert_eq!(vertex::type_of(quantized, 0), Some(Type::Uint16));
        assert_eq!(vertex::type_of(quantized, 1), Some(Type::Snorm8));
        assert!(vertex::valid(quantized));
        // A skinned vertex of floats with 8-bit joints and weights.
        let skinned = with(with(0, 6, Type::Uint8).unwrap(), 7, Type::Unorm8).unwrap();
        assert_eq!(skinned & vertex::ALL, vertex::JOINTS | vertex::WEIGHTS);
        assert_eq!(vertex::stride(skinned), 24 + 4 + 4);
        assert_eq!(vertex::offset(skinned, 7), Some(28));
        // Each attribute takes only its own types, and every type takes whole words.
        assert_eq!(with(0, 1, Type::Uint8), None);
        assert_eq!(with(0, 6, Type::F32), None);
        assert_eq!(with(0, 5, Type::Snorm8), None);
        for (k, attribute) in ATTRIBUTES.iter().enumerate() {
            for &ty in attribute.types {
                let format = with(0, k, ty).unwrap();
                assert!(vertex::valid(format));
                assert_eq!(vertex::type_of(format, k), Some(ty));
                assert_eq!(attribute.size(ty) % 4, 0);
                assert!(attribute.size(ty) >= attribute.components * ty.bytes());
            }
        }
        // A field that names no type, unknown bits, and a field of a missing attribute.
        let bad_normal = 3 << ATTRIBUTES[1].shift;
        assert!(!vertex::valid(bad_normal));
        assert_eq!(vertex::type_of(bad_normal, 1), None);
        assert!(!vertex::valid(1 << 31));
        assert!(!vertex::valid(1 << ATTRIBUTES[2].shift));
    }

    #[test]
    fn vertex_types_decode_as_shaders_read_them() {
        use vertex::Type;
        assert_eq!(Type::F32.decode(&1.5f32.to_le_bytes()), 1.5);
        assert_eq!(Type::Unorm8.decode(&[255]), 1.0);
        assert_eq!(Type::Uint8.decode(&[255]), 255.0);
        assert_eq!(Type::Snorm8.decode(&[0x81]), -1.0);
        // glTF clamps the most negative normalized value at -1.
        assert_eq!(Type::Snorm8.decode(&[0x80]), -1.0);
        assert_eq!(Type::Sint8.decode(&[0x80]), -128.0);
        assert_eq!(Type::Unorm16.decode(&u16::MAX.to_le_bytes()), 1.0);
        assert_eq!(Type::Uint16.decode(&1000u16.to_le_bytes()), 1000.0);
        assert_eq!(
            Type::Snorm16.decode(&(-16384i16).to_le_bytes()),
            -16384.0 / 32767.0
        );
        assert_eq!(Type::Sint16.decode(&(-300i16).to_le_bytes()), -300.0);
        for (code, ty) in Type::ALL.iter().enumerate() {
            assert_eq!(*ty as usize, code);
        }
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
    fn a_list_grows_as_commands_need_and_keeps_what_it_has() {
        let mut list = DrawList::with_capacity(1);
        for k in 0..100 {
            list.push(Op::Dispatch, &[k, 1, 1]).unwrap();
        }
        assert_eq!(list.len(), 400);
        let dispatched: Vec<u32> = decode(list.words())
            .map(|c| c.unwrap().operands[0])
            .collect();
        assert_eq!(dispatched, (0..100).collect::<Vec<_>>());
    }

    #[test]
    fn a_list_at_its_limit_refuses_commands_and_keeps_what_it_has() {
        let mut list = DrawList::with_limit(1, 4);
        list.push(Op::SetPipeline, &[1]).unwrap();
        assert_eq!(
            list.push(Op::Dispatch, &[1, 1, 1]),
            Err(DrawListError::Full { limit: 4 })
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
    fn every_format_code_is_unique_and_has_a_block_size() {
        for (k, &code) in format::ALL.iter().enumerate() {
            assert!(
                !format::ALL[k + 1..].contains(&code),
                "format {code} is listed twice"
            );
            assert!(code < format::CODES);
            assert!(format::is_known(code));
            assert!(matches!(format::block_size(code), 1 | 4));
        }
        assert!(!format::is_known(format::CODES));
        assert_eq!(format::texel_bytes(format::RGBA8_UNORM_SRGB), 4);
        assert_eq!(format::texel_bytes(format::RG11B10_UFLOAT), 4);
        assert_eq!(format::texel_bytes(format::RGBA32_FLOAT), 16);
        assert_eq!(format::texel_bytes(format::DEPTH24_PLUS), 0);
        assert_eq!(format::texel_bytes(99), 0);
        assert!(format::is_depth(format::DEPTH32_FLOAT));
        assert!(format::is_depth(format::DEPTH16_UNORM));
        assert_eq!(format::texel_bytes(format::DEPTH16_UNORM), 2);
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
    fn compressed_levels_hold_whole_blocks() {
        let astc = format::ASTC_4X4_UNORM_SRGB;
        let etc2 = format::ETC2_RGB8_UNORM;
        assert!(format::is_compressed(astc));
        assert!(!format::is_compressed(format::RGBA8_UNORM));
        assert_eq!(
            format::texel_bytes(astc),
            0,
            "a compressed texel has no bytes of its own"
        );
        // 64 x 32 texels are 16 x 8 blocks, and a level of 2 x 1 texels takes a whole block.
        assert_eq!(format::level_bytes(astc, 64, 32, 0), 16 * 8 * 16);
        assert_eq!(format::level_bytes(astc, 64, 32, 5), 16);
        assert_eq!(format::level_bytes(etc2, 64, 32, 0), 16 * 8 * 8);
        // Levels of 20 x 12, 10 x 6 and 5 x 3 texels: 5 x 3, 3 x 2 and 2 x 1 blocks.
        assert_eq!(format::layer_bytes(etc2, 20, 12, 3), (15 + 6 + 2) * 8);
        assert_eq!(format::row_bytes(etc2, 20, 1), 3 * 8);
        assert_eq!(format::blocks(etc2, 12, 2), 1);
        assert_eq!(
            format::capability(format::BC7_RGBA_UNORM_SRGB),
            Capabilities::TEXTURE_BC
        );
        // BC6H holds high dynamic range color in the same blocks of 16 bytes as BC7.
        let bc6h = format::BC6H_RGB_UFLOAT;
        assert!(format::is_compressed(bc6h));
        assert_eq!(format::level_bytes(bc6h, 64, 32, 0), 16 * 8 * 16);
        assert_eq!(format::capability(bc6h), Capabilities::TEXTURE_BC);
        assert!(format::writes_only(bc6h));
        assert!(format::writes_only(format::RGB9E5_UFLOAT));
        assert!(!format::writes_only(format::RGBA16_FLOAT));
        assert_eq!(
            format::capability(format::RGBA8_UNORM),
            Capabilities::empty()
        );
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

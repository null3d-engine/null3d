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
    /// level before it, with a linear filter in linear color. The texture is a 2D array of a format
    /// that [`format::draws_mipmaps`] takes, with `TEXTURE_BINDING` and `RENDER_ATTACHMENT` usage.
    /// Both backends draw each level with the mip shader, which samples the level before it.
    /// WebGL2's `generateMipmap` would remake every layer of an array. A frame may make a render
    /// target's levels in every frame, so the backends keep what each texture's levels need.
    GenerateMipmaps = 15,
    /// [color target texture id or 0 for the canvas or `NO_TARGET`, resolve target texture id or
    /// 0 for the canvas or `NO_TARGET`, depth texture id or `NO_TARGET`, clear red, green, blue,
    /// alpha (f32), clear depth (f32), pass flags, then optionally a second color target texture
    /// id]. A target is a texture of one layer and one mip level, or a view of one. A pass without
    /// a color target draws depth only. A second color target has one sample, no resolve, and the
    /// first target's clear color and flags; its pipelines are those with `permutation::WEIGHTED`.
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
    /// [texture location (5 words), buffer id, buffer offset, bytes per row, rows per image, width,
    /// height]: copies a box of texels of a texture with `COPY_SRC` usage into a buffer with
    /// `COPY_DST` usage, which `ReadBuffer` then reads back. GPU picking copies its small id target
    /// through this. The texture is `RGBA8_UNORM` or `RGBA32_UINT`, whose texels both paths copy
    /// as the same bytes. The buffer offset and the bytes per row are multiples of 256, as WebGPU
    /// requires, the bytes per row hold the box's width, and the rows per image are at least its
    /// height. Row `r` of the box lands at the offset plus `r` times the bytes per row. The box's x
    /// and y address texels as stored, as the other copies do. So in a texture that a render pass
    /// drew, WebGL2's first stored row is the image's bottom row, and a reader of such a target
    /// flips y and the order of the rows on that path, as a shader that samples it flips its
    /// texture coordinates. The buffer must not be waiting for a read (`ReadBuffer`).
    CopyTextureToBuffer = 50,
    /// [image id]: closes an image that the backend holds, once no later command uploads it. A
    /// backend that holds no such image does nothing, as when a capture replays a list again.
    ReleaseImage = 51,
    /// [pipeline id]: releases a render pipeline that no later command uses, such as the pipelines
    /// of a custom material whose last material was destroyed. A backend that holds no such
    /// pipeline does nothing, as when a capture replays a list again.
    DestroyPipeline = 52,
    /// [buffer id, offset, size, destination address in engine memory, control slot]: once the GPU
    /// has run the commands before this one, maps `size` bytes of the buffer at `offset`, copies
    /// them into engine memory at `destination`, then adds one to the control slot, by its index in
    /// the control block. The buffer has `MAP_READ` usage, and no other usage than `COPY_DST`. The
    /// offset is a multiple of 8, and the size a multiple of 4 that is not 0, as WebGPU's map
    /// requires. Outside passes and bundles. The command is asynchronous: the bytes land, and the
    /// slot rises, one or more frames after the command replays. Until the slot rises, the buffer
    /// is waiting: no command writes it, copies into or out of it, or reads it again, because
    /// WebGPU is mapping it and WebGL2 has yet to collect its bytes. So code that reads in every
    /// frame keeps a ring of buffers, one for each read in flight. Destroying a waiting buffer
    /// drops its read, whose slot never rises. A list that replays again while its read waits,
    /// as a capture's does, finds the buffer waiting: both backends then skip the copy into it
    /// and the read, and the first read still lands. GPU picking reads the ids under the pointer
    /// this way.
    ReadBuffer = 53,
    /// [texture id, image id]: runs the generator that the backend holds under the image id, which
    /// fills every mip level of every face of a cube texture on the GPU in one submit, ahead of the
    /// frame's passes. The thread that draws counts a generator among the images it received once
    /// its code has loaded and its pipelines are built, so the generator runs at once. The texture
    /// is a cube of `RGB9E5_UFLOAT` with `COPY_DST` usage. The backend keeps the entry until
    /// `ReleaseImage`, so a new GPU device can fill the texture again. A list that runs again, as
    /// a capture's does, fills the texture again with the same texels.
    GenerateTexture = 54,
    /// [texture id, image id, stage, the physical sky's panorama texture id or 0 for the analytic
    /// sky, then the analytic sky's settings as 16 floats: the sun's position and
    /// a spare, the turbidity, Rayleigh, Mie coefficient and Mie directional g, the cloud scale,
    /// speed, coverage and density, and the cloud elevation, the time and two spares]: runs one
    /// stage of a sky map on the cube texture that the generator under the image id filled. The
    /// backend's plan of the stages says what each one draws: the first ones draw the sky into
    /// the generator's own chain of levels, a face each; the next ones filter the map's levels for
    /// their roughness from the chain, a few faces each; the last copies the finished levels into
    /// the texture at once. Only stage 0 reads the settings, which hold for the whole refresh. A
    /// stage that names a panorama reads the panorama, a 2D texture of 16-bit floats, in place of
    /// the analytic sky's model, as the generator reads a panorama file.
    /// The stages before the copy write nothing that a frame reads, so a map can refresh over
    /// several frames while frames draw with the old one. Each stage reads only what earlier
    /// stages wrote, in this list or in an earlier one.
    ///
    /// A map of a scene with a sky layer draws the sky with the layer's own build of the generator's
    /// shader, which the words after the settings name: the template of that build, then the core
    /// sky's cloud coverage, density, elevation and scale that the layer obeys, the share of the sun
    /// that it hides, its opacity and its clock. The last stage names the buffer of the ring that
    /// the map's light capture lands in, and a `ReadBuffer` after it brings the nine coefficients of
    /// the map's diffuse light into engine memory.
    SkyMapStep = 55,
    /// [probes texture id, chain texture id, layer, image id, then the six faces' texture ids]:
    /// makes one reflection probe's map from what its six capture views drew (decision record
    /// D-149), in the frame's commands, ahead of its passes, with the code of the generator that
    /// the backend holds under the image id. The probes texture is a 2D array of `RGBA16_FLOAT`
    /// with mip levels down to 4 texels across, and the chain a 2D array of six layers of
    /// `RGBA16_FLOAT` with every mip level, both with `RENDER_ATTACHMENT` and `TEXTURE_BINDING`
    /// usage. Each face texture is a one-layer array that a capture view drew into, its first row
    /// at the view's bottom edge. The backend copies face `k` into layer `k` of the chain, in the
    /// cube map table that every GPU path shares, makes the chain's levels, then fills each level
    /// of the probe's layer with the chain's light filtered for the level's roughness, as an
    /// octahedral map. Level `i` of `n` holds perceptual roughness `1 - sqrt(1 - i / (n - 1))`,
    /// as an environment map's levels do.
    ProbeFilter = 56,
    /// []: submits everything recorded since the previous submit.
    Submit = 63,
}

impl Op {
    pub const ALL: [Op; 44] = [
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
        Op::CopyTextureToBuffer,
        Op::ReleaseImage,
        Op::DestroyPipeline,
        Op::ReadBuffer,
        Op::GenerateTexture,
        Op::SkyMapStep,
        Op::ProbeFilter,
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
            Op::CopyTextureToBuffer => "COPY_TEXTURE_TO_BUFFER",
            Op::ReleaseImage => "RELEASE_IMAGE",
            Op::DestroyPipeline => "DESTROY_PIPELINE",
            Op::ReadBuffer => "READ_BUFFER",
            Op::GenerateTexture => "GENERATE_TEXTURE",
            Op::SkyMapStep => "SKY_MAP_STEP",
            Op::ProbeFilter => "PROBE_FILTER",
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

    pub const ALL: [u8; 1] = [DISPATCH_INDIRECT];
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
    /// Four 32-bit unsigned integers per texel: data of several kinds in one data texture, such as
    /// WebGL2's light grid and light records, which shaders read as integers or turn into floats.
    pub const RGBA32_UINT: u32 = 23;
    /// Two 16-bit floats per texel: the screen motion of each pixel's surface, which the motion
    /// pass draws. Multisampled, it needs `Capabilities::MSAA_FLOAT16`, as `RGBA16_FLOAT` does.
    /// WebGL2 calls it `RG16F`, and draws into it with `EXT_color_buffer_float`.
    pub const RG16_FLOAT: u32 = 24;
    /// One 16-bit float per texel, which draws and blends: the coverage of weighted blended
    /// transparency. WebGL2 calls it `R16F`, and draws into it with `EXT_color_buffer_float` or
    /// `EXT_color_buffer_half_float`.
    pub const R16_FLOAT: u32 = 25;

    /// Every format.
    pub const ALL: [u32; 26] = [
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
        RGBA32_UINT,
        RG16_FLOAT,
        R16_FLOAT,
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

    /// True for the color formats that a render pipeline can draw into with alpha to coverage:
    /// those with an alpha channel, as WebGPU requires.
    pub const fn covers_by_alpha(format: u32) -> bool {
        matches!(
            format,
            CANVAS | RGBA8_UNORM | BGRA8_UNORM | RGBA16_FLOAT | RGBA8_UNORM_SRGB
        )
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
            | RG11B10_UFLOAT | RGB9E5_UFLOAT | R32_FLOAT | RG16_FLOAT => 4,
            DEPTH16_UNORM | R16_FLOAT => 2,
            RGBA16_FLOAT | ETC2_RGB8_UNORM | ETC2_RGB8_UNORM_SRGB => 8,
            RGBA32_FLOAT
            | RGBA32_UINT
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

    /// True for the formats of images whose mip levels the engine makes with `GenerateMipmaps`:
    /// 8-bit color, which every device can filter and draw into.
    pub const fn makes_mipmaps(format: u32) -> bool {
        matches!(format, RGBA8_UNORM | RGBA8_UNORM_SRGB)
    }

    /// True for the formats whose mip levels `GenerateMipmaps` takes: those of
    /// [`makes_mipmaps`], and the HDR formats of the render graph's targets, which a device
    /// filters and draws into wherever it draws the scene in them.
    pub const fn draws_mipmaps(format: u32) -> bool {
        makes_mipmaps(format) || matches!(format, RGBA16_FLOAT | RG11B10_UFLOAT)
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
    /// depth pyramid or a placeholder, the cell offsets texture and the skin firsts texture.
    pub const CULL: u32 = 1;
    /// Group 0 of an add-on's compute pipeline: its block of uniforms, then the storage texture
    /// that it fills, as 16-bit floats. The storage texture's format is part of the layout, so a
    /// pass of another format takes the layout of that format.
    pub const COMPUTE_RGBA16_FLOAT: u32 = 53;
    /// [`COMPUTE_RGBA16_FLOAT`] for a target of 32-bit floats.
    pub const COMPUTE_R32_FLOAT: u32 = 54;
    /// [`COMPUTE_RGBA16_FLOAT`] for a target of 8-bit color.
    pub const COMPUTE_RGBA8_UNORM: u32 = 55;
    /// Group 0 of an add-on's compute pipeline that writes the two buffers of an instance draw: its
    /// block of uniforms, then the draw's count word and its per-instance rows, which the shader
    /// reads and writes as storage. A pass of this layout has no storage texture.
    pub const COMPUTE_INSTANCE_BUFFERS: u32 = 56;
    /// Group 0 of the compute pipeline that converts a feature-instance draw's world rows to the
    /// camera-relative rows that the engine's vertex shaders read: its block of uniforms, which
    /// holds the camera's world position, then the draw's count word, its world rows and the rows
    /// that it writes.
    pub const FEATURE_ROWS: u32 = 60;
    /// Group 0 of the cluster levels' compute pipeline: the dispatch's parameters at a dynamic
    /// offset, then the scene's patches and mesh records, its tree indices, the view's compacted
    /// instances, and the view's counts, offsets, index list and indirect draws.
    pub const CLUSTER_CULL: u32 = 52;
    /// Group 1 of render pipelines that read instances from data textures: the draw records.
    pub const DRAWS: u32 = 2;
    /// Group 2 of render pipelines that read instances from data textures: the textures.
    pub const INSTANCES: u32 = 3;
    /// Group 0 of the final pass: its settings and the scene color it reads, then at bindings 9
    /// and 10 the color grading table, a 3D texture, and its linear sampler, at binding 11 the
    /// outline effect's mask, which the table's sampler reads, and at binding 12 the texel of the
    /// automatic exposure, which it reads as plain floats. Every build of the final pass has
    /// binding 12.
    pub const FINAL: u32 = 4;
    /// The maps of render pipelines that sample them: a 2D array texture, then its sampler. It is
    /// group 1 on WebGPU, and group 3 on WebGL2, after the groups of the data textures.
    pub const TEXTURES: u32 = 5;
    /// The maps of the standard material, in the order of a material's map slots: a 2D array
    /// texture at each binding from 0, then each one's sampler at the bindings after every
    /// texture. It sits where [`TEXTURES`] sits.
    pub const MATERIAL_MAPS: u32 = 6;
    /// [`MATERIAL_MAPS`] with the displacement map visible to the fragment stage too, for the
    /// builds of parallax occlusion mapping. The fragment stage then reads every sampled texture
    /// that WebGPU's default limits give it, so only materials with parallax take it.
    pub const MATERIAL_MAPS_PARALLAX: u32 = 34;
    /// [`MATERIAL_MAPS`] for a custom material that reads the scene's depth: the first seven map
    /// slots, their samplers at the bindings after every slot, and no displacement map, which only
    /// a standard material reads. The last slot's two bindings are left out, so the depth copy that
    /// the material's own group carries keeps the fragment stage within WebGPU's default count of
    /// sampled textures. Only WebGPU has it: WebGL2 gives a program a unit only for a texture that
    /// it reads.
    pub const MATERIAL_MAPS_SCENE: u32 = 61;
    /// [`FRAME`] for the builds of parallax occlusion mapping: the same groups without the copy of
    /// the opaque color. A parallax material reads the displacement map in the fragment stage as
    /// well as the vertex stage, so its maps' group holds one more sampled texture than any other
    /// material's. The draw list never pairs [`permutation::PARALLAX`] with
    /// [`permutation::TRANSMISSION`], so those builds read no copy. Only WebGPU has this layout:
    /// the parallax passes bind it in place of [`FRAME`].
    pub const FRAME_PARALLAX: u32 = 48;
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
    /// uniform block at binding 2, the base level of bloom's chain at binding 3 and that level's
    /// linear sampler at binding 8, then [`FINAL`]'s color grading table and its sampler at
    /// bindings 9 and 10, its outline mask at binding 11, and the texel of the automatic exposure
    /// at binding 12.
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
    /// Group 0 of ambient occlusion's other steps: the steps' uniform block, then the three
    /// textures that the step reads with `textureLoad`. The third is the target of screen-space
    /// reflections' trace, which only the denoise reads, while they draw.
    pub const AO: u32 = 18;
    /// The background's group: its uniform block, then a cube texture and its filtering sampler.
    /// It is group 1 of the cube and sky backgrounds, and group 2 of the texture background,
    /// which reads only the uniform block.
    pub const BACKGROUND: u32 = 19;
    /// The group after a template's own groups in the WebGPU builds that read their instances by
    /// index ([`INSTANCE_INDEX`](super::permutation::INSTANCE_INDEX)): the view's culling
    /// parameters as a uniform block, for the offset from the camera to each cell, then the world
    /// matrices, the bucket table and the bucket records of the layout that the view draws, which
    /// vertex shaders read.
    pub const INSTANCE_INDEX: u32 = 20;
    /// Group 0 of a custom effect's pass: the effect's uniform block, or every effect's block for a
    /// group of joined effects, the color it reads, a linear sampler, and the scene's depth as
    /// unfilterable floats, or a blank texture where no effect reads depth.
    pub const EFFECT: u32 = 21;
    /// [`EFFECT`] with a multisampled scene depth, whose sample 0 the effect reads. Only WebGPU has
    /// it: WebGL2 reads a copy of one sample that the backend keeps.
    pub const EFFECT_DEPTH_MS: u32 = 22;
    /// [`EFFECT`] with a level of bloom's chain at binding 4, which the effect samples with its
    /// linear sampler. An effect that reads a level draws in a pass of its own.
    pub const EFFECT_BLOOM: u32 = 50;
    /// [`EFFECT_BLOOM`] with a multisampled scene depth, whose sample 0 the effect reads. Only
    /// WebGPU has it.
    pub const EFFECT_BLOOM_DEPTH_MS: u32 = 51;
    /// Group 1 of a sky layer's draw, an add-on's layer over the core sky: its uniform block alone.
    /// The core sky's cloud settings, the share of the sun that the layer hides and the layer's own
    /// opacity reach it, so a layer obeys the settings the core sky obeys. A layer's pipeline takes
    /// a template of the page's own, as a custom effect's does, because the page's WGSL completes
    /// the engine's sky-layer template.
    pub const BACKGROUND_LAYER: u32 = 59;
    /// Group 0 of temporal anti-aliasing's resolve: its uniform block, the scene color, the scene's
    /// depth, the motion target and the two histories at bindings 1 to 5, and the linear sampler
    /// of the histories at 6. The scene color, the depth and the motion read with `textureLoad`;
    /// the histories read with the sampler.
    pub const TAA: u32 = 57;
    /// [`TAA`] with a multisampled scene depth, whose samples the resolve reads. Only WebGPU has
    /// it.
    pub const TAA_MS: u32 = 58;
    /// The final pass with custom effects folded into it: [`FINAL`]'s bindings, then the effects'
    /// uniform buffer at binding 4 and the scene's depth, or a blank texture, at binding 5, as
    /// plain floats.
    pub const FINAL_EFFECTS: u32 = 23;
    /// [`FINAL_EFFECTS`] with a multisampled scene depth, whose sample 0 the effects read. Only
    /// WebGPU has it.
    pub const FINAL_EFFECTS_DEPTH_MS: u32 = 24;
    /// Group 0 of the copy of a view's image into its target: the image, which it reads with
    /// `textureLoad`, as plain floats.
    pub const VIEW_COPY: u32 = 25;
    /// Group 0 of the still-camera accumulation's blend: its values, then the scene color that it
    /// reads with `textureLoad`, as plain floats.
    pub const ACCUMULATE: u32 = 26;
    /// Group 0 of depth of field's composite step: [`EFFECT`]'s bindings, then at binding 4 the
    /// blurred image at half the render size, which the step reads with the linear sampler.
    pub const DOF_COMPOSITE: u32 = 27;
    /// [`DOF_COMPOSITE`] with a multisampled scene depth, whose sample 0 the step reads. Only
    /// WebGPU has it.
    pub const DOF_COMPOSITE_MS: u32 = 28;
    /// Group 0 of a level of screen-space reflections' depth pyramid: the level's uniform block,
    /// then the level below it, which the step reads with `textureLoad`.
    pub const SSR_REDUCE: u32 = 30;
    /// Group 0 of screen-space reflections' trace: its uniform block, then ambient occlusion's depth
    /// copy and the pyramid's six levels above it, which it reads with `textureLoad`.
    pub const SSR_TRACE: u32 = 31;
    /// The weighted layer's blend: the weighted color sum and the coverage, both read with
    /// `textureLoad` as unfilterable floats. The copy of the camera's opaque color for
    /// transmission binds its scene color and depth the same way.
    pub const WEIGHTED_COMPOSITE: u32 = 41;
    /// The copy of a multisampled scene depth for the weighted layer: the depth, read with
    /// `textureLoad` as multisampled unfilterable floats. Only WebGPU has it.
    pub const WEIGHTED_DEPTH_MS: u32 = 42;
    /// [`WEIGHTED_COMPOSITE`] for the copy of the camera's opaque color from a multisampled scene
    /// depth, whose sample 0 it reads. Only WebGPU has it.
    pub const TRANSMISSION_COPY_MS: u32 = 49;
    /// Group 0 of the subsurface blur's across step: its block at binding 0 and the skin pass's
    /// target at binding 1, which it reads with `textureLoad` as plain floats.
    pub const SUBSURFACE_BLUR: u32 = 43;
    /// Group 0 of the subsurface blur's down step: [`SUBSURFACE_BLUR`]'s bindings, then the across
    /// step's target, the scene color and the scene's depth at bindings 2 to 4, each read with
    /// `textureLoad` as plain floats.
    pub const SUBSURFACE_COMPOSITE: u32 = 44;
    /// [`SUBSURFACE_COMPOSITE`] with a multisampled scene depth, whose sample 0 the step reads.
    /// Only WebGPU has it.
    pub const SUBSURFACE_COMPOSITE_MS: u32 = 45;
    /// The group of the decal pass's scene depth: the depth target, which the decal templates read
    /// with `textureLoad` as plain floats. It is group 1 of [`super::template::DECAL`] and group 2
    /// of [`super::template::DECAL_MAPS`] on WebGPU, and group 4 on WebGL2, which reads a copy of
    /// one sample of a multisampled depth.
    pub const DECAL_DEPTH: u32 = 36;
    /// [`DECAL_DEPTH`] for a multisampled depth target, whose sample 0 the decals read. Only WebGPU
    /// has it.
    pub const DECAL_DEPTH_MS: u32 = 37;
    /// The group of a custom material that reads the scene's depth: the copy of the camera's
    /// opaque depth, which its surface function reads with `textureLoad` as plain floats. It is
    /// group 1 of the custom material's template and group 2 of one with textures on WebGPU, and
    /// group 4 on WebGL2. A view that makes no copy binds one texel at the far plane.
    pub const MATERIAL_SCENE: u32 = 38;
    /// Group 0 of the decal templates on WebGPU: [`FRAME`]'s bindings without the light probe
    /// grids' texture and the copy of the opaque color, which no decal build reads. A decal with
    /// maps then reads 15 sampled textures in its fragment stage, within WebGPU's default limit of
    /// 16. WebGL2 binds the frame group, as its programs take a texture unit only for a texture
    /// that they read.
    pub const DECAL_FRAME: u32 = 46;
    /// Group 1 of the particle templates: a particle system's values as a uniform block, then the
    /// block of the view that draws, at a dynamic offset.
    pub const PARTICLE: u32 = 32;
    /// Group 2 of the particle templates: the view's copy of its opaque depth, which soft particles
    /// read with `textureLoad` as unfilterable floats, or one texel at the far plane.
    pub const PARTICLE_SCENE_DEPTH: u32 = 33;
    /// The copy of the camera's opaque depth for soft particles from a multisampled depth, whose
    /// first sample it reads with `textureLoad`. Only WebGPU has it: the one-sample copy binds as
    /// [`VIEW_COPY`] does.
    pub const PARTICLE_DEPTH_MS: u32 = 35;
    /// Group 0 of the motion pass's pipelines: [`DEPTH`]'s bindings, then the motion block at
    /// binding 4 and the last frame's joint texture at 5. On WebGL2 the texture at 5 also holds
    /// the last frame's morph weights after its joints, and the group holds the last frame's
    /// matrix rows at 7 and 9, resident and streamed.
    pub const MOTION_FRAME: u32 = 47;
    /// The physical sky's group: at binding 0 its uniform block, at bindings 1, 2 and 3 its
    /// transmittance, multiple scattering and sky view tables, at binding 4 a linear sampler that
    /// clamps, and at binding 5 one that repeats across the width. Group 0 of its tables' steps,
    /// group 1 of its background.
    pub const ATMOSPHERE: u32 = 39;
    /// Group 0 of the exposure meter's compute steps: the meter's uniform block, the color it
    /// meters, a linear sampler, the histogram and the state as storage buffers, then the texel of
    /// the exposure as a storage texture of `RGBA32_FLOAT`, which the final pass reads. Only WebGPU
    /// has it.
    pub const EXPOSURE: u32 = 40;
    /// Group 0 of the light clusters' depth reduction: its blocks' uniform block, the light grid
    /// that it writes, and the view's depth target of one sample, which it reads as a float
    /// texture. Only WebGPU has it.
    pub const LIGHT_DEPTH: u32 = 62;
    /// [`LIGHT_DEPTH`] for a multisampled depth target, whose sample 0 it reads. Only WebGPU has
    /// it.
    pub const LIGHT_DEPTH_MS: u32 = 63;
}

/// Bits of a render pipeline's permutation word, which pick a shader variant. A feature that
/// changes what a shader costs is a bit, so a pipeline without the feature does not pay for it. A
/// cheap option is a uniform value instead. A shader reads each bit as the shader def of the bit's
/// name in [`NAMES`], and the shader manifest lists the bits that each shader is built with. A bit
/// that no shader reads yet is reserved for the feature it names. Two features share a value only
/// when no template lists both, as [`SHARED`] records (decision record D-156).
pub mod permutation {
    /// The vertex shader reads its draw's index, from `WEBGL_multi_draw`.
    pub const DRAW_INDEX: u32 = 1;
    /// The fragment shader applies the exposure and the tone mapping and encodes sRGB itself, for
    /// an 8-bit target that resolves straight into the canvas. Without it, the shader writes
    /// linear color for the final pass.
    pub const TONE_MAP: u32 = 2;
    /// The mesh's vertex colors multiply the material's base color.
    pub const VERTEX_COLOR: u32 = 4;
    /// The standard material's bump map bends the normal by the change of a height map's red
    /// channel from one pixel to the next, as three.js's `bumpMap` does. The height map sits in the
    /// normal map's slot.
    pub const BUMP: u32 = 8;
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
    /// The surface takes the light of the rectangle and tube lights in its cluster. Without it, the
    /// light loop has no code for them, so scenes without area lights do not pay for it. It shares
    /// [`FXAA`]'s value: only the lit templates list it, and only the final pass lists FXAA.
    pub const AREA_LIGHTS: u32 = FXAA;
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
    /// The final pass's build that scales the drawn corner up to the canvas and sharpens it, which
    /// the second step of the two-step pass draws. The other builds read the one texel under each
    /// pixel and hold none of that code: a software GPU pays for code in every frame, even in a
    /// loop of no rounds. It shares [`CASTER_OFFSET`]'s value: only the final pass lists it, and
    /// only the shadow casters' and the depth templates list the caster offset.
    pub const UPSCALE: u32 = CASTER_OFFSET;
    /// The final pass adds bloom's levels to the scene color before the output transform.
    pub const BLOOM: u32 = 32768;
    /// A custom material's template draws an object into GPU picking's id target: the vertex
    /// shader moves each vertex by the material's vertex offset and places it as the shading
    /// builds do, and the fragment shader writes the instance's ids, as the pick template does.
    /// Only custom materials with a vertex offset build it. It shares [`BLOOM`]'s value: only the
    /// final pass lists BLOOM, and only custom materials' builds of the lit template list PICK.
    pub const PICK: u32 = BLOOM;
    /// The outline mask template marks the parts of outlined objects that nothing hides. Without
    /// it, the template marks every part, hidden or not.
    pub const OUTLINE_VISIBLE: u32 = 65536;
    /// On WebGPU, the vertex shader reads its instance by index: an instance-rate vertex attribute
    /// names the source, and the shader reads the source's world matrix, its bucket's material and
    /// its cell's offset from storage buffers, instead of a copy that the culling shader writes.
    /// Only the test switch for index-only instance data asks for it (decision record D-23).
    pub const INSTANCE_INDEX: u32 = 131072;
    /// A custom effect reads the scene's depth from a multisampled target, at sample 0.
    pub const DEPTH_MULTISAMPLED: u32 = 262144;

    /// The builds of a level of detail that hands over to the next in a fading band: each instance
    /// carries a fade value, and the fragment shader keeps the pixels that a 4 × 4 ordered dither
    /// gives its side of the band. Only the fade buckets of meshes with levels draw with it, so
    /// the other buckets keep the GPU's early depth test.
    pub const LOD_FADE: u32 = 1 << 19;
    /// The fragment shader of a masked surface writes its coverage of the pixel's samples itself,
    /// through `sample_mask`, from the faded alpha of [`ALPHA_COVERAGE`]. WebGPU builds only, for
    /// multisampled targets whose format has no alpha, where the pipeline cannot turn alpha to
    /// coverage on.
    pub const SAMPLE_MASK: u32 = 1 << 20;
    /// A masked surface fades its alpha from nothing at the cutoff to full over about a pixel, and
    /// writes the faded alpha, which alpha to coverage turns into the share of the pixel's samples
    /// that it covers.
    pub const ALPHA_COVERAGE: u32 = 1 << 21;
    /// A masked surface keeps each fragment whose alpha passes a threshold from a hash of its place
    /// on the mesh, instead of the cutoff.
    pub const ALPHA_HASH: u32 = 1 << 22;
    /// The surface lets light through: it samples the copy of the opaque objects' color behind it,
    /// bent by its index of refraction and blurred by its roughness, as three.js's transmission.
    pub const TRANSMISSION: u32 = 1 << 23;
    /// The rows of an instance batch bring a color and values of their own. The vertex shader reads
    /// them from the row values texture: the color multiplies the base color as a vertex color
    /// does, and custom materials read the values as `object.values`.
    pub const ROW_VALUES: u32 = 1 << 24;
    /// A custom material's template draws a shadow caster's depth: the vertex shader moves each
    /// vertex by the material's vertex offset, then places it as the depth template places a
    /// caster's, and the pipeline has no fragment stage. Only custom materials with a vertex
    /// offset build it, beside [`CASTER_OFFSET`] for casters that draw their back faces.
    pub const CASTER: u32 = 1 << 25;
    /// The standard material's displacement map moves each vertex along its normal, as three.js's
    /// `displacementMap` does. The vertex shader samples it from its own binding of the maps group,
    /// with its values from the material's custom values.
    pub const DISPLACEMENT: u32 = 1 << 26;
    /// The fragment shader shifts where it reads the maps by parallax occlusion mapping: it steps
    /// along the view ray through the displacement map's relief, so finer relief than the vertices
    /// hides and shows the surface behind it. Its pipelines bind the maps group with the
    /// displacement map visible to the fragment stage too.
    pub const PARALLAX: u32 = 1 << 27;
    /// The surface lets light through to its other side, as glTF's diffuse transmission does: the
    /// light that reaches its back shows on its front through the material's transmission color,
    /// as leaves, petals and ears show the sun behind them. The material's row holds its values in
    /// one more `vec4f`.
    pub const TRANSLUCENCY: u32 = 1 << 28;
    /// The build draws or culls for the motion pass. A custom material's template draws a moving
    /// object's motion: the vertex shader places each vertex in this frame and in the last, moved
    /// by the material's vertex offset at each frame's time, and the fragment shader writes the
    /// difference. Only custom materials with a vertex offset build it. The culling shader keeps
    /// the instances whose world matrix changed since the last frame, and writes both matrices.
    pub const MOTION: u32 = 1 << 29;

    /// The surface has a clear coat, a sheen or both above its base, as three.js's
    /// `MeshPhysicalMaterial` draws them: a second GGX lobe at the coat's normal and roughness,
    /// and the Charlie lobe of cloth. The material's row holds their values in two more `vec4f`s.
    pub const COAT_SHEEN: u32 = 1 << 30;
    /// The surface draws into the two targets of weighted blended transparency, in any order: the
    /// first, of the pipeline's color format, sums its premultiplied color and its alpha, each
    /// times a weight that falls with its distance. The second, of `format::R16_FLOAT`, sums
    /// `-log2(1 - alpha)`, so that two to the power of minus the sum is the share of the scene that
    /// shows through. Both targets blend by adding (decision record D-150).
    pub const WEIGHTED: u32 = 1 << 31;

    /// Every bit with its name: the shader def that turns its code on, in bit order.
    pub const NAMES: [(&str, u32); 35] = [
        ("DRAW_INDEX", DRAW_INDEX),
        ("TONE_MAP", TONE_MAP),
        ("VERTEX_COLOR", VERTEX_COLOR),
        ("BUMP", BUMP),
        ("ALPHA_MASK", ALPHA_MASK),
        ("RECEIVE_SHADOWS", RECEIVE_SHADOWS),
        ("SKIN", SKIN),
        ("MORPH", MORPH),
        ("FXAA", FXAA),
        ("AREA_LIGHTS", AREA_LIGHTS),
        ("VERTEX_TANGENT", VERTEX_TANGENT),
        ("DEBUG_VIEW_LOW", DEBUG_VIEW_LOW),
        ("DEBUG_VIEW_HIGH", DEBUG_VIEW_HIGH),
        ("PREPASS", PREPASS),
        ("HALF", HALF),
        ("CASTER_OFFSET", CASTER_OFFSET),
        ("UPSCALE", UPSCALE),
        ("BLOOM", BLOOM),
        ("PICK", PICK),
        ("OUTLINE_VISIBLE", OUTLINE_VISIBLE),
        ("INSTANCE_INDEX", INSTANCE_INDEX),
        ("DEPTH_MULTISAMPLED", DEPTH_MULTISAMPLED),
        ("LOD_FADE", LOD_FADE),
        ("SAMPLE_MASK", SAMPLE_MASK),
        ("ALPHA_COVERAGE", ALPHA_COVERAGE),
        ("ALPHA_HASH", ALPHA_HASH),
        ("TRANSMISSION", TRANSMISSION),
        ("ROW_VALUES", ROW_VALUES),
        ("CASTER", CASTER),
        ("DISPLACEMENT", DISPLACEMENT),
        ("PARALLAX", PARALLAX),
        ("TRANSLUCENCY", TRANSLUCENCY),
        ("MOTION", MOTION),
        ("COAT_SHEEN", COAT_SHEEN),
        ("WEIGHTED", WEIGHTED),
    ];

    /// Pairs of names that share one value, because no template lists both: the shader build
    /// refuses a template that lists two names of one value, and any other shared value.
    pub const SHARED: [(&str, &str); 3] = [
        ("FXAA", "AREA_LIGHTS"),
        ("CASTER_OFFSET", "UPSCALE"),
        ("BLOOM", "PICK"),
    ];

    /// The bits that a device fixes when the engine starts, the same in every pipeline it builds:
    /// the draw index where WebGL2 has multi-draw, tone mapping in the shader where the device
    /// draws scene color in 8 bits, and half precision where the device draws with it. The shader
    /// build writes the engine's variants into one module for each GPU path and each value of
    /// these bits, and a page loads only its own.
    pub const DEVICE: u32 = DRAW_INDEX | TONE_MAP | HALF;

    /// Bits that only make sense beside another bit, as (bit, the bit it needs). The shader build
    /// writes no build that has the first without the second, and no pipeline asks for one.
    pub const NEEDS: [(u32, u32); 4] = [
        (SAMPLE_MASK, ALPHA_COVERAGE),
        (ALPHA_COVERAGE, ALPHA_MASK),
        (ALPHA_HASH, ALPHA_MASK),
        (PARALLAX, DISPLACEMENT),
    ];
    /// Pairs of bits that no build holds together, so the shader build makes no build with both.
    /// A mask tests its alpha one way, by coverage or by the hash. A mesh that WebGPU skins in the
    /// vertex shader reads the culling shader's copies, so the builds that read their instances by
    /// index never skin: those builds would load with the skinning feature and double its WebGPU
    /// files. A surface that lets light through tests no mask, and draws in the transparent pass,
    /// which never reads instances by index. Row values come from instance batches, which neither
    /// skin nor morph, read their instances from the culling shader's copies, and test a mask
    /// against its cutoff; a surface that lets light through draws its rows without their values.
    /// A caster's build writes depth alone, so it has none of the bits that shade or tone map.
    /// Displacement and bump builds load on first use, so the test switch's builds do without them.
    /// A bump map takes the normal map's slot, so its builds never read the mesh's tangents.
    /// Parallax draws only opaque and masked surfaces, never one that lets light through. A
    /// displaced level of detail switches at once, so the fading builds stay small.
    /// Transmission wins over light through a thin surface, as glTF orders them, and only the test
    /// switch reads instances by index, which no build of such a surface needs. Layers win over
    /// light through a thin surface, whose maps would take their slots, and a weighted surface lets
    /// no light through a thin surface either, so neither doubles the builds of the other.
    /// A motion build writes motion alone: it has none of those bits either, and a skinned or
    /// morphed custom material draws its motion through the motion template, without its vertex
    /// offset.
    /// A fading level's builds dither its pixels after the mask's own test, by its cutoff or by
    /// coverage: skinned, morphed, transmissive and index-read instances never fade, and a mask
    /// that tests its alpha by the hash switches its levels at once. A motion build never fades.
    /// The layers shade, so casters never have them, and only the test switch reads instances by
    /// index, which no layered build needs. A weighted surface blends, so it tests no mask, lets
    /// no light through and never fades, and it draws in the sorted pass's rows, which never read
    /// instances by index. The final pass's upscale draws only in the two-step pass's second step,
    /// with neither FXAA nor bloom.
    pub const APART: [(u32, u32); 56] = [
        (ALPHA_HASH, ALPHA_COVERAGE),
        (SKIN, INSTANCE_INDEX),
        (TRANSMISSION, ALPHA_MASK),
        (TRANSMISSION, INSTANCE_INDEX),
        (ROW_VALUES, SKIN),
        (ROW_VALUES, MORPH),
        (ROW_VALUES, INSTANCE_INDEX),
        (ROW_VALUES, ALPHA_COVERAGE),
        (ROW_VALUES, ALPHA_HASH),
        (ROW_VALUES, TRANSMISSION),
        (CASTER, TONE_MAP),
        (CASTER, VERTEX_COLOR),
        (CASTER, ALPHA_MASK),
        (CASTER, RECEIVE_SHADOWS),
        (CASTER, TRANSMISSION),
        (CASTER, PREPASS),
        (CASTER, INSTANCE_INDEX),
        (CASTER, AREA_LIGHTS),
        (DISPLACEMENT, INSTANCE_INDEX),
        (BUMP, INSTANCE_INDEX),
        (BUMP, VERTEX_TANGENT),
        (PARALLAX, TRANSMISSION),
        (PARALLAX, TRANSLUCENCY),
        (TRANSLUCENCY, TRANSMISSION),
        (TRANSLUCENCY, CASTER),
        (TRANSLUCENCY, INSTANCE_INDEX),
        (TRANSLUCENCY, COAT_SHEEN),
        (TRANSLUCENCY, WEIGHTED),
        (MOTION, TONE_MAP),
        (MOTION, VERTEX_COLOR),
        (MOTION, ALPHA_MASK),
        (MOTION, RECEIVE_SHADOWS),
        (MOTION, SKIN),
        (MOTION, MORPH),
        (MOTION, TRANSMISSION),
        (MOTION, PREPASS),
        (MOTION, INSTANCE_INDEX),
        (MOTION, CASTER),
        (MOTION, LOD_FADE),
        (LOD_FADE, SKIN),
        (LOD_FADE, MORPH),
        (LOD_FADE, INSTANCE_INDEX),
        (LOD_FADE, TRANSMISSION),
        (LOD_FADE, ALPHA_HASH),
        (COAT_SHEEN, INSTANCE_INDEX),
        (COAT_SHEEN, CASTER),
        (WEIGHTED, ALPHA_MASK),
        (WEIGHTED, TRANSMISSION),
        (WEIGHTED, INSTANCE_INDEX),
        (WEIGHTED, PREPASS),
        (WEIGHTED, CASTER),
        (WEIGHTED, OUTLINE_VISIBLE),
        (WEIGHTED, LOD_FADE),
        (LOD_FADE, DISPLACEMENT),
        (UPSCALE, FXAA),
        (UPSCALE, BLOOM),
    ];

    /// True when a permutation word holds every bit that each of its bits needs ([`NEEDS`]), and
    /// no pair of bits kept apart ([`APART`]): the words that the shader build makes.
    pub const fn buildable(word: u32) -> bool {
        let mut k = 0;
        while k < NEEDS.len() {
            let (bit, needed) = NEEDS[k];
            if word & bit != 0 && word & needed == 0 {
                return false;
            }
            k += 1;
        }
        let mut k = 0;
        while k < APART.len() {
            let (a, b) = APART[k];
            if word & a != 0 && word & b != 0 {
                return false;
            }
            k += 1;
        }
        true
    }

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
    /// The fragment's alpha decides which of the pixel's samples it covers. Only a multisampled
    /// pipeline whose color format has alpha takes it (`format::covers_by_alpha`).
    pub const ALPHA_TO_COVERAGE: u32 = 512;
    /// Draws where the fragment is as near as what the depth target holds or nearer, so a
    /// fragment at the far plane draws where no object wrote depth, as backgrounds draw after the
    /// opaque objects.
    pub const DEPTH_OR_EQUAL: u32 = 1024;
    /// Every flag.
    pub const ALL: u32 = CULL_NONE
        | LINE_LIST
        | CULL_FRONT
        | NO_DEPTH_WRITE
        | NO_DEPTH_TEST
        | BLEND
        | DEPTH_EQUAL
        | NO_COLOR_WRITE
        | ALPHA_TO_COVERAGE
        | DEPTH_OR_EQUAL;
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
    /// The location of the first texture coordinates.
    pub const UV0_LOCATION: usize = 2;

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
    /// Bytes per compacted instance of the motion view: [`INSTANCE_STRIDE`]'s, then the three rows
    /// of the last frame's world matrix.
    pub const MOTION_INSTANCE_STRIDE: u32 = 112;
    /// Bytes per compacted instance that a vertex shader reads by index: the source's index in a
    /// whole 16-byte entry, which the culling shader writes as one vector.
    pub const INDEX_STRIDE: u32 = 16;
    /// Bytes of the per-frame uniform block: the view-projection matrix, four vectors, the output
    /// settings, the fog's 48 bytes, the light grid's two vectors, three vectors that custom
    /// materials read, the camera's near and far distances, ambient occlusion's values, the
    /// environment's 208 bytes, the hemisphere lights' three vectors, the view's offset for
    /// shadow lookups, the camera's view and projection matrices, which custom materials read,
    /// screen-space reflections' matrix into the frame before's view and their two vectors, a
    /// still view's jitter, which the scene's vertex shaders add, the physical sky's aerial
    /// perspective's six vectors, and the vignette that the 8-bit path's fragment shaders apply.
    pub const FRAME_UNIFORM_BYTES: u32 = 1088;
    /// Bytes of the output settings: the exposure, the tone mapping, the flags and the render
    /// size, then the grading controls that the 8-bit path's shaders apply before their curve.
    pub const OUTPUT_UNIFORM_BYTES: u32 = 112;
    /// Threads per workgroup of the culling shader.
    pub const CULL_WORKGROUP_SIZE: u32 = 128;
    /// 32-bit words per indexed indirect draw.
    pub const INDIRECT_WORDS: u32 = 5;
    /// 32-bit words per bucket record of the culling shader: its slice's base, its material, its
    /// local sphere's radius, its first draw and draw count, the sphere's centre, the first joint
    /// of a skin that the vertex shader skins, 1 for a bucket whose slice holds source indices
    /// instead of copies of the matrices, for a mesh with levels of detail the level's switch
    /// value, the bucket of the next coarser level plus one, the level's fade bucket plus one, the
    /// threshold bias that picks the levels, 1 for none, and the measure that the switch value
    /// names.
    pub const BUCKET_WORDS: u32 = 15;
    /// A bucket record's first joint that sends the culling shader to each source's own: the
    /// buckets that skinned objects share, whose vertex shaders skin, read the first joint of each
    /// object's skin from a data texture of 32-bit indices, at the object's source.
    pub const PER_SOURCE_JOINT: u32 = u32::MAX;
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
    /// Texels of an `RGBA32_FLOAT` data texture per row of an instance batch's row values: its
    /// color, then its own values.
    pub const ROW_VALUE_TEXELS: u32 = 2;
    /// Row values per row of their data texture, which is 2,048 texels wide.
    pub const ROW_VALUES_PER_TEXTURE_ROW: u32 = 1024;
    /// Texels of an `RGBA32_FLOAT` data texture per source's distance range: its start distance
    /// and its end distance.
    pub const RANGE_TEXELS: u32 = 1;
    /// Distance ranges per row of their data texture, which is 2,048 texels wide.
    pub const RANGES_PER_TEXTURE_ROW: u32 = 2048;
    /// Bytes of the table of object ranges, a uniform block that the vertex shaders of custom
    /// materials which read an instance's index or an object's id search: the largest uniform
    /// block that every WebGL2 device and WebGPU's compatibility mode allow.
    pub const OBJECT_RANGE_BYTES: u32 = 16384;
    /// Bytes of one point or spot light's record, which fragment shaders read from the light
    /// list: five vectors of four 32-bit values.
    pub const LIGHT_RECORD_BYTES: u32 = 80;
    /// Texels of an `RGBA32_UINT` data texture per light record: one per vector.
    pub const LIGHT_RECORD_TEXELS: u32 = LIGHT_RECORD_BYTES / 16;
    /// Light records per row of WebGL2's light data texture, from its first column. A power of
    /// two.
    pub const LIGHTS_PER_TEXTURE_ROW: u32 = 256;
    /// Words of the light grid per row of WebGL2's light data texture, four to a texel, in the
    /// columns after the light records'. A power of two. The texture is 1,792 texels wide, inside
    /// the 2,048 that every WebGL2 device allows.
    pub const GRID_WORDS_PER_TEXTURE_ROW: u32 = 2048;
    /// Bytes of one draw record: the start of the draw's slice of the index list, its material
    /// and the data texture its instances come from, and one spare word.
    pub const DRAW_RECORD_BYTES: u32 = 16;
    /// Draw records one multi-draw call reads: a 4 KiB uniform block, which WebGL2's multi-draw
    /// vertex shaders read through a texture copy, one texel per record.
    pub const MULTI_DRAW_RECORDS: u32 = 256;
    /// Materials in the material table.
    pub const MAX_MATERIALS: u32 = 1024;
    /// Bytes of one material's row in the material table: thirty-two `vec4f`s. The row holds the
    /// base values, the transmission's values, the attenuation's, the clear coat's, the sheen's,
    /// the diffuse transmission's, the subsurface scatter's, the iridescence's, the anisotropy's,
    /// the light map's transform, and the transforms of the maps of the slots from the second up.
    /// On WebGL2 each row is a row of thirty-two `RGBA32_FLOAT` texels of a data texture.
    pub const MATERIAL_BYTES: u32 = 512;
    /// The map slots of a material: the textures of the [`super::layout::MATERIAL_MAPS`] layout,
    /// at bindings from 0, with each one's sampler at the bindings after every texture.
    pub const MAP_SLOTS: u32 = 8;
    /// The units that the standard material's maps share on WebGL2, which gives a shader stage
    /// only 16 texture units: the group's first bindings hold the units' arrays, and the bindings
    /// from [`MAP_SLOTS`] their samplers.
    pub const SHARED_MAP_UNITS: u32 = 6;
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
    /// Bytes of the uniform block of the sun's hero shadow: its matrix, then its vector of the
    /// texel size, the light's biases and its layer.
    pub const SHADOW_HERO_UNIFORM_BYTES: u32 = 80;
    /// Bytes of the frame's shadow settings: the cascades' block, the tiles' block and the hero's,
    /// one binding of the frame's group (D-146).
    pub const SHADOW_SETTINGS_BYTES: u32 =
        SHADOW_UNIFORM_BYTES + SHADOW_TILES_UNIFORM_BYTES + SHADOW_HERO_UNIFORM_BYTES;
    /// Bytes of the background's uniform block: ten vectors, which the cube map, the sky, a plain
    /// color and a sky layer's sun visibility read (see `null3d_render::background`).
    pub const BACKGROUND_UNIFORM_BYTES: u32 = 160;
    /// Bytes of a sky layer's uniform block: two vectors, the core sky's cloud settings and the
    /// layer's own view values (see `null3d_render::background`).
    pub const BACKGROUND_LAYER_UNIFORM_BYTES: u32 = 32;
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
    /// The physical sky's tables and its panorama: one triangle over the whole target, whose first
    /// vertex names the step, three times the table's index. Its group 0 has layout
    /// [`ATMOSPHERE`](super::layout::ATMOSPHERE).
    pub const SKY_TABLE: u32 = 10;
    /// The physical sky behind every object, drawn as [`BACKGROUND_SKY`] is, from its tables. Its
    /// group 1 has layout [`ATMOSPHERE`](super::layout::ATMOSPHERE).
    pub const BACKGROUND_ATMOSPHERE: u32 = 11;
    /// A texture behind every object: one triangle over the whole view, with no vertex buffer, that
    /// samples a layer of a texture array. The bind group of index 0 is the frame's, that of index
    /// 1 the texture's and that of index 2 the background's, of layout
    /// [`BACKGROUND`](super::layout::BACKGROUND). The draw's first vertex is the layer times three.
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
    /// The exposure meter's downsample step: one triangle over a grid of 16 x 16 cells, each of
    /// which writes the mean log luminance of its part of the color and its center weight. It
    /// binds as a step of bloom does.
    pub const EXPOSURE_LUMINANCE: u32 = 15;
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
    /// The exposure meter's adaptation from the downsample: one triangle over one texel, which
    /// meters the cells, moves the stored exposure toward the result and writes the new exposure.
    /// It binds as ambient occlusion's later steps do: the cells, then the stored exposure.
    pub const EXPOSURE_ADAPT: u32 = 26;
    /// The exposure meter's histogram: a compute shader that adds a grid of the color's samples to
    /// bins of log luminance. WebGPU only.
    pub const EXPOSURE_HISTOGRAM: u32 = 27;
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
    /// A cube map behind every object, such as an environment map: a cube around the camera of 36
    /// vertices with no vertex buffer, whose fragments read the cube map in their direction. The
    /// bind group of index 0 is the frame's and that of index 1 the background's, of layout
    /// [`BACKGROUND`](super::layout::BACKGROUND).
    pub const BACKGROUND_CUBE: u32 = 35;
    /// three.js's analytic sky behind every object, drawn as [`BACKGROUND_CUBE`] is, from the
    /// values of the background's uniform block alone.
    pub const BACKGROUND_SKY: u32 = 36;
    /// The depth of a masked shadow caster: [`SHADOW_DEPTH`]'s vertices, with each fragment of the
    /// caster's material tested as its shading tests it, by the material's opacity and vertex
    /// alpha, so masked surfaces cut holes in their shadows. It binds as the depth template does.
    pub const SHADOW_CUTOUT: u32 = 37;
    /// [`SHADOW_CUTOUT`] times the alpha of the material's base color map. The bind group of index
    /// 1 is the map's, as for [`INSTANCED_UNLIT_MAP`].
    pub const SHADOW_CUTOUT_MAP: u32 = 38;
    /// The copy of a view's image into the target that materials sample: one triangle over the
    /// target, which reads the texel of the same column in the mirrored row of the image, so the
    /// target holds the image's bottom row first. Only WebGPU has it.
    pub const VIEW_COPY: u32 = 39;
    /// The still-camera accumulation's blend: one triangle over the render size, which blends the
    /// scene color into the history of a still view. It binds as
    /// [`layout::ACCUMULATE`](super::layout::ACCUMULATE) does.
    pub const ACCUMULATE: u32 = 48;
    /// The exposure meter's adaptation from the histogram: a compute shader that meters the bins,
    /// moves the stored exposure toward the result and writes the new exposure. WebGPU only.
    pub const EXPOSURE_ADAPT_HISTOGRAM: u32 = 40;
    /// Depth of field's first step: one triangle over a target at half the render size, which
    /// reads four pixels of the scene's color and depth for each texel and writes their color with
    /// the blur's signed size. It binds as a custom effect that reads depth does.
    pub const DOF_SETUP: u32 = 41;
    /// [`DOF_SETUP`] from a multisampled depth target, whose sample 0 it reads. WebGPU only.
    pub const DOF_SETUP_MS: u32 = 42;
    /// Depth of field's gather: a disk or polygon of taps around each texel, which splits what it
    /// reads into the near and the far field. It binds as a step of bloom does.
    pub const DOF_BLUR: u32 = 43;
    /// Depth of field's small tent filter over the gather's result. It binds as a step of bloom
    /// does.
    pub const DOF_FILTER: u32 = 44;
    /// Depth of field's last step: one triangle over a target of the render size, which mixes the
    /// blurred image into the scene's color by each pixel's own blur size.
    pub const DOF_COMPOSITE: u32 = 45;
    /// [`DOF_COMPOSITE`] from a multisampled depth target, whose sample 0 it reads. WebGPU only.
    pub const DOF_COMPOSITE_MS: u32 = 46;
    /// The copy of the camera's opaque color that surfaces which let light through sample: one
    /// triangle over the first level of its target, which reads one texel of the scene color per
    /// pixel, and writes the code of the scene depth's distance in its alpha. Its TONE_MAP build
    /// decodes display color, and its DEPTH_MULTISAMPLED builds read sample 0 of a multisampled
    /// depth. It binds as [`layout::WEIGHTED_COMPOSITE`](super::layout::WEIGHTED_COMPOSITE), or
    /// [`layout::TRANSMISSION_COPY_MS`](super::layout::TRANSMISSION_COPY_MS) from a multisampled
    /// depth.
    pub const TRANSMISSION_COPY: u32 = 47;
    /// The motion of moving objects, from the motion view: each vertex placed in this frame and in
    /// the last, and the difference of the two places on the screen, beyond what the camera's
    /// move explains, as two half floats. Masked materials test their alpha as masked casters
    /// do, with their base color map where it has an image. Its group 0 is
    /// [`super::layout::MOTION_FRAME`], and group 1 the map's.
    pub const MOTION: u32 = 73;
    /// The tone mask of instanced meshes: the parts of the objects whose material keeps its color
    /// as the display shows it, in blue, where the scene's depth leaves them. The final pass reads
    /// it to skip the tone curve for those pixels. It binds as the depth template does.
    pub const TONE_MASK: u32 = 79;
    /// One level of screen-space reflections' depth pyramid: one triangle over the level's drawn
    /// corner, each texel the nearest depth of the 2 x 2 texels of the level below it.
    pub const SSR_REDUCE: u32 = 49;
    /// Screen-space reflections' trace: one triangle over the grid of the screen texture, which
    /// marches each texel's mirror ray through the depth pyramid and writes the ray's length.
    pub const SSR_TRACE: u32 = 50;
    /// The skin pass's build of the standard material, from the lit template's file: it writes the
    /// diffuse light that scatters under the surface, with the view distance and the material's
    /// scatter distances, for the subsurface blur. It binds as [`INSTANCED_LIT`] does.
    pub const SUBSURFACE: u32 = 51;
    /// [`SUBSURFACE`] with the standard material's maps. It binds as [`INSTANCED_STANDARD_MAPS`]
    /// does.
    pub const SUBSURFACE_MAPS: u32 = 52;
    /// The subsurface blur's across step: one triangle over its target, which blurs the skin pass's
    /// light along the rows.
    pub const SUBSURFACE_BLUR: u32 = 66;
    /// The subsurface blur's down step: one triangle over its target, which blurs the across
    /// step's light along the columns and adds the change to a copy of the scene color.
    pub const SUBSURFACE_COMPOSITE: u32 = 67;
    /// [`SUBSURFACE_COMPOSITE`] with a multisampled scene depth, whose sample 0 the step reads.
    /// Only WebGPU has it.
    pub const SUBSURFACE_COMPOSITE_MS: u32 = 68;
    /// The blend of weighted blended transparency's layer over the scene color: one triangle that
    /// reads the weighted color sum and the coverage, each one texel per pixel, with the layout
    /// [`WEIGHTED_COMPOSITE`](super::layout::WEIGHTED_COMPOSITE), and writes their average color
    /// premultiplied by the share that the layer covers.
    pub const WEIGHTED_COMPOSITE: u32 = 64;
    /// The copy of the first sample of a multisampled scene depth into a depth target of one
    /// sample, which the weighted layer's pass tests against: one triangle that writes each
    /// pixel's depth, first in that pass. Its pipelines name the pass's two color targets, as
    /// [`draws_two_targets`] says, and write no color. On WebGPU it reads the multisampled depth
    /// with the layout [`WEIGHTED_DEPTH_MS`](super::layout::WEIGHTED_DEPTH_MS); on WebGL2 it reads
    /// the copy of one sample that the backend keeps.
    pub const WEIGHTED_DEPTH: u32 = 65;

    /// True for a pipeline that draws into a second color target of `format::R16_FLOAT` beside its
    /// color format: the weighted layer's builds (`permutation::WEIGHTED`), and its depth copy.
    pub const fn draws_two_targets(template: u32, permutation: u32) -> bool {
        permutation & super::permutation::WEIGHTED != 0 || template == WEIGHTED_DEPTH
    }
    /// Decals with the standard material: the back faces of each instance's box, which shade the
    /// surface under each pixel from the scene's depth, in the decal pass after the camera's opaque
    /// pass. It binds the frame's group, of [`super::layout::DECAL_FRAME`] on WebGPU, then the
    /// scene's depth in the group of [`super::layout::DECAL_DEPTH`] or
    /// [`super::layout::DECAL_DEPTH_MS`].
    pub const DECAL: u32 = 61;
    /// [`DECAL`] with the standard material's maps, whose group comes before the depth's.
    pub const DECAL_MAPS: u32 = 62;
    /// The lit material with the scene's light probe grid (D-146): the standard material with the
    /// grid's sampling in the light's loop, in a template of its own so a page that sets no grid
    /// loads none of it. The engine draws lit meshes through it while the scene sets a grid.
    pub const PROBE_GRID: u32 = 71;
    /// The same with the material's texture maps.
    pub const PROBE_GRID_MAPS: u32 = 72;
    /// Particles of a particle system: six vertices for each 32-byte record of a vertex buffer of
    /// the instance's step, which the vertex shader moves to the particle's age, with no mesh. The
    /// bind group of index 0 is the frame's, 1 the system's of layout
    /// [`PARTICLE`](super::layout::PARTICLE), and 2 the view's depth copy of layout
    /// [`PARTICLE_SCENE_DEPTH`](super::layout::PARTICLE_SCENE_DEPTH). Each particle is a soft dot.
    pub const PARTICLE: u32 = 53;
    /// [`PARTICLE`] with a flipbook atlas: the bind group of index 3 is the map's, as for
    /// [`SPRITE_MAP`] on WebGL2.
    pub const PARTICLE_MAP: u32 = 54;
    /// The copy of the camera's opaque depth that soft particles read: one triangle over a target
    /// of 32-bit floats, which reads the depth one texel per pixel, with the layout
    /// [`VIEW_COPY`](super::layout::VIEW_COPY).
    pub const PARTICLE_DEPTH: u32 = 55;
    /// [`PARTICLE_DEPTH`] from a multisampled depth, whose first sample it reads, with the layout
    /// [`PARTICLE_DEPTH_MS`](super::layout::PARTICLE_DEPTH_MS). Only WebGPU has it.
    pub const PARTICLE_DEPTH_MS: u32 = 56;
    /// The motion debug view: one triangle over the scene color, which shows each pixel's whole
    /// motion, the camera's part from the depth and the surface's own from the motion target. It
    /// binds as a custom effect that reads depth does.
    pub const MOTION_VIEW: u32 = 74;
    /// The volumetric fog's light step: one triangle over the grid's texture, which lights each cell
    /// of the grid. It binds the camera's frame group at group 0, as the background does, and at
    /// group 1 its settings, the last frame's grid and a sampler, as a step of bloom binds them.
    pub const FOG_LIGHT: u32 = 57;
    /// The volumetric fog's sum: one triangle over the summed grid's texture, which joins the
    /// blocks' sums in front of each cell. It binds as a step of bloom does.
    pub const FOG_SUM: u32 = 58;
    /// The volumetric fog's apply step: one triangle over a target of the render size, which adds
    /// the summed grid's light to the scene's color. It binds as depth of field's composite does.
    pub const FOG_APPLY: u32 = 59;
    /// [`FOG_APPLY`] from a multisampled depth target, whose sample 0 it reads. WebGPU only.
    pub const FOG_APPLY_MS: u32 = 60;
    /// The volumetric fog's block step: one triangle over a texture of the grid's size, which sums
    /// the cells of each block of slices up to each cell. It binds as a step of bloom does.
    pub const FOG_BLOCK: u32 = 69;
    /// GPU picking: each object of the camera's view written with its object or batch id and its
    /// instance's row where the scene's depth leaves it, into a small id target, with the scene's
    /// depth as its depth target and an EQUAL test that writes no depth. A masked fragment wrote
    /// no depth, so it never matches, and picking follows the mask. Binds as the frame's group
    /// does, and reads the table of object ranges for each instance's id.
    pub const PICK: u32 = 70;
    /// GPU picking's resolve: one triangle over the render size that copies the id target, which
    /// the device resolved into one sample per pixel, into a target that a copy reads. It binds
    /// the resolved target at group 0, of [`super::layout::VIEW_COPY`].
    pub const PICK_RESOLVE: u32 = 75;
    /// GPU picking with a masked standard material: the pick template that binds the material's map
    /// slots, so the mask cuts the same pixels that the shading cuts.
    pub const PICK_MAPS: u32 = 76;
    /// GPU picking with a masked unlit map: the pick template that binds its single base color map.
    pub const PICK_TEXTURE_MAPS: u32 = 77;
    /// Cluster levels: one compute pipeline whose dispatch counts, scans or copies the patches of
    /// a view, which the dispatch's parameters pick. WebGPU only.
    pub const CLUSTER: u32 = 78;
    /// Temporal anti-aliasing's resolve, a prototype (M3-A11): one triangle over a target of the
    /// render size, which blends the scene's color into the history that it reads where each
    /// pixel's surface lay in the frame before, from the motion target and the depth. Its group 0
    /// is [`TAA`](super::layout::TAA), or [`TAA_MS`](super::layout::TAA_MS) from a multisampled
    /// scene depth.
    pub const TAA_RESOLVE: u32 = 80;
    /// [`TAA_RESOLVE`] from a multisampled scene depth, whose samples it reads. WebGPU only.
    pub const TAA_RESOLVE_MS: u32 = 81;
    /// Temporal anti-aliasing's copy of the resolve's target into the history of the frame's
    /// parity, one texel per pixel. It binds as the copy of a view's image does.
    pub const TAA_COPY: u32 = 82;
    /// The conversion of a feature-instance draw's world rows to camera-relative rows: one
    /// dispatch for each draw in each frame, whose count bounds the instances it converts. The
    /// engine's vertex shaders read rows relative to their view's camera, and a page writes world
    /// rows (D-229). WebGPU only.
    pub const FEATURE_ROWS: u32 = 83;
    /// The light clusters' depth reduction: reads the view's depth and writes its nearest and
    /// farthest into the light grid's header. WebGPU only.
    pub const LIGHT_DEPTH: u32 = 84;
    /// [`LIGHT_DEPTH`] from a multisampled depth target, whose sample 0 it reads. WebGPU only.
    pub const LIGHT_DEPTH_MS: u32 = 85;
    /// Clears the depth reduction's buffer: one thread, before the reduction fills it. WebGPU only.
    pub const LIGHT_DEPTH_CLEAR: u32 = 86;
    /// [`LIGHT_DEPTH_CLEAR`] from a multisampled depth target. WebGPU only.
    pub const LIGHT_DEPTH_CLEAR_MS: u32 = 87;
    /// Light clustering's fit: one thread that fits the slices to the measured depth and writes
    /// the grid's header, before the counting dispatch. WebGPU only.
    pub const LIGHT_FIT: u32 = 88;
    /// The first template of custom materials: each compiled custom material's WGSL has its own
    /// template from here up, which the thread that draws receives from the sketch. The engine's
    /// own templates take ids below it.
    pub const CUSTOM_FIRST: u32 = 128;

    /// Every engine template with its name, in id order: the constants that the TypeScript replay
    /// loop reads, and the templates whose groups [`super::groups`] knows.
    pub const NAMES: [(&str, u32); 88] = [
        ("INSTANCED_LIT", INSTANCED_LIT),
        ("INSTANCED_UNLIT", INSTANCED_UNLIT),
        ("INSTANCED_TEXCOORDS", INSTANCED_TEXCOORDS),
        ("DEBUG_LINES", DEBUG_LINES),
        ("INSTANCED_UNLIT_MAP", INSTANCED_UNLIT_MAP),
        ("INSTANCED_STANDARD_MAPS", INSTANCED_STANDARD_MAPS),
        ("FINAL", FINAL),
        ("SHADOW_DEPTH", SHADOW_DEPTH),
        ("BACKGROUND", BACKGROUND),
        ("DEBUG_VIEW", DEBUG_VIEW),
        ("BLOOM", BLOOM),
        ("FINAL_BLOOM", FINAL_BLOOM),
        ("CULL", CULL),
        ("LIGHT_COUNT", LIGHT_COUNT),
        ("LIGHT_PLACE", LIGHT_PLACE),
        ("LIGHT_WRITE", LIGHT_WRITE),
        ("SKIN", SKIN),
        ("OUTLINE_MASK", OUTLINE_MASK),
        ("TONE_MASK", TONE_MASK),
        ("SPRITE", SPRITE),
        ("SPRITE_MAP", SPRITE_MAP),
        ("OCCLUSION_EARLY", OCCLUSION_EARLY),
        ("OCCLUSION_LATE", OCCLUSION_LATE),
        ("DEPTH_PYRAMID", DEPTH_PYRAMID),
        ("LINE", LINE),
        ("LINE_LIT", LINE_LIT),
        ("AO_DEPTH", AO_DEPTH),
        ("AO_DEPTH_MS", AO_DEPTH_MS),
        ("AO", AO),
        ("AO_DENOISE", AO_DENOISE),
        ("BACKGROUND_CUBE", BACKGROUND_CUBE),
        ("BACKGROUND_SKY", BACKGROUND_SKY),
        ("SKY_TABLE", SKY_TABLE),
        ("BACKGROUND_ATMOSPHERE", BACKGROUND_ATMOSPHERE),
        ("SHADOW_CUTOUT", SHADOW_CUTOUT),
        ("SHADOW_CUTOUT_MAP", SHADOW_CUTOUT_MAP),
        ("VIEW_COPY", VIEW_COPY),
        ("ACCUMULATE", ACCUMULATE),
        ("DOF_SETUP", DOF_SETUP),
        ("DOF_SETUP_MS", DOF_SETUP_MS),
        ("DOF_BLUR", DOF_BLUR),
        ("DOF_FILTER", DOF_FILTER),
        ("DOF_COMPOSITE", DOF_COMPOSITE),
        ("DOF_COMPOSITE_MS", DOF_COMPOSITE_MS),
        ("TRANSMISSION_COPY", TRANSMISSION_COPY),
        ("SSR_REDUCE", SSR_REDUCE),
        ("SSR_TRACE", SSR_TRACE),
        ("WEIGHTED_COMPOSITE", WEIGHTED_COMPOSITE),
        ("WEIGHTED_DEPTH", WEIGHTED_DEPTH),
        ("DECAL", DECAL),
        ("DECAL_MAPS", DECAL_MAPS),
        ("PROBE_GRID", PROBE_GRID),
        ("PROBE_GRID_MAPS", PROBE_GRID_MAPS),
        ("PARTICLE", PARTICLE),
        ("PARTICLE_MAP", PARTICLE_MAP),
        ("PARTICLE_DEPTH", PARTICLE_DEPTH),
        ("PARTICLE_DEPTH_MS", PARTICLE_DEPTH_MS),
        ("EXPOSURE_LUMINANCE", EXPOSURE_LUMINANCE),
        ("EXPOSURE_ADAPT", EXPOSURE_ADAPT),
        ("EXPOSURE_HISTOGRAM", EXPOSURE_HISTOGRAM),
        ("EXPOSURE_ADAPT_HISTOGRAM", EXPOSURE_ADAPT_HISTOGRAM),
        ("FOG_LIGHT", FOG_LIGHT),
        ("FOG_SUM", FOG_SUM),
        ("FOG_APPLY", FOG_APPLY),
        ("FOG_APPLY_MS", FOG_APPLY_MS),
        ("FOG_BLOCK", FOG_BLOCK),
        ("PICK", PICK),
        ("SUBSURFACE", SUBSURFACE),
        ("SUBSURFACE_MAPS", SUBSURFACE_MAPS),
        ("SUBSURFACE_BLUR", SUBSURFACE_BLUR),
        ("SUBSURFACE_COMPOSITE", SUBSURFACE_COMPOSITE),
        ("SUBSURFACE_COMPOSITE_MS", SUBSURFACE_COMPOSITE_MS),
        ("MOTION", MOTION),
        ("MOTION_VIEW", MOTION_VIEW),
        ("PICK_RESOLVE", PICK_RESOLVE),
        ("PICK_MAPS", PICK_MAPS),
        ("PICK_TEXTURE_MAPS", PICK_TEXTURE_MAPS),
        ("CLUSTER", CLUSTER),
        ("TAA_RESOLVE", TAA_RESOLVE),
        ("TAA_RESOLVE_MS", TAA_RESOLVE_MS),
        ("TAA_COPY", TAA_COPY),
        ("FEATURE_ROWS", FEATURE_ROWS),
        ("LIGHT_DEPTH", LIGHT_DEPTH),
        ("LIGHT_DEPTH_MS", LIGHT_DEPTH_MS),
        ("LIGHT_DEPTH_CLEAR", LIGHT_DEPTH_CLEAR),
        ("LIGHT_DEPTH_CLEAR_MS", LIGHT_DEPTH_CLEAR_MS),
        ("LIGHT_FIT", LIGHT_FIT),
        ("CUSTOM_FIRST", CUSTOM_FIRST),
    ];
}

/// The bind group layouts that each engine template's pipeline binds, group by group, as the
/// render worker declares them in `pipelines.ts`. A draw whose bound group has another layout is
/// what WebGPU refuses when it validates the pipeline, so the mock backend holds every draw to
/// this table.
///
/// An entry lists the layouts that a build may bind at one group index, over both GPU paths: a
/// draw list comes from one path and the mock reads both. The WebGL2 path reads each view's
/// instance data from groups of its own, so a template that draws meshes carries the indices that
/// path binds beside the indices WebGPU binds. A template from [`template::CUSTOM_FIRST`] up,
/// whose layouts the page decides, has no entry.
pub mod groups {
    use super::{layout, template};

    /// One group of the given layouts, bound at group 0.
    macro_rules! own {
        ($($id:expr),+) => {
            &[&[$($id),+]]
        };
    }
    /// The groups of a template that draws meshes: its shading group, then the groups the two
    /// paths bind after it. WebGPU binds the joint texture of a build that skins in the vertex
    /// shader, the maps' group of a build that samples maps, and the view's index group of a build
    /// that reads its instances by index. WebGL2 reads each view's instance data from groups of its
    /// own, the draws' group and the instances' one, and binds a material's maps at the group after
    /// them. A decal adds the scene's depth: at index 2 on WebGPU, after the maps on WebGL2. That
    /// last index on WebGL2 also holds the copy of the scene's depth that a custom material reads,
    /// which the view binds once for the whole pass: a pass that draws such a material carries it
    /// at every draw. A WebGL2 program reads no binding that it does not declare.
    const MESH: &[&[u32]] = &[
        &[layout::FRAME, layout::DEPTH],
        &[
            layout::DRAWS,
            layout::JOINTS,
            layout::MATERIAL_MAPS,
            layout::TEXTURES,
            layout::INSTANCE_INDEX,
            layout::DECAL_DEPTH,
            layout::DECAL_DEPTH_MS,
        ],
        &[
            layout::INSTANCES,
            layout::INSTANCE_INDEX,
            layout::DECAL_DEPTH,
            layout::DECAL_DEPTH_MS,
        ],
        &[layout::TEXTURES, layout::MATERIAL_MAPS],
        &[
            layout::DECAL_DEPTH,
            layout::DECAL_DEPTH_MS,
            layout::MATERIAL_SCENE,
        ],
    ];
    /// [`MESH`] for a decal's templates, whose frame group leaves out the bindings that no decal
    /// build reads.
    const DECAL_MESH: &[&[u32]] = &[
        &[layout::FRAME, layout::DEPTH, layout::DECAL_FRAME],
        MESH[1],
        MESH[2],
        MESH[3],
        MESH[4],
    ];
    /// The groups of a template that draws particles: its system's group, then the view's copy of
    /// its opaque depth, the group the maps of a build that has them sit in, and the WebGL2 path's
    /// draws and instances groups.
    const PARTICLE_MESH: &[&[u32]] = &[
        &[layout::FRAME],
        &[layout::PARTICLE, layout::DRAWS],
        &[layout::PARTICLE_SCENE_DEPTH, layout::INSTANCES],
        &[layout::TEXTURES],
    ];
    /// The groups of the background templates: the frame's group, then a texture and the
    /// background's own group. A cube or sky background binds only the background's own, at the
    /// group after the frame's, and the WebGL2 path binds each view's instances group last.
    const BACKGROUND: &[&[u32]] = &[
        &[layout::FRAME],
        &[layout::TEXTURES, layout::BACKGROUND],
        &[layout::BACKGROUND, layout::INSTANCES],
    ];
    /// The physical sky's tables and its panorama.
    const SKY: &[&[u32]] = &[&[layout::ATMOSPHERE]];
    /// Every engine template with its groups, by template id.
    const TABLE: &[(u32, &[&[u32]])] = &[
        (template::INSTANCED_LIT, MESH),
        (template::INSTANCED_UNLIT, MESH),
        (template::INSTANCED_TEXCOORDS, MESH),
        (template::DEBUG_LINES, MESH),
        (template::INSTANCED_UNLIT_MAP, MESH),
        (template::INSTANCED_STANDARD_MAPS, MESH),
        (template::FINAL, own!(layout::FINAL)),
        (template::SHADOW_DEPTH, MESH),
        (template::BACKGROUND, BACKGROUND),
        (template::SKY_TABLE, SKY),
        (
            template::BACKGROUND_ATMOSPHERE,
            &[
                &[layout::FRAME],
                &[layout::ATMOSPHERE],
                &[layout::INSTANCES],
            ],
        ),
        (template::DEBUG_VIEW, MESH),
        (template::BLOOM, own!(layout::BLOOM)),
        (template::FINAL_BLOOM, own!(layout::FINAL_BLOOM)),
        (template::EXPOSURE_LUMINANCE, own!(layout::EFFECT)),
        (template::CULL, own!(layout::CULL)),
        (template::CLUSTER, own!(layout::CLUSTER_CULL)),
        (template::TAA_RESOLVE, own!(layout::TAA)),
        (template::TAA_RESOLVE_MS, own!(layout::TAA_MS)),
        (template::TAA_COPY, own!(layout::VIEW_COPY)),
        (template::FEATURE_ROWS, own!(layout::FEATURE_ROWS)),
        (template::LIGHT_COUNT, own!(layout::LIGHT_CLUSTERS)),
        (template::LIGHT_PLACE, own!(layout::LIGHT_CLUSTERS)),
        (template::LIGHT_WRITE, own!(layout::LIGHT_CLUSTERS)),
        (template::LIGHT_DEPTH, own!(layout::LIGHT_DEPTH)),
        (template::LIGHT_DEPTH_MS, own!(layout::LIGHT_DEPTH_MS)),
        (template::LIGHT_DEPTH_CLEAR, own!(layout::LIGHT_DEPTH)),
        (template::LIGHT_DEPTH_CLEAR_MS, own!(layout::LIGHT_DEPTH_MS)),
        (template::LIGHT_FIT, own!(layout::LIGHT_CLUSTERS)),
        (template::SKIN, own!(layout::SKIN)),
        (template::OUTLINE_MASK, MESH),
        (template::TONE_MASK, MESH),
        (template::SPRITE, MESH),
        (template::SPRITE_MAP, MESH),
        (template::OCCLUSION_EARLY, own!(layout::CULL)),
        (template::OCCLUSION_LATE, own!(layout::CULL)),
        (template::EXPOSURE_ADAPT, own!(layout::EFFECT)),
        (template::EXPOSURE_HISTOGRAM, own!(layout::EXPOSURE)),
        (template::DEPTH_PYRAMID, own!(layout::DEPTH_PYRAMID)),
        (template::LINE, MESH),
        (template::LINE_LIT, MESH),
        (template::AO_DEPTH, own!(layout::AO_DEPTH)),
        (template::AO_DEPTH_MS, own!(layout::AO_DEPTH_MS)),
        (template::AO, own!(layout::AO)),
        (template::AO_DENOISE, own!(layout::AO)),
        (template::BACKGROUND_CUBE, BACKGROUND),
        (template::BACKGROUND_SKY, BACKGROUND),
        (template::SHADOW_CUTOUT, MESH),
        (template::SHADOW_CUTOUT_MAP, MESH),
        (template::VIEW_COPY, own!(layout::VIEW_COPY)),
        (template::ACCUMULATE, own!(layout::ACCUMULATE)),
        (template::EXPOSURE_ADAPT_HISTOGRAM, own!(layout::EXPOSURE)),
        (template::DOF_SETUP, own!(layout::EFFECT)),
        (template::DOF_SETUP_MS, own!(layout::EFFECT_DEPTH_MS)),
        (template::DOF_BLUR, own!(layout::BLOOM)),
        (template::DOF_FILTER, own!(layout::BLOOM)),
        (template::DOF_COMPOSITE, own!(layout::DOF_COMPOSITE)),
        (template::DOF_COMPOSITE_MS, own!(layout::DOF_COMPOSITE_MS)),
        (
            template::TRANSMISSION_COPY,
            own!(layout::WEIGHTED_COMPOSITE, layout::TRANSMISSION_COPY_MS),
        ),
        (template::SSR_REDUCE, own!(layout::SSR_REDUCE)),
        (template::SSR_TRACE, own!(layout::SSR_TRACE)),
        (template::PARTICLE, PARTICLE_MESH),
        (template::PARTICLE_MAP, PARTICLE_MESH),
        (template::PARTICLE_DEPTH, own!(layout::VIEW_COPY)),
        (template::PARTICLE_DEPTH_MS, own!(layout::PARTICLE_DEPTH_MS)),
        (template::FOG_LIGHT, &[&[layout::FRAME], &[layout::BLOOM]]),
        (template::FOG_SUM, own!(layout::BLOOM)),
        (template::FOG_APPLY, own!(layout::DOF_COMPOSITE)),
        (template::FOG_APPLY_MS, own!(layout::DOF_COMPOSITE_MS)),
        (template::DECAL, DECAL_MESH),
        (template::DECAL_MAPS, DECAL_MESH),
        (
            template::WEIGHTED_COMPOSITE,
            own!(layout::WEIGHTED_COMPOSITE),
        ),
        (template::WEIGHTED_DEPTH, own!(layout::WEIGHTED_DEPTH_MS)),
        (template::SUBSURFACE, MESH),
        (template::SUBSURFACE_MAPS, MESH),
        (template::SUBSURFACE_BLUR, own!(layout::SUBSURFACE_BLUR)),
        (
            template::SUBSURFACE_COMPOSITE,
            own!(layout::SUBSURFACE_COMPOSITE),
        ),
        (
            template::SUBSURFACE_COMPOSITE_MS,
            own!(layout::SUBSURFACE_COMPOSITE_MS),
        ),
        (template::FOG_BLOCK, own!(layout::BLOOM)),
        (template::PICK, MESH),
        (template::PICK_RESOLVE, own!(layout::VIEW_COPY)),
        (template::PICK_MAPS, MESH),
        (template::PICK_TEXTURE_MAPS, MESH),
        (template::PROBE_GRID, MESH),
        (template::PROBE_GRID_MAPS, MESH),
        (
            // A WebGL2 build reads the draw table at group 1 and the instances at 2, as every
            // mesh template does, then its maps at 3. A WebGPU build has no draw table and binds
            // its maps at group 1, after the frame group.
            template::MOTION,
            &[
                &[layout::MOTION_FRAME],
                &[layout::DRAWS, layout::TEXTURES],
                &[layout::INSTANCES],
                &[layout::TEXTURES],
            ],
        ),
        (
            template::MOTION_VIEW,
            &[&[layout::EFFECT, layout::EFFECT_DEPTH_MS]],
        ),
    ];

    /// The groups of a template's pipeline, group by group from group 0 on: each entry lists the
    /// layouts that a build may bind at that index. `None` for a template whose page decides the
    /// layouts, which the mock does not judge.
    pub fn of(template: u32) -> Option<&'static [&'static [u32]]> {
        if template >= template::CUSTOM_FIRST {
            return None;
        }
        TABLE
            .iter()
            .find(|(id, _)| *id == template)
            .map(|(_, groups)| *groups)
    }
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

    /// The bytes that the recorded words reserve and use.
    pub fn memory_use(&self) -> (usize, usize) {
        (
            self.words.capacity() * size_of::<u32>(),
            self.words.len() * size_of::<u32>(),
        )
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

/// The bind group layouts that the generated table lists, by name. Each id names one layout: two
/// layouts at one id make the render worker refuse to start.
const GENERATED_LAYOUTS: &[(&str, u32)] = &[
    ("FRAME", layout::FRAME),
    ("CULL", layout::CULL),
    ("DRAWS", layout::DRAWS),
    ("INSTANCES", layout::INSTANCES),
    ("FINAL", layout::FINAL),
    ("TEXTURES", layout::TEXTURES),
    ("MATERIAL_MAPS", layout::MATERIAL_MAPS),
    ("MATERIAL_MAPS_PARALLAX", layout::MATERIAL_MAPS_PARALLAX),
    ("MATERIAL_MAPS_SCENE", layout::MATERIAL_MAPS_SCENE),
    ("FRAME_PARALLAX", layout::FRAME_PARALLAX),
    ("DEPTH", layout::DEPTH),
    ("LIGHT_CLUSTERS", layout::LIGHT_CLUSTERS),
    ("LIGHT_DEPTH", layout::LIGHT_DEPTH),
    ("LIGHT_DEPTH_MS", layout::LIGHT_DEPTH_MS),
    ("BLOOM", layout::BLOOM),
    ("FINAL_BLOOM", layout::FINAL_BLOOM),
    ("JOINTS", layout::JOINTS),
    ("SKIN", layout::SKIN),
    ("COMPUTE_RGBA16_FLOAT", layout::COMPUTE_RGBA16_FLOAT),
    ("COMPUTE_R32_FLOAT", layout::COMPUTE_R32_FLOAT),
    ("COMPUTE_RGBA8_UNORM", layout::COMPUTE_RGBA8_UNORM),
    ("COMPUTE_INSTANCE_BUFFERS", layout::COMPUTE_INSTANCE_BUFFERS),
    ("FEATURE_ROWS", layout::FEATURE_ROWS),
    ("DEPTH_PYRAMID", layout::DEPTH_PYRAMID),
    ("AO_DEPTH", layout::AO_DEPTH),
    ("AO_DEPTH_MS", layout::AO_DEPTH_MS),
    ("AO", layout::AO),
    ("BACKGROUND", layout::BACKGROUND),
    ("INSTANCE_INDEX", layout::INSTANCE_INDEX),
    ("EFFECT", layout::EFFECT),
    ("EFFECT_DEPTH_MS", layout::EFFECT_DEPTH_MS),
    ("EFFECT_BLOOM", layout::EFFECT_BLOOM),
    ("EFFECT_BLOOM_DEPTH_MS", layout::EFFECT_BLOOM_DEPTH_MS),
    ("BACKGROUND_LAYER", layout::BACKGROUND_LAYER),
    ("FINAL_EFFECTS", layout::FINAL_EFFECTS),
    ("FINAL_EFFECTS_DEPTH_MS", layout::FINAL_EFFECTS_DEPTH_MS),
    ("VIEW_COPY", layout::VIEW_COPY),
    ("ACCUMULATE", layout::ACCUMULATE),
    ("DOF_COMPOSITE", layout::DOF_COMPOSITE),
    ("DOF_COMPOSITE_MS", layout::DOF_COMPOSITE_MS),
    ("MOTION_FRAME", layout::MOTION_FRAME),
    ("SSR_REDUCE", layout::SSR_REDUCE),
    ("SSR_TRACE", layout::SSR_TRACE),
    ("WEIGHTED_COMPOSITE", layout::WEIGHTED_COMPOSITE),
    ("WEIGHTED_DEPTH_MS", layout::WEIGHTED_DEPTH_MS),
    ("TRANSMISSION_COPY_MS", layout::TRANSMISSION_COPY_MS),
    ("CLUSTER_CULL", layout::CLUSTER_CULL),
    ("TAA", layout::TAA),
    ("TAA_MS", layout::TAA_MS),
    ("SUBSURFACE_BLUR", layout::SUBSURFACE_BLUR),
    ("SUBSURFACE_COMPOSITE", layout::SUBSURFACE_COMPOSITE),
    ("SUBSURFACE_COMPOSITE_MS", layout::SUBSURFACE_COMPOSITE_MS),
    ("DECAL_DEPTH", layout::DECAL_DEPTH),
    ("DECAL_DEPTH_MS", layout::DECAL_DEPTH_MS),
    ("DECAL_FRAME", layout::DECAL_FRAME),
    ("MATERIAL_SCENE", layout::MATERIAL_SCENE),
    ("PARTICLE", layout::PARTICLE),
    ("PARTICLE_SCENE_DEPTH", layout::PARTICLE_SCENE_DEPTH),
    ("PARTICLE_DEPTH_MS", layout::PARTICLE_DEPTH_MS),
    ("ATMOSPHERE", layout::ATMOSPHERE),
    ("EXPOSURE", layout::EXPOSURE),
];

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
                ("RGBA32_UINT", format::RGBA32_UINT),
                ("RG16_FLOAT", format::RG16_FLOAT),
                ("R16_FLOAT", format::R16_FLOAT),
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
        ("LAYOUT", GENERATED_LAYOUTS),
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
                ("ALPHA_TO_COVERAGE", state_flags::ALPHA_TO_COVERAGE),
                ("DEPTH_OR_EQUAL", state_flags::DEPTH_OR_EQUAL),
            ],
        ),
        ("TEMPLATE", &template::NAMES),
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
                ("MOTION_INSTANCE_STRIDE", sizes::MOTION_INSTANCE_STRIDE),
                ("INDEX_STRIDE", sizes::INDEX_STRIDE),
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
                (
                    "GRID_WORDS_PER_TEXTURE_ROW",
                    sizes::GRID_WORDS_PER_TEXTURE_ROW,
                ),
                ("DRAW_RECORD_BYTES", sizes::DRAW_RECORD_BYTES),
                ("MULTI_DRAW_RECORDS", sizes::MULTI_DRAW_RECORDS),
                ("MAX_MATERIALS", sizes::MAX_MATERIALS),
                ("MATERIAL_BYTES", sizes::MATERIAL_BYTES),
                ("MAP_SLOTS", sizes::MAP_SLOTS),
                ("SHARED_MAP_UNITS", sizes::SHARED_MAP_UNITS),
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
                (
                    "SHADOW_HERO_UNIFORM_BYTES",
                    sizes::SHADOW_HERO_UNIFORM_BYTES,
                ),
                ("BACKGROUND_UNIFORM_BYTES", sizes::BACKGROUND_UNIFORM_BYTES),
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
            format!("const MAX_RANGES: u32 = {}u;", sizes::MAX_CULL_RANGES),
            format!(
                "const PER_SOURCE_JOINT: u32 = {:#x}u;",
                sizes::PER_SOURCE_JOINT
            ),
            format!(
                "const INDEX_ROW_SHIFT: u32 = {}u;",
                sizes::INDICES_PER_TEXTURE_ROW.trailing_zeros()
            ),
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
        assert!(sizes::ROW_VALUES_PER_TEXTURE_ROW.is_power_of_two());
        assert_eq!(
            sizes::ROW_VALUE_TEXELS,
            2,
            "the shader reads two texels per row's values"
        );
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
            format!(
                "const VALUES_ROW_SHIFT: u32 = {}u;",
                shift(sizes::ROW_VALUES_PER_TEXTURE_ROW)
            ),
            // The texel of a material's row where the maps' own transforms start, one per vec4f:
            // the last fourteen of the row's texels, two for each of the seven maps.
            format!(
                "const MATERIAL_MAP_UV_TEXEL: u32 = {}u;",
                sizes::MATERIAL_BYTES / 16 - 14
            ),
            format!("const CELL_SHIFT: u32 = {}u;", sizes::CELL_SHIFT),
            format!("const MAX_CELLS: u32 = {}u;", sizes::MAX_CELLS),
            format!(
                "const OBJECT_RANGE_VECTORS: u32 = {}u;",
                sizes::OBJECT_RANGE_BYTES / 16
            ),
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
    fn permutation_bits_are_single_bits_with_their_names_shared_only_as_listed() {
        let mut seen = 0;
        for (k, (name, bit)) in permutation::NAMES.into_iter().enumerate() {
            assert!(bit.is_power_of_two(), "{name}");
            for (other, _) in permutation::NAMES[..k].iter().filter(|(_, b)| *b == bit) {
                let listed = permutation::SHARED
                    .iter()
                    .any(|&(a, b)| (a, b) == (*other, name) || (a, b) == (name, *other));
                assert!(listed, "{name} shares a bit with {other}");
            }
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
    fn engine_templates_have_unique_ids_below_the_custom_ones() {
        assert_eq!(template::CUSTOM_FIRST, 128);
        let mut ids: Vec<u32> = typescript_constants()
            .lines()
            .filter_map(|line| line.strip_prefix("export const TEMPLATE_"))
            .filter(|line| !line.starts_with("CUSTOM_FIRST "))
            .map(|line| line.split(" = ").nth(1).unwrap().trim_end_matches(';'))
            .map(|id| id.parse().unwrap())
            .collect();
        assert!(ids.len() > 40, "{} engine templates", ids.len());
        ids.sort_unstable();
        assert!(ids.windows(2).all(|pair| pair[0] < pair[1]), "{ids:?}");
        assert!(ids.iter().all(|&id| id > 0 && id < template::CUSTOM_FIRST));
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

    /// The generated table names each bind group layout once: two layouts at one id make the
    /// render worker refuse to start with E1405 when the pipelines are made.
    #[test]
    fn generated_layout_ids_are_unique() {
        let mut ids = std::collections::BTreeMap::new();
        for &(name, id) in GENERATED_LAYOUTS {
            if let Some(first) = ids.insert(id, name) {
                panic!("{name} and {first} both take layout {id}");
            }
        }
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

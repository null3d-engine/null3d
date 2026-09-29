//! Binary draw lists: every GPU command the engine issues, as 32-bit words in shared memory.
//!
//! Any thread can record a draw list, so recording runs in parallel on the job workers; the thread
//! that owns the GPU replays the lists in order. Each command starts with a header word holding the
//! opcode in its low 8 bits and the command's length in words (header included) above them, so a
//! decoder can check every command and step over it. Operands are `u32`, or `f32` and `i32` stored
//! as their bits.

/// Command opcodes. The TypeScript replay loop uses the generated constants in
/// `packages/engine/src/generated/gpu.ts`, which a test keeps equal to these values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Op {
    /// [buffer id, size in bytes, usage flags]
    CreateBuffer = 1,
    /// [buffer id, destination offset, source address in engine memory, byte length]
    WriteBuffer = 2,
    /// [buffer id]
    DestroyBuffer = 3,
    /// [texture id, width, height, layers, format, usage flags, sample count, mip levels]
    CreateTexture = 4,
    /// [texture id]
    DestroyTexture = 5,
    /// [width, height]: the canvas's drawing buffer size in device pixels. Recorded in the frame
    /// built for that size, so the canvas and the frame's render targets always match.
    ResizeCanvas = 6,
    /// [render pipeline id, template, permutation bits, color format, depth format, sample count, state flags]
    CreateRenderPipeline = 7,
    /// [compute pipeline id, template, permutation bits]
    CreateComputePipeline = 8,
    /// [bind group id, standard layout, entry count, then per entry: binding, resource kind,
    /// resource id, offset, size]
    CreateBindGroup = 9,
    /// [buffer id, offset, size]
    ClearBuffer = 10,
    /// [texture id, x, y, width, height, source address in engine memory, byte length]: writes a
    /// rectangle of a data texture from tightly packed rows.
    WriteTexture = 11,
    /// [color target texture id or 0 for the canvas, resolve target texture id or 0 for the
    /// canvas or `NO_TARGET`, depth texture id or `NO_TARGET`, clear red, green, blue, alpha (f32),
    /// clear depth (f32), pass flags]
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
    /// []: submits everything recorded since the previous submit.
    Submit = 63,
}

impl Op {
    pub const ALL: [Op; 30] = [
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
        Op::BeginBundle,
        Op::EndBundle,
        Op::BeginComputePass,
        Op::SetComputePipeline,
        Op::Dispatch,
        Op::EndComputePass,
        Op::CopyBufferToBuffer,
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
            Op::BeginBundle => "BEGIN_BUNDLE",
            Op::EndBundle => "END_BUNDLE",
            Op::BeginComputePass => "BEGIN_COMPUTE_PASS",
            Op::SetComputePipeline => "SET_COMPUTE_PIPELINE",
            Op::Dispatch => "DISPATCH",
            Op::EndComputePass => "END_COMPUTE_PASS",
            Op::CopyBufferToBuffer => "COPY_BUFFER_TO_BUFFER",
            Op::Submit => "SUBMIT",
        }
    }
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
    pub const RENDER_ATTACHMENT: u32 = 0x10;
    /// Only after checking `Capabilities::TRANSIENT_ATTACHMENTS`.
    pub const TRANSIENT_ATTACHMENT: u32 = 0x20;
}

/// Texture formats, by engine code. The replay loop maps each code to the browser's format name;
/// `CANVAS` means the canvas's preferred format.
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
}

/// Bits of a render pipeline's permutation word, which pick a shader variant.
pub mod permutation {
    /// The vertex shader reads its draw's index, from `WEBGL_multi_draw`.
    pub const DRAW_INDEX: u32 = 1;
}

/// Bits of a render pipeline's state flags.
pub mod state_flags {
    /// Draws both faces of each triangle.
    pub const CULL_NONE: u32 = 1;
}

/// Sizes of the data that the render pipelines read. The shaders in `crates/null3d-shaders/wgsl/`
/// declare the same sizes, and a test checks that they agree.
pub mod sizes {
    /// Bytes per mesh vertex: a position and a normal, three floats each.
    pub const VERTEX_STRIDE: u32 = 24;
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
    /// Materials in the material table; as a uniform block this is 16 KiB, the largest block
    /// every WebGL2 device allows.
    pub const MAX_MATERIALS: u32 = 1024;
}

/// Shader templates for `CreateRenderPipeline` and `CreateComputePipeline`.
pub mod template {
    /// Instanced meshes with Lambert lighting.
    pub const INSTANCED_LIT: u32 = 1;
    /// Instanced meshes without lighting.
    pub const INSTANCED_UNLIT: u32 = 2;
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
    let groups: [(&str, &[(&str, u32)]); 11] = [
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
            ],
        ),
        ("PERMUTATION", &[("DRAW_INDEX", permutation::DRAW_INDEX)]),
        ("STATE", &[("CULL_NONE", state_flags::CULL_NONE)]),
        (
            "TEMPLATE",
            &[
                ("INSTANCED_LIT", template::INSTANCED_LIT),
                ("INSTANCED_UNLIT", template::INSTANCED_UNLIT),
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
                ("RENDER_ATTACHMENT", texture_usage::RENDER_ATTACHMENT),
                ("TRANSIENT_ATTACHMENT", texture_usage::TRANSIENT_ATTACHMENT),
            ],
        ),
        (
            "SIZE",
            &[
                ("VERTEX_STRIDE", sizes::VERTEX_STRIDE),
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
            ],
        ),
    ];
    for (prefix, entries) in groups {
        for (name, value) in entries {
            out.push_str(&format!("export const {prefix}_{name} = {value};\n"));
        }
        out.push('\n');
    }
    out.pop();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_culling_shader_declares_the_same_sizes() {
        let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
        let workgroup = format!("@workgroup_size({})", sizes::CULL_WORKGROUP_SIZE);
        let words = format!("const INDIRECT_WORDS: u32 = {}u;", sizes::INDIRECT_WORDS);
        assert!(cull.contains(&workgroup), "cull.wgsl lacks {workgroup}");
        assert!(cull.contains(&words), "cull.wgsl lacks {words}");
    }

    #[test]
    fn the_mesh_shader_declares_the_same_sizes() {
        let mesh = include_str!("../../null3d-shaders/wgsl/mesh.wgsl");
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
        ] {
            assert!(mesh.contains(&line), "mesh.wgsl lacks {line}");
        }
        assert_eq!(sizes::DRAW_RECORD_BYTES, 16, "a draw record is one vec4u");
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

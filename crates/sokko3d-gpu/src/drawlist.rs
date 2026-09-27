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
    /// [render pipeline id, template, permutation bits, color format, depth format, sample count, state flags]
    CreateRenderPipeline = 7,
    /// [compute pipeline id, template, permutation bits]
    CreateComputePipeline = 8,
    /// [bind group id, standard layout, entry count, then per entry: binding, resource kind,
    /// resource id, offset, size]
    CreateBindGroup = 9,
    /// [buffer id, offset, size]
    ClearBuffer = 10,
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
    pub const ALL: [Op; 27] = [
        Op::CreateBuffer,
        Op::WriteBuffer,
        Op::DestroyBuffer,
        Op::CreateTexture,
        Op::DestroyTexture,
        Op::CreateRenderPipeline,
        Op::CreateComputePipeline,
        Op::CreateBindGroup,
        Op::ClearBuffer,
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
            Op::CreateRenderPipeline => "CREATE_RENDER_PIPELINE",
            Op::CreateComputePipeline => "CREATE_COMPUTE_PIPELINE",
            Op::CreateBindGroup => "CREATE_BIND_GROUP",
            Op::ClearBuffer => "CLEAR_BUFFER",
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
        "// Generated by `cargo test -p sokko3d-gpu` from crates/sokko3d-gpu/src/drawlist.rs.\n\
         // Do not edit: set SOKKO3D_UPDATE_GENERATED=1 and run that command to rewrite it.\n\n",
    );
    for op in Op::ALL {
        out.push_str(&format!("export const OP_{} = {};\n", op.name(), op as u8));
    }
    out.push_str(&format!("\nexport const NO_TARGET = {NO_TARGET};\n\n"));
    let groups: [(&str, &[(&str, u32)]); 7] = [
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
            &[("FRAME", layout::FRAME), ("CULL", layout::CULL)],
        ),
        (
            "TEMPLATE",
            &[
                ("INSTANCED_LIT", template::INSTANCED_LIT),
                ("INSTANCED_UNLIT", template::INSTANCED_UNLIT),
                ("CULL", template::CULL),
            ],
        ),
        (
            "TEXTURE_USAGE",
            &[("TRANSIENT_ATTACHMENT", texture_usage::TRANSIENT_ATTACHMENT)],
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
        if std::env::var_os("SOKKO3D_UPDATE_GENERATED").is_some() {
            std::fs::write(path, &expected).unwrap();
        }
        let actual = std::fs::read_to_string(path).unwrap_or_default();
        assert!(
            actual == expected,
            "{path} is out of date: run `SOKKO3D_UPDATE_GENERATED=1 cargo test -p sokko3d-gpu`"
        );
    }
}

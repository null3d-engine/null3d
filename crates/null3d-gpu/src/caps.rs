//! Capability flags and the portable limits budget.
//!
//! The page reads what the device offers once, at startup, from feature tests, and passes the
//! result in as flags and reported limits. Engine code checks flags, never browser or GPU names.

/// A set of capability flags.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Capabilities(pub u64);

impl Capabilities {
    /// Compute shaders.
    pub const COMPUTE: Self = Self(1 << 0);
    /// Draws whose counts the GPU reads from a buffer.
    pub const INDIRECT_DRAW: Self = Self(1 << 1);
    /// Storage buffers readable from vertex shaders (absent in much of compatibility mode).
    pub const STORAGE_IN_VERTEX: Self = Self(1 << 2);
    /// Many draws in one call (`WEBGL_multi_draw`).
    pub const MULTI_DRAW: Self = Self(1 << 3);
    /// BC texture compression.
    pub const TEXTURE_BC: Self = Self(1 << 4);
    /// ETC2 texture compression.
    pub const TEXTURE_ETC2: Self = Self(1 << 5);
    /// ASTC texture compression.
    pub const TEXTURE_ASTC: Self = Self(1 << 6);
    /// Filtering of 32-bit float textures.
    pub const FLOAT32_FILTERABLE: Self = Self(1 << 7);
    /// GPU timestamp queries.
    pub const TIMESTAMP_QUERY: Self = Self(1 << 8);
    /// MSAA on 16-bit float render targets (absent in compatibility mode).
    pub const MSAA_FLOAT16: Self = Self(1 << 9);
    /// Render targets that may stay in tile memory.
    pub const TRANSIENT_ATTACHMENTS: Self = Self(1 << 10);
    /// 16-bit floats in shaders.
    pub const SHADER_F16: Self = Self(1 << 11);
    /// Rendering to `rg11b10ufloat`.
    pub const RG11B10_RENDERABLE: Self = Self(1 << 12);
    /// Blending on 32-bit float targets.
    pub const FLOAT32_BLENDABLE: Self = Self(1 << 13);
    /// Subgroup operations in shaders.
    pub const SUBGROUPS: Self = Self(1 << 14);
    /// Reserved for 64-bit atomics; no browser offers them yet, so always off.
    pub const ATOMIC64: Self = Self(1 << 32);
    /// Reserved for bindless resources; always off.
    pub const BINDLESS: Self = Self(1 << 33);
    /// Reserved for mesh shaders; always off.
    pub const MESH_SHADERS: Self = Self(1 << 34);
    /// Reserved for ray queries; always off.
    pub const RAY_QUERY: Self = Self(1 << 35);

    /// Flags reserved for features no browser ships yet.
    pub const RESERVED: Self =
        Self(Self::ATOMIC64.0 | Self::BINDLESS.0 | Self::MESH_SHADERS.0 | Self::RAY_QUERY.0);

    pub const fn empty() -> Self {
        Self(0)
    }

    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    /// The flags as reported by the page, with every reserved flag cleared.
    pub const fn from_bits(bits: u64) -> Self {
        Self(bits & !Self::RESERVED.0)
    }
}

/// Every limit the engine reads, in the order the page reports them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Limit {
    BindGroups = 0,
    BufferSize,
    ColorAttachments,
    ColorAttachmentBytesPerSample,
    ComputeInvocationsPerWorkgroup,
    ComputeWorkgroupSizeX,
    ComputeWorkgroupStorageSize,
    InterStageShaderVariables,
    SampledTexturesPerShaderStage,
    StorageBufferBindingSize,
    StorageBuffersPerShaderStage,
    StorageBuffersInVertexStage,
    StorageBuffersInFragmentStage,
    TextureArrayLayers,
    TextureDimension2D,
    UniformBufferBindingSize,
    VertexAttributes,
    VertexBuffers,
}

/// Number of limits the engine reads.
pub const LIMIT_COUNT: usize = 18;

/// The portable budget: WebGPU's default limits, lowered where compatibility mode is lower.
pub const BUDGET: [u32; LIMIT_COUNT] = [
    4,                 // bind groups (the engine's pipelines use 2 on WebGPU)
    256 * 1024 * 1024, // buffer size
    4,                 // color attachments
    32,                // color bytes per sample
    128,               // compute invocations per workgroup
    128,               // compute workgroup size X and Y
    16 * 1024,         // compute workgroup storage
    15,                // inter-stage variables
    16,                // sampled textures per stage
    128 * 1024 * 1024, // storage buffer binding size
    8,                 // storage buffers per stage
    0,                 // storage buffers in the vertex stage
    4,                 // storage buffers in the fragment stage
    256,               // texture array layers
    4096,              // 2D texture size
    16 * 1024,         // uniform buffer binding size
    16,                // vertex attributes, counting the vertex and instance index built-ins
    8,                 // vertex buffers
];

/// Every buffer offset the engine binds dynamically aligns to this many bytes, the largest
/// alignment any tested browser requires.
pub const OFFSET_ALIGNMENT: u32 = 256;

/// Rounds `value` up to the next multiple of `alignment`, which must be a power of two.
pub const fn align_up(value: u32, alignment: u32) -> u32 {
    (value + alignment - 1) & !(alignment - 1)
}

/// The limits the engine uses: the budget, lowered further where the device reports less.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits(pub [u32; LIMIT_COUNT]);

impl Limits {
    /// Combines the reported limits with the budget. A limit the device does not report counts as
    /// absent, so the budget value applies: it never counts as zero.
    pub fn from_reported(reported: &[Option<u32>; LIMIT_COUNT]) -> Self {
        let mut limits = BUDGET;
        for (limit, value) in limits.iter_mut().zip(reported) {
            if let Some(value) = value {
                *limit = (*limit).min(*value);
            }
        }
        Self(limits)
    }

    pub fn get(&self, limit: Limit) -> u32 {
        self.0[limit as usize]
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self(BUDGET)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_flags_are_always_off() {
        let caps = Capabilities::from_bits(u64::MAX);
        assert!(caps.contains(Capabilities::COMPUTE));
        assert!(!caps.contains(Capabilities::ATOMIC64));
        assert!(!caps.contains(Capabilities::MESH_SHADERS));
    }

    #[test]
    fn missing_limits_count_as_absent_not_zero() {
        let mut reported = [None; LIMIT_COUNT];
        reported[Limit::TextureDimension2D as usize] = Some(8192);
        reported[Limit::StorageBuffersPerShaderStage as usize] = Some(4);
        let limits = Limits::from_reported(&reported);
        assert_eq!(
            limits.get(Limit::TextureDimension2D),
            4096,
            "the budget caps a larger report"
        );
        assert_eq!(
            limits.get(Limit::StorageBuffersPerShaderStage),
            4,
            "a smaller report lowers the budget"
        );
        assert_eq!(
            limits.get(Limit::UniformBufferBindingSize),
            16 * 1024,
            "a missing limit keeps the budget"
        );
    }

    #[test]
    fn alignment_rounds_up_to_the_offset_alignment() {
        assert_eq!(align_up(0, OFFSET_ALIGNMENT), 0);
        assert_eq!(align_up(1, OFFSET_ALIGNMENT), 256);
        assert_eq!(align_up(256, OFFSET_ALIGNMENT), 256);
        assert_eq!(align_up(257, OFFSET_ALIGNMENT), 512);
    }
}

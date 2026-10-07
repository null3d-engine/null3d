//! Numbers TypeScript shares with the engine core, written out as a generated TypeScript module so
//! neither side copies them by hand.

use null3d_core::animation::{
    Channel, DEFAULT_RATE, EVENT_CAPACITY, EVENT_WORDS, Interpolation, MAX_BLEND, MAX_CLIP_KEYS,
    MAX_LAYERS as MAX_ANIMATION_LAYERS, NO_SOURCE, REST_FLOATS, TRACK_WORDS, event_kind,
};
use null3d_core::cells::CELL_SIZE;
use null3d_core::handle::{DEAD_GENERATION, GENERATION_BITS, SLOT_BITS};
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::{color as light_color, kind as light_kind, value as light_value};
use null3d_core::lines::LineMode;
use null3d_core::scene::{NO_PARENT, flags, op};
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::caps::{CUBE_TEXTURE_SIZE, Capabilities};
use null3d_gpu::drawlist::{address, filter, format, sizes, upload_flags};
use null3d_render::arrays::ArrayName;
use null3d_render::cpu_culled::{CpuCulledConfig, MAX_SOURCE_BITS};
use null3d_render::frame::{NO_MATERIAL, NO_MESH};
use null3d_render::geometry::Shape;
use null3d_render::gpu_driven::{MAX_USEFUL_BINDING_BYTES, PORTABLE_MAX_SOURCES};
use null3d_render::materials::{feature, param};
use null3d_render::output::{Antialias, ToneMapping};
use null3d_render::textures::{DEFAULT_MAX_ANISOTROPY, DEFAULT_UPLOAD_BUDGET, MAX_LAYERS};
use null3d_render::{debug_view, fog};

/// Fields of `sceneArrays`.
pub mod scene_field {
    pub const POSITIONS: u32 = 0;
    pub const ROTATIONS: u32 = 1;
    pub const SCALES: u32 = 2;
    pub const LOCAL_RADII: u32 = 3;
    pub const DIRTY_WORDS: u32 = 4;
    pub const LOCAL_CENTERS: u32 = 5;
    pub const POSITION_CELLS: u32 = 6;
}

/// Fields of `batchArrays`.
pub mod batch_field {
    pub const POSITIONS: u32 = 0;
    pub const ROTATIONS: u32 = 1;
    pub const SCALES: u32 = 2;
    pub const COLORS: u32 = 3;
    /// A sprite batch's sizes, 2 floats a row.
    pub const SIZES: u32 = 4;
    /// A sprite batch's atlas frames, one 32-bit integer a row.
    pub const FRAMES: u32 = 5;
}

/// Fields of `debugLineArrays`.
pub mod debug_line_field {
    pub const POSITIONS: u32 = 0;
    pub const COLORS: u32 = 1;
}

/// Fields of `commandRing`.
pub mod ring_field {
    pub const RECORDS: u32 = 0;
    pub const CAPACITY: u32 = 1;
    pub const WRITE_INDEX: u32 = 2;
    pub const READ_INDEX: u32 = 3;
}

/// 32-bit words in one command record.
pub const COMMAND_WORDS: u32 = 4;

/// How a material shades, as `createMaterial` takes it.
pub mod shading {
    /// The standard material, lit as three.js's `MeshStandardMaterial`.
    pub const LIT: u32 = 0;
    /// The base color only, as three.js's `MeshBasicMaterial`.
    pub const UNLIT: u32 = 1;
    /// The first texture coordinates as red and green, for the engine's own tests.
    pub const TEXCOORDS: u32 = 2;
    /// The base color times the material's map, as three.js's `MeshBasicMaterial` with a `map`.
    pub const UNLIT_MAP: u32 = 3;
    /// Sprites, as three.js's `SpriteMaterial` draws them, for the rows of a sprite batch only.
    pub const SPRITE: u32 = 4;
    /// Wide lines, as three.js's `LineMaterial` draws them, for the rows of a line batch only.
    pub const LINE: u32 = 5;
    /// Wide lines lit as a standard material that faces the camera, for the rows of a line batch
    /// only.
    pub const LINE_LIT: u32 = 7;
    /// The first custom material: a shading from here up is a custom material's. Its low 16 bits
    /// are the render pipeline template of the material's compiled WGSL.
    pub const CUSTOM_FIRST: u32 = null3d_gpu::drawlist::template::CUSTOM_FIRST;
    /// Where a custom shading holds the optional vertex attributes (`vertex::*` bits) that its
    /// vertex stage reads.
    pub const CUSTOM_ATTRIBUTE_SHIFT: u32 = 16;
    /// The bit of a custom shading whose shader reads the material's base color and opacity, as the
    /// standard template does.
    pub const CUSTOM_BASE_COLOR: u32 = 1 << 24;
    /// Where a custom shading holds the number of textures that its WGSL declares, from 0 to the
    /// map slots of a row, in 3 bits.
    pub const CUSTOM_TEXTURE_SHIFT: u32 = 25;
}

/// The map slots that `setMaterialMap` takes, in the order of a material's row.
pub mod map_slot {
    use null3d_render::materials::MapSlot;

    pub const BASE_COLOR: u32 = MapSlot::BaseColor as u32;
    pub const METAL_ROUGH: u32 = MapSlot::MetalRough as u32;
    pub const NORMAL: u32 = MapSlot::Normal as u32;
    pub const OCCLUSION: u32 = MapSlot::Occlusion as u32;
    pub const EMISSIVE: u32 = MapSlot::Emissive as u32;
    pub const LIGHT: u32 = MapSlot::Light as u32;
    pub const SPECULAR_INTENSITY: u32 = MapSlot::SpecularIntensity as u32;
    pub const SPECULAR_COLOR: u32 = MapSlot::SpecularColor as u32;
}

/// The flags of an effect that `setEffect` takes.
pub mod effect_flag {
    /// The effect reads the scene's depth.
    pub const DEPTH: u32 = 1;
}

/// The numbers that `textureStat` reads from the texture store.
/// The places of the post-processing values in the block that `postValues` gives: 32-bit floats
/// that TypeScript writes before it calls `setOutput`, `setBloom`, `setLut` or `setVignette`. The
/// values come through engine memory, not as arguments, because the browser stores each fraction
/// that it passes to a call it does not inline in an object of its own.
pub mod post_value {
    /// The exposure.
    pub const EXPOSURE: u32 = 0;
    /// Bloom's intensity, threshold and the threshold's soft edge.
    pub const BLOOM_INTENSITY: u32 = 1;
    pub const BLOOM_THRESHOLD: u32 = 2;
    pub const BLOOM_KNEE: u32 = 3;
    /// The color grading table's intensity.
    pub const LUT_INTENSITY: u32 = 4;
    /// The colors of the table's first texels, red first, then of its last texels.
    pub const LUT_DOMAIN_MIN: u32 = 5;
    pub const LUT_DOMAIN_MAX: u32 = 8;
    /// The vignette's offset and darkness.
    pub const VIGNETTE_OFFSET: u32 = 11;
    pub const VIGNETTE_DARKNESS: u32 = 12;
    /// Ambient occlusion's radius, thickness, distance exponent, distance falloff, scale, samples
    /// and intensity.
    pub const AO_RADIUS: u32 = 13;
    pub const AO_THICKNESS: u32 = 14;
    pub const AO_DISTANCE_EXPONENT: u32 = 15;
    pub const AO_DISTANCE_FALLOFF: u32 = 16;
    pub const AO_SCALE: u32 = 17;
    pub const AO_SAMPLES: u32 = 18;
    pub const AO_INTENSITY: u32 = 19;
    /// The outline's linear line color, red first, then its linear color around hidden parts.
    pub const OUTLINE_COLOR: u32 = 20;
    pub const OUTLINE_HIDDEN_COLOR: u32 = 23;
    /// 1 where the outline draws around hidden parts, else 0, then the line's width in CSS pixels.
    pub const OUTLINE_HIDDEN: u32 = 26;
    pub const OUTLINE_WIDTH: u32 = 27;
    /// Bloom's blend (0 mixes, 1 adds, 2 screens), then the share of each of its 10 levels.
    pub const BLOOM_BLEND: u32 = 28;
    pub const BLOOM_WEIGHTS: u32 = 29;
    /// The values in the block.
    pub const COUNT: u32 = 39;
}

/// The places of the environment's values in the block that `environmentValues` gives: 32-bit
/// floats that TypeScript writes before it calls `setEnvironment`, as the post-processing values
/// come.
pub mod environment_value {
    /// The factor of the environment's light.
    pub const INTENSITY: u32 = 0;
    /// The environment's turn as Euler angles in radians, in the order X, Y, Z.
    pub const ROTATION: u32 = 1;
    /// The nine coefficients of its diffuse light: red, green and blue for each.
    pub const SH: u32 = 4;
    /// The values in the block.
    pub const COUNT: u32 = 31;
}

pub mod texture_stat {
    /// The GPU bytes that every texture array holds, free layers included.
    pub const MEMORY_BYTES: u32 = 0;
    /// The GPU bytes of one texture: its layer, with every mip level.
    pub const TEXTURE_BYTES: u32 = 1;
    /// Texel bytes that the last recorded frame uploads.
    pub const LAST_FRAME_BYTES: u32 = 2;
    /// The most texel bytes that any frame uploaded.
    pub const LARGEST_FRAME_BYTES: u32 = 3;
    /// Textures with an image that is not on the GPU yet.
    pub const WAITING: u32 = 4;
    /// The last image id handed out, or 0 before the first.
    pub const IMAGES_SENT: u32 = 5;
    /// The widest and tallest texture the store takes.
    pub const MAX_SIZE: u32 = 6;
    /// The texel bytes that one frame may upload.
    pub const UPLOAD_BUDGET: u32 = 7;
    /// The largest anisotropy that samplers use.
    pub const MAX_ANISOTROPY: u32 = 8;
    /// The GPU bytes that the textures may take, or 0 for no budget.
    pub const MEMORY_BUDGET: u32 = 9;
    /// The largest mip levels of one texture that the memory budget dropped.
    pub const DROPPED_LEVELS: u32 = 10;
    /// The mip levels that the memory budget dropped from every texture.
    pub const DROPPED_TOTAL: u32 = 11;
    /// The textures that the memory budget dropped levels from.
    pub const DROPPED_TEXTURES: u32 = 12;
    /// A number that changes with each drop, each load again asked for and each swap.
    pub const BUDGET_EPOCH: u32 = 13;
    /// The dropped levels that one texture's load again asks for.
    pub const RELOAD_LEVEL: u32 = 14;
    /// The hidden texture that takes the texels of one texture's load again.
    pub const RELOAD_TEXTURE: u32 = 15;
}

/// The parts of the number that `shadowCasters` returns.
pub mod shadow_casters {
    /// The bits that hold the main directional light's shadow cascades, 0 when it casts none.
    pub const CASCADE_MASK: u32 = 0xff;
    /// Set when point or spot lights cast shadows into the shadow atlas.
    pub const TILES: u32 = 1 << 8;
}

/// What a camera's lens is for, in `setPerspectiveCamera` and `setOrthographicCamera`.
pub mod camera_target {
    /// The camera's view, which draws the frame.
    pub const VIEW: u32 = 0;
    /// The camera that fits the main directional light's cascades, for the debug API.
    pub const SHADOWS: u32 = 1;
}

/// The settings that `setTextureOption` changes.
pub mod texture_option {
    /// The texel bytes that one frame may upload.
    pub const UPLOAD_BUDGET: u32 = 0;
    /// The largest anisotropy that samplers use.
    pub const MAX_ANISOTROPY: u32 = 1;
    /// Any value makes the next recorded frame upload every image that arrived, whatever its
    /// budget, as a held frame must.
    pub const UPLOAD_ALL: u32 = 2;
    /// The GPU memory that the textures may take, in KiB, or 0 for no budget.
    pub const MEMORY_BUDGET_KIB: u32 = 3;
}

/// The arrays that `createMeshFromArrays` finds in the staging words, and what it does with them.
/// The staging words hold, one after another, the positions and each array present in this
/// order, as 32-bit floats, then the indices, as 32-bit unsigned integers.
pub mod mesh_arrays {
    pub const NORMALS: u32 = 1;
    pub const UVS: u32 = 2;
    pub const UVS1: u32 = 4;
    /// Colors of three values per vertex, or four with `COLORS_ALPHA`.
    pub const COLORS: u32 = 8;
    pub const COLORS_ALPHA: u32 = 16;
    pub const TANGENTS: u32 = 32;
    pub const INDICES: u32 = 64;
    pub const COMPUTE_NORMALS: u32 = 128;
    pub const COMPUTE_TANGENTS: u32 = 256;
    pub const JOINTS: u32 = 512;
    pub const WEIGHTS: u32 = 1024;
}

/// The morph target arrays that `createMeshFromArrays` finds in the staging words after the
/// indices: the deltas of the positions, the normals and the tangents, each three 32-bit floats
/// per vertex of each target, then of the colors, four 32-bit floats per vertex of each target,
/// target after target, in this order.
pub mod morph_arrays {
    pub const POSITIONS: u32 = 1;
    pub const NORMALS: u32 = 2;
    pub const TANGENTS: u32 = 4;
    pub const COLORS: u32 = 8;
}

/// The first detail of an E1206 failure: what is wrong with the arrays. The second detail is the
/// array's code, or for the last two problems the element's place.
pub mod arrays_problem {
    pub const NO_VERTICES: u32 = 1;
    pub const LENGTH: u32 = 2;
    pub const NOT_TRIANGLES: u32 = 3;
    pub const TWICE: u32 = 4;
    pub const MISSING: u32 = 5;
    /// The second detail is the place of the index in the indices.
    pub const INDEX_OUT_OF_RANGE: u32 = 6;
    /// The array's type of number is not one that its attribute takes.
    pub const TYPE: u32 = 7;
    /// The morph targets move one vertex more than 255 times, or every mesh's morph targets
    /// together pass what the engine holds. The second detail is that limit in texels.
    pub const MORPH_TOO_LARGE: u32 = 8;
    /// A morph target array does not hold its values per vertex of each target. The second
    /// detail is the array: 0 for positions, 1 for normals, 2 for tangents and 3 for colors.
    pub const MORPH_LENGTH: u32 = 9;
    /// A morph target delta is NaN or infinite. The second detail is its place, and the array's
    /// number, as in `MORPH_LENGTH`, times 2^28.
    pub const MORPH_NOT_FINITE: u32 = 10;
    /// Plus the array's code; the second detail is the place of the value in the array.
    pub const NOT_FINITE: u32 = 16;
}

/// The arrays of the animation table that `animationArrays` returns.
pub mod animation_field {
    /// The clip of each sample slot, as 32-bit unsigned integers.
    pub const SLOT_CLIPS: u32 = 0;
    /// The time in seconds of each sample slot.
    pub const SLOT_TIMES: u32 = 1;
    /// The weight of each sample slot.
    pub const SLOT_WEIGHTS: u32 = 2;
    /// The skinning matrices: twelve floats per joint of each instance.
    pub const MATRICES: u32 = 3;
    /// The rate of each instance's time, which TypeScript writes.
    pub const TIME_SCALES: u32 = 4;
    /// The weight of each layer of each instance, `MAX_LAYERS` per instance, which TypeScript
    /// writes.
    pub const LAYER_WEIGHTS: u32 = 5;
    /// The last frame step's event records, `EVENT_WORDS` 32-bit words each.
    pub const EVENTS: u32 = 6;
    /// Two words: the last frame step's event records, and the events that did not fit.
    pub const EVENT_TOTALS: u32 = 7;
    /// The clip that a play put in each sample slot, as 32-bit unsigned integers, or
    /// `NO_SOURCE` for a slot that no play fills.
    pub const SLOT_SOURCES: u32 = 8;
    /// The blend value of each layer of each instance, `MAX_LAYERS` per instance, which
    /// TypeScript writes.
    pub const BLEND_VALUES: u32 = 9;
    /// The numbers of the next `animatorPlay` or `animatorPlayBlend` call, `play_arg::COUNT`
    /// floats, which TypeScript writes before the call.
    pub const PLAY_ARGS: u32 = 10;
}

/// The places of the numbers in the `PLAY_ARGS` array. The numbers cross in engine memory, not as
/// call arguments, so a play allocates nothing in the browser whatever numbers its options hold.
pub mod play_arg {
    /// Seconds of the fade.
    pub const FADE: usize = 0;
    /// The rate of the clip's time, or of the blend.
    pub const SPEED: usize = 1;
    /// The start time in seconds, or the blend's start phase.
    pub const TIME: usize = 2;
    /// The clip's weight.
    pub const WEIGHT: usize = 3;
    /// The blend's value.
    pub const VALUE: usize = 4;
    /// The numbers in the array.
    pub const COUNT: usize = 5;
}

/// What `clipReady` returns while a job worker still resamples the clip: no clip id reaches it.
pub const CLIP_PENDING: u32 = u32::MAX;

/// The bits of `animatorPlay`'s and `animatorPlayBlend`'s `flags`.
pub mod play_flag {
    /// The clip repeats.
    pub const LOOP: u32 = 1;
    /// The clip adds its change from its first frame to the pose.
    pub const ADDITIVE: u32 = 2;
    /// The play gives a start time, or a blend a start phase.
    pub const TIME: u32 = 4;
    /// The play gives the clip's weight.
    pub const WEIGHT: u32 = 8;
    /// The clip plays beside the other clips of its layer.
    pub const JOIN: u32 = 16;
    /// The blend gives its layer's blend value.
    pub const VALUE: u32 = 32;
}

/// The first detail of an E1218 failure: what is wrong with the animation data. The second detail
/// says where, as each problem documents.
pub mod animation_problem {
    /// The second detail is the joint count.
    pub const JOINTS: u32 = 1;
    /// The second detail is the joint whose parent is not before it.
    pub const PARENT: u32 = 2;
    /// The second detail is 0 for the rest pose and 1 for the inverse bind matrices.
    pub const LENGTH: u32 = 3;
    /// The second detail is the joint whose value is NaN or infinite.
    pub const NOT_FINITE: u32 = 4;
    /// The second detail is the keys the clip would hold, its frames times its tracks, which pass
    /// the core's limit per clip.
    pub const KEYS: u32 = 5;
    /// The second detail is the skeleton id.
    pub const UNKNOWN_SKELETON: u32 = 6;
    /// The second detail is the clip's joint count.
    pub const WRONG_SKELETON: u32 = 7;
    /// The second detail is the clip event whose time is out of range or not finite.
    pub const EVENTS: u32 = 8;
    /// The second detail is the joint whose mask weight lies outside 0 to 1, or the weight count.
    pub const MASK: u32 = 9;
    /// The second detail is 0 for the fade and 1 for the speed.
    pub const PLAY: u32 = 10;
    /// The second detail is the instance id.
    pub const UNKNOWN_INSTANCE: u32 = 11;
    /// The second detail is the clip id.
    pub const UNKNOWN_CLIP: u32 = 12;
    /// The second detail is the layer.
    pub const LAYER: u32 = 13;
    /// The second detail is the mask id.
    pub const UNKNOWN_MASK: u32 = 14;
    /// Plus the track problem's number (`TrackProblem`); the second detail is the track.
    pub const TRACK: u32 = 16;
}

/// Raycasts and overlap queries: the arrays `queryArrays` names, the query kinds, and the layout
/// of the numbers they read and write. Every array holds 64-bit floats.
pub mod query {
    /// The query's input: a ray's origin and direction, then its far limit; a sphere's centre,
    /// then its radius at the far limit's place; or a box's lowest and highest corners.
    pub const INPUT: u32 = 0;
    /// The hit records that queries write, `HIT_FLOATS` numbers each.
    pub const HITS: u32 = 1;
    /// How many hit records the hit array holds now; it moves when it grows.
    pub const HIT_CAPACITY: u32 = 2;
    /// The rays of a batch, `RAY_FLOATS` numbers each: origin, then direction.
    pub const RAYS: u32 = 3;

    /// Numbers in the input array.
    pub const INPUT_FLOATS: u32 = 8;
    /// Where the input holds the far limit or the radius.
    pub const INPUT_LIMIT: u32 = 6;
    /// Numbers per ray of a batch.
    pub const RAY_FLOATS: u32 = 6;

    /// Numbers per hit record.
    pub const HIT_FLOATS: u32 = 11;
    /// The object's slot, or 0 for a batch row.
    pub const HIT_SLOT: u32 = 0;
    /// The batch's id, or 0 for an object.
    pub const HIT_BATCH: u32 = 1;
    /// The batch row, or -1 for an object.
    pub const HIT_ROW: u32 = 2;
    /// The triangle's index in its mesh, or -1 for an overlap.
    pub const HIT_TRIANGLE: u32 = 3;
    /// The distance along the ray, or -1 for a ray that hit nothing.
    pub const HIT_DISTANCE: u32 = 4;
    /// The hit's point in the world, three numbers.
    pub const HIT_POINT: u32 = 5;
    /// The triangle's unit normal in the world, facing the ray's origin, three numbers.
    pub const HIT_NORMAL: u32 = 8;

    /// The closest hit.
    pub const CLOSEST: u32 = 0;
    /// Whether anything is hit.
    pub const ANY: u32 = 1;
    /// Every hit, nearest first.
    pub const ALL: u32 = 2;
    /// Items with a triangle within a sphere.
    pub const SPHERE: u32 = 3;
    /// Items with a triangle within a box.
    pub const BOX: u32 = 4;

    /// What a query returns when it fails.
    pub const FAILED: u32 = u32::MAX;
}

/// What a per-frame count returns where the core does not count, such as visible entries where the
/// GPU culls.
pub const NOT_COUNTED: u32 = u32::MAX;

/// The generated module's text.
pub fn typescript() -> String {
    let mut out = String::from(
        "// Generated by `cargo test -p null3d-wasm` from crates/null3d-wasm/src/constants.rs.\n\
         // Do not edit: set NULL3D_UPDATE_GENERATED=1 and run that command to rewrite it.\n\n",
    );
    // A slice, not an array of a stated length, so work that adds a group changes no count.
    let groups: &[(&str, &[(&str, u32)])] = &[
        (
            "COMMAND",
            &[
                ("CREATE", op::CREATE),
                ("DESTROY", op::DESTROY),
                ("SET_PARENT", op::SET_PARENT),
                ("SET_MESH", op::SET_MESH),
                ("SET_MATERIAL", op::SET_MATERIAL),
                ("SET_DYNAMIC", op::SET_DYNAMIC),
                ("SET_VISIBLE", op::SET_VISIBLE),
                ("SET_LAYERS", op::SET_LAYERS),
                ("SET_FLAGS", op::SET_FLAGS),
                ("SET_RENDER_ORDER", op::SET_RENDER_ORDER),
                ("SET_SKIN", op::SET_SKIN),
                ("SET_MORPH", op::SET_MORPH),
                ("KEEP_WORLD", op::KEEP_WORLD),
                ("WORDS", COMMAND_WORDS),
            ],
        ),
        (
            "FLAG",
            &[
                ("DYNAMIC", flags::DYNAMIC),
                ("VISIBLE", flags::VISIBLE),
                ("CAST_SHADOWS", flags::CAST_SHADOWS),
                ("RECEIVE_SHADOWS", flags::RECEIVE_SHADOWS),
                ("UNCULLED", flags::UNCULLED),
                ("CUSTOM_BOUNDS", flags::CUSTOM_BOUNDS),
                ("OUTLINED", flags::OUTLINED),
                ("OCCLUDER", flags::OCCLUDER),
            ],
        ),
        ("LAYERS", &[("DEFAULT", DEFAULT_LAYERS)]),
        ("CELL", &[("SIZE", CELL_SIZE as u32)]),
        (
            "LIGHT_KIND",
            &[
                ("DIRECTIONAL", light_kind::DIRECTIONAL),
                ("POINT", light_kind::POINT),
                ("SPOT", light_kind::SPOT),
                ("HEMISPHERE", light_kind::HEMISPHERE),
                ("AMBIENT", light_kind::AMBIENT),
            ],
        ),
        (
            "LIGHT_COLOR",
            &[("MAIN", light_color::MAIN), ("GROUND", light_color::GROUND)],
        ),
        (
            "LIGHT_VALUE",
            &[
                ("INTENSITY", light_value::INTENSITY),
                ("RANGE", light_value::RANGE),
                ("DECAY", light_value::DECAY),
                ("ANGLE", light_value::ANGLE),
                ("PENUMBRA", light_value::PENUMBRA),
                ("SHADOW_BIAS", light_value::SHADOW_BIAS),
                ("SHADOW_NORMAL_BIAS", light_value::SHADOW_NORMAL_BIAS),
                ("SHADOW_CASCADES", light_value::SHADOW_CASCADES),
                ("SHADOW_MAP_SIZE", light_value::SHADOW_MAP_SIZE),
                ("SHADOW_DISTANCE", light_value::SHADOW_DISTANCE),
            ],
        ),
        (
            "SCENE_FIELD",
            &[
                ("POSITIONS", scene_field::POSITIONS),
                ("ROTATIONS", scene_field::ROTATIONS),
                ("SCALES", scene_field::SCALES),
                ("LOCAL_RADII", scene_field::LOCAL_RADII),
                ("DIRTY_WORDS", scene_field::DIRTY_WORDS),
                ("LOCAL_CENTERS", scene_field::LOCAL_CENTERS),
                ("POSITION_CELLS", scene_field::POSITION_CELLS),
            ],
        ),
        (
            "BATCH_FIELD",
            &[
                ("POSITIONS", batch_field::POSITIONS),
                ("ROTATIONS", batch_field::ROTATIONS),
                ("SCALES", batch_field::SCALES),
                ("COLORS", batch_field::COLORS),
                ("SIZES", batch_field::SIZES),
                ("FRAMES", batch_field::FRAMES),
            ],
        ),
        (
            "SPRITE",
            &[("MAX_ATLAS_SIDE", null3d_core::sprites::MAX_ATLAS_SIDE)],
        ),
        (
            "LINE_MODE",
            &[
                ("SEGMENTS", LineMode::Segments as u32),
                ("STRIP", LineMode::Strip as u32),
                ("LOOP", LineMode::Loop as u32),
            ],
        ),
        (
            "QUERY",
            &[
                ("INPUT", query::INPUT),
                ("HITS", query::HITS),
                ("HIT_CAPACITY", query::HIT_CAPACITY),
                ("RAYS", query::RAYS),
                ("INPUT_FLOATS", query::INPUT_FLOATS),
                ("INPUT_LIMIT", query::INPUT_LIMIT),
                ("RAY_FLOATS", query::RAY_FLOATS),
                ("HIT_FLOATS", query::HIT_FLOATS),
                ("HIT_SLOT", query::HIT_SLOT),
                ("HIT_BATCH", query::HIT_BATCH),
                ("HIT_ROW", query::HIT_ROW),
                ("HIT_TRIANGLE", query::HIT_TRIANGLE),
                ("HIT_DISTANCE", query::HIT_DISTANCE),
                ("HIT_POINT", query::HIT_POINT),
                ("HIT_NORMAL", query::HIT_NORMAL),
                ("CLOSEST", query::CLOSEST),
                ("ANY", query::ANY),
                ("ALL", query::ALL),
                ("SPHERE", query::SPHERE),
                ("BOX", query::BOX),
                ("FAILED", query::FAILED),
            ],
        ),
        (
            "DEBUG_LINE_FIELD",
            &[
                ("POSITIONS", debug_line_field::POSITIONS),
                ("COLORS", debug_line_field::COLORS),
            ],
        ),
        (
            "RING_FIELD",
            &[
                ("RECORDS", ring_field::RECORDS),
                ("CAPACITY", ring_field::CAPACITY),
                ("WRITE_INDEX", ring_field::WRITE_INDEX),
                ("READ_INDEX", ring_field::READ_INDEX),
            ],
        ),
        (
            "HANDLE",
            &[
                ("SLOT_BITS", SLOT_BITS),
                ("GENERATION_BITS", GENERATION_BITS),
                ("DEAD_GENERATION", DEAD_GENERATION),
            ],
        ),
        (
            "CORE",
            &[
                ("NO_PARENT", NO_PARENT),
                ("NO_MESH", NO_MESH),
                ("NO_MATERIAL", NO_MATERIAL),
                ("MATRIX_FLOATS", MATRIX_FLOATS as u32),
                ("NOT_COUNTED", NOT_COUNTED),
            ],
        ),
        (
            "LIMIT",
            &[
                (
                    "PORTABLE_STORAGE_BINDING_BYTES",
                    sizes::PORTABLE_STORAGE_BINDING_BYTES,
                ),
                ("MAX_USEFUL_BINDING_BYTES", MAX_USEFUL_BINDING_BYTES),
                ("INSTANCE_STRIDE", sizes::INSTANCE_STRIDE),
                ("PORTABLE_MAX_SOURCES", PORTABLE_MAX_SOURCES),
                ("MATRICES_PER_TEXTURE_ROW", sizes::MATRICES_PER_TEXTURE_ROW),
                (
                    "WEBGL2_MIN_TEXTURE_SIZE",
                    CpuCulledConfig::default().max_texture_size,
                ),
                ("WEBGL2_MAX_SOURCES", 1 << MAX_SOURCE_BITS),
                ("MSAA_SAMPLES", Antialias::Msaa.samples()),
            ],
        ),
        (
            "CAPABILITY",
            &[
                ("MULTI_DRAW", Capabilities::MULTI_DRAW.0 as u32),
                ("TEXTURE_BC", Capabilities::TEXTURE_BC.0 as u32),
                ("TEXTURE_ETC2", Capabilities::TEXTURE_ETC2.0 as u32),
                ("TEXTURE_ASTC", Capabilities::TEXTURE_ASTC.0 as u32),
                (
                    "TRANSIENT_ATTACHMENTS",
                    Capabilities::TRANSIENT_ATTACHMENTS.0 as u32,
                ),
            ],
        ),
        (
            "ANTIALIAS",
            &[
                ("NONE", Antialias::None.code()),
                ("FXAA", Antialias::Fxaa.code()),
                ("MSAA", Antialias::Msaa.code()),
            ],
        ),
        (
            "TONE_MAPPING",
            &[
                ("ACES", ToneMapping::Aces.code()),
                ("AGX", ToneMapping::Agx.code()),
                ("NEUTRAL", ToneMapping::Neutral.code()),
                ("NONE", ToneMapping::None.code()),
            ],
        ),
        (
            "SHADING",
            &[
                ("LIT", shading::LIT),
                ("UNLIT", shading::UNLIT),
                ("TEXCOORDS", shading::TEXCOORDS),
                ("UNLIT_MAP", shading::UNLIT_MAP),
                ("SPRITE", shading::SPRITE),
                ("LINE", shading::LINE),
                ("LINE_LIT", shading::LINE_LIT),
                ("CUSTOM_FIRST", shading::CUSTOM_FIRST),
                ("CUSTOM_ATTRIBUTE_SHIFT", shading::CUSTOM_ATTRIBUTE_SHIFT),
                ("CUSTOM_BASE_COLOR", shading::CUSTOM_BASE_COLOR),
                ("CUSTOM_TEXTURE_SHIFT", shading::CUSTOM_TEXTURE_SHIFT),
            ],
        ),
        // The features that `createMaterial` takes, fixed from then on.
        (
            "MATERIAL_FEATURE",
            &[
                ("DOUBLE_SIDED", feature::DOUBLE_SIDED),
                ("VERTEX_COLORS", feature::VERTEX_COLORS),
                ("FLAT_SHADING", feature::FLAT_SHADING),
                ("ALPHA_MASK", feature::ALPHA_MASK),
                ("BLEND", feature::BLEND),
                ("NO_DEPTH_WRITE", feature::NO_DEPTH_WRITE),
                ("NO_DEPTH_TEST", feature::NO_DEPTH_TEST),
                ("ADDITIVE", feature::ADDITIVE),
                ("MULTIPLY", feature::MULTIPLY),
                ("NO_FOG", feature::NO_FOG),
            ],
        ),
        // The debug views that `setDebugView` takes.
        (
            "DEBUG_VIEW",
            &[
                ("LIT", debug_view::code::LIT),
                ("NORMALS", debug_view::code::NORMALS),
                ("DEPTH", debug_view::code::DEPTH),
                ("OVERDRAW", debug_view::code::OVERDRAW),
                ("WIREFRAME", debug_view::code::WIREFRAME),
                ("SHADOWS", debug_view::code::SHADOWS),
            ],
        ),
        // The fog curves that `setFog` takes, and its code for no fog.
        (
            "FOG_CURVE",
            &[
                ("NONE", fog::curve::NONE),
                ("LINEAR", fog::curve::LINEAR),
                ("EXP2", fog::curve::EXP2),
                ("EXPONENTIAL", fog::curve::EXPONENTIAL),
            ],
        ),
        (
            "MAP_SLOT",
            &[
                ("BASE_COLOR", map_slot::BASE_COLOR),
                ("METAL_ROUGH", map_slot::METAL_ROUGH),
                ("NORMAL", map_slot::NORMAL),
                ("OCCLUSION", map_slot::OCCLUSION),
                ("EMISSIVE", map_slot::EMISSIVE),
                ("LIGHT", map_slot::LIGHT),
                ("SPECULAR_INTENSITY", map_slot::SPECULAR_INTENSITY),
                ("SPECULAR_COLOR", map_slot::SPECULAR_COLOR),
            ],
        ),
        // The values that `setMaterialValue` changes, by the float where each starts in a row.
        (
            "MATERIAL_PARAM",
            &[
                ("COLOR", param::COLOR as u32),
                ("OPACITY", param::OPACITY as u32),
                ("EMISSIVE", param::EMISSIVE as u32),
                ("EMISSIVE_INTENSITY", param::EMISSIVE_INTENSITY as u32),
                ("ALPHA_CUTOFF", param::ALPHA_CUTOFF as u32),
                ("METALNESS", param::METALNESS as u32),
                ("ROUGHNESS", param::ROUGHNESS as u32),
                ("NORMAL_SCALE", param::NORMAL_SCALE as u32),
                ("OCCLUSION_STRENGTH", param::OCCLUSION_STRENGTH as u32),
                ("LIGHT_MAP_INTENSITY", param::LIGHT_MAP_INTENSITY as u32),
                ("ENV_INTENSITY", param::ENV_INTENSITY as u32),
                ("UV_U", param::UV_U as u32),
                ("UV_V", param::UV_V as u32),
                ("REFLECTANCE", param::REFLECTANCE as u32),
                ("SPECULAR_COLOR", param::SPECULAR_COLOR as u32),
                ("SPECULAR_INTENSITY", param::SPECULAR_INTENSITY as u32),
            ],
        ),
        // The custom effects that `setEffect` takes, and the floats of each one's uniforms, which
        // TypeScript writes at `effectValues` first.
        (
            "EFFECT",
            &[
                ("MAX", null3d_render::effects::MAX_EFFECTS as u32),
                ("FLOATS", null3d_render::effects::EFFECT_FLOATS as u32),
                ("DEPTH", effect_flag::DEPTH),
            ],
        ),
        (
            "POST_VALUE",
            &[
                ("EXPOSURE", post_value::EXPOSURE),
                ("BLOOM_INTENSITY", post_value::BLOOM_INTENSITY),
                ("BLOOM_THRESHOLD", post_value::BLOOM_THRESHOLD),
                ("BLOOM_KNEE", post_value::BLOOM_KNEE),
                ("LUT_INTENSITY", post_value::LUT_INTENSITY),
                ("LUT_DOMAIN_MIN", post_value::LUT_DOMAIN_MIN),
                ("LUT_DOMAIN_MAX", post_value::LUT_DOMAIN_MAX),
                ("VIGNETTE_OFFSET", post_value::VIGNETTE_OFFSET),
                ("VIGNETTE_DARKNESS", post_value::VIGNETTE_DARKNESS),
                ("AO_RADIUS", post_value::AO_RADIUS),
                ("AO_THICKNESS", post_value::AO_THICKNESS),
                ("AO_DISTANCE_EXPONENT", post_value::AO_DISTANCE_EXPONENT),
                ("AO_DISTANCE_FALLOFF", post_value::AO_DISTANCE_FALLOFF),
                ("AO_SCALE", post_value::AO_SCALE),
                ("AO_SAMPLES", post_value::AO_SAMPLES),
                ("AO_INTENSITY", post_value::AO_INTENSITY),
                ("OUTLINE_COLOR", post_value::OUTLINE_COLOR),
                ("OUTLINE_HIDDEN_COLOR", post_value::OUTLINE_HIDDEN_COLOR),
                ("OUTLINE_HIDDEN", post_value::OUTLINE_HIDDEN),
                ("OUTLINE_WIDTH", post_value::OUTLINE_WIDTH),
                ("BLOOM_BLEND", post_value::BLOOM_BLEND),
                ("BLOOM_WEIGHTS", post_value::BLOOM_WEIGHTS),
                ("COUNT", post_value::COUNT),
            ],
        ),
        (
            "ENVIRONMENT_VALUE",
            &[
                ("INTENSITY", environment_value::INTENSITY),
                ("ROTATION", environment_value::ROTATION),
                ("SH", environment_value::SH),
                ("COUNT", environment_value::COUNT),
            ],
        ),
        (
            "TEXTURE_STAT",
            &[
                ("MEMORY_BYTES", texture_stat::MEMORY_BYTES),
                ("TEXTURE_BYTES", texture_stat::TEXTURE_BYTES),
                ("LAST_FRAME_BYTES", texture_stat::LAST_FRAME_BYTES),
                ("LARGEST_FRAME_BYTES", texture_stat::LARGEST_FRAME_BYTES),
                ("WAITING", texture_stat::WAITING),
                ("IMAGES_SENT", texture_stat::IMAGES_SENT),
                ("MAX_SIZE", texture_stat::MAX_SIZE),
                ("UPLOAD_BUDGET", texture_stat::UPLOAD_BUDGET),
                ("MAX_ANISOTROPY", texture_stat::MAX_ANISOTROPY),
                ("MEMORY_BUDGET", texture_stat::MEMORY_BUDGET),
                ("DROPPED_LEVELS", texture_stat::DROPPED_LEVELS),
                ("DROPPED_TOTAL", texture_stat::DROPPED_TOTAL),
                ("DROPPED_TEXTURES", texture_stat::DROPPED_TEXTURES),
                ("BUDGET_EPOCH", texture_stat::BUDGET_EPOCH),
                ("RELOAD_LEVEL", texture_stat::RELOAD_LEVEL),
                ("RELOAD_TEXTURE", texture_stat::RELOAD_TEXTURE),
            ],
        ),
        (
            "CAMERA_TARGET",
            &[
                ("VIEW", camera_target::VIEW),
                ("SHADOWS", camera_target::SHADOWS),
            ],
        ),
        (
            "SHADOW_CASTERS",
            &[
                ("CASCADE_MASK", shadow_casters::CASCADE_MASK),
                ("TILES", shadow_casters::TILES),
            ],
        ),
        // The draw list's codes that `createTexture` takes, so the sketch thread needs no import of
        // the GPU layer's constants, which the bundler would put in a file of their own.
        (
            "TEXTURE",
            &[
                ("FORMAT_SRGB", format::RGBA8_UNORM_SRGB),
                ("FORMAT_LINEAR", format::RGBA8_UNORM),
                ("FORMAT_HALF_FLOAT", format::RGBA16_FLOAT),
                ("FORMAT_SHARED_EXPONENT", format::RGB9E5_UFLOAT),
                ("CUBE_MAX_SIZE", CUBE_TEXTURE_SIZE),
                ("FORMAT_ASTC", format::ASTC_4X4_UNORM),
                ("FORMAT_ASTC_SRGB", format::ASTC_4X4_UNORM_SRGB),
                ("FORMAT_BC7", format::BC7_RGBA_UNORM),
                ("FORMAT_BC7_SRGB", format::BC7_RGBA_UNORM_SRGB),
                ("FORMAT_ETC2_RGB", format::ETC2_RGB8_UNORM),
                ("FORMAT_ETC2_RGB_SRGB", format::ETC2_RGB8_UNORM_SRGB),
                ("FORMAT_ETC2_RGBA", format::ETC2_RGBA8_UNORM),
                ("FORMAT_ETC2_RGBA_SRGB", format::ETC2_RGBA8_UNORM_SRGB),
                ("PREMULTIPLIED_ALPHA", upload_flags::PREMULTIPLIED_ALPHA),
                ("MAX_DEPTH", MAX_LAYERS),
                ("WRAP_CLAMP", address::CLAMP_TO_EDGE),
                ("WRAP_REPEAT", address::REPEAT),
                ("WRAP_MIRROR", address::MIRROR_REPEAT),
                ("FILTER_NEAREST", filter::NEAREST),
                ("FILTER_LINEAR", filter::LINEAR),
            ],
        ),
        (
            "TEXTURE_OPTION",
            &[
                ("UPLOAD_BUDGET", texture_option::UPLOAD_BUDGET),
                ("MAX_ANISOTROPY", texture_option::MAX_ANISOTROPY),
                ("UPLOAD_ALL", texture_option::UPLOAD_ALL),
                ("MEMORY_BUDGET_KIB", texture_option::MEMORY_BUDGET_KIB),
                ("DEFAULT_UPLOAD_BUDGET", DEFAULT_UPLOAD_BUDGET),
                ("DEFAULT_MAX_ANISOTROPY", DEFAULT_MAX_ANISOTROPY),
            ],
        ),
        (
            "SHAPE",
            &[
                ("BOX", Shape::Box as u32),
                ("SPHERE", Shape::Sphere as u32),
                ("PLANE", Shape::Plane as u32),
                ("CYLINDER", Shape::Cylinder as u32),
                ("TORUS", Shape::Torus as u32),
                ("CAPSULE", Shape::Capsule as u32),
                ("CIRCLE", Shape::Circle as u32),
                ("RING", Shape::Ring as u32),
            ],
        ),
        (
            "MESH_ARRAYS",
            &[
                ("NORMALS", mesh_arrays::NORMALS),
                ("UVS", mesh_arrays::UVS),
                ("UVS1", mesh_arrays::UVS1),
                ("COLORS", mesh_arrays::COLORS),
                ("COLORS_ALPHA", mesh_arrays::COLORS_ALPHA),
                ("TANGENTS", mesh_arrays::TANGENTS),
                ("INDICES", mesh_arrays::INDICES),
                ("COMPUTE_NORMALS", mesh_arrays::COMPUTE_NORMALS),
                ("COMPUTE_TANGENTS", mesh_arrays::COMPUTE_TANGENTS),
                ("JOINTS", mesh_arrays::JOINTS),
                ("WEIGHTS", mesh_arrays::WEIGHTS),
            ],
        ),
        // The morph target arrays of `createMeshFromArrays`, the morph weight table, and the bytes of
        // each delta texel on the GPU.
        (
            "MORPH",
            &[
                ("POSITIONS", morph_arrays::POSITIONS),
                ("NORMALS", morph_arrays::NORMALS),
                ("TANGENTS", morph_arrays::TANGENTS),
                ("COLORS", morph_arrays::COLORS),
                ("MAX_WEIGHTS", null3d_core::morph::MAX_WEIGHTS),
                ("MAX_TARGETS", null3d_core::morph::MAX_TARGETS),
                ("WEIGHTS_PER_JOINT", null3d_core::morph::WEIGHTS_PER_JOINT),
                ("DELTA_BYTES", null3d_render::morph::DELTA_BYTES),
            ],
        ),
        (
            "ARRAY",
            &[
                ("POSITIONS", ArrayName::Positions as u32),
                ("NORMALS", ArrayName::Normals as u32),
                ("UVS", ArrayName::Uvs as u32),
                ("UVS1", ArrayName::Uvs1 as u32),
                ("COLORS", ArrayName::Colors as u32),
                ("TANGENTS", ArrayName::Tangents as u32),
                ("INDICES", ArrayName::Indices as u32),
                ("JOINTS", ArrayName::Joints as u32),
                ("WEIGHTS", ArrayName::Weights as u32),
            ],
        ),
        (
            "ANIMATION_FIELD",
            &[
                ("SLOT_CLIPS", animation_field::SLOT_CLIPS),
                ("SLOT_TIMES", animation_field::SLOT_TIMES),
                ("SLOT_WEIGHTS", animation_field::SLOT_WEIGHTS),
                ("MATRICES", animation_field::MATRICES),
                ("TIME_SCALES", animation_field::TIME_SCALES),
                ("LAYER_WEIGHTS", animation_field::LAYER_WEIGHTS),
                ("EVENTS", animation_field::EVENTS),
                ("EVENT_TOTALS", animation_field::EVENT_TOTALS),
                ("SLOT_SOURCES", animation_field::SLOT_SOURCES),
                ("BLEND_VALUES", animation_field::BLEND_VALUES),
                ("PLAY_ARGS", animation_field::PLAY_ARGS),
            ],
        ),
        // The animation table's layout, the numbers of `createClip`'s track headers, the bits of
        // `animatorPlay`'s flags, and the kinds of event in an event record's second word.
        (
            "ANIMATION",
            &[
                ("MAX_BLEND", MAX_BLEND as u32),
                ("MAX_LAYERS", MAX_ANIMATION_LAYERS as u32),
                ("MAX_CLIP_KEYS", MAX_CLIP_KEYS as u32),
                ("EVENT_CAPACITY", EVENT_CAPACITY as u32),
                ("EVENT_WORDS", EVENT_WORDS as u32),
                ("PLAY_LOOP", play_flag::LOOP),
                ("PLAY_ADDITIVE", play_flag::ADDITIVE),
                ("PLAY_TIME", play_flag::TIME),
                ("PLAY_WEIGHT", play_flag::WEIGHT),
                ("PLAY_JOIN", play_flag::JOIN),
                ("PLAY_VALUE", play_flag::VALUE),
                ("NO_SOURCE", NO_SOURCE),
                ("ARG_FADE", play_arg::FADE as u32),
                ("ARG_SPEED", play_arg::SPEED as u32),
                ("ARG_TIME", play_arg::TIME as u32),
                ("ARG_WEIGHT", play_arg::WEIGHT as u32),
                ("ARG_VALUE", play_arg::VALUE as u32),
                ("ARGS", play_arg::COUNT as u32),
                ("EVENT_CLIP", event_kind::EVENT),
                ("EVENT_LOOP", event_kind::LOOP),
                ("EVENT_FINISHED", event_kind::FINISHED),
                ("REST_FLOATS", REST_FLOATS as u32),
                ("TRACK_WORDS", TRACK_WORDS),
                ("CLIP_PENDING", CLIP_PENDING),
                ("DEFAULT_RATE", DEFAULT_RATE as u32),
                ("TRANSLATION", Channel::Translation as u32),
                ("ROTATION", Channel::Rotation as u32),
                ("SCALE", Channel::Scale as u32),
                ("LINEAR", Interpolation::Linear as u32),
                ("STEP", Interpolation::Step as u32),
                ("CUBIC_SPLINE", Interpolation::CubicSpline as u32),
            ],
        ),
        (
            "ANIMATION_PROBLEM",
            &[
                ("JOINTS", animation_problem::JOINTS),
                ("PARENT", animation_problem::PARENT),
                ("LENGTH", animation_problem::LENGTH),
                ("NOT_FINITE", animation_problem::NOT_FINITE),
                ("KEYS", animation_problem::KEYS),
                ("UNKNOWN_SKELETON", animation_problem::UNKNOWN_SKELETON),
                ("WRONG_SKELETON", animation_problem::WRONG_SKELETON),
                ("EVENTS", animation_problem::EVENTS),
                ("MASK", animation_problem::MASK),
                ("PLAY", animation_problem::PLAY),
                ("UNKNOWN_INSTANCE", animation_problem::UNKNOWN_INSTANCE),
                ("UNKNOWN_CLIP", animation_problem::UNKNOWN_CLIP),
                ("LAYER", animation_problem::LAYER),
                ("UNKNOWN_MASK", animation_problem::UNKNOWN_MASK),
                ("TRACK", animation_problem::TRACK),
            ],
        ),
        (
            "ARRAYS_PROBLEM",
            &[
                ("NO_VERTICES", arrays_problem::NO_VERTICES),
                ("LENGTH", arrays_problem::LENGTH),
                ("NOT_TRIANGLES", arrays_problem::NOT_TRIANGLES),
                ("TWICE", arrays_problem::TWICE),
                ("MISSING", arrays_problem::MISSING),
                ("INDEX_OUT_OF_RANGE", arrays_problem::INDEX_OUT_OF_RANGE),
                ("TYPE", arrays_problem::TYPE),
                ("MORPH_TOO_LARGE", arrays_problem::MORPH_TOO_LARGE),
                ("MORPH_LENGTH", arrays_problem::MORPH_LENGTH),
                ("MORPH_NOT_FINITE", arrays_problem::MORPH_NOT_FINITE),
                ("NOT_FINITE", arrays_problem::NOT_FINITE),
            ],
        ),
    ];
    for &(prefix, entries) in groups {
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
    #[test]
    fn the_generated_module_is_current() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/engine/src/generated/core.ts"
        );
        let expected = super::typescript();
        if std::env::var_os("NULL3D_UPDATE_GENERATED").is_some() {
            std::fs::write(path, &expected).unwrap();
        }
        let actual = std::fs::read_to_string(path).unwrap_or_default();
        assert!(
            actual == expected,
            "{path} is out of date: run `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-wasm`"
        );
    }
}

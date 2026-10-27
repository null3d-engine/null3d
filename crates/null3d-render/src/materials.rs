//! The material table: each material's parameters in the row layout that the shaders read by
//! material id, the pipeline it draws with, and the textures of its maps.
//!
//! # Rows
//!
//! Each material has one row of [`MATERIAL_FLOATS`] floats, thirty-two `vec4f`s, which the WGSL
//! struct `MaterialRow` in `null3d::globals` mirrors field for field. Shaders copy the first nine
//! into a `Material`. Only the builds that let light through read the next two, the transmission's
//! values; only the builds of layered materials read the next two, the clear coat's and the
//! sheen's; only the builds that let light through a thin surface read the one after, the diffuse
//! transmission's values; and only the skin pass's builds read the one after that, the scatter
//! distances of the subsurface blur. The vec4f after them holds a light map's transform, and the
//! spare float of the transmission's vec4f holds the direction map's layer. The last fourteen hold
//! the texture coordinate transforms of the maps of the slots from the second up, two for each: the
//! base color map's two rows sit with the values that every shader reads. The [`param`] module names
//! where each value sits. A row also holds the texture array layer of each of its maps, which the
//! table writes once the map's image is on the GPU, and [`NO_MAP`] until then. Where a standard
//! material's maps share a few units of their bind group, as on WebGL2, each map's value is its
//! unit times [`UNIT_LAYERS`], plus its layer. On WebGPU the table is a
//! storage buffer; on WebGL2 it is a data texture with one row of texels per material.
//!
//! A change marks its rows, and the next frame uploads the rows from the first changed one to the
//! last, not the whole table.
//!
//! # Custom values
//!
//! Each material also has a row of [`MATERIAL_FLOATS`] custom values, of which a custom material's
//! WGSL uses the first [`CUSTOM_FLOATS`] for its uniforms, as the shader compiler packs them. Vertex shaders read them too, so on WebGPU,
//! where vertex shaders read no storage buffers, they live in a data texture of their own, one row
//! of texels per material. On WebGL2 the table's data texture holds them after every material's
//! row: it has twice [`MaterialTable::capacity`] rows, and the custom values of material `id` sit
//! in row `capacity + id`. They start at zero, as a new GPU texture does, and change and upload as
//! the rows do.
//!
//! A custom material's textures take its map slots in the order its WGSL declares them, and the
//! layer of texture `k` sits in its custom values at [`texture_layer_offset`], from the row's end,
//! where both shader stages read it. It holds [`NO_MAP`] until the texture's image is on the GPU.
//!
//! # Destroyed materials
//!
//! A destroyed material draws nothing from then on. Objects may still name it, so its id stays
//! taken until a rebuild of the draw tables finds no object or batch that uses it. The id then
//! goes back to the table, and the next material created takes it.

use std::ops::Range;

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{sizes, state_flags, template, vertex};

use crate::pipelines::DepthBias;
use crate::textures::Premultiplied;

/// How a material shades.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Shading {
    /// The standard material: glTF's metallic-roughness model, lit as three.js's
    /// `MeshStandardMaterial` is lit.
    Lit,
    /// The base color only, as three.js's `MeshBasicMaterial`.
    Unlit,
    /// The first texture coordinates as red and green, for the engine's own tests of vertex
    /// formats. Only meshes with those coordinates draw with it.
    TexCoords,
    /// The base color times the material's map, as three.js's `MeshBasicMaterial` with a `map`.
    /// A material without a live map, or on a mesh without texture coordinates, draws as
    /// [`Shading::Unlit`].
    UnlitMap,
    /// The standard material with its texture maps. A standard material draws with it when it
    /// has a live map and its mesh has texture coordinates; nothing creates it.
    StandardMaps,
    /// Sprites, as three.js's `SpriteMaterial` draws them: quads that face the camera, in the base
    /// color times each sprite's color, from the rows of a sprite batch. With a live map the
    /// material draws as [`Shading::SpriteMap`].
    Sprite,
    /// A sprite material with its map, at each sprite's frame of the atlas; nothing creates it.
    SpriteMap,
    /// Particles of a particle system of the particles add-on: a soft dot for each record of the
    /// system, whose shader moves it to its age (see [`crate::particles`]). With a live map the
    /// material draws as [`Shading::ParticleMap`].
    Particle,
    /// A particle material with its map, a flipbook atlas; nothing creates it.
    ParticleMap,
    /// Wide lines, as three.js's `LineMaterial` draws them: a quad with round ends for each
    /// segment of a line batch, in the base color times the segment's colors, with dashes that the
    /// material's custom values set.
    Line,
    /// Wide lines lit as a standard material whose surface faces the camera, with the material's
    /// metalness, roughness and emissive color.
    LineLit,
    /// A custom material: the standard material's template with the sketch's own WGSL, or a full
    /// shader of the sketch's, under its own template id, from [`template::CUSTOM_FIRST`] up.
    Custom(CustomShading),
}

/// How a custom material's shader draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CustomShading {
    /// Its render pipeline template.
    pub template: u32,
    /// The optional vertex attributes (`vertex::*` bits) that its vertex stage reads.
    pub attributes: u32,
    /// True when its shader reads the material's base color and opacity, as the standard
    /// material's template does in its `VERTEX_COLOR` and `ALPHA_MASK` builds.
    pub base_color: bool,
    /// The textures that its WGSL declares, which take its first map slots.
    pub textures: u32,
    /// True when its WGSL has the builds that let light through, which it draws with when its
    /// material has [`feature::TRANSMISSION`].
    pub transmission: bool,
    /// True when it has the builds that draw the rows of instance batches with row values: a
    /// material built from the standard material's template, not a whole shader of the sketch's.
    pub row_values: bool,
    /// True when it has the builds of a shadow caster that moves by its vertex offset, which its
    /// shadows draw with.
    pub caster: bool,
    /// True when its WGSL reads an instance's index or an object's id, which its vertex shader
    /// finds in the table of object ranges.
    pub object_ids: bool,
}

impl CustomShading {
    /// A custom material from the standard material's template, which reads the first texture
    /// coordinates and the base color.
    pub const fn standard(template: u32) -> Shading {
        Shading::Custom(Self {
            template,
            attributes: vertex::UV0,
            base_color: true,
            textures: 0,
            transmission: false,
            row_values: true,
            caster: false,
            object_ids: false,
        })
    }
}

impl Shading {
    /// The render pipeline template that draws with this shading.
    pub const fn template(self) -> u32 {
        match self {
            Shading::Lit => template::INSTANCED_LIT,
            Shading::Unlit => template::INSTANCED_UNLIT,
            Shading::TexCoords => template::INSTANCED_TEXCOORDS,
            Shading::UnlitMap => template::INSTANCED_UNLIT_MAP,
            Shading::StandardMaps => template::INSTANCED_STANDARD_MAPS,
            Shading::Sprite => template::SPRITE,
            Shading::SpriteMap => template::SPRITE_MAP,
            Shading::Particle => template::PARTICLE,
            Shading::ParticleMap => template::PARTICLE_MAP,
            Shading::Line => template::LINE,
            Shading::LineLit => template::LINE_LIT,
            Shading::Custom(custom) => custom.template,
        }
    }

    /// The optional vertex attributes (`vertex::*` bits) that its pipeline reads, which a mesh
    /// needs to draw with it.
    pub const fn attributes(self) -> u32 {
        match self {
            Shading::Lit
            | Shading::Unlit
            | Shading::Line
            | Shading::LineLit
            | Shading::Particle
            | Shading::ParticleMap => 0,
            Shading::TexCoords
            | Shading::UnlitMap
            | Shading::StandardMaps
            | Shading::Sprite
            | Shading::SpriteMap => vertex::UV0,
            Shading::Custom(custom) => custom.attributes,
        }
    }

    /// True when its shader has the builds that let light through: the standard material's, with
    /// or without maps, and a custom material's whose WGSL has them.
    pub const fn transmits(self) -> bool {
        match self {
            Shading::Lit | Shading::StandardMaps => true,
            Shading::Custom(custom) => custom.transmission,
            _ => false,
        }
    }

    /// True when its shader has the builds that let light through a thin surface: the standard
    /// material's, with or without maps, and a custom material's. A custom material has the
    /// feature only when its WGSL has such builds, which the engine checks when it creates it.
    pub const fn translucent(self) -> bool {
        matches!(
            self,
            Shading::Lit | Shading::StandardMaps | Shading::Custom(_)
        )
    }

    /// True when its shader has the builds that light layers above the base: the standard
    /// material's, with or without maps, and a custom material's. A custom material has the
    /// feature only when its WGSL has such builds, which the engine checks when it creates it.
    pub const fn layers(self) -> bool {
        matches!(
            self,
            Shading::Lit | Shading::StandardMaps | Shading::Custom(_)
        )
    }

    /// True when its shader reads the material's base color and opacity, which vertex colors
    /// multiply and a mask compares with the material's alpha cutoff.
    pub const fn reads_base_color(self) -> bool {
        match self {
            Shading::TexCoords | Shading::Particle | Shading::ParticleMap => false,
            Shading::Custom(custom) => custom.base_color,
            _ => true,
        }
    }

    /// True when its shader has the builds that draw the rows of instance batches with row
    /// values: the standard and unlit materials', with or without maps, and a custom material's
    /// built from the standard material's template.
    pub const fn reads_row_values(self) -> bool {
        match self {
            Shading::Lit | Shading::StandardMaps | Shading::Unlit | Shading::UnlitMap => true,
            Shading::Custom(custom) => custom.row_values,
            _ => false,
        }
    }

    /// True when its shader is a whole shader of the sketch's, not built from the standard
    /// material's template. Such a shader has no builds that skin in the vertex shader.
    pub const fn is_full_shader(self) -> bool {
        matches!(self, Shading::Custom(custom) if !custom.row_values)
    }

    /// True when its shadows draw with its own caster builds, which move each vertex by its
    /// vertex offset: a custom material's whose WGSL has one.
    pub const fn casts_its_own_way(self) -> bool {
        matches!(self, Shading::Custom(custom) if custom.caster)
    }

    /// True when its shader reads the table of object ranges: a custom material's whose WGSL
    /// reads an instance's index or an object's id.
    pub const fn reads_object_ids(self) -> bool {
        matches!(self, Shading::Custom(custom) if custom.object_ids)
    }

    /// True when its shader reads the displacement map's values from the material's custom values:
    /// the standard material's, with or without maps.
    pub const fn displaces(self) -> bool {
        matches!(self, Shading::Lit | Shading::StandardMaps)
    }

    /// The template that draws a decal with this shading: the standard material's, with or
    /// without maps, or `None` for shading that has no decal builds.
    pub const fn decal_template(self) -> Option<u32> {
        match self {
            Shading::Lit => Some(template::DECAL),
            Shading::StandardMaps => Some(template::DECAL_MAPS),
            _ => None,
        }
    }
}

/// Options fixed when a material is created, which choose its pipeline or its shader's code.
pub mod feature {
    /// Both faces of each triangle draw, and back faces light as if they faced the camera.
    pub const DOUBLE_SIDED: u32 = 1;
    /// The mesh's vertex colors multiply the base color, on meshes that have them.
    pub const VERTEX_COLORS: u32 = 2;
    /// Each triangle lights with one normal, the normal of its face.
    pub const FLAT_SHADING: u32 = 4;
    /// Fragments whose alpha is below the material's cutoff draw nothing: glTF's alpha mode `MASK`.
    pub const ALPHA_MASK: u32 = 8;
    /// The surface blends over what lies behind it, in the transparent pass that draws such
    /// surfaces back to front: glTF's alpha mode `BLEND`. It wins over [`ALPHA_MASK`].
    pub const BLEND: u32 = 16;
    /// The surface writes no depth.
    pub const NO_DEPTH_WRITE: u32 = 32;
    /// The surface draws whatever the depth target holds, and writes no depth.
    pub const NO_DEPTH_TEST: u32 = 64;
    /// With [`BLEND`], the surface's light adds to what lies behind it.
    pub const ADDITIVE: u32 = 128;
    /// With [`BLEND`], the surface tints what lies behind it. It wins over [`ADDITIVE`].
    pub const MULTIPLY: u32 = 256;
    /// With [`ALPHA_MASK`], the alpha fades from nothing at the cutoff to full over about one
    /// pixel, as three.js's `alphaToCoverage` makes it, and MSAA turns it into the share of each
    /// pixel's samples that the surface covers. Without MSAA it is a plain alpha test, and so it is
    /// for custom materials, whose builds stay few.
    pub const ALPHA_TO_COVERAGE: u32 = 512;
    /// The scene's fog leaves the material's color as it is.
    pub const NO_FOG: u32 = 1024;
    /// With [`ALPHA_MASK`], each fragment draws when its alpha passes a threshold from a hash of
    /// its place on the mesh, as three.js's `alphaHash` does, so the alpha sets the share of the
    /// surface that draws. It wins over [`ALPHA_TO_COVERAGE`]. Custom materials have no such
    /// builds, and test their alpha against the cutoff.
    pub const ALPHA_HASH: u32 = 2048;
    /// The surface draws only the shadows that fall on it, as three.js's `ShadowMaterial`: its own
    /// color where the main directional light's shadows fall, and nothing where the light reaches
    /// it. It takes the lit template, whose `shade` branches on the material's flag.
    pub const SHADOW_CATCHER: u32 = 2_097_152;
    /// The main directional light's contact shadows leave the surface alone: it keeps the shadow
    /// map's shadows, and its row's flag sets the contact shadows' share of the sun to all of it.
    /// For thin surfaces that crowd together or move, such as grass blades, which the march takes
    /// for solid walls.
    pub const NO_CONTACT_SHADOWS: u32 = 4_194_304;
    /// A double-sided surface that blends draws in one draw, both faces in the mesh's order, as
    /// three.js's `forceSinglePass` does. Without it the transparent pass draws such a surface's
    /// back faces first, then its front faces.
    pub const SINGLE_PASS: u32 = 4096;
    /// The surface lets light through, as three.js's `transmission` does: it draws in the
    /// transparent pass, after the opaque objects, and samples a copy of their color behind it,
    /// bent by its index of refraction and its thickness and blurred by its roughness. The
    /// material's transmission value sets how much light passes. It takes no mask, so it wins over
    /// [`ALPHA_MASK`].
    pub const TRANSMISSION: u32 = 8192;
    /// Light that reaches the surface's back shows on its front, as glTF's diffuse transmission
    /// draws a leaf, a petal or an ear against the light. The material's diffuse transmission
    /// value sets how much of its diffuse light passes through, and its transmission color tints
    /// it. It picks the shader builds that light the back, so a material without it pays nothing
    /// for them. In such a material, the specular maps' slots hold the diffuse transmission maps,
    /// which read the same channels ([`MapSlot::DIFFUSE_TRANSMISSION`]). [`TRANSMISSION`] wins
    /// over it.
    pub const TRANSLUCENCY: u32 = 262144;
    /// The surface has layers above its base, as three.js's `MeshPhysicalMaterial` draws them: a
    /// clear coat, a sheen or both, whose values sit at the end of the material's row. It picks
    /// the shader builds that light them, so a material without layers pays nothing for them. In
    /// a layered material, the map slots of the light map and the specular maps hold the layers'
    /// maps ([`LayerMap`]).
    pub const COAT_SHEEN: u32 = 65536;
    /// Light that enters the surface leaves it nearby, as in skin: the subsurface blur spreads the
    /// surface's diffuse light over its scatter radius, redder the further where its scatter color
    /// says so, so its shadows' edges and the detail of its maps soften. Its objects draw again in
    /// the skin pass, which only the standard material has, while the quality setting gives the
    /// blur taps. A material without it pays nothing for the blur.
    pub const SUBSURFACE: u32 = 1048576;
    /// With [`BLEND`] and normal blending, the surface blends with the other such surfaces in any
    /// order, by a weighted average, in the camera's weighted layer (see [`crate::weighted`]).
    /// Elsewhere it draws back to front with the blended surfaces. A surface that lets light
    /// through sorts, so [`TRANSMISSION`] wins over it.
    pub const WEIGHTED: u32 = 524288;
    /// The material is a decal's: each object with it projects the material onto the surfaces
    /// inside the object's box, in the decal pass after the camera's opaque pass, and draws no
    /// mesh of its own. Only the standard material has it. It blends, and wins over every other
    /// feature that picks a pass, a mask or faces.
    pub const DECAL: u32 = 131072;
    /// Each triangle's edges draw as lines, from the part's edge list, with the material's own
    /// shading, as three.js's `wireframe` draws them. Flat shading and bump maps are off, as they
    /// read derivatives that lines do not have.
    pub const WIREFRAME: u32 = 16384;
    /// The displacement map also shifts where the fragment shader reads the maps, by parallax
    /// occlusion mapping, so relief finer than the mesh's vertices hides and shows the surface
    /// behind it. Only opaque and masked surfaces take it.
    pub const PARALLAX: u32 = 32768;
    /// The surface keeps its color as the display shows it: the tone curve leaves it alone. The
    /// 8-bit path decides that in the material's own shader, and the HDR path's final pass reads a
    /// mask of these surfaces and skips the curve where one draws. A blended surface keeps the
    /// curve on the HDR path.
    pub const NO_TONE_MAP: u32 = 8_388_608;
    /// The material's surface function reads the copy of the camera's opaque depth, which the
    /// frame makes while a material with this feature draws. It lies above the flags that a
    /// material's row stores, as no shader reads it from the row: the frame reads it to bind the
    /// copy and to keep it from drawing before the copy exists.
    pub const SCENE_DEPTH: u32 = 1 << 24;
    /// The surface reflects light through a thin film above it, as glTF's
    /// `KHR_materials_iridescence` does: the film's interference tints the specular reflection by
    /// the angle and the film's thickness, so a soap bubble or a beetle's shell shows the colors
    /// of its thickness. It takes the builds of the layers above the base ([`COAT_SHEEN`]), whose
    /// row holds its values, so a material without any layer pays nothing for them.
    pub const IRIDESCENCE: u32 = 1 << 25;
    /// The surface's specular lobe stretches along one direction of its tangent frame, as glTF's
    /// `KHR_materials_anisotropy` does: highlights spread across the direction instead of around,
    /// as brushed metal shows. It takes the builds of the layers above the base ([`COAT_SHEEN`]).
    pub const ANISOTROPY: u32 = 1 << 26;
    /// The light map holds RGBM texels, as Needle's viewer reads its light maps: each texel's
    /// color is multiplied by its alpha times 8, then the sRGB transfer turns it linear. The
    /// texture is uploaded as linear texels, so the shader makes that decode itself.
    pub const LIGHT_MAP_RGBM: u32 = 1 << 27;
    /// The surface writes depth and no color, so it shows nothing itself and hides what lies
    /// behind it, as three.js's `colorWrite: false` does. Its objects draw before the opaque
    /// objects that write color, so the depth it writes holds their color back. With
    /// [`ALPHA_MASK`] the parts below the cutoff write nothing at all, so the surface cuts a shape
    /// out of the depth it holds.
    pub const NO_COLOR_WRITE: u32 = 1 << 28;
    /// Every feature.
    pub const ALL: u32 = DOUBLE_SIDED
        | VERTEX_COLORS
        | FLAT_SHADING
        | ALPHA_MASK
        | BLEND
        | NO_DEPTH_WRITE
        | NO_DEPTH_TEST
        | ADDITIVE
        | MULTIPLY
        | ALPHA_TO_COVERAGE
        | NO_FOG
        | NO_CONTACT_SHADOWS
        | ALPHA_HASH
        | SINGLE_PASS
        | TRANSMISSION
        | SHADOW_CATCHER
        | COAT_SHEEN
        | WEIGHTED
        | DECAL
        | TRANSLUCENCY
        | SUBSURFACE
        | WIREFRAME
        | PARALLAX
        | NO_TONE_MAP
        | SCENE_DEPTH
        | IRIDESCENCE
        | ANISOTROPY
        | LIGHT_MAP_RGBM
        | NO_COLOR_WRITE;

    /// The features whose material lights layers above its base: a clear coat, a sheen,
    /// iridescence or anisotropy. Each takes the shader builds that [`COAT_SHEEN`] names, whose
    /// row holds every one of their values.
    pub const LAYERS: u32 = COAT_SHEEN | IRIDESCENCE | ANISOTROPY;

    /// True for features that test alpha with the masked shader variant: a mask that neither
    /// blends nor lets light through.
    pub const fn masks(features: u32) -> bool {
        features & ALPHA_MASK != 0 && features & (BLEND | TRANSMISSION) == 0
    }

    /// True for features that draw in the camera's weighted layer: [`WEIGHTED`] with normal
    /// blending, on a surface that does not let light through.
    pub const fn weighs(features: u32) -> bool {
        features & WEIGHTED != 0
            && features & BLEND != 0
            && features & (ADDITIVE | MULTIPLY | TRANSMISSION) == 0
    }
}

/// The blend state of a material's features (`state_flags::BLEND_*`), or 0 for a material that
/// does not blend.
pub const fn blend_state(features: u32) -> u32 {
    if features & feature::BLEND == 0 {
        0
    } else if features & feature::MULTIPLY != 0 {
        state_flags::BLEND_MULTIPLY
    } else if features & feature::ADDITIVE != 0 {
        state_flags::BLEND_ADDITIVE
    } else {
        state_flags::BLEND_NORMAL
    }
}

/// Bits of a row's flags, which shaders test with no cost worth a shader variant.
pub mod flag {
    /// The shader lights each triangle with its face's normal.
    pub const FLAT_SHADING: u32 = 1;
    /// The shader writes its color times its alpha, beside the alpha, as premultiplied blending
    /// reads them. Other shaders write an alpha of 1.
    pub const BLEND: u32 = 2;
    /// The shader skips the scene's fog.
    pub const NO_FOG: u32 = 4;
    /// The base color map holds sRGB colors that were multiplied by their alpha while encoded, so
    /// a material that blends divides them by it again before it uses them.
    pub const MAP_PREMULTIPLIED: u32 = 8;
    /// With `MAP_PREMULTIPLIED`, the base color map holds linear colors instead, multiplied by
    /// their alpha.
    pub const MAP_LINEAR: u32 = 16;
    /// The normal map's slot holds a height map, whose red channel bends the normal by three.js's
    /// bump mapping, with the bump scale in the normal scale's first float.
    pub const BUMP: u32 = 32;
    /// The normal map's slot holds the displacement map, whose slope bends the normal in world
    /// units, so the light follows the moved vertices.
    pub const HEIGHT_NORMALS: u32 = 64;
    /// The map of slot `s` reads the second texture coordinates when bit `SECOND_UV << s` is set.
    pub const SECOND_UV: u32 = 256;
    /// The shader draws only the shadows that fall on the surface, as three.js's `ShadowMaterial`.
    pub const SHADOW_CATCHER: u32 = 128;
    /// In a layered material, the red of the coat map multiplies the clear coat.
    pub const COAT_MAP: u32 = 1 << 16;
    /// In a layered material, the green of the coat map multiplies the coat's roughness.
    pub const COAT_ROUGHNESS_MAP: u32 = 1 << 17;
    /// In a layered material, the color of the sheen map multiplies the sheen color.
    pub const SHEEN_COLOR_MAP: u32 = 1 << 18;
    /// In a layered material, the alpha of the sheen map multiplies the sheen's roughness.
    pub const SHEEN_ROUGHNESS_MAP: u32 = 1 << 19;
    /// The shader takes none of the main directional light's contact shadows.
    pub const NO_CONTACT_SHADOWS: u32 = 1 << 20;
    /// The shader encodes its color without the tone curve on the 8-bit path, where it applies the
    /// output transform itself.
    pub const NO_TONE_MAP: u32 = 1 << 21;
    /// The material has the iridescence feature, so its shaders light the film: the light map's
    /// slot then holds its iridescence map, whose red channel scales the iridescence, and the
    /// specular intensity map's slot its thickness map, whose green channel mixes the thickness
    /// range, where the row's layer maps are its family's.
    pub const IRIDESCENCE: u32 = 1 << 22;
    /// The material has the anisotropy feature, so its shaders stretch the lobe: the specular
    /// color map's slot then holds its anisotropy map, the direction in red and green and the
    /// strength in blue, where the row's layer maps are its family's.
    pub const ANISOTROPY: u32 = 1 << 23;
    /// The light map holds RGBM texels, as Needle's viewer reads its light maps: the color of each
    /// texel is multiplied by its alpha times 8 before the sRGB transfer turns it linear. The
    /// texture is uploaded as linear texels, so the build makes that decode itself.
    pub const LIGHT_MAP_RGBM: u32 = 1 << 24;
}

/// The row flags (`flag::*` bits) of a material with `features` (`feature::*` bits). The base
/// color map's flag comes later, from its texels.
const fn row_flags(features: u32) -> u32 {
    let mut flags = 0;
    if features & feature::FLAT_SHADING != 0 && features & feature::WIREFRAME == 0 {
        flags |= flag::FLAT_SHADING;
    }
    if features & feature::BLEND != 0 {
        flags |= flag::BLEND;
    }
    if features & feature::NO_FOG != 0 {
        flags |= flag::NO_FOG;
    }
    if features & feature::SHADOW_CATCHER != 0 {
        flags |= flag::SHADOW_CATCHER;
    }
    if features & feature::NO_CONTACT_SHADOWS != 0 {
        flags |= flag::NO_CONTACT_SHADOWS;
    }
    if features & feature::NO_TONE_MAP != 0 {
        flags |= flag::NO_TONE_MAP;
    }
    if features & feature::IRIDESCENCE != 0 {
        flags |= flag::IRIDESCENCE;
    }
    if features & feature::ANISOTROPY != 0 {
        flags |= flag::ANISOTROPY;
    }
    if features & feature::LIGHT_MAP_RGBM != 0 {
        flags |= flag::LIGHT_MAP_RGBM;
    }
    flags
}

/// Floats in each material's row: thirty-two `vec4f`s.
pub const MATERIAL_FLOATS: usize = sizes::MATERIAL_BYTES as usize / 4;
/// Floats of a row of custom values that a custom material's uniforms and texture layers use: eight
/// `vec4f`s, as the shader compiler packs them. The rest of the row stays unused.
pub const CUSTOM_FLOATS: usize = 32;
/// Texels in each material's row of the WebGL2 data texture, one `vec4f` each.
pub const MATERIAL_TEXELS: u32 = MATERIAL_FLOATS as u32 / 4;

/// Where each value sits in a material's row, in floats. Colors are linear.
pub mod param {
    /// The base color: 3 floats.
    pub const COLOR: usize = 0;
    /// The opacity, from 0 to 1.
    pub const OPACITY: usize = 3;
    /// The emissive color: 3 floats, which the shaders multiply by [`EMISSIVE_INTENSITY`].
    pub const EMISSIVE: usize = 4;
    /// The alpha below which a masked material draws nothing.
    pub const ALPHA_CUTOFF: usize = 7;
    /// The metalness, from 0 to 1.
    pub const METALNESS: usize = 8;
    /// The perceptual roughness, from 0 to 1.
    pub const ROUGHNESS: usize = 9;
    /// How strongly the normal map bends normals along u and along v: 2 floats.
    pub const NORMAL_SCALE: usize = 10;
    /// How much the occlusion map darkens indirect light, from 0 to 1.
    pub const OCCLUSION_STRENGTH: usize = 12;
    /// The factor of the light map's light.
    pub const LIGHT_MAP_INTENSITY: usize = 13;
    /// Shading switches (`flag::*` bits) as a float, fixed when the material is created.
    pub const FLAGS: usize = 14;
    /// The factor of the emissive color.
    pub const EMISSIVE_INTENSITY: usize = 15;
    /// The transform of the base color map's texture coordinates as two rows of a 2 x 3 matrix. The
    /// row that gives u is 3 floats here, and the row that gives v is 3 floats at [`UV_V`]. Every
    /// other map's transform sits at [`MAP_UV`].
    pub const UV_U: usize = 16;
    /// The factor of the scene environment's light on the surface, as three.js's
    /// `envMapIntensity`.
    pub const ENV_INTENSITY: usize = 19;
    /// The row of the texture coordinate transform that gives v: 3 floats.
    pub const UV_V: usize = 20;
    /// The dielectric reflectance at normal incidence that the index of refraction gives,
    /// `((ior - 1) / (ior + 1))^2`: 0.04 for glTF's default index of 1.5.
    pub const REFLECTANCE: usize = 23;
    /// The texture array layer of each map, in [`super::MapSlot`] order: one float per slot.
    pub const MAP_LAYERS: usize = 24;
    /// The specular color, which tints the dielectric reflectance at normal incidence: 3 floats,
    /// linear, which may exceed 1.
    pub const SPECULAR_COLOR: usize = 32;
    /// The strength of the dielectric specular reflection, from 0 to 1.
    pub const SPECULAR_INTENSITY: usize = 35;
    /// How much light passes through the surface, from 0 to 1, in materials with the
    /// transmission feature.
    pub const TRANSMISSION: usize = 36;
    /// The thickness of the volume under the surface, in the mesh's own units: 0 for a thin wall,
    /// which bends no light.
    pub const THICKNESS: usize = 37;
    /// The index of refraction, 1 or more, which bends the light that passes through. The float
    /// after it holds the light map's direction layer.
    pub const IOR: usize = 38;
    /// The layer of the map that holds a light map's direction, in the radiance's own texture
    /// array, or [`NO_MAP`] where the material has none. On WebGL2 the value is the light map's
    /// unit times [`UNIT_LAYERS`], plus the layer. A shader reads the direction through the light
    /// map's binding, at a layer of its array.
    pub const LIGHT_MAP_DIRECTION: usize = 39;
    /// The color that white light takes after it travels [`ATTENUATION_DISTANCE`] through the
    /// volume: 3 floats, linear.
    pub const ATTENUATION_COLOR: usize = 40;
    /// The distance through the volume over which light takes [`ATTENUATION_COLOR`], in world
    /// units, or 0 for light that the volume does not absorb.
    pub const ATTENUATION_DISTANCE: usize = 43;
    /// How much of the clear coat covers the surface, from 0 to 1, in layered materials.
    pub const CLEARCOAT: usize = 44;
    /// The perceptual roughness of the clear coat, from 0 to 1.
    pub const CLEARCOAT_ROUGHNESS: usize = 45;
    /// How strongly the coat normal map bends the coat's normals along u and along v: 2 floats.
    pub const CLEARCOAT_NORMAL_SCALE: usize = 46;
    /// The color of the sheen, linear: 3 floats. Black gives no sheen.
    pub const SHEEN_COLOR: usize = 48;
    /// The perceptual roughness of the sheen, from 0 to 1.
    pub const SHEEN_ROUGHNESS: usize = 51;
    /// The color that tints the light that passes through a thin surface, linear: 3 floats, in
    /// materials with the translucency feature.
    pub const DIFFUSE_TRANSMISSION_COLOR: usize = 52;
    /// How much of the surface's diffuse light passes through it to its other side, from 0 to 1.
    pub const DIFFUSE_TRANSMISSION: usize = 55;
    /// Each channel's share of the scatter radius, linear: 3 floats, in materials with the
    /// subsurface feature. Skin's red light scatters furthest.
    pub const SUBSURFACE_COLOR: usize = 56;
    /// How far light spreads under the surface before it leaves it, in world units, taken as
    /// metres: the scatter distance of a channel whose share is 1.
    pub const SUBSURFACE_RADIUS: usize = 59;
    /// How much of the light reflected by a thin film above the surface is iridescent, from 0 to 1,
    /// in materials with the iridescence feature.
    pub const IRIDESCENCE: usize = 60;
    /// The index of refraction of the film above the surface, 1 or more: 1 makes it as thin as no
    /// film at all.
    pub const IRIDESCENCE_IOR: usize = 61;
    /// The thickness of the film where the thickness map's green channel is 0, in nanometers.
    pub const IRIDESCENCE_THICKNESS_MIN: usize = 62;
    /// The thickness of the film where the thickness map's green channel is 1, in nanometers.
    pub const IRIDESCENCE_THICKNESS_MAX: usize = 63;
    /// How strongly the specular lobe stretches along a direction of the tangent frame, from 0 to
    /// 1, in materials with the anisotropy feature.
    pub const ANISOTROPY: usize = 64;
    /// The direction along which the lobe stretches, in radians from the tangent.
    pub const ANISOTROPY_ROTATION: usize = 65;
    /// Which family's maps each group of shared slots holds, as [`LayerMap::kind`] gives it, packed
    /// two bits each: bits 0 and 1 for the light map's slot, bits 2 and 3 for the specular intensity
    /// map's, and bits 4 and 5 for the specular color map's. 0 is a clear coat's and a sheen's, 1 is
    /// iridescence's and the anisotropy's, and 2 is the transmission and thickness maps' of a
    /// material that lets light through. The core sets each group's bits as it sets a layer map that
    /// fills that group's slot, so a shader reads the maps that the material gave. A material with
    /// layers may keep its transmission and thickness maps in the specular slots beside a layer map
    /// of the light slot, and each specular slot names its own family, since one may hold a layer map
    /// while the other holds a transmission or a thickness map.
    pub const LAYER_MAPS_KIND: usize = 66;
    /// The strength of the volume's dispersion, 0 or more, in materials that let light through:
    /// 20 divided by the Abbe number, as glTF's `KHR_materials_dispersion` gives it. Each color
    /// channel bends by its own index of refraction, so the light from behind separates into
    /// colors. 0 bends every channel alike.
    pub const DISPERSION: usize = 67;
    /// How a light map's texture coordinates stretch along u and along v: 2 floats. The scale is
    /// 1 by default, which leaves the coordinates alone.
    pub const LIGHT_MAP_SCALE: usize = 68;
    /// Where a light map's texture coordinates start along u and along v: 2 floats. The offset is
    /// 0 by default.
    pub const LIGHT_MAP_OFFSET: usize = 70;
    /// The first of the transforms that the row keeps apart from the base color map's: the row that
    /// gives u, 3 floats, then the row that gives v, 3 floats, and two spares that keep each pair on
    /// a texel boundary, for each map slot from [`MapSlot::MetalRough`](super::MapSlot::MetalRough)
    /// up. A map's own transform lets a file place each of its maps differently, as three.js keeps
    /// one transform for each texture.
    pub const MAP_UV: usize = 72;
    /// Floats that each map's transform takes in the row: its two rows and their spares.
    pub const MAP_UV_STRIDE: usize = 8;
    /// The texel of the row that [`MAP_UV`] starts at, one per `vec4f`.
    pub const MAP_UV_TEXEL: u32 = 18;

    /// The float of the row that holds the transform of the map in `slot`, for a slot from 1 up
    /// ([`UV_U`] and [`UV_V`] hold slot 0's): the row that gives u, with the row that gives v 4
    /// floats after it. `slot` equal to [`super::MAP_SLOTS`] gives the first float after the block.
    pub const fn map_uv(slot: usize) -> usize {
        MAP_UV + (slot - 1) * MAP_UV_STRIDE
    }
    /// A decal material's values take the place of the transmission's, which a decal never has.
    /// The cosine of the angle from the decal's direction at which it starts to fade.
    pub const DECAL_FADE_START: usize = TRANSMISSION;
    /// The cosine of the angle from the decal's direction past which it shows nothing.
    pub const DECAL_FADE_END: usize = THICKNESS;
    /// The share of the box's depth, from 0 to 1, over which the decal fades at each end.
    pub const DECAL_EDGE_FADE: usize = IOR;

    /// The floats of the value that starts at `at`, for a value that sketches set, or `None` for
    /// the flags, the map layers or a float inside a value.
    pub const fn width(at: usize) -> Option<usize> {
        // Each map transform of the slots from the second up is the row that gives u, and the row
        // that gives v, 4 floats further on.
        if at >= MAP_UV && at < map_uv(super::MAP_SLOTS) && (at - MAP_UV).is_multiple_of(4) {
            return Some(3);
        }
        match at {
            COLOR
            | EMISSIVE
            | UV_U
            | UV_V
            | SPECULAR_COLOR
            | ATTENUATION_COLOR
            | SHEEN_COLOR
            | DIFFUSE_TRANSMISSION_COLOR
            | SUBSURFACE_COLOR => Some(3),
            NORMAL_SCALE | CLEARCOAT_NORMAL_SCALE | LIGHT_MAP_SCALE | LIGHT_MAP_OFFSET => Some(2),
            OPACITY
            | ALPHA_CUTOFF
            | METALNESS
            | ROUGHNESS
            | OCCLUSION_STRENGTH
            | LIGHT_MAP_INTENSITY
            | EMISSIVE_INTENSITY
            | ENV_INTENSITY
            | REFLECTANCE
            | SPECULAR_INTENSITY
            | TRANSMISSION
            | THICKNESS
            | IOR
            | ATTENUATION_DISTANCE
            | CLEARCOAT
            | CLEARCOAT_ROUGHNESS
            | SHEEN_ROUGHNESS
            | DIFFUSE_TRANSMISSION
            | SUBSURFACE_RADIUS
            | IRIDESCENCE
            | IRIDESCENCE_IOR
            | IRIDESCENCE_THICKNESS_MIN
            | IRIDESCENCE_THICKNESS_MAX
            | ANISOTROPY
            | ANISOTROPY_ROTATION
            | DISPERSION => Some(1),
            _ => None,
        }
    }
}

/// A range of ids grown to hold `id`.
fn marked(range: &Range<u32>, id: u32) -> Range<u32> {
    if range.is_empty() {
        id..id + 1
    } else {
        range.start.min(id)..range.end.max(id + 1)
    }
}

/// A map layer in a row for a map that draws nothing: none is set, or its image is not on the
/// GPU yet. Shaders test for a layer of 0 or more.
pub const NO_MAP: f32 = -1.0;

/// The layers of one shared unit in a map's layer as a row holds it: the most layers of a texture
/// array, so a layer and its unit never mix.
pub const UNIT_LAYERS: u32 = crate::textures::MAX_LAYERS;

/// The unit of a map that found no shared unit (see [`MaterialTable::set_map_units`]).
pub const NO_UNIT: u8 = u8::MAX;

/// The maps a material can sample, in the order their layers sit in its row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapSlot {
    /// The base color and opacity, in sRGB.
    BaseColor = 0,
    /// Roughness in green and metalness in blue, as glTF packs them.
    MetalRough = 1,
    /// Normals in tangent space.
    Normal = 2,
    /// Ambient occlusion in red.
    Occlusion = 3,
    /// The emissive color, in sRGB.
    Emissive = 4,
    /// Baked light, read at the second texture coordinates.
    Light = 5,
    /// The strength of the specular reflection in alpha, which multiplies the specular intensity.
    SpecularIntensity = 6,
    /// The specular color, in sRGB, which multiplies the specular color value.
    SpecularColor = 7,
}

impl MapSlot {
    /// The slot that holds the diffuse transmission map of a material with the translucency
    /// feature: its alpha scales the diffuse transmission, in linear color, as the specular
    /// intensity map's alpha scales the specular intensity.
    pub const DIFFUSE_TRANSMISSION: MapSlot = MapSlot::SpecularIntensity;
    /// The slot that holds the diffuse transmission color map of a material with the translucency
    /// feature: its sRGB color scales the transmission color, as the specular color map's scales
    /// the specular color.
    pub const DIFFUSE_TRANSMISSION_COLOR: MapSlot = MapSlot::SpecularColor;
}

/// A map that takes a slot that the material has no other use for, and that the row's kind names.
///
/// A material with layers above its base ([`feature::LAYERS`]) has no light map and no specular
/// maps, so the layers' maps take those slots, packed as glTF packs them: the coat in red and its
/// roughness in green of one map, the coat's normals in another, the sheen's color in RGB and its
/// roughness in alpha of a third, the iridescence in the red of a fourth and its thickness in the
/// green of a fifth, and the anisotropy in the RGB of a sixth. A material that lets light through a
/// thin surface has no specular maps either, so its transmission and thickness maps take the two
/// specular slots, which the diffuse transmission maps of a translucent material take as well. A row
/// flag says which channels of a shared map apply.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayerMap {
    /// The clear coat in red, in linear color.
    Coat,
    /// The coat's roughness in green, in linear color, in the coat map's slot.
    CoatRoughness,
    /// The coat's normals in tangent space, in linear color.
    CoatNormal,
    /// The sheen color in RGB, in sRGB.
    SheenColor,
    /// The sheen's roughness in alpha, in the sheen color map's slot.
    SheenRoughness,
    /// The iridescence in red, in linear color, in the light map's slot.
    Iridescence,
    /// The film's thickness in green, in linear color, in the specular intensity map's slot.
    IridescenceThickness,
    /// The anisotropy's direction in red and green and its strength in blue, in linear color, in
    /// the specular color map's slot.
    Anisotropy,
    /// The share of the light behind the surface that passes through it in red, in linear color,
    /// in the specular intensity map's slot.
    Transmission,
    /// The thickness of the volume in green, in linear color, in the specular color map's slot.
    Thickness,
}

impl LayerMap {
    /// Every layer map, in the order that `setMaterialMap` numbers them after the map slots.
    pub const ALL: [LayerMap; 10] = [
        LayerMap::Coat,
        LayerMap::CoatRoughness,
        LayerMap::CoatNormal,
        LayerMap::SheenColor,
        LayerMap::SheenRoughness,
        LayerMap::Iridescence,
        LayerMap::IridescenceThickness,
        LayerMap::Anisotropy,
        LayerMap::Transmission,
        LayerMap::Thickness,
    ];

    /// Which family of maps the slot that holds it belongs to: 0 for a clear coat's and a sheen's,
    /// 1 for iridescence's and the anisotropy's, and 2 for the transmission and thickness maps' of
    /// a material that lets light through.
    pub const fn kind(self) -> u32 {
        match self {
            LayerMap::Coat
            | LayerMap::CoatRoughness
            | LayerMap::CoatNormal
            | LayerMap::SheenColor
            | LayerMap::SheenRoughness => 0,
            LayerMap::Iridescence | LayerMap::IridescenceThickness | LayerMap::Anisotropy => 1,
            LayerMap::Transmission | LayerMap::Thickness => 2,
        }
    }

    /// The slot that holds the map.
    pub const fn slot(self) -> MapSlot {
        match self {
            LayerMap::Coat | LayerMap::CoatRoughness | LayerMap::Iridescence => MapSlot::Light,
            LayerMap::CoatNormal | LayerMap::IridescenceThickness | LayerMap::Transmission => {
                MapSlot::SpecularIntensity
            }
            LayerMap::SheenColor
            | LayerMap::SheenRoughness
            | LayerMap::Anisotropy
            | LayerMap::Thickness => MapSlot::SpecularColor,
        }
    }

    /// The bit of the row's kinds at which this map's slot names its family
    /// ([`param::LAYER_MAPS_KIND`]).
    pub const fn kind_shift(self) -> u32 {
        match self.slot() {
            MapSlot::Light => 0,
            MapSlot::SpecularIntensity => 2,
            MapSlot::SpecularColor => 4,
            _ => 0,
        }
    }

    /// The row flag (`flag::*`) that says the map's channel applies, or 0 for a map whose slot
    /// holds nothing else.
    pub const fn flag(self) -> u32 {
        match self {
            LayerMap::Coat => flag::COAT_MAP,
            LayerMap::CoatRoughness => flag::COAT_ROUGHNESS_MAP,
            LayerMap::CoatNormal => 0,
            LayerMap::SheenColor => flag::SHEEN_COLOR_MAP,
            LayerMap::SheenRoughness => flag::SHEEN_ROUGHNESS_MAP,
            LayerMap::Iridescence
            | LayerMap::IridescenceThickness
            | LayerMap::Anisotropy
            | LayerMap::Transmission
            | LayerMap::Thickness => 0,
        }
    }
}

/// The number of map slots in a row.
pub const MAP_SLOTS: usize = sizes::MAP_SLOTS as usize;

/// The float of a material's custom values that holds the layer of its custom texture `k`: the
/// last float of the custom values for the first texture, and one float lower for each next one,
/// as the shader compiler places them.
pub const fn texture_layer_offset(k: usize) -> usize {
    CUSTOM_FLOATS - 1 - k
}

/// Where a standard material's displacement map keeps its values: in its row of custom values,
/// which both shader stages read, unlike the row itself on WebGPU, and which standard materials
/// have no other use for.
pub mod height {
    /// The displacement map's layer, which the vertex stage samples through the map's own binding,
    /// or [`super::NO_MAP`] until its image is on the GPU.
    pub const LAYER: usize = 0;
    /// The distance that the map's white moves a vertex along its normal, in the mesh's units, as
    /// three.js's `displacementScale`.
    pub const SCALE: usize = 1;
    /// The distance added to every vertex's, as three.js's `displacementBias`.
    pub const BIAS: usize = 2;
    /// 1 when the map reads the second texture coordinates, else 0.
    pub const SECOND_UV: usize = 3;
    /// A copy of the row's texture coordinate transform: the row that gives u, 3 floats.
    pub const UV_U: usize = 4;
    /// The row of the transform that gives v, 3 floats.
    pub const UV_V: usize = 8;
    /// The layer that the fragment stage samples for parallax, with its shared unit times
    /// [`super::UNIT_LAYERS`] where maps share units, or [`super::NO_MAP`] where it has none.
    pub const PIXEL_LAYER: usize = 11;
}

/// The custom values of a material that is not custom: the displacement map's values, with no map,
/// three.js's default scale of 1 and bias of 0, and the identity texture coordinate transform.
const DEFAULT_HEIGHT_VALUES: [f32; 12] = [
    NO_MAP, 1.0, 0.0, 0.0, // layer, scale, bias, second coordinates
    1.0, 0.0, 0.0, 0.0, // the row that gives u
    0.0, 1.0, 0.0, NO_MAP, // the row that gives v, and the fragment stage's layer
];

/// Where a material id stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Live,
    /// Destroyed, while objects or batches may still name it.
    Destroyed,
    /// Free for the next material.
    Free,
}

impl MapSlot {
    /// Every slot in the order that its map takes a shared unit, where a builder's maps share a
    /// few. When a material's maps need more units than there are, the maps last in this order
    /// draw without their texture: the specular maps first, which change the look least.
    pub const SHARING_ORDER: [MapSlot; MAP_SLOTS] = [
        MapSlot::BaseColor,
        MapSlot::Normal,
        MapSlot::MetalRough,
        MapSlot::Occlusion,
        MapSlot::Emissive,
        MapSlot::Light,
        MapSlot::SpecularColor,
        MapSlot::SpecularIntensity,
    ];

    /// Every slot, in the order of a row's maps, so a slot's number indexes it.
    pub const ALL: [MapSlot; MAP_SLOTS] = [
        MapSlot::BaseColor,
        MapSlot::MetalRough,
        MapSlot::Normal,
        MapSlot::Occlusion,
        MapSlot::Emissive,
        MapSlot::Light,
        MapSlot::SpecularIntensity,
        MapSlot::SpecularColor,
    ];
}

/// A row's values before the sketch changes any: white, opaque, not metal, fully rough, the
/// identity texture coordinate transform, a white specular color at full intensity with glTF's
/// index of refraction, no maps, no transmission through a thin wall that absorbs nothing, no
/// clear coat and a black sheen of full roughness, no diffuse transmission with a white
/// transmission color, and no scatter radius with a white scatter color. The metalness and
/// roughness are three.js's `MeshStandardMaterial` defaults; the alpha cutoff, the index of
/// refraction, the volume's values and the diffuse transmission's values are glTF's, and the
/// layers' values three.js's `MeshPhysicalMaterial` defaults.
const DEFAULT_ROW: [f32; MATERIAL_FLOATS] = {
    let mut row = [0.0; MATERIAL_FLOATS];
    let mut k = 0;
    while k < 4 {
        row[param::COLOR + k] = 1.0;
        k += 1;
    }
    row[param::ALPHA_CUTOFF] = 0.5;
    row[param::ROUGHNESS] = 1.0;
    row[param::NORMAL_SCALE] = 1.0;
    row[param::NORMAL_SCALE + 1] = 1.0;
    row[param::OCCLUSION_STRENGTH] = 1.0;
    row[param::LIGHT_MAP_INTENSITY] = 1.0;
    row[param::EMISSIVE_INTENSITY] = 1.0;
    row[param::ENV_INTENSITY] = 1.0;
    row[param::UV_U] = 1.0;
    row[param::UV_V + 1] = 1.0;
    let mut slot = 1;
    while slot < MAP_SLOTS {
        row[param::map_uv(slot)] = 1.0;
        row[param::map_uv(slot) + 5] = 1.0;
        slot += 1;
    }
    row[param::REFLECTANCE] = 0.04;
    row[param::LIGHT_MAP_DIRECTION] = NO_MAP;
    row[param::LIGHT_MAP_SCALE] = 1.0;
    row[param::LIGHT_MAP_SCALE + 1] = 1.0;
    let mut k = 0;
    while k < 4 {
        row[param::SPECULAR_COLOR + k] = 1.0;
        k += 1;
    }
    let mut slot = 0;
    while slot < MAP_SLOTS {
        row[param::MAP_LAYERS + slot] = NO_MAP;
        slot += 1;
    }
    row[param::IOR] = 1.5;
    let mut k = 0;
    while k < 3 {
        row[param::ATTENUATION_COLOR + k] = 1.0;
        k += 1;
    }
    row[param::CLEARCOAT_NORMAL_SCALE] = 1.0;
    row[param::CLEARCOAT_NORMAL_SCALE + 1] = 1.0;
    row[param::SHEEN_ROUGHNESS] = 1.0;
    row[param::IRIDESCENCE_IOR] = 1.3;
    row[param::IRIDESCENCE_THICKNESS_MIN] = 100.0;
    row[param::IRIDESCENCE_THICKNESS_MAX] = 400.0;
    let mut k = 0;
    while k < 3 {
        row[param::DIFFUSE_TRANSMISSION_COLOR + k] = 1.0;
        k += 1;
    }
    let mut k = 0;
    while k < 3 {
        row[param::SUBSURFACE_COLOR + k] = 1.0;
        k += 1;
    }
    row
};

/// The decal values of a new decal material's row, in place of the transmission's: the decal
/// starts to fade 60 degrees from its direction and shows nothing past 80 degrees, as cosines, and
/// fades over the last fifth of its box's depth at each end.
pub const DECAL_DEFAULTS: [f32; 3] = [0.5, 0.173_648_18, 0.2];

/// Materials by id, with a fixed capacity so the GPU table never moves.
#[derive(Debug)]
pub struct MaterialTable {
    /// Each material's row, in id order.
    rows: Vec<f32>,
    shading: Vec<Shading>,
    /// Each material's features (`feature::*` bits).
    features: Vec<u32>,
    /// Each material's maps by slot, `Handle::NONE` where it has none.
    maps: Vec<[Handle; MAP_SLOTS]>,
    /// The shared unit that each material's map samples, by slot (see [`MaterialTable::set_map_units`]).
    map_units: Vec<[u8; MAP_SLOTS]>,
    /// Each material's displacement map, `Handle::NONE` where it has none.
    heights: Vec<Handle>,
    /// Each material's light map direction map, `Handle::NONE` where it has none. It shares the
    /// light map's texture array, so a shader reads it through the light map's binding.
    directions: Vec<Handle>,
    /// The shared unit that each material's displacement map samples in the fragment stage, where
    /// maps share units and the material takes parallax.
    height_units: Vec<u8>,
    /// The farthest that each material's displacement has moved a vertex, in the mesh's units: the
    /// margin that bounding spheres grow by. It only grows, so objects need new bounds rarely.
    margins: Vec<f32>,
    /// Each material's custom values, in id order: zero until a custom material sets them.
    values: Vec<f32>,
    /// Each material's depth bias.
    biases: Vec<DepthBias>,
    /// Where each id stands.
    states: Vec<State>,
    /// The ids that new materials take before the table grows, the lowest last.
    free: Vec<u32>,
    /// True while destroyed materials wait for their ids to go back to the table.
    destroyed: bool,
    capacity: u32,
    /// The ids whose rows changed since the last upload; empty when none did.
    changed: Range<u32>,
    /// The ids whose custom values changed since the last upload; empty when none did.
    values_changed: Range<u32>,
    /// True when a map changed since its layer was last written.
    maps_changed: bool,
    /// The live materials whose light the subsurface blur spreads.
    scattering: u32,
    /// The live materials that keep their color as the display shows it.
    unmapped: u32,
}

/// True for a material of the standard shading, with or without maps, whose features give it a
/// scatter radius.
fn scatters(shading: Shading, features: u32) -> bool {
    features & feature::SUBSURFACE != 0 && matches!(shading, Shading::Lit | Shading::StandardMaps)
}

/// True for a material that keeps its color as the display shows it.
fn keeps_display_color(features: u32) -> bool {
    features & feature::NO_TONE_MAP != 0
}

/// Why a material could not be created or changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaterialError {
    /// The table holds its capacity already.
    Full,
    /// No material has this id.
    Unknown(u32),
    /// No value that sketches set starts at this float of a row, or the value has another width.
    Value(u32),
}

impl MaterialTable {
    pub fn with_capacity(capacity: u32) -> Self {
        Self {
            rows: Vec::with_capacity(capacity as usize * MATERIAL_FLOATS),
            shading: Vec::with_capacity(capacity as usize),
            features: Vec::with_capacity(capacity as usize),
            maps: Vec::with_capacity(capacity as usize),
            map_units: Vec::with_capacity(capacity as usize),
            heights: Vec::with_capacity(capacity as usize),
            directions: Vec::with_capacity(capacity as usize),
            height_units: Vec::with_capacity(capacity as usize),
            margins: Vec::with_capacity(capacity as usize),
            values: Vec::with_capacity(capacity as usize * MATERIAL_FLOATS),
            biases: Vec::with_capacity(capacity as usize),
            states: Vec::with_capacity(capacity as usize),
            free: Vec::new(),
            destroyed: false,
            capacity,
            changed: 0..0,
            values_changed: 0..0,
            maps_changed: false,
            scattering: 0,
            unmapped: 0,
        }
    }

    /// Adds a material with its features (`feature::*` bits, fixed from now on), a linear color
    /// and opacity, and the default values of the rest of its row. Returns its id, counting from 0:
    /// the lowest id that a destroyed material gave back, or else the next new one.
    pub fn create(
        &mut self,
        shading: Shading,
        features: u32,
        color: [f32; 4],
    ) -> Result<u32, MaterialError> {
        let reused = !self.free.is_empty();
        let id = match self.free.pop() {
            Some(id) => id,
            None if self.len() < self.capacity => {
                self.rows.extend_from_slice(&DEFAULT_ROW);
                self.shading.push(shading);
                self.features.push(0);
                self.maps.push([Handle::NONE; MAP_SLOTS]);
                self.map_units.push([0; MAP_SLOTS]);
                self.heights.push(Handle::NONE);
                self.directions.push(Handle::NONE);
                self.height_units.push(0);
                self.margins.push(0.0);
                self.values.extend_from_slice(&[0.0; MATERIAL_FLOATS]);
                self.biases.push(DepthBias::NONE);
                self.states.push(State::Live);
                self.len() - 1
            }
            None => return Err(MaterialError::Full),
        };
        let at = id as usize;
        let features = features & feature::ALL;
        let row = &mut self.rows[at * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
        row.copy_from_slice(&DEFAULT_ROW);
        row[..4].copy_from_slice(&color);
        row[param::FLAGS] = row_flags(features) as f32;
        if features & feature::DECAL != 0 {
            row[param::DECAL_FADE_START..][..DECAL_DEFAULTS.len()].copy_from_slice(&DECAL_DEFAULTS);
        }
        self.shading[at] = shading;
        self.features[at] = features;
        self.maps[at] = [Handle::NONE; MAP_SLOTS];
        self.map_units[at] = [0; MAP_SLOTS];
        self.heights[at] = Handle::NONE;
        self.directions[at] = Handle::NONE;
        self.height_units[at] = 0;
        self.margins[at] = 0.0;
        self.biases[at] = DepthBias::NONE;
        self.states[at] = State::Live;
        self.scattering += u32::from(scatters(shading, features));
        self.unmapped += u32::from(keeps_display_color(features));
        let values = &mut self.values[at * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
        values.fill(0.0);
        let textures = match shading {
            Shading::Custom(custom) => (custom.textures as usize).min(MAP_SLOTS),
            _ => {
                values[..DEFAULT_HEIGHT_VALUES.len()].copy_from_slice(&DEFAULT_HEIGHT_VALUES);
                0
            }
        };
        for k in 0..textures {
            values[texture_layer_offset(k)] = NO_MAP;
        }
        // A new row's values start at zero on the GPU too; a reused row's hold the last material's.
        if reused || !matches!(shading, Shading::Custom(_)) || textures > 0 {
            self.values_changed = marked(&self.values_changed, id);
        }
        self.mark_row(id);
        Ok(id)
    }

    /// Destroys a material: it draws nothing from now on, and its maps let go of their textures.
    /// Its id stays taken until [`MaterialTable::release_unused`] finds no object that names it.
    pub fn destroy(&mut self, id: u32) -> Result<(), MaterialError> {
        let at = id as usize;
        if self.states.get(at) != Some(&State::Live) {
            return Err(MaterialError::Unknown(id));
        }
        self.states[at] = State::Destroyed;
        self.scattering -= u32::from(scatters(self.shading[at], self.features[at]));
        self.unmapped -= u32::from(keeps_display_color(self.features[at]));
        self.maps[at] = [Handle::NONE; MAP_SLOTS];
        self.heights[at] = Handle::NONE;
        self.directions[at] = Handle::NONE;
        self.maps_changed = true;
        self.destroyed = true;
        Ok(())
    }

    /// True while a destroyed material waits for its id to go back to the table.
    pub fn has_destroyed(&self) -> bool {
        self.destroyed
    }

    /// Gives the ids of destroyed materials back to the table, unless `used` says that an object
    /// or a batch still names them.
    pub fn release_unused(&mut self, used: impl Fn(u32) -> bool) {
        self.destroyed = false;
        for id in 0..self.len() {
            if self.states[id as usize] != State::Destroyed {
                continue;
            }
            if used(id) {
                self.destroyed = true;
            } else {
                self.states[id as usize] = State::Free;
                self.free.push(id);
            }
        }
        // The lowest free id goes first, so ids stay low.
        self.free.sort_unstable_by(|a, b| b.cmp(a));
    }

    /// True when a material with this id lives: created, and not destroyed.
    pub fn is_live(&self, id: u32) -> bool {
        self.states.get(id as usize) == Some(&State::Live)
    }

    /// True when the material, by id, has a scatter radius whose light the subsurface blur
    /// spreads: the standard material's, with or without maps.
    pub fn scatters(&self, id: u32) -> bool {
        let at = id as usize;
        at < self.features.len() && scatters(self.shading[at], self.features[at])
    }

    /// True while some live material has a scatter radius, so the frame builders hold the
    /// subsurface blur's layout.
    pub fn any_scatters(&self) -> bool {
        self.scattering > 0
    }

    /// True when the material, by id, keeps its color as the display shows it: the material's own
    /// shader skips the tone curve on the 8-bit path, and the mask marks the pixels that skip it
    /// on the HDR path.
    pub fn keeps_display_color(&self, id: u32) -> bool {
        let at = id as usize;
        at < self.features.len()
            && self.states[at] == State::Live
            && keeps_display_color(self.features[at])
    }

    /// True while some live material keeps its color as the display shows it, so the frame builders
    /// hold the tone mask's layout.
    pub fn any_keeps_display_color(&self) -> bool {
        self.unmapped > 0
    }

    /// True when the material, by id, reads the copy of the camera's opaque depth.
    pub fn reads_scene_depth(&self, id: u32) -> bool {
        self.is_live(id) && self.features(id) & feature::SCENE_DEPTH != 0
    }

    /// True while some live material reads the copy of the camera's opaque depth, so the frame
    /// makes that copy whatever the quality preset says.
    pub fn any_reads_scene_depth(&self) -> bool {
        (0..self.len()).any(|id| self.reads_scene_depth(id))
    }

    /// True when a live material's shader reads the table of object ranges, which the frame
    /// builders then fill.
    pub fn reads_object_ids(&self) -> bool {
        (0..self.len()).any(|id| self.is_live(id) && self.shading[id as usize].reads_object_ids())
    }

    /// True when a template is a custom one that no live material draws with.
    pub fn custom_template_unused(&self, template: u32) -> bool {
        template >= template::CUSTOM_FIRST && !(0..self.len()).any(|id| {
            self.is_live(id)
                && matches!(self.shading[id as usize], Shading::Custom(c) if c.template == template)
        })
    }

    /// Changes 1 to 4 custom values of a material, from float `at` of its row of custom values,
    /// and keeps the others.
    pub fn set_values(&mut self, id: u32, at: usize, values: &[f32]) -> Result<(), MaterialError> {
        if values.is_empty() || values.len() > 4 || at + values.len() > CUSTOM_FLOATS {
            return Err(MaterialError::Value(at as u32));
        }
        if !self.is_live(id) {
            return Err(MaterialError::Unknown(id));
        }
        let start = id as usize * MATERIAL_FLOATS + at;
        let row = self.values.get_mut(start..start + values.len());
        row.ok_or(MaterialError::Unknown(id))?
            .copy_from_slice(values);
        self.values_changed = marked(&self.values_changed, id);
        Ok(())
    }

    /// The custom values of the materials in `ids`, one row after another.
    pub fn values(&self, ids: Range<u32>) -> &[f32] {
        &self.values[ids.start as usize * MATERIAL_FLOATS..ids.end as usize * MATERIAL_FLOATS]
    }

    /// The ids whose custom values changed since the last call, once, or `None` when none did.
    pub fn take_values_changed(&mut self) -> Option<Range<u32>> {
        let changed = std::mem::replace(&mut self.values_changed, 0..0);
        (!changed.is_empty()).then_some(changed)
    }

    /// Gives a material a depth bias. It is part of the material's pipeline, so it is set once,
    /// right after [`MaterialTable::create`].
    pub fn set_depth_bias(&mut self, id: u32, bias: DepthBias) -> Result<(), MaterialError> {
        let slot = self
            .biases
            .get_mut(id as usize)
            .ok_or(MaterialError::Unknown(id))?;
        *slot = bias;
        Ok(())
    }

    /// A material's depth bias, or none for an id that names no material.
    pub fn depth_bias(&self, id: u32) -> DepthBias {
        self.biases
            .get(id as usize)
            .copied()
            .unwrap_or(DepthBias::NONE)
    }

    /// Changes the value that starts at float `at` of a material's row (`param::*`) and keeps the
    /// others. `values` holds as many floats as the value has.
    pub fn set(&mut self, id: u32, at: usize, values: &[f32]) -> Result<(), MaterialError> {
        if param::width(at) != Some(values.len()) {
            return Err(MaterialError::Value(at as u32));
        }
        if !self.is_live(id) {
            return Err(MaterialError::Unknown(id));
        }
        let start = id as usize * MATERIAL_FLOATS + at;
        let row = self.rows.get_mut(start..start + values.len());
        row.ok_or(MaterialError::Unknown(id))?
            .copy_from_slice(values);
        self.mark_row(id);
        // The displacement map holds the normal map's slot, and its vertex stage reads that map's
        // transform from a copy in the custom values, which both stages read on both GPU paths.
        let normal = param::map_uv(MapSlot::Normal as usize);
        let copy = match at {
            at if at == normal => Some(height::UV_U),
            at if at == normal + 4 => Some(height::UV_V),
            _ => None,
        };
        if let Some(copy) = copy
            && !matches!(self.shading[id as usize], Shading::Custom(_))
        {
            let start = id as usize * MATERIAL_FLOATS + copy;
            self.values[start..start + values.len()].copy_from_slice(values);
            self.values_changed = marked(&self.values_changed, id);
        }
        Ok(())
    }

    /// Adds a row to the range that the next frame uploads.
    fn mark_row(&mut self, id: u32) {
        self.changed = marked(&self.changed, id);
    }

    /// Gives a material a map in `slot`: a texture, or none with `Handle::NONE`, which the
    /// shader reads at the second texture coordinates when `second_uv` is true.
    pub fn set_map(
        &mut self,
        id: u32,
        slot: MapSlot,
        texture: Handle,
        second_uv: bool,
    ) -> Result<(), MaterialError> {
        if !self.is_live(id) {
            return Err(MaterialError::Unknown(id));
        }
        self.put_map(id, slot, texture, second_uv);
        if slot == MapSlot::Normal {
            self.set_flags(id, flag::BUMP | flag::HEIGHT_NORMALS, 0);
            self.share_height_normals(id);
        }
        Ok(())
    }

    /// Gives a standard material a bump map, a height map in the normal map's slot, or none with
    /// `Handle::NONE`. A wireframe material keeps the map but draws without it, as three.js's does:
    /// its pipelines leave out the bump builds.
    pub fn set_bump_map(
        &mut self,
        id: u32,
        texture: Handle,
        second_uv: bool,
    ) -> Result<(), MaterialError> {
        self.set_map(id, MapSlot::Normal, texture, second_uv)?;
        let bits = if texture.is_none() { 0 } else { flag::BUMP };
        self.set_flags(id, flag::BUMP, bits);
        Ok(())
    }

    /// True when a material's normal map's slot holds a bump map.
    pub fn bumps(&self, id: u32) -> bool {
        self.flags(id) & flag::BUMP != 0
    }

    /// Gives a standard material a displacement map, which moves each vertex along its normal, or
    /// none with `Handle::NONE`. Without a normal or bump map, the map also bends the normals.
    pub fn set_displacement_map(
        &mut self,
        id: u32,
        texture: Handle,
        second_uv: bool,
    ) -> Result<(), MaterialError> {
        if !self.is_live(id) || matches!(self.shading[id as usize], Shading::Custom(_)) {
            return Err(MaterialError::Unknown(id));
        }
        self.heights[id as usize] = texture;
        let values = &mut self.values[id as usize * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
        values[height::SECOND_UV] = if second_uv { 1.0 } else { 0.0 };
        let (scale, bias) = (values[height::SCALE], values[height::BIAS]);
        let margin = &mut self.margins[id as usize];
        *margin = margin.max(bias.abs()).max((scale + bias).abs());
        self.values_changed = marked(&self.values_changed, id);
        self.maps_changed = true;
        if self.flags(id) & flag::HEIGHT_NORMALS != 0 {
            self.put_map(id, MapSlot::Normal, Handle::NONE, false);
            self.set_flags(id, flag::HEIGHT_NORMALS, 0);
        }
        self.share_height_normals(id);
        Ok(())
    }

    /// Changes how far a standard material's displacement map moves vertices: the distance of
    /// the map's white, and the distance added to every vertex's. Returns true when the farthest
    /// distance grew, so the bounds of objects with the material must grow too.
    pub fn set_displacement(
        &mut self,
        id: u32,
        scale: f32,
        bias: f32,
    ) -> Result<bool, MaterialError> {
        if !self.is_live(id) || matches!(self.shading[id as usize], Shading::Custom(_)) {
            return Err(MaterialError::Unknown(id));
        }
        let start = id as usize * MATERIAL_FLOATS;
        self.values[start + height::SCALE] = scale;
        self.values[start + height::BIAS] = bias;
        self.values_changed = marked(&self.values_changed, id);
        let farthest = bias.abs().max((scale + bias).abs());
        let margin = &mut self.margins[id as usize];
        let grew = farthest > *margin;
        *margin = margin.max(farthest);
        Ok(grew && !self.heights[id as usize].is_none())
    }

    /// True when any material has a displacement map.
    pub fn any_displacement(&self) -> bool {
        self.heights.iter().any(|map| !map.is_none())
    }

    /// A material's displacement map, or `Handle::NONE`.
    pub fn displacement_map(&self, id: u32) -> Handle {
        self.heights
            .get(id as usize)
            .copied()
            .unwrap_or(Handle::NONE)
    }

    /// Gives a material the direction map of its light map, or `Handle::NONE` to light as a plain
    /// light map. A shader reads the direction through the light map's own binding, so the map
    /// must share the light map's texture array; [`MaterialTable::update_map_layers`] writes no
    /// layer for a map that does not.
    pub fn set_light_map_direction(
        &mut self,
        id: u32,
        texture: Handle,
    ) -> Result<(), MaterialError> {
        if !self.is_live(id) {
            return Err(MaterialError::Unknown(id));
        }
        if self.directions[id as usize] != texture {
            self.directions[id as usize] = texture;
            self.maps_changed = true;
        }
        Ok(())
    }

    /// A material's light map direction map, or `Handle::NONE`.
    pub fn light_map_direction(&self, id: u32) -> Handle {
        self.directions
            .get(id as usize)
            .copied()
            .unwrap_or(Handle::NONE)
    }

    /// How far a material's bounding spheres grow for its displacement, in the mesh's units: the
    /// farthest that its displacement has moved a vertex, or 0 without a displacement map.
    pub fn bounds_margin(&self, id: u32) -> f32 {
        match self.heights.get(id as usize) {
            Some(map) if !map.is_none() => self.margins[id as usize],
            _ => 0.0,
        }
    }

    /// True when a material's normal map's slot holds a normal map, not a height map.
    pub fn normal_slot_holds_normals(&self, id: u32) -> bool {
        self.rows
            .get(id as usize * MATERIAL_FLOATS + param::FLAGS)
            .is_some()
            && self.flags(id) & (flag::BUMP | flag::HEIGHT_NORMALS) == 0
    }

    /// True for a material whose triangles draw as lines.
    pub fn wireframe(&self, id: u32) -> bool {
        self.features(id) & feature::WIREFRAME != 0
    }

    /// A material's row flags.
    fn flags(&self, id: u32) -> u32 {
        self.rows[id as usize * MATERIAL_FLOATS + param::FLAGS] as u32
    }

    /// Sets the row flags of `mask` to `bits` and keeps the others.
    fn set_flags(&mut self, id: u32, mask: u32, bits: u32) {
        let flags = &mut self.rows[id as usize * MATERIAL_FLOATS + param::FLAGS];
        let next = (*flags as u32 & !mask | bits) as f32;
        if *flags != next {
            *flags = next;
            self.mark_row(id);
        }
    }

    /// Puts a map in a slot, with the slot's bit for the second texture coordinates.
    fn put_map(&mut self, id: u32, slot: MapSlot, texture: Handle, second_uv: bool) {
        self.maps[id as usize][slot as usize] = texture;
        let bit = flag::SECOND_UV << slot as u32;
        self.set_flags(id, bit, if second_uv { bit } else { 0 });
        self.mark_row(id);
        self.maps_changed = true;
    }

    /// Puts a material's displacement map in its normal map's slot too, to bend the normals by its
    /// slope, while the slot holds no map of its own and the material draws triangles.
    fn share_height_normals(&mut self, id: u32) {
        let height = self.heights[id as usize];
        let free = self.maps[id as usize][MapSlot::Normal as usize].is_none();
        if height.is_none() || !free || self.wireframe(id) {
            return;
        }
        let at = id as usize * MATERIAL_FLOATS + height::SECOND_UV;
        let second_uv = self.values[at] != 0.0;
        self.put_map(id, MapSlot::Normal, height, second_uv);
        self.set_flags(id, flag::HEIGHT_NORMALS, flag::HEIGHT_NORMALS);
    }

    /// Gives a material's maps the shared units that they sample, by slot, where a builder's
    /// standard material samples its maps through a few shared units (WebGL2's). A map's layer in
    /// the row then holds its unit times [`UNIT_LAYERS`], plus its layer. [`NO_UNIT`] marks a map
    /// that found no unit, which draws as without it. Every map samples unit 0 until this is called.
    pub fn set_map_units(&mut self, id: u32, units: [u8; MAP_SLOTS]) {
        if let Some(held) = self.map_units.get_mut(id as usize)
            && *held != units
        {
            *held = units;
            self.maps_changed = true;
        }
    }

    /// Gives a material one of the maps that takes a slot it has no other use for: a texture, or
    /// none with `Handle::NONE`. The map takes its slot ([`LayerMap::slot`]), and its row flag says
    /// that its channel applies while it has a texture. Two maps that share a slot share its
    /// texture, so the last one given names it.
    pub fn set_layer_map(
        &mut self,
        id: u32,
        map: LayerMap,
        texture: Handle,
        second_uv: bool,
    ) -> Result<(), MaterialError> {
        self.set_map(id, map.slot(), texture, second_uv)?;
        let flags = &mut self.rows[id as usize * MATERIAL_FLOATS + param::FLAGS];
        let bit = map.flag();
        let on = if texture.is_none() { 0 } else { bit };
        *flags = ((*flags as u32 & !bit) | on) as f32;
        // A live map names the family whose slot it fills, so the shader reads the maps that the
        // material gave: the coat's and the sheen's, iridescence's and the anisotropy's, or the
        // transmission and thickness maps'. Each group of slots names its family apart, since a
        // material with layers may keep the transmission and thickness maps in the specular slots
        // beside a layer map of the light slot, and one specular slot may hold a layer map while
        // the other holds one of those two maps.
        if !texture.is_none() {
            let at = id as usize * MATERIAL_FLOATS + param::LAYER_MAPS_KIND;
            let shift = map.kind_shift();
            let kinds = self.rows[at] as u32;
            self.rows[at] = ((kinds & !(3 << shift)) | (map.kind() << shift)) as f32;
        }
        Ok(())
    }

    /// Gives a material's displacement map the shared unit that the fragment stage samples it
    /// through, as [`MaterialTable::set_map_units`] does for the maps. The vertex stage samples it
    /// through a binding of its own, and ignores the unit.
    pub fn set_height_unit(&mut self, id: u32, unit: u8) {
        if let Some(held) = self.height_units.get_mut(id as usize)
            && *held != unit
        {
            *held = unit;
            self.maps_changed = true;
        }
    }

    /// A material's maps by slot, `Handle::NONE` where it has none.
    pub fn maps(&self, id: u32) -> [Handle; MAP_SLOTS] {
        self.maps
            .get(id as usize)
            .copied()
            .unwrap_or([Handle::NONE; MAP_SLOTS])
    }

    /// A material's map in `slot`, or `Handle::NONE`.
    pub fn map(&self, id: u32, slot: MapSlot) -> Handle {
        self.maps
            .get(id as usize)
            .map_or(Handle::NONE, |maps| maps[slot as usize])
    }

    /// A material's features (`feature::*` bits), or none for an id that names no material.
    pub fn features(&self, id: u32) -> u32 {
        self.features.get(id as usize).copied().unwrap_or(0)
    }

    /// A live material's shading.
    pub fn shading(&self, id: u32) -> Result<Shading, MaterialError> {
        if !self.is_live(id) {
            return Err(MaterialError::Unknown(id));
        }
        Ok(self.shading[id as usize])
    }

    /// The ids that materials have taken, destroyed ones included.
    pub fn len(&self) -> u32 {
        self.shading.len() as u32
    }

    pub fn is_empty(&self) -> bool {
        self.shading.is_empty()
    }

    pub fn capacity(&self) -> u32 {
        self.capacity
    }

    /// The rows of the materials in `ids`, one after another.
    pub fn rows(&self, ids: Range<u32>) -> &[f32] {
        &self.rows[ids.start as usize * MATERIAL_FLOATS..ids.end as usize * MATERIAL_FLOATS]
    }

    /// Marks every row changed, so the next frame uploads the whole table.
    pub fn mark_changed(&mut self) {
        self.changed = 0..self.len();
        self.values_changed = 0..self.len();
    }

    /// Writes each map's layer into its row when a map changed, or when `layers_changed` says
    /// that a texture's layer became ready or stopped drawing. `ready_layer` gives the layer of a
    /// texture whose image is on the GPU, `same_array` says whether two textures share a texture
    /// array, and `premultiplied` says whether an image holds colors multiplied by their alpha,
    /// which the row's flags then say for the base color map. Only rows whose layers or flags
    /// differ count as changed.
    pub fn update_map_layers(
        &mut self,
        layers_changed: bool,
        ready_layer: impl Fn(Handle) -> Option<u32>,
        same_array: impl Fn(Handle, Handle) -> bool,
        premultiplied: impl Fn(Handle) -> Premultiplied,
    ) {
        if !std::mem::take(&mut self.maps_changed) && !layers_changed {
            return;
        }
        for id in 0..self.len() {
            let maps = self.maps[id as usize];
            let units = self.map_units[id as usize];
            let row = &mut self.rows[id as usize * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
            let mut changed = false;
            let layers = &mut row[param::MAP_LAYERS..param::MAP_LAYERS + MAP_SLOTS];
            for ((layer, map), unit) in layers.iter_mut().zip(maps).zip(units) {
                let ready = if map.is_none() || unit == NO_UNIT {
                    None
                } else {
                    ready_layer(map)
                };
                let value = ready.map_or(NO_MAP, |layer| {
                    (u32::from(unit) * UNIT_LAYERS + layer) as f32
                });
                changed |= *layer != value;
                *layer = value;
            }
            // A light map's direction map sits in the light map's own texture array, so a shader
            // reads it through the light map's binding, at the light map's unit. A direction map
            // in another array, or a light map without a unit, leaves the light map plain.
            let light = maps[MapSlot::Light as usize];
            let direction = self.directions[id as usize];
            let light_unit = units[MapSlot::Light as usize];
            let ready = if light.is_none() || direction.is_none() || light_unit == NO_UNIT {
                None
            } else {
                ready_layer(direction).filter(|_| same_array(light, direction))
            };
            let value = ready.map_or(NO_MAP, |layer| {
                (u32::from(light_unit) * UNIT_LAYERS + layer) as f32
            });
            changed |= row[param::LIGHT_MAP_DIRECTION] != value;
            row[param::LIGHT_MAP_DIRECTION] = value;
            // The base color map's texels decide whether its colors are premultiplied.
            let base = maps[MapSlot::BaseColor as usize];
            let base_flags = if row[param::MAP_LAYERS] == NO_MAP {
                0
            } else {
                match premultiplied(base) {
                    Premultiplied::No => 0,
                    Premultiplied::Srgb => flag::MAP_PREMULTIPLIED,
                    Premultiplied::Linear => flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR,
                }
            };
            let map_flags = flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR;
            let flags = ((row[param::FLAGS] as u32 & !map_flags) | base_flags) as f32;
            changed |= row[param::FLAGS] != flags;
            row[param::FLAGS] = flags;
            if changed {
                self.mark_row(id);
            }
            // A displacement map's layer goes into the custom values, which the vertex stage reads.
            // Where the fragment stage samples it through a shared unit, the layer names the unit.
            // Only a shader that reads those values gets them: another shading keeps its own custom
            // values in that slot.
            let height = self.heights[id as usize];
            if self.shading[id as usize].displaces() {
                let unit = self.height_units[id as usize];
                let ready = (!height.is_none()).then(|| ready_layer(height)).flatten();
                let vertex = ready.map_or(NO_MAP, |layer| layer as f32);
                let pixel = ready.filter(|_| unit != NO_UNIT).map_or(NO_MAP, |layer| {
                    (u32::from(unit) * UNIT_LAYERS + layer) as f32
                });
                let values = &mut self.values[id as usize * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
                if values[height::LAYER] != vertex || values[height::PIXEL_LAYER] != pixel {
                    values[height::LAYER] = vertex;
                    values[height::PIXEL_LAYER] = pixel;
                    self.values_changed = marked(&self.values_changed, id);
                }
            }
            // A custom material reads its textures' layers from its custom values, in both stages.
            if let Shading::Custom(custom) = self.shading[id as usize] {
                let textures = (custom.textures as usize).min(MAP_SLOTS);
                let row = &self.rows[id as usize * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
                let values = &mut self.values[id as usize * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
                let mut moved = false;
                for k in 0..textures {
                    let layer = row[param::MAP_LAYERS + k];
                    moved |= values[texture_layer_offset(k)] != layer;
                    values[texture_layer_offset(k)] = layer;
                }
                if moved {
                    self.values_changed = marked(&self.values_changed, id);
                }
            }
        }
    }

    /// The ids whose rows changed since the last call, once, or `None` when none did.
    pub fn take_changed(&mut self) -> Option<Range<u32>> {
        let changed = std::mem::replace(&mut self.changed, 0..0);
        (!changed.is_empty()).then_some(changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(table: &MaterialTable, id: u32) -> &[f32] {
        table.rows(id..id + 1)
    }

    fn layers(table: &MaterialTable, id: u32) -> Vec<f32> {
        row(table, id)[param::MAP_LAYERS..][..MAP_SLOTS].to_vec()
    }

    #[test]
    fn templates_from_64_to_the_first_custom_one_belong_to_the_engine() {
        let mut table = MaterialTable::with_capacity(1);
        let first = template::CUSTOM_FIRST;
        assert_eq!(first, 128);
        let id = table
            .create(CustomShading::standard(first), 0, [1.0; 4])
            .unwrap();
        // No material draws with the engine's ids, so no frame releases their pipelines.
        assert!((64..first).all(|t| !table.custom_template_unused(t)));
        assert!(!table.custom_template_unused(first));
        assert!(table.custom_template_unused(first + 1));
        table.destroy(id).unwrap();
        assert!(table.custom_template_unused(first));
    }

    #[test]
    fn a_line_keeps_its_dashes_beside_the_displacement_values() {
        let mut table = MaterialTable::with_capacity(1);
        let line = table.create(Shading::Line, 0, [1.0; 4]).unwrap();
        // Dash size, gap size, dash scale and dash offset, in the fourth texel of the custom values.
        table.set_values(line, 12, &[0.25, 0.12, 1.0, 0.0]).unwrap();
        table.update_map_layers(true, |_| None, |_, _| true, |_| Premultiplied::No);
        assert_eq!(
            &table.values(0..1)[12..16],
            &[0.25, 0.12, 1.0, 0.0],
            "the displacement map's values leave the dashes alone"
        );
    }

    #[test]
    fn custom_values_start_at_zero_and_change_apart_from_the_rows() {
        let mut table = MaterialTable::with_capacity(3);
        for _ in 0..3 {
            table
                .create(CustomShading::standard(template::CUSTOM_FIRST), 0, [1.0; 4])
                .unwrap();
        }
        assert_eq!(
            table.take_values_changed(),
            None,
            "new tables start at zero"
        );
        assert!(table.values(0..3).iter().all(|&v| v == 0.0));
        table.take_changed();
        table.set_values(2, 4, &[0.5, 0.25, 0.125]).unwrap();
        table.set_values(1, 31, &[7.0]).unwrap();
        assert_eq!(table.take_changed(), None, "the rows did not change");
        assert_eq!(table.take_values_changed(), Some(1..3));
        assert_eq!(table.values(1..2)[31], 7.0);
        assert_eq!(&table.values(2..3)[4..8], &[0.5, 0.25, 0.125, 0.0]);
        for (at, count) in [(30, 3), (0, 0), (0, 5)] {
            assert_eq!(
                table.set_values(0, at, &[1.0; 5][..count]),
                Err(MaterialError::Value(at as u32))
            );
        }
        assert_eq!(
            table.set_values(3, 0, &[1.0]),
            Err(MaterialError::Unknown(3))
        );
    }

    #[test]
    fn materials_get_ids_in_order_and_report_changes_once() {
        let mut table = MaterialTable::with_capacity(2);
        assert_eq!(table.create(Shading::Lit, 0, [1.0, 0.0, 0.0, 1.0]), Ok(0));
        assert_eq!(table.create(Shading::Unlit, 0, [0.0, 1.0, 0.0, 1.0]), Ok(1));
        assert_eq!(
            table.create(Shading::Lit, 0, [0.0; 4]),
            Err(MaterialError::Full)
        );
        assert_eq!(table.take_changed(), Some(0..2));
        assert_eq!(table.take_changed(), None);
        table.set(1, param::COLOR, &[0.5, 0.5, 0.5]).unwrap();
        assert_eq!(table.take_changed(), Some(1..2));
        assert_eq!(&row(&table, 1)[..4], &[0.5, 0.5, 0.5, 1.0]);
        assert_eq!(table.shading(1), Ok(Shading::Unlit));
        assert_eq!(
            table.set(2, param::COLOR, &[0.0; 3]),
            Err(MaterialError::Unknown(2))
        );
    }

    #[test]
    fn a_new_row_holds_the_default_values_where_the_shaders_read_them() {
        let mut table = MaterialTable::with_capacity(1);
        table.create(Shading::Lit, 0, [0.2, 0.3, 0.4, 0.5]).unwrap();
        let row = row(&table, 0);
        assert_eq!(row.len(), MATERIAL_FLOATS);
        assert_eq!(&row[param::COLOR..param::COLOR + 3], &[0.2, 0.3, 0.4]);
        assert_eq!(row[param::OPACITY], 0.5);
        assert_eq!(&row[param::EMISSIVE..param::EMISSIVE + 3], &[0.0; 3]);
        assert_eq!(row[param::ALPHA_CUTOFF], 0.5);
        assert_eq!([row[param::METALNESS], row[param::ROUGHNESS]], [0.0, 1.0]);
        assert_eq!(
            &row[param::NORMAL_SCALE..param::NORMAL_SCALE + 2],
            &[1.0; 2]
        );
        assert_eq!(row[param::OCCLUSION_STRENGTH], 1.0);
        assert_eq!(row[param::LIGHT_MAP_INTENSITY], 1.0);
        assert_eq!(row[param::FLAGS], 0.0);
        assert_eq!(row[param::EMISSIVE_INTENSITY], 1.0);
        assert_eq!(&row[param::UV_U..param::UV_U + 3], &[1.0, 0.0, 0.0]);
        assert_eq!(&row[param::UV_V..param::UV_V + 3], &[0.0, 1.0, 0.0]);
        // Each other map slot starts with the identity transform too.
        for slot in 1..MAP_SLOTS {
            let at = param::map_uv(slot);
            assert_eq!(&row[at..at + 3], &[1.0, 0.0, 0.0], "map slot {slot}");
            assert_eq!(&row[at + 4..at + 7], &[0.0, 1.0, 0.0], "map slot {slot}");
        }
        assert_eq!(
            &row[param::MAP_LAYERS..param::MAP_LAYERS + MAP_SLOTS],
            &[NO_MAP; MAP_SLOTS]
        );
        // glTF's index of refraction of 1.5, and a white specular color at full intensity, which
        // the shaders turn into the metallic-roughness model's reflectance of 0.04.
        assert_eq!(row[param::REFLECTANCE], 0.04);
        assert_eq!(
            &row[param::SPECULAR_COLOR..param::SPECULAR_COLOR + 3],
            &[1.0; 3]
        );
        assert_eq!(row[param::SPECULAR_INTENSITY], 1.0);
        // No clear coat, a coat normal map at full strength, and a black sheen of full roughness,
        // as three.js's MeshPhysicalMaterial starts.
        assert_eq!(
            [row[param::CLEARCOAT], row[param::CLEARCOAT_ROUGHNESS]],
            [0.0, 0.0]
        );
        assert_eq!(
            &row[param::CLEARCOAT_NORMAL_SCALE..param::CLEARCOAT_NORMAL_SCALE + 2],
            &[1.0; 2]
        );
        assert_eq!(&row[param::SHEEN_COLOR..param::SHEEN_COLOR + 3], &[0.0; 3]);
        assert_eq!(row[param::SHEEN_ROUGHNESS], 1.0);
        // No diffuse transmission, and glTF's white transmission color.
        assert_eq!(row[param::DIFFUSE_TRANSMISSION], 0.0);
        assert_eq!(
            &row[param::DIFFUSE_TRANSMISSION_COLOR..param::DIFFUSE_TRANSMISSION_COLOR + 3],
            &[1.0; 3]
        );
    }

    #[test]
    fn each_value_has_its_own_floats_and_vectors_hold_whole_values() {
        let mut starts = vec![
            (param::COLOR, 3),
            (param::OPACITY, 1),
            (param::EMISSIVE, 3),
            (param::ALPHA_CUTOFF, 1),
            (param::METALNESS, 1),
            (param::ROUGHNESS, 1),
            (param::NORMAL_SCALE, 2),
            (param::OCCLUSION_STRENGTH, 1),
            (param::LIGHT_MAP_INTENSITY, 1),
            (param::FLAGS, 1),
            (param::EMISSIVE_INTENSITY, 1),
            (param::UV_U, 3),
            (param::UV_V, 3),
            (param::REFLECTANCE, 1),
            (param::MAP_LAYERS, MAP_SLOTS),
            (param::SPECULAR_COLOR, 3),
            (param::SPECULAR_INTENSITY, 1),
            (param::TRANSMISSION, 1),
            (param::THICKNESS, 1),
            (param::IOR, 1),
            (param::ATTENUATION_COLOR, 3),
            (param::ATTENUATION_DISTANCE, 1),
            (param::CLEARCOAT, 1),
            (param::CLEARCOAT_ROUGHNESS, 1),
            (param::CLEARCOAT_NORMAL_SCALE, 2),
            (param::SHEEN_COLOR, 3),
            (param::SHEEN_ROUGHNESS, 1),
            (param::DIFFUSE_TRANSMISSION_COLOR, 3),
            (param::DIFFUSE_TRANSMISSION, 1),
            (param::SUBSURFACE_COLOR, 3),
            (param::SUBSURFACE_RADIUS, 1),
            (param::IRIDESCENCE, 1),
            (param::IRIDESCENCE_IOR, 1),
            (param::IRIDESCENCE_THICKNESS_MIN, 1),
            (param::IRIDESCENCE_THICKNESS_MAX, 1),
            (param::ANISOTROPY, 1),
            (param::ANISOTROPY_ROTATION, 1),
            (param::DISPERSION, 1),
        ];
        // Each map of the slots from the second up keeps the two rows of its transform apart from
        // the material's.
        for slot in 1..MAP_SLOTS {
            starts.push((param::map_uv(slot), 3));
            starts.push((param::map_uv(slot) + 4, 3));
        }
        starts.sort();
        for pair in starts.windows(2) {
            let ((start, length), (next, _)) = (pair[0], pair[1]);
            assert!(start + length <= next, "values overlap at float {next}");
        }
        for (start, length) in starts {
            // The shaders read a value of up to four floats from one vec4f, so none crosses one;
            // the map layers take two.
            if length <= 4 {
                assert_eq!(start / 4, (start + length - 1) / 4, "float {start}");
            }
            assert!(start + length <= MATERIAL_FLOATS);
        }
        assert_eq!(MATERIAL_TEXELS * 16, MATERIAL_FLOATS as u32 * 4);
        // The maps' transforms fill the row to its end, and the shader finds their block at the
        // texel that its constant names.
        assert_eq!(param::map_uv(MAP_SLOTS), MATERIAL_FLOATS);
        assert_eq!(param::MAP_UV_TEXEL as usize * 4, param::MAP_UV);
    }

    #[test]
    fn color_and_opacity_change_apart() {
        let mut table = MaterialTable::with_capacity(2);
        table.create(Shading::Lit, 0, [1.0, 0.0, 0.0, 1.0]).unwrap();
        table
            .create(Shading::Unlit, 0, [0.0, 1.0, 0.0, 1.0])
            .unwrap();
        table.take_changed();
        table.set(0, param::OPACITY, &[0.25]).unwrap();
        assert_eq!(table.take_changed(), Some(0..1));
        table.set(0, param::COLOR, &[0.0, 0.0, 1.0]).unwrap();
        assert_eq!(table.take_changed(), Some(0..1));
        assert_eq!(&row(&table, 0)[..4], &[0.0, 0.0, 1.0, 0.25]);
        assert_eq!(&row(&table, 1)[..4], &[0.0, 1.0, 0.0, 1.0]);
        assert_eq!(
            table.set(2, param::OPACITY, &[0.5]),
            Err(MaterialError::Unknown(2))
        );
        assert_eq!(table.take_changed(), None);
    }

    #[test]
    fn sketches_set_whole_values_only() {
        let mut table = MaterialTable::with_capacity(1);
        table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        table.take_changed();
        table.set(0, param::METALNESS, &[0.75]).unwrap();
        table.set(0, param::ROUGHNESS, &[0.25]).unwrap();
        table.set(0, param::EMISSIVE, &[1.0, 0.5, 0.0]).unwrap();
        table.set(0, param::EMISSIVE_INTENSITY, &[2.0]).unwrap();
        table.set(0, param::NORMAL_SCALE, &[0.5, -0.5]).unwrap();
        table.set(0, param::UV_V, &[0.0, 2.0, 0.25]).unwrap();
        table.set(0, param::REFLECTANCE, &[0.25]).unwrap();
        table
            .set(0, param::SPECULAR_COLOR, &[2.0, 0.5, 0.0])
            .unwrap();
        table.set(0, param::SPECULAR_INTENSITY, &[0.5]).unwrap();
        let row = row(&table, 0);
        assert_eq!(row[param::REFLECTANCE], 0.25);
        assert_eq!(&row[param::SPECULAR_COLOR..][..4], &[2.0, 0.5, 0.0, 0.5]);
        assert_eq!([row[param::METALNESS], row[param::ROUGHNESS]], [0.75, 0.25]);
        assert_eq!(&row[param::EMISSIVE..param::EMISSIVE + 3], &[1.0, 0.5, 0.0]);
        assert_eq!(row[param::EMISSIVE_INTENSITY], 2.0);
        assert_eq!(&row[param::NORMAL_SCALE..][..2], &[0.5, -0.5]);
        assert_eq!(&row[param::UV_V..][..3], &[0.0, 2.0, 0.25]);
        for (at, values) in [
            (param::FLAGS, &[1.0][..]),
            (param::MAP_LAYERS, &[3.0][..]),
            (param::COLOR + 1, &[0.0][..]),
            (param::METALNESS, &[0.0, 0.0][..]),
            (param::COLOR, &[0.0][..]),
        ] {
            assert_eq!(
                table.set(0, at, values),
                Err(MaterialError::Value(at as u32))
            );
        }
    }

    #[test]
    fn each_map_keeps_its_own_texture_transform() {
        let mut table = MaterialTable::with_capacity(1);
        table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let emissive = param::map_uv(MapSlot::Emissive as usize);
        let occlusion = param::map_uv(MapSlot::Occlusion as usize);
        assert_eq!(param::width(emissive), Some(3));
        assert_eq!(param::width(emissive + 4), Some(3));
        assert_eq!(param::width(emissive + 1), None);
        table.set(0, emissive, &[0.0, 0.0, 0.5]).unwrap();
        table.set(0, emissive + 4, &[0.0, 2.0, 0.25]).unwrap();
        let row = row(&table, 0);
        assert_eq!(&row[emissive..emissive + 3], &[0.0, 0.0, 0.5]);
        assert_eq!(&row[emissive + 4..emissive + 7], &[0.0, 2.0, 0.25]);
        // Every other map keeps the identity, and so does the base color map.
        assert_eq!(&row[occlusion..occlusion + 3], &[1.0, 0.0, 0.0]);
        assert_eq!(&row[param::UV_U..param::UV_U + 3], &[1.0, 0.0, 0.0]);
        assert_eq!(&row[param::UV_V..param::UV_V + 3], &[0.0, 1.0, 0.0]);
    }

    #[test]
    fn features_are_kept_and_flat_shading_and_no_fog_are_flags_in_the_row() {
        let mut table = MaterialTable::with_capacity(4);
        let flat = feature::FLAT_SHADING | feature::DOUBLE_SIDED;
        table
            .create(Shading::Lit, flat | 1 << 30, [1.0; 4])
            .unwrap();
        table
            .create(Shading::Unlit, feature::VERTEX_COLORS, [1.0; 4])
            .unwrap();
        table
            .create(Shading::Unlit, feature::NO_FOG, [1.0; 4])
            .unwrap();
        table
            .create(
                Shading::Lit,
                feature::NO_FOG | feature::FLAT_SHADING,
                [1.0; 4],
            )
            .unwrap();
        assert_eq!(table.features(0), flat, "unknown bits are dropped");
        assert_eq!(table.features(1), feature::VERTEX_COLORS);
        assert_eq!(table.features(2), feature::NO_FOG);
        assert_eq!(table.features(9), 0);
        assert_eq!(row(&table, 0)[param::FLAGS], flag::FLAT_SHADING as f32);
        assert_eq!(row(&table, 1)[param::FLAGS], 0.0);
        assert_eq!(row(&table, 2)[param::FLAGS], flag::NO_FOG as f32);
        let both = flag::FLAT_SHADING | flag::NO_FOG;
        assert_eq!(row(&table, 3)[param::FLAGS], both as f32);
    }

    #[test]
    fn a_material_without_the_tone_curve_flags_its_row_and_keeps_its_builds() {
        let mut table = MaterialTable::with_capacity(2);
        let plain = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let bare = feature::NO_TONE_MAP | feature::DOUBLE_SIDED;
        let unmapped = table.create(Shading::Lit, bare, [1.0; 4]).unwrap();
        assert_eq!(table.features(unmapped), bare);
        assert_eq!(row(&table, plain)[param::FLAGS], 0.0);
        assert_eq!(
            row(&table, unmapped)[param::FLAGS],
            flag::NO_TONE_MAP as f32
        );
        // The flag stays exact in the row's float, and clear of the map slots' bits.
        const { assert!(flag::NO_TONE_MAP < 1 << 24) };
        const { assert!(flag::NO_TONE_MAP > flag::SHEEN_ROUGHNESS_MAP) };
        // The table counts the live materials that keep their display color, so the HDR path's
        // mask is built only while one lives.
        assert!(table.any_keeps_display_color());
        assert!(!table.keeps_display_color(plain));
        assert!(table.keeps_display_color(unmapped));
        table.destroy(unmapped).unwrap();
        assert!(!table.keeps_display_color(unmapped));
    }

    #[test]
    fn the_count_of_materials_that_keep_their_display_color_follows_creation_and_destruction() {
        let mut table = MaterialTable::with_capacity(3);
        let first = table
            .create(Shading::Unlit, feature::NO_TONE_MAP, [1.0; 4])
            .unwrap();
        assert!(table.any_keeps_display_color());
        let second = table
            .create(Shading::Lit, feature::NO_TONE_MAP, [1.0; 4])
            .unwrap();
        assert!(table.keeps_display_color(first));
        assert!(table.keeps_display_color(second));
        table.destroy(first).unwrap();
        assert!(table.any_keeps_display_color(), "the second still lives");
        table.destroy(second).unwrap();
        assert!(!table.any_keeps_display_color());
        table.release_unused(|_| false);
        assert!(!table.any_keeps_display_color());
        let reused = table.create(Shading::Unlit, 0, [1.0; 4]).unwrap();
        assert_eq!(reused, first, "the lowest free id comes back");
        assert!(!table.keeps_display_color(reused));
        assert!(!table.any_keeps_display_color());
    }

    #[test]
    fn a_material_without_contact_shadows_flags_its_row_and_keeps_its_builds() {
        let mut table = MaterialTable::with_capacity(2);
        let plain = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let bare = feature::NO_CONTACT_SHADOWS | feature::DOUBLE_SIDED;
        let without = table.create(Shading::Lit, bare, [1.0; 4]).unwrap();
        assert_eq!(table.features(without), bare);
        assert_eq!(row(&table, plain)[param::FLAGS], 0.0);
        assert_eq!(
            row(&table, without)[param::FLAGS],
            flag::NO_CONTACT_SHADOWS as f32
        );
        // The flag must stay exact in the row's float, and clear of the map slots' bits.
        const { assert!(flag::NO_CONTACT_SHADOWS < 1 << 24) };
        const { assert!(flag::NO_CONTACT_SHADOWS > flag::SHEEN_ROUGHNESS_MAP) };
    }

    #[test]
    fn layer_maps_take_the_slots_of_the_light_and_specular_maps_and_flag_their_channels() {
        let mut table = MaterialTable::with_capacity(1);
        let id = table
            .create(Shading::Lit, feature::COAT_SHEEN, [1.0; 4])
            .unwrap();
        assert_eq!(table.features(id), feature::COAT_SHEEN);
        let coat = Handle::from_raw(5);
        let sheen = Handle::from_raw(7);
        table
            .set_layer_map(id, LayerMap::Coat, coat, false)
            .unwrap();
        table
            .set_layer_map(id, LayerMap::CoatRoughness, coat, false)
            .unwrap();
        table
            .set_layer_map(id, LayerMap::SheenRoughness, sheen, true)
            .unwrap();
        table
            .set_layer_map(id, LayerMap::CoatNormal, Handle::from_raw(6), false)
            .unwrap();
        assert_eq!(table.map(id, MapSlot::Light), coat);
        assert_eq!(table.map(id, MapSlot::SpecularColor), sheen);
        assert_eq!(
            table.map(id, MapSlot::SpecularIntensity),
            Handle::from_raw(6)
        );
        let flags = row(&table, id)[param::FLAGS] as u32;
        let channels = flag::COAT_MAP | flag::COAT_ROUGHNESS_MAP | flag::SHEEN_ROUGHNESS_MAP;
        assert_eq!(flags & !(flag::SECOND_UV * 0xff), channels);
        assert_ne!(
            flags & (flag::SECOND_UV << MapSlot::SpecularColor as u32),
            0,
            "the sheen map reads the second coordinates"
        );
        // A map taken away turns its channel off.
        table
            .set_layer_map(id, LayerMap::CoatRoughness, Handle::NONE, false)
            .unwrap();
        let flags = row(&table, id)[param::FLAGS] as u32;
        assert_eq!(flags & flag::COAT_ROUGHNESS_MAP, 0);
        assert_eq!(flags & flag::COAT_MAP, flag::COAT_MAP);
        // The flags fit the float of the row exactly, above the second coordinates' bits.
        const { assert!(flag::SHEEN_ROUGHNESS_MAP < 1 << 24) };
        const { assert!(flag::COAT_MAP > flag::SECOND_UV << (MAP_SLOTS - 1)) };
    }

    #[test]
    fn the_film_and_the_stretch_take_the_layer_slots_and_name_their_family() {
        let mut table = MaterialTable::with_capacity(2);
        let id = table
            .create(
                Shading::Lit,
                feature::IRIDESCENCE | feature::ANISOTROPY,
                [1.0; 4],
            )
            .unwrap();
        let coat = table
            .create(Shading::Lit, feature::COAT_SHEEN, [1.0; 4])
            .unwrap();
        // A material's layer maps name the family that fills the slot each takes, so a shader
        // reads a coat map as a coat map and a film map as a film map.
        table
            .set_layer_map(id, LayerMap::Iridescence, Handle::from_raw(5), false)
            .unwrap();
        table
            .set_layer_map(
                id,
                LayerMap::IridescenceThickness,
                Handle::from_raw(6),
                false,
            )
            .unwrap();
        table
            .set_layer_map(id, LayerMap::Anisotropy, Handle::from_raw(7), false)
            .unwrap();
        let kinds = row(&table, id)[param::LAYER_MAPS_KIND] as u32;
        assert_eq!(kinds & 3, 1, "the light map's slot holds the film");
        assert_eq!(
            (kinds >> 2) & 3,
            1,
            "the specular intensity slot holds the film's thickness"
        );
        assert_eq!(
            (kinds >> 4) & 3,
            1,
            "the specular color slot holds the stretch"
        );
        assert_eq!(row(&table, coat)[param::LAYER_MAPS_KIND], 0.0);
        assert_eq!(table.map(id, MapSlot::Light), Handle::from_raw(5));
        assert_eq!(
            table.map(id, MapSlot::SpecularIntensity),
            Handle::from_raw(6)
        );
        assert_eq!(table.map(id, MapSlot::SpecularColor), Handle::from_raw(7));
        // The film's and the stretch's values take the row's last two `vec4f`s, within them.
        assert_eq!(param::IRIDESCENCE / 4, 15);
        assert_eq!(param::ANISOTROPY / 4, 16);
        assert_eq!(
            row(&table, id)[param::IRIDESCENCE_IOR],
            DEFAULT_ROW[param::IRIDESCENCE_IOR]
        );
        assert_eq!(
            row(&table, id)[param::IRIDESCENCE_THICKNESS_MAX],
            DEFAULT_ROW[param::IRIDESCENCE_THICKNESS_MAX]
        );
    }

    #[test]
    fn the_volume_maps_take_the_specular_slots_and_name_their_family() {
        let mut table = MaterialTable::with_capacity(1);
        let id = table
            .create(Shading::Lit, feature::TRANSMISSION, [1.0; 4])
            .unwrap();
        // A material that lets light through keeps its transmission map in the specular intensity
        // map's slot and its thickness map in the specular color map's, and each of those slots
        // names its family while the light slot's stays free.
        table
            .set_layer_map(id, LayerMap::Transmission, Handle::from_raw(5), false)
            .unwrap();
        table
            .set_layer_map(id, LayerMap::Thickness, Handle::from_raw(6), true)
            .unwrap();
        let kinds = row(&table, id)[param::LAYER_MAPS_KIND] as u32;
        assert_eq!(
            (kinds >> 2) & 3,
            2,
            "the intensity slot holds the map of the light through"
        );
        assert_eq!(
            (kinds >> 4) & 3,
            2,
            "the color slot holds the thickness map"
        );
        assert_eq!(
            kinds & 3,
            0,
            "the transmission maps leave the light map's slot alone"
        );
        assert_eq!(
            table.map(id, MapSlot::SpecularIntensity),
            Handle::from_raw(5)
        );
        assert_eq!(table.map(id, MapSlot::SpecularColor), Handle::from_raw(6));
        // Each map applies while it has a texture, and the thickness map reads the second
        // coordinates.
        let flags = row(&table, id)[param::FLAGS] as u32;
        assert_eq!(flags & !(flag::SECOND_UV * 0xff), 0);
        assert_ne!(
            flags & (flag::SECOND_UV << MapSlot::SpecularColor as u32),
            0,
            "the thickness map reads the second coordinates"
        );
        assert_eq!(
            flags & (flag::SECOND_UV << MapSlot::SpecularIntensity as u32),
            0,
            "the transmission map reads the first coordinates"
        );
        // The maps arrive through the numbers that `setMaterialMap` takes after the map slots.
        assert_eq!(LayerMap::ALL.len(), 10);
        assert_eq!(LayerMap::Transmission as u32, 8);
        assert_eq!(LayerMap::Thickness as u32, 9);
    }

    #[test]
    fn a_layer_map_and_the_volume_maps_name_each_slots_family_apart() {
        let mut table = MaterialTable::with_capacity(2);
        let id = table
            .create(
                Shading::Lit,
                feature::COAT_SHEEN | feature::TRANSMISSION,
                [1.0; 4],
            )
            .unwrap();
        let normal = table
            .create(
                Shading::Lit,
                feature::COAT_SHEEN | feature::TRANSMISSION,
                [1.0; 4],
            )
            .unwrap();
        // A coated glass keeps its coat map in the light map's slot and the transmission and
        // thickness maps in the specular slots: one family fills the first slot and another the
        // last two, so each group of slots names its own family.
        table
            .set_layer_map(id, LayerMap::Coat, Handle::from_raw(5), false)
            .unwrap();
        table
            .set_layer_map(id, LayerMap::Transmission, Handle::from_raw(6), false)
            .unwrap();
        table
            .set_layer_map(id, LayerMap::Thickness, Handle::from_raw(7), false)
            .unwrap();
        let kinds = row(&table, id)[param::LAYER_MAPS_KIND] as u32;
        assert_eq!(kinds & 3, LayerMap::Coat.kind());
        assert_eq!((kinds >> 2) & 3, LayerMap::Transmission.kind());
        assert_eq!((kinds >> 4) & 3, LayerMap::Thickness.kind());
        assert_eq!(table.map(id, MapSlot::Light), Handle::from_raw(5));
        assert_eq!(
            table.map(id, MapSlot::SpecularIntensity),
            Handle::from_raw(6)
        );
        assert_eq!(table.map(id, MapSlot::SpecularColor), Handle::from_raw(7));
        // One specular slot may hold a layer map while the other holds a volume map: a coat normal
        // map keeps the specular intensity slot as the coat's family, and the thickness map names
        // the specular color slot as the volume's.
        table
            .set_layer_map(normal, LayerMap::CoatNormal, Handle::from_raw(6), false)
            .unwrap();
        table
            .set_layer_map(normal, LayerMap::Thickness, Handle::from_raw(7), false)
            .unwrap();
        let mixed = row(&table, normal)[param::LAYER_MAPS_KIND] as u32;
        assert_eq!(mixed & 3, 0, "no layer map fills the light map's slot");
        assert_eq!(
            (mixed >> 2) & 3,
            LayerMap::CoatNormal.kind(),
            "the intensity slot holds the coat's normals"
        );
        assert_eq!(
            (mixed >> 4) & 3,
            LayerMap::Thickness.kind(),
            "the color slot holds the thickness"
        );
        // The three kinds sit in the anisotropy `vec4f`, which the shaders already read.
        assert_eq!(param::LAYER_MAPS_KIND / 4, param::ANISOTROPY / 4);
    }

    #[test]
    fn the_new_features_are_kept_and_leave_the_row_flags_alone() {
        let mut table = MaterialTable::with_capacity(2);
        let hashed = feature::ALPHA_MASK | feature::ALPHA_HASH;
        let glass = feature::BLEND | feature::DOUBLE_SIDED | feature::SINGLE_PASS;
        table
            .create(Shading::Lit, hashed | feature::ALPHA_TO_COVERAGE, [1.0; 4])
            .unwrap();
        table.create(Shading::Lit, glass, [1.0; 4]).unwrap();
        assert_eq!(table.features(0), hashed | feature::ALPHA_TO_COVERAGE);
        assert_eq!(table.features(1), glass);
        assert_eq!(row(&table, 0)[param::FLAGS], 0.0);
        assert_eq!(row(&table, 1)[param::FLAGS], flag::BLEND as f32);
        assert!(feature::masks(hashed));
        assert!(!feature::masks(feature::ALPHA_MASK | feature::BLEND));
    }

    #[test]
    fn a_shadow_catcher_sets_its_row_flag_beside_blend() {
        let mut table = MaterialTable::with_capacity(1);
        table
            .create(
                Shading::Lit,
                feature::BLEND | feature::SHADOW_CATCHER,
                [0.0, 0.0, 0.0, 0.6],
            )
            .unwrap();
        assert_eq!(table.features(0), feature::BLEND | feature::SHADOW_CATCHER);
        assert_eq!(
            row(&table, 0)[param::FLAGS],
            (flag::BLEND | flag::SHADOW_CATCHER) as f32
        );
    }

    #[test]
    fn each_material_keeps_its_depth_bias_and_none_is_the_default() {
        let mut table = MaterialTable::with_capacity(2);
        let plain = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let decal = table
            .create(Shading::Unlit, feature::NO_DEPTH_WRITE, [1.0; 4])
            .unwrap();
        let bias = DepthBias::from_polygon_offset(-2.0, -1.0);
        table.set_depth_bias(decal, bias).unwrap();
        assert_eq!(table.depth_bias(plain), DepthBias::NONE);
        assert_eq!(table.depth_bias(decal), bias);
        assert_eq!(table.features(decal), feature::NO_DEPTH_WRITE);
        assert_eq!(
            table.set_depth_bias(2, bias),
            Err(MaterialError::Unknown(2))
        );
        assert_eq!(table.depth_bias(2), DepthBias::NONE);
    }

    #[test]
    fn changes_upload_the_rows_from_the_first_changed_to_the_last() {
        let mut table = MaterialTable::with_capacity(5);
        for _ in 0..5 {
            table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        }
        table.take_changed();
        table.set(3, param::COLOR, &[0.0; 3]).unwrap();
        table.set(1, param::OPACITY, &[0.5]).unwrap();
        assert_eq!(table.take_changed(), Some(1..4));
        table.mark_changed();
        assert_eq!(table.take_changed(), Some(0..5));
    }

    #[test]
    fn a_bump_map_takes_the_normal_maps_slot_and_a_normal_map_takes_it_back() {
        let mut table = MaterialTable::with_capacity(2);
        let id = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let wire = table
            .create(Shading::Lit, feature::WIREFRAME, [1.0; 4])
            .unwrap();
        let (bumps, normals) = (Handle::new(1, 0), Handle::new(2, 0));
        let flags = |table: &MaterialTable, id| row(table, id)[param::FLAGS] as u32;
        table.set_bump_map(id, bumps, true).unwrap();
        assert_eq!(table.map(id, MapSlot::Normal), bumps);
        let second = flag::SECOND_UV << MapSlot::Normal as u32;
        assert_eq!(flags(&table, id), flag::BUMP | second);
        assert!(!table.normal_slot_holds_normals(id));
        table.set_map(id, MapSlot::Normal, normals, false).unwrap();
        assert_eq!(flags(&table, id), 0, "a normal map draws as one");
        assert!(table.normal_slot_holds_normals(id));
        // A wireframe keeps the bump map, so its slot never reads as a normal map, and its
        // pipelines draw without it.
        table.set_bump_map(wire, bumps, false).unwrap();
        assert_eq!(flags(&table, wire), flag::BUMP);
        assert!(!table.normal_slot_holds_normals(wire));
    }

    #[test]
    fn a_displacement_map_keeps_its_values_where_the_vertex_stage_reads_them() {
        let mut table = MaterialTable::with_capacity(4);
        let plain = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let normal = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let wire = table
            .create(Shading::Lit, feature::WIREFRAME, [1.0; 4])
            .unwrap();
        let custom = table
            .create(CustomShading::standard(64), 0, [1.0; 4])
            .unwrap();
        let values = |table: &MaterialTable, id: u32| table.values(id..id + 1)[..12].to_vec();
        assert_eq!(
            values(&table, plain),
            DEFAULT_HEIGHT_VALUES,
            "three.js's defaults"
        );
        assert_eq!(table.bounds_margin(plain), 0.0, "no map moves nothing");
        let (height, normals) = (Handle::new(1, 0), Handle::new(2, 0));
        table
            .set_map(normal, MapSlot::Normal, normals, false)
            .unwrap();
        for id in [plain, normal, wire] {
            table.set_displacement_map(id, height, true).unwrap();
        }
        assert_eq!(
            table.set_displacement_map(custom, height, false),
            Err(MaterialError::Unknown(custom))
        );
        // The default scale of 1 moves vertices by up to 1.
        assert_eq!(table.bounds_margin(plain), 1.0);
        // Without a normal map, the displacement map bends the normals from the normal map's slot.
        assert_eq!(table.map(plain, MapSlot::Normal), height);
        let flags = |table: &MaterialTable, id| row(table, id)[param::FLAGS] as u32;
        let second = flag::SECOND_UV << MapSlot::Normal as u32;
        assert_eq!(flags(&table, plain), flag::HEIGHT_NORMALS | second);
        assert_eq!(table.map(normal, MapSlot::Normal), normals);
        assert_eq!(flags(&table, normal), 0);
        assert_eq!(table.map(wire, MapSlot::Normal), Handle::NONE);
        // The bounds grow with the farthest move, and never shrink.
        assert_eq!(table.set_displacement(plain, 0.5, -2.0), Ok(true));
        assert_eq!(table.bounds_margin(plain), 2.0);
        assert_eq!(table.set_displacement(plain, 0.5, 0.0), Ok(false));
        assert_eq!(table.bounds_margin(plain), 2.0);
        assert_eq!(&values(&table, plain)[..4], &[NO_MAP, 0.5, 0.0, 1.0]);
        // The texture coordinate transform of the map in the normal map's slot, which the
        // displacement reads, goes to the custom values too.
        table
            .set(
                plain,
                param::map_uv(MapSlot::Normal as usize),
                &[2.0, 0.5, 0.25],
            )
            .unwrap();
        assert_eq!(
            &values(&table, plain)[height::UV_U..height::UV_U + 3],
            &[2.0, 0.5, 0.25]
        );
        // A ready layer goes to both stages' floats; a shared unit only to the fragment stage's.
        table.set_height_unit(plain, 2);
        table.set_height_unit(normal, NO_UNIT);
        table.update_map_layers(true, |_| Some(5), |_, _| true, |_| Premultiplied::No);
        let layers = |id| {
            let v = values(&table, id);
            [v[height::LAYER], v[height::PIXEL_LAYER]]
        };
        assert_eq!(layers(plain), [5.0, (2 * UNIT_LAYERS + 5) as f32]);
        assert_eq!(layers(normal), [5.0, NO_MAP]);
        // Taking the map away leaves the normal map's slot free again.
        table
            .set_displacement_map(plain, Handle::NONE, false)
            .unwrap();
        assert_eq!(table.map(plain, MapSlot::Normal), Handle::NONE);
        assert_eq!(flags(&table, plain), 0);
        assert_eq!(table.bounds_margin(plain), 0.0);
    }

    #[test]
    fn a_shading_that_reads_no_displacement_keeps_its_custom_values() {
        let mut table = MaterialTable::with_capacity(2);
        let line = table.create(Shading::Line, 0, [1.0; 4]).unwrap();
        let lit = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        // The line material keeps its dash values in the slot where a standard material keeps its
        // displacement values.
        let dash = [0.25, 0.12, 1.0, 0.0];
        table.set_values(line, 0, &dash).unwrap();
        table.take_values_changed();
        table
            .set_displacement_map(lit, Handle::new(1, 0), false)
            .unwrap();
        table.update_map_layers(true, |_| Some(5), |_, _| true, |_| Premultiplied::No);
        assert_eq!(
            &table.values(line..line + 1)[..4],
            &dash,
            "the line's values stay"
        );
        assert_eq!(table.values(lit..lit + 1)[height::LAYER], 5.0);
    }

    #[test]
    fn rows_hold_the_layer_of_each_map_that_is_ready() {
        let mut table = MaterialTable::with_capacity(3);
        let plain = table.create(Shading::Unlit, 0, [1.0; 4]).unwrap();
        let mapped = table.create(Shading::UnlitMap, 0, [1.0; 4]).unwrap();
        let waiting = table.create(Shading::UnlitMap, 0, [1.0; 4]).unwrap();
        table.take_changed();
        let (ready, on_its_way) = (Handle::new(1, 0), Handle::new(2, 0));
        table
            .set_map(mapped, MapSlot::BaseColor, ready, false)
            .unwrap();
        table
            .set_map(waiting, MapSlot::Emissive, on_its_way, true)
            .unwrap();
        assert_eq!(table.map(mapped, MapSlot::BaseColor), ready);
        assert_eq!(table.map(mapped, MapSlot::Emissive), Handle::NONE);
        assert_eq!(table.map(plain, MapSlot::BaseColor), Handle::NONE);
        let layer = |texture: Handle| (texture == ready).then_some(7);
        assert_eq!(
            row(&table, waiting)[param::FLAGS],
            (flag::SECOND_UV << MapSlot::Emissive as u32) as f32,
            "the emissive map reads the second texture coordinates"
        );
        assert_eq!(table.maps(waiting)[MapSlot::Emissive as usize], on_its_way);
        table.take_changed();
        table.update_map_layers(false, layer, |_, _| true, |_| Premultiplied::No);
        assert_eq!(
            table.take_changed(),
            Some(mapped..mapped + 1),
            "only it changed"
        );
        let mut expected = [NO_MAP; MAP_SLOTS];
        expected[0] = 7.0;
        assert_eq!(layers(&table, mapped), expected);
        assert_eq!(layers(&table, waiting), [NO_MAP; MAP_SLOTS]);
        table.update_map_layers(false, layer, |_, _| true, |_| Premultiplied::No);
        assert_eq!(table.take_changed(), None, "nothing changed");
        // A texture whose layer became ready writes the layers again.
        let both = |_: Handle| Some(3);
        table.update_map_layers(true, both, |_, _| true, |_| Premultiplied::No);
        assert_eq!(table.take_changed(), Some(mapped..waiting + 1));
        assert_eq!(layers(&table, waiting)[MapSlot::Emissive as usize], 3.0);
        // The specular maps take the last two layers, and their own coordinate bits.
        table
            .set_map(mapped, MapSlot::SpecularColor, ready, true)
            .unwrap();
        table.update_map_layers(false, layer, |_, _| true, |_| Premultiplied::No);
        assert_eq!(layers(&table, mapped)[MAP_SLOTS - 1], 7.0);
        assert_eq!(
            row(&table, mapped)[param::FLAGS] as u32
                & (flag::SECOND_UV << MapSlot::SpecularColor as u32),
            flag::SECOND_UV << 7
        );
        // A premultiplied base color map's encoding sets the flags; an emissive map's does not.
        let map_flags = |table: &MaterialTable, id| {
            row(table, id)[param::FLAGS] as u32 & (flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR)
        };
        for (premultiplied, flags) in [
            (Premultiplied::Srgb, flag::MAP_PREMULTIPLIED),
            (
                Premultiplied::Linear,
                flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR,
            ),
            (Premultiplied::No, 0),
        ] {
            table.update_map_layers(true, both, |_, _| true, |_| premultiplied);
            assert_eq!(map_flags(&table, mapped), flags, "{premultiplied:?}");
            assert_eq!(map_flags(&table, waiting), 0);
        }
        assert_eq!(
            table.set_map(9, MapSlot::BaseColor, ready, false),
            Err(MaterialError::Unknown(9))
        );
    }

    #[test]
    fn the_shaders_read_the_shared_units_as_the_rows_and_groups_hold_them() {
        use null3d_gpu::drawlist::sizes;
        let mesh = include_str!("../../null3d-shaders/wgsl/lib/mesh.wgsl");
        assert!(mesh.contains(&format!("const UNIT_LAYERS: u32 = {UNIT_LAYERS}u;")));
        let lit = include_str!("../../null3d-shaders/wgsl/lit.wgsl");
        let units = sizes::SHARED_MAP_UNITS;
        for k in 0..units {
            let texture =
                format!("@group(3) @binding({k}) var unit_{k}_map: texture_2d_array<f32>;");
            let sampler = format!(
                "@group(3) @binding({}) var unit_{k}_sampler: sampler;",
                MAP_SLOTS as u32 + k
            );
            assert!(lit.contains(&texture), "lit.wgsl lacks {texture}");
            assert!(lit.contains(&sampler), "lit.wgsl lacks {sampler}");
        }
        assert!(!lit.contains(&format!("unit_{units}_map")));
        assert!(units as usize <= MAP_SLOTS);
    }

    #[test]
    fn a_light_maps_direction_takes_a_layer_of_the_light_maps_own_array() {
        let mut table = MaterialTable::with_capacity(1);
        let id = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let light = Handle::new(1, 0);
        let direction = Handle::new(2, 0);
        let other = Handle::new(3, 0);
        table.set_map(id, MapSlot::Light, light, true).unwrap();
        table.set_light_map_direction(id, direction).unwrap();
        // The direction shares the light map's array, so its layer names the light map's unit.
        table.update_map_layers(
            true,
            |_| Some(4),
            |first, second| first == light && (second == light || second == direction),
            |_| Premultiplied::No,
        );
        assert_eq!(row(&table, id)[param::LIGHT_MAP_DIRECTION], 4.0);
        // A direction in another array would name a layer of a map that is not this one.
        table.set_light_map_direction(id, other).unwrap();
        table.update_map_layers(
            true,
            |_| Some(5),
            |first, second| first == light && second == light,
            |_| Premultiplied::No,
        );
        assert_eq!(row(&table, id)[param::LIGHT_MAP_DIRECTION], NO_MAP);
        // A direction without a light map lights nothing.
        table.set_light_map_direction(id, direction).unwrap();
        table
            .set_map(id, MapSlot::Light, Handle::NONE, false)
            .unwrap();
        table.update_map_layers(true, |_| Some(5), |_, _| true, |_| Premultiplied::No);
        assert_eq!(row(&table, id)[param::LIGHT_MAP_DIRECTION], NO_MAP);
    }

    #[test]
    fn rows_name_the_shared_unit_of_each_map_beside_its_layer() {
        let mut table = MaterialTable::with_capacity(1);
        let id = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let texture = Handle::new(1, 0);
        for slot in [MapSlot::BaseColor, MapSlot::Normal, MapSlot::SpecularColor] {
            table.set_map(id, slot, texture, false).unwrap();
        }
        let ready = |_: Handle| Some(5);
        table.update_map_layers(false, ready, |_, _| true, |_| Premultiplied::No);
        assert_eq!(
            layers(&table, id)[MapSlot::Normal as usize],
            5.0,
            "unit 0 by default"
        );
        let mut units = [NO_UNIT; MAP_SLOTS];
        units[MapSlot::BaseColor as usize] = 0;
        units[MapSlot::Normal as usize] = 2;
        table.take_changed();
        table.set_map_units(id, units);
        table.update_map_layers(false, ready, |_, _| true, |_| Premultiplied::No);
        assert_eq!(table.take_changed(), Some(id..id + 1));
        let mut expected = [NO_MAP; MAP_SLOTS];
        expected[MapSlot::BaseColor as usize] = 5.0;
        expected[MapSlot::Normal as usize] = (2 * UNIT_LAYERS + 5) as f32;
        assert_eq!(
            layers(&table, id),
            expected,
            "a map without a unit draws as without its texture"
        );
        table.set_map_units(id, units);
        table.update_map_layers(false, ready, |_, _| true, |_| Premultiplied::No);
        assert_eq!(table.take_changed(), None, "the same units change nothing");
    }
}

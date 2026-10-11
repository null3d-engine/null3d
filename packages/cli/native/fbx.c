// The asset tool's reader of FBX and OBJ files: ufbx loads a file from memory, and this code
// writes what a glTF file needs as a JSON description and one block of binary arrays, which
// packages/cli/src/assets/fbx.js reads. ufbx converts the scene to glTF's space first: right-handed,
// Y up, in meters, with geometric transforms and non-standard scale inheritance moved to helper
// nodes. tools/build-ufbx.ts builds this file and ufbx into packages/cli/vendor/ufbx/ufbx.wasm.
//
// The description:
//   nodes: name, parent (-1 for a root), t, r, s, and the mesh and materials it shows
//   meshes: name, parts (triangles of one material slot, with welded vertices), target names and
//     default weights, and the skin
//   skins: joints (node indices) and inverse bind matrices
//   materials: the glTF values that ufbx's PBR mapping gives, and the textures of each slot
//   textures: file names and embedded contents
//   clips: keys of node transforms and of blend shape weights, baked by ufbx
// Every array is a range [byte offset, count] in the binary block. Floats are 32-bit and indices
// 32-bit unsigned, each array starting at a multiple of 4 bytes.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "ufbx.h"

#define EXPORT __attribute__((visibility("default")))

// A growable block of bytes.
typedef struct {
	char *data;
	size_t length;
	size_t capacity;
	int failed;
} bytes_t;

static void reserve(bytes_t *b, size_t more) {
	if (b->failed || b->length + more <= b->capacity) return;
	size_t capacity = b->capacity ? b->capacity : 4096;
	while (capacity < b->length + more) capacity *= 2;
	char *data = realloc(b->data, capacity);
	if (!data) {
		b->failed = 1;
		return;
	}
	b->data = data;
	b->capacity = capacity;
}

static void append(bytes_t *b, const void *data, size_t length) {
	reserve(b, length);
	if (b->failed) return;
	memcpy(b->data + b->length, data, length);
	b->length += length;
}

static bytes_t json;
static bytes_t bin;

static void text(const char *s) { append(&json, s, strlen(s)); }

static void number(double value) {
	char buffer[32];
	// JSON has no NaN or infinity, which a broken file may hold.
	if (!(value == value) || value > 3.4e38 || value < -3.4e38) value = 0;
	snprintf(buffer, sizeof(buffer), "%.9g", value);
	text(buffer);
}

static void integer(long long value) {
	char buffer[24];
	snprintf(buffer, sizeof(buffer), "%lld", value);
	text(buffer);
}

// A JSON string, with the characters that JSON escapes escaped.
static void string(const char *s, size_t length) {
	text("\"");
	for (size_t i = 0; i < length; i++) {
		unsigned char c = (unsigned char)s[i];
		if (c == '"' || c == '\\') {
			char escaped[2] = {'\\', (char)c};
			append(&json, escaped, 2);
		} else if (c < 0x20) {
			char escaped[8];
			snprintf(escaped, sizeof(escaped), "\\u%04x", c);
			text(escaped);
		} else
			append(&json, &c, 1);
	}
	text("\"");
}

static void key(const char *name) {
	text("\"");
	text(name);
	text("\":");
}

// Starts an array in the binary block, at a multiple of 4 bytes, and returns its offset.
static size_t start_array(void) {
	static const char zeros[4] = {0};
	append(&bin, zeros, (4 - bin.length % 4) % 4);
	return bin.length;
}

static void range(size_t offset, size_t count) {
	text("[");
	integer((long long)offset);
	text(",");
	integer((long long)count);
	text("]");
}

static void floats(const char *name, const float *values, size_t count) {
	size_t offset = start_array();
	append(&bin, values, count * sizeof(float));
	key(name);
	range(offset, count);
}

static void vector(const double *v, size_t count) {
	text("[");
	for (size_t i = 0; i < count; i++) {
		if (i) text(",");
		number(v[i]);
	}
	text("]");
}

// The 4 x 4 column-major matrix of an affine ufbx matrix, as glTF stores matrices.
static void matrix_floats(const ufbx_matrix *m, float *out) {
	for (int c = 0; c < 4; c++) {
		out[c * 4 + 0] = (float)m->cols[c].x;
		out[c * 4 + 1] = (float)m->cols[c].y;
		out[c * 4 + 2] = (float)m->cols[c].z;
		out[c * 4 + 3] = c == 3 ? 1.0f : 0.0f;
	}
}

// The vertex streams of one welded part: each corner's attributes before welding, then each
// vertex's after.
typedef struct {
	float *position, *normal, *uv0, *uv1, *color;
	uint32_t *source;
} streams_t;

// The most joints that move one vertex in glTF's first set of joints and weights.
#define MAX_JOINTS 4

// Writes one part, after a comma unless it is the first that `first` counts. A part with no whole
// triangle writes nothing.
static int write_part(const ufbx_mesh *mesh, const ufbx_mesh_part *part, int *first,
	ufbx_error *error) {
	size_t corners = part->num_triangles * 3;
	if (corners == 0) return 1;
	int has_normal = mesh->vertex_normal.exists;
	int has_uv0 = mesh->uv_sets.count > 0;
	int has_uv1 = mesh->uv_sets.count > 1;
	int has_color = mesh->vertex_color.exists;
	streams_t s = {0};
	s.position = malloc(corners * 3 * sizeof(float));
	s.normal = has_normal ? malloc(corners * 3 * sizeof(float)) : NULL;
	s.uv0 = has_uv0 ? malloc(corners * 2 * sizeof(float)) : NULL;
	s.uv1 = has_uv1 ? malloc(corners * 2 * sizeof(float)) : NULL;
	s.color = has_color ? malloc(corners * 4 * sizeof(float)) : NULL;
	s.source = malloc(corners * sizeof(uint32_t));
	uint32_t *indices = malloc(corners * sizeof(uint32_t));
	uint32_t *triangle = malloc(mesh->max_face_triangles * 3 * sizeof(uint32_t));
	int ok = s.position && s.source && indices && triangle && (!has_normal || s.normal) &&
		(!has_uv0 || s.uv0) && (!has_uv1 || s.uv1) && (!has_color || s.color);
	size_t n = 0;
	for (size_t f = 0; ok && f < part->face_indices.count; f++) {
		uint32_t face_index = part->face_indices.data[f];
		if (mesh->face_hole.count > face_index && mesh->face_hole.data[face_index]) continue;
		ufbx_face face = mesh->faces.data[face_index];
		uint32_t count = ufbx_triangulate_face(triangle, mesh->max_face_triangles * 3, mesh, face);
		for (uint32_t k = 0; k < count * 3 && n < corners; k++, n++) {
			uint32_t ix = triangle[k];
			ufbx_vec3 p = ufbx_get_vertex_vec3(&mesh->vertex_position, ix);
			s.position[n * 3 + 0] = (float)p.x;
			s.position[n * 3 + 1] = (float)p.y;
			s.position[n * 3 + 2] = (float)p.z;
			if (has_normal) {
				ufbx_vec3 v = ufbx_get_vertex_vec3(&mesh->vertex_normal, ix);
				s.normal[n * 3 + 0] = (float)v.x;
				s.normal[n * 3 + 1] = (float)v.y;
				s.normal[n * 3 + 2] = (float)v.z;
			}
			// FBX and OBJ put the texture's bottom row at V = 0, and glTF its top row.
			if (has_uv0) {
				ufbx_vec2 v = ufbx_get_vertex_vec2(&mesh->uv_sets.data[0].vertex_uv, ix);
				s.uv0[n * 2 + 0] = (float)v.x;
				s.uv0[n * 2 + 1] = (float)(1.0 - v.y);
			}
			if (has_uv1) {
				ufbx_vec2 v = ufbx_get_vertex_vec2(&mesh->uv_sets.data[1].vertex_uv, ix);
				s.uv1[n * 2 + 0] = (float)v.x;
				s.uv1[n * 2 + 1] = (float)(1.0 - v.y);
			}
			if (has_color) {
				ufbx_vec4 v = ufbx_get_vertex_vec4(&mesh->vertex_color, ix);
				s.color[n * 4 + 0] = (float)v.x;
				s.color[n * 4 + 1] = (float)v.y;
				s.color[n * 4 + 2] = (float)v.z;
				s.color[n * 4 + 3] = (float)v.w;
			}
			s.source[n] = mesh->vertex_indices.data[ix];
		}
	}
	size_t vertices = 0;
	if (ok && n > 0) {
		ufbx_vertex_stream streams[6];
		size_t count = 0;
		streams[count++] = (ufbx_vertex_stream){s.position, n, 3 * sizeof(float)};
		streams[count++] = (ufbx_vertex_stream){s.source, n, sizeof(uint32_t)};
		if (has_normal) streams[count++] = (ufbx_vertex_stream){s.normal, n, 3 * sizeof(float)};
		if (has_uv0) streams[count++] = (ufbx_vertex_stream){s.uv0, n, 2 * sizeof(float)};
		if (has_uv1) streams[count++] = (ufbx_vertex_stream){s.uv1, n, 2 * sizeof(float)};
		if (has_color) streams[count++] = (ufbx_vertex_stream){s.color, n, 4 * sizeof(float)};
		vertices = ufbx_generate_indices(streams, count, indices, n, NULL, error);
		if (error->type != UFBX_ERROR_NONE) ok = 0;
	}
	if (ok && vertices > 0) {
		if (!*first) text(",");
		*first = 0;
		text("{");
		key("slot");
		integer(part->index);
		text(",");
		floats("positions", s.position, vertices * 3);
		if (has_normal) {
			text(",");
			floats("normals", s.normal, vertices * 3);
		}
		if (has_uv0) {
			text(",");
			floats("uv0", s.uv0, vertices * 2);
		}
		if (has_uv1) {
			text(",");
			floats("uv1", s.uv1, vertices * 2);
		}
		if (has_color) {
			text(",");
			floats("colors", s.color, vertices * 4);
		}
		size_t offset = start_array();
		append(&bin, indices, n * sizeof(uint32_t));
		text(",");
		key("indices");
		range(offset, n);
		offset = start_array();
		append(&bin, s.source, vertices * sizeof(uint32_t));
		text(",");
		key("sources");
		range(offset, vertices);
		text("}");
	}
	free(s.position);
	free(s.normal);
	free(s.uv0);
	free(s.uv1);
	free(s.color);
	free(s.source);
	free(indices);
	free(triangle);
	return ok;
}

// The skin's first joints and weights of each of the mesh's vertices, the heaviest first, with
// the weights summing to one. A vertex that no joint moves takes the last joint, which the reader
// adds: the mesh's own node.
static void write_skin_weights(const ufbx_mesh *mesh, const ufbx_skin_deformer *skin) {
	size_t count = mesh->num_vertices;
	size_t offset = start_array();
	for (size_t v = 0; v < count; v++) {
		uint32_t joints[MAX_JOINTS] = {0};
		float weights[MAX_JOINTS] = {0};
		float total = 0;
		if (v < skin->vertices.count) {
			ufbx_skin_vertex sv = skin->vertices.data[v];
			for (uint32_t k = 0; k < sv.num_weights && k < MAX_JOINTS; k++) {
				ufbx_skin_weight w = skin->weights.data[sv.weight_begin + k];
				joints[k] = w.cluster_index;
				weights[k] = (float)w.weight;
				total += weights[k];
			}
		}
		if (total > 0)
			for (int k = 0; k < MAX_JOINTS; k++) weights[k] /= total;
		else {
			joints[0] = (uint32_t)skin->clusters.count;
			weights[0] = 1;
		}
		append(&bin, joints, sizeof(joints));
		append(&bin, weights, sizeof(weights));
	}
	key("skinWeights");
	range(offset, count);
}

// The blend shape channels of a mesh, which become its morph targets: each channel's final
// shape, as offsets of every vertex of the mesh.
static void write_targets(const ufbx_mesh *mesh) {
	text("\"targets\":[");
	int first = 1;
	for (size_t d = 0; d < mesh->blend_deformers.count; d++) {
		const ufbx_blend_deformer *deformer = mesh->blend_deformers.data[d];
		for (size_t c = 0; c < deformer->channels.count; c++) {
			const ufbx_blend_channel *channel = deformer->channels.data[c];
			const ufbx_blend_shape *shape = channel->target_shape;
			if (!first) text(",");
			first = 0;
			text("{");
			// Some exporters leave the channel unnamed and name only its shape.
			const ufbx_string *name =
				channel->name.length == 0 && shape ? &shape->name : &channel->name;
			key("name");
			string(name->data, name->length);
			text(",");
			key("channel");
			integer(channel->element_id);
			text(",");
			key("weight");
			number(channel->weight);
			size_t count = mesh->num_vertices;
			float *positions = calloc(count * 3, sizeof(float));
			float *normals = calloc(count * 3, sizeof(float));
			int has_normals = shape && shape->normal_offsets.count > 0;
			if (positions && normals && shape) {
				for (size_t k = 0; k < shape->num_offsets; k++) {
					uint32_t v = shape->offset_vertices.data[k];
					if (v >= count) continue;
					ufbx_vec3 p = shape->position_offsets.data[k];
					positions[v * 3 + 0] = (float)p.x;
					positions[v * 3 + 1] = (float)p.y;
					positions[v * 3 + 2] = (float)p.z;
					if (has_normals) {
						ufbx_vec3 n = shape->normal_offsets.data[k];
						normals[v * 3 + 0] = (float)n.x;
						normals[v * 3 + 1] = (float)n.y;
						normals[v * 3 + 2] = (float)n.z;
					}
				}
				text(",");
				floats("positions", positions, count * 3);
				if (has_normals) {
					text(",");
					floats("normals", normals, count * 3);
				}
			} else if (!positions || !normals)
				bin.failed = 1;
			free(positions);
			free(normals);
			text("}");
		}
	}
	text("]");
}

static int write_mesh(const ufbx_mesh *mesh, ufbx_error *error) {
	text("{");
	key("name");
	string(mesh->name.data, mesh->name.length);
	text(",\"parts\":[");
	int first = 1;
	for (size_t p = 0; p < mesh->material_parts.count; p++) {
		const ufbx_mesh_part *part = &mesh->material_parts.data[p];
		if (!write_part(mesh, part, &first, error)) return 0;
	}
	text("],");
	write_targets(mesh);
	if (mesh->skin_deformers.count > 0) {
		const ufbx_skin_deformer *skin = mesh->skin_deformers.data[0];
		text(",");
		write_skin_weights(mesh, skin);
		text(",\"joints\":[");
		float *inverse = malloc((skin->clusters.count + 1) * 16 * sizeof(float));
		if (!inverse) return 0;
		for (size_t c = 0; c < skin->clusters.count; c++) {
			const ufbx_skin_cluster *cluster = skin->clusters.data[c];
			if (c) text(",");
			integer(cluster->bone_node ? (long long)cluster->bone_node->typed_id : -1);
			matrix_floats(&cluster->geometry_to_bone, inverse + c * 16);
		}
		text("],");
		floats("inverseBind", inverse, skin->clusters.count * 16);
		free(inverse);
	}
	text("}");
	return 1;
}

static void write_node(const ufbx_node *node) {
	text("{");
	key("name");
	string(node->name.data, node->name.length);
	text(",");
	key("parent");
	integer(node->parent && !node->parent->is_root ? (long long)node->parent->typed_id : -1);
	const ufbx_transform *t = &node->local_transform;
	double translation[3] = {t->translation.x, t->translation.y, t->translation.z};
	double rotation[4] = {t->rotation.x, t->rotation.y, t->rotation.z, t->rotation.w};
	double scale[3] = {t->scale.x, t->scale.y, t->scale.z};
	text(",\"t\":");
	vector(translation, 3);
	text(",\"r\":");
	vector(rotation, 4);
	text(",\"s\":");
	vector(scale, 3);
	if (node->mesh) {
		text(",");
		key("mesh");
		integer(node->mesh->typed_id);
		text(",\"materials\":[");
		for (size_t m = 0; m < node->materials.count; m++) {
			if (m) text(",");
			integer(node->materials.data[m]->typed_id);
		}
		text("]");
		// The bind transform of a skinned mesh's vertices that no joint moves.
		const ufbx_matrix *g = &node->geometry_to_node;
		float m[16];
		matrix_floats(g, m);
		double rest[16];
		for (int i = 0; i < 16; i++) rest[i] = m[i];
		text(",\"geometryToNode\":");
		vector(rest, 16);
	}
	text("}");
}

static void write_map(const char *name, const ufbx_material_map *map) {
	text(",");
	key(name);
	text("{");
	key("value");
	double v[4] = {map->value_vec4.x, map->value_vec4.y, map->value_vec4.z, map->value_vec4.w};
	vector(v, 4);
	text(",");
	key("has");
	text(map->has_value ? "true" : "false");
	if (map->texture && map->texture_enabled) {
		text(",");
		key("texture");
		integer(map->texture->typed_id);
	}
	text("}");
}

static void write_material(const ufbx_material *material) {
	text("{");
	key("name");
	string(material->name.data, material->name.length);
	text(",");
	key("shader");
	integer(material->shader_type);
	const ufbx_material_pbr_maps *pbr = &material->pbr;
	const ufbx_material_fbx_maps *fbx = &material->fbx;
	write_map("baseFactor", &pbr->base_factor);
	write_map("baseColor", &pbr->base_color);
	write_map("roughness", &pbr->roughness);
	write_map("metalness", &pbr->metalness);
	write_map("glossiness", &pbr->glossiness);
	write_map("opacity", &pbr->opacity);
	write_map("normal", &pbr->normal_map);
	write_map("occlusion", &pbr->ambient_occlusion);
	write_map("emissionFactor", &pbr->emission_factor);
	write_map("emission", &pbr->emission_color);
	write_map("specularExponent", &fbx->specular_exponent);
	write_map("bump", &fbx->bump);
	write_map("bumpFactor", &fbx->bump_factor);
	write_map("transparencyFactor", &fbx->transparency_factor);
	write_map("transparency", &fbx->transparency_color);
	text(",");
	key("pbr");
	text(material->features.pbr.enabled ? "true" : "false");
	text(",");
	key("doubleSided");
	text(material->features.double_sided.enabled ? "true" : "false");
	text("}");
}

static void write_texture(const ufbx_texture *texture) {
	text("{");
	key("name");
	string(texture->name.data, texture->name.length);
	text(",");
	key("file");
	string(texture->filename.data, texture->filename.length);
	text(",");
	key("relative");
	string(texture->relative_filename.data, texture->relative_filename.length);
	text(",");
	key("absolute");
	string(texture->absolute_filename.data, texture->absolute_filename.length);
	if (texture->content.size > 0) {
		size_t offset = start_array();
		append(&bin, texture->content.data, texture->content.size);
		text(",");
		key("content");
		range(offset, texture->content.size);
	}
	if (texture->has_uv_transform) {
		const ufbx_matrix *m = &texture->uv_to_texture;
		// The scale and offset of the texture's coordinates, and whether it also turns them.
		double transform[6] = {m->m00, m->m11, m->m03, m->m13, m->m01, m->m10};
		text(",");
		key("transform");
		vector(transform, 6);
	}
	text(",");
	key("wrapU");
	integer(texture->wrap_u);
	text(",");
	key("wrapV");
	integer(texture->wrap_v);
	text("}");
}

static void write_vec3_keys(const char *name, const ufbx_baked_vec3_list *keys, int components) {
	float *times = malloc(keys->count * sizeof(float));
	float *values = malloc(keys->count * components * sizeof(float));
	if (!times || !values) {
		bin.failed = 1;
		free(times);
		free(values);
		return;
	}
	for (size_t k = 0; k < keys->count; k++) {
		times[k] = (float)keys->data[k].time;
		const ufbx_vec3 *v = &keys->data[k].value;
		values[k * components] = (float)v->x;
		if (components == 3) {
			values[k * 3 + 1] = (float)v->y;
			values[k * 3 + 2] = (float)v->z;
		}
	}
	text(",");
	key(name);
	text("{");
	floats("times", times, keys->count);
	text(",");
	floats("values", values, keys->count * components);
	text("}");
	free(times);
	free(values);
}

static void write_quat_keys(const ufbx_baked_quat_list *keys) {
	float *times = malloc(keys->count * sizeof(float));
	float *values = malloc(keys->count * 4 * sizeof(float));
	if (!times || !values) {
		bin.failed = 1;
		free(times);
		free(values);
		return;
	}
	for (size_t k = 0; k < keys->count; k++) {
		times[k] = (float)keys->data[k].time;
		const ufbx_quat *q = &keys->data[k].value;
		values[k * 4 + 0] = (float)q->x;
		values[k * 4 + 1] = (float)q->y;
		values[k * 4 + 2] = (float)q->z;
		values[k * 4 + 3] = (float)q->w;
	}
	text(",\"r\":{");
	floats("times", times, keys->count);
	text(",");
	floats("values", values, keys->count * 4);
	text("}");
	free(times);
	free(values);
}

static int write_clip(const ufbx_scene *scene, const ufbx_anim_stack *stack, double rate,
	ufbx_error *error) {
	ufbx_bake_opts opts = {0};
	opts.trim_start_time = true;
	opts.resample_rate = rate;
	opts.key_reduction_enabled = true;
	opts.key_reduction_rotation = true;
	ufbx_baked_anim *baked = ufbx_bake_anim(scene, stack->anim, &opts, error);
	if (!baked) return 0;
	text("{");
	key("name");
	string(stack->name.data, stack->name.length);
	text(",");
	key("duration");
	number(baked->playback_duration);
	text(",\"nodes\":[");
	for (size_t i = 0; i < baked->nodes.count; i++) {
		const ufbx_baked_node *node = &baked->nodes.data[i];
		if (i) text(",");
		text("{");
		key("node");
		integer(node->typed_id);
		write_vec3_keys("t", &node->translation_keys, 3);
		write_quat_keys(&node->rotation_keys);
		write_vec3_keys("s", &node->scale_keys, 3);
		text("}");
	}
	text("],\"weights\":[");
	int first = 1;
	for (size_t i = 0; i < baked->elements.count; i++) {
		const ufbx_baked_element *element = &baked->elements.data[i];
		for (size_t p = 0; p < element->props.count; p++) {
			const ufbx_baked_prop *prop = &element->props.data[p];
			if (strcmp(prop->name.data, "DeformPercent") != 0) continue;
			if (!first) text(",");
			first = 0;
			text("{");
			key("channel");
			integer(element->element_id);
			write_vec3_keys("keys", &prop->keys, 1);
			text("}");
		}
	}
	text("]}");
	ufbx_free_baked_anim(baked);
	return 1;
}

typedef struct {
	uint32_t json;
	uint32_t json_length;
	uint32_t bin;
	uint32_t bin_length;
} result_t;

static result_t result;

static void fail(const ufbx_error *error) {
	char message[1024];
	ufbx_format_error(message, sizeof(message), error);
	json.length = 0;
	bin.length = 0;
	json.failed = bin.failed = 0;
	text("{\"error\":");
	string(message, strlen(message));
	text("}");
}

// Frees the last result's blocks.
EXPORT void n3d_release(void) {
	free(json.data);
	free(bin.data);
	memset(&json, 0, sizeof(json));
	memset(&bin, 0, sizeof(bin));
}

// Reads a file: FBX when `obj` is 0, else OBJ with the MTL file's bytes, if any. Clips are
// baked at `rate` keys a second where their curves need it.
EXPORT result_t *n3d_convert(const void *data, size_t size, const void *mtl, size_t mtl_size,
	int obj, double rate) {
	n3d_release();
	ufbx_load_opts opts = {0};
	opts.target_axes = ufbx_axes_right_handed_y_up;
	opts.target_unit_meters = 1.0;
	opts.space_conversion = UFBX_SPACE_CONVERSION_MODIFY_GEOMETRY;
	opts.geometry_transform_handling = UFBX_GEOMETRY_TRANSFORM_HANDLING_HELPER_NODES;
	opts.inherit_mode_handling = UFBX_INHERIT_MODE_HANDLING_COMPENSATE;
	opts.handedness_conversion_axis = UFBX_MIRROR_AXIS_X;
	opts.generate_missing_normals = true;
	opts.clean_skin_weights = true;
	opts.use_blender_pbr_material = true;
	opts.file_format = obj ? UFBX_FILE_FORMAT_OBJ : UFBX_FILE_FORMAT_FBX;
	if (obj && mtl_size > 0) {
		opts.obj_mtl_data.data = mtl;
		opts.obj_mtl_data.size = mtl_size;
	}
	ufbx_error error;
	ufbx_scene *scene = ufbx_load_memory(data, size, &opts, &error);
	if (!scene) {
		fail(&error);
	} else {
		int ok = 1;
		text("{\"nodes\":[");
		int first = 1;
		for (size_t i = 0; i < scene->nodes.count; i++) {
			const ufbx_node *node = scene->nodes.data[i];
			if (!first) text(",");
			first = 0;
			// The root keeps its place, so typed ids index the list, and the reader skips it.
			if (node->is_root)
				text("null");
			else
				write_node(node);
		}
		text("],\"meshes\":[");
		for (size_t i = 0; ok && i < scene->meshes.count; i++) {
			if (i) text(",");
			ok = write_mesh(scene->meshes.data[i], &error);
		}
		text("],\"materials\":[");
		for (size_t i = 0; ok && i < scene->materials.count; i++) {
			if (i) text(",");
			write_material(scene->materials.data[i]);
		}
		text("],\"textures\":[");
		for (size_t i = 0; ok && i < scene->textures.count; i++) {
			if (i) text(",");
			write_texture(scene->textures.data[i]);
		}
		text("],\"clips\":[");
		for (size_t i = 0; ok && i < scene->anim_stacks.count; i++) {
			if (i) text(",");
			ok = write_clip(scene, scene->anim_stacks.data[i], rate, &error);
		}
		text("],");
		key("cameras");
		integer((long long)scene->cameras.count);
		text(",");
		key("lights");
		integer((long long)scene->lights.count);
		text("}");
		if (!ok) fail(&error);
		ufbx_free_scene(scene);
	}
	if (json.failed || bin.failed) {
		n3d_release();
		text("{\"error\":\"out of memory\"}");
	}
	result.json = (uint32_t)(uintptr_t)json.data;
	result.json_length = (uint32_t)json.length;
	result.bin = (uint32_t)(uintptr_t)bin.data;
	result.bin_length = (uint32_t)bin.length;
	return &result;
}

EXPORT void *n3d_alloc(size_t size) { return malloc(size); }

EXPORT void n3d_free(void *pointer) { free(pointer); }

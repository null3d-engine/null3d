// Written by tools/plant-textures from the reference set: the texture files of the species
// tree-fern, as `bun run plants:textures tree-fern` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "tree-fern",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "642aac0aa630679b33779558fb80d5a8e75e1d4e86ba23e90c513094c3466757",
					"job": "da00242b-e120-4541-a1ac-9a7f919d82b0"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "7090e16fe7e2ca4de36eca77c729dae173de930cbb52f1bf3ee5693bc88309f9",
					"job": "9ba085e2-e25c-4fcf-b192-471eafa692b1"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "31da95312a64b1bfa14c2b561d34106bf49741a104ad78f61ed1c99e380c1ee2",
					"job": "5849d771-6d66-40c8-abcd-2a2ae6789319"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "31da95312a64b1bfa14c2b561d34106bf49741a104ad78f61ed1c99e380c1ee2",
					"job": "5849d771-6d66-40c8-abcd-2a2ae6789319"
				}
			]
		},
		"tool": {
			"version": "1",
			"encoder": "Basis Universal 2.50, ETC1S, effort 2"
		},
		"leaf": {
			"size": 1024,
			"layers": [
				"upper",
				"lower"
			],
			"length": 0.80444,
			"frame": {
				"petiole": [
					0.5,
					0.02307
				],
				"base": [
					0.5,
					0.16895
				],
				"tip": [
					0.5,
					0.97338
				]
			},
			"outline": [
				0.4868,
				0.9995,
				0.4716,
				0.8706,
				0.3795,
				0.8159,
				0.4244,
				0.8042,
				0.3689,
				0.7632,
				0.362,
				0.7476,
				0.3973,
				0.7446,
				0.3485,
				0.689,
				0.3973,
				0.6802,
				0.3331,
				0.6138,
				0.3855,
				0.6157,
				0.335,
				0.5522,
				0.3875,
				0.5552,
				0.3387,
				0.4868,
				0.3833,
				0.487,
				0.3951,
				0.4644,
				0.354,
				0.4217,
				0.4158,
				0.4155,
				0.3616,
				0.3657,
				0.4251,
				0.3774,
				0.3792,
				0.312,
				0.4171,
				0.3169,
				0.3938,
				0.2642,
				0.4279,
				0.2681,
				0.4131,
				0.2212,
				0.4367,
				0.229,
				0.4279,
				0.1968,
				0.5005,
				0.0077,
				0.5543,
				0.1196,
				0.5429,
				0.1558,
				0.5714,
				0.1519,
				0.5492,
				0.1938,
				0.5826,
				0.189,
				0.5469,
				0.2446,
				0.5962,
				0.2223,
				0.5712,
				0.2827,
				0.6151,
				0.2866,
				0.5956,
				0.3286,
				0.6164,
				0.3286,
				0.6111,
				0.3657,
				0.5644,
				0.3901,
				0.623,
				0.3804,
				0.6184,
				0.4136,
				0.5791,
				0.4341,
				0.6278,
				0.4292,
				0.5951,
				0.4751,
				0.6294,
				0.4746,
				0.6365,
				0.4985,
				0.5916,
				0.5317,
				0.6375,
				0.5288,
				0.6017,
				0.5923,
				0.6372,
				0.5818,
				0.6383,
				0.605,
				0.5994,
				0.6431,
				0.6393,
				0.647,
				0.6089,
				0.6931,
				0.57,
				0.7007,
				0.6359,
				0.6997,
				0.5807,
				0.7554,
				0.6236,
				0.7593,
				0.5632,
				0.8101,
				0.569,
				0.8423,
				0.5105,
				0.8726,
				0.515,
				0.9644
			],
			"mean": {
				"upper": [
					0.08023,
					0.11902,
					0.03219
				],
				"lower": [
					0.26162,
					0.25853,
					0.07896
				]
			},
			"veins": {
				"luminance": 0.09958,
				"contrast": 12.472
			},
			"profile": {
				"upper": [
					0.10378,
					0.10421,
					0.10445,
					0.10524,
					0.10437,
					0.10419,
					0.10436,
					0.10836
				],
				"lower": [
					0.24572,
					0.24756,
					0.24734,
					0.24773,
					0.24757,
					0.24477,
					0.24619,
					0.24112
				]
			},
			"coverage": 0.1227
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.5,
						0.5
					],
					"mean": [
						0.15875,
						0.05023,
						0.02861
					],
					"height": {
						"offset": 0.07174,
						"depth": 0.066209
					}
				}
			],
			"young": {
				"tile": [
					0.16,
					0.16
				],
				"mean": [
					0.15893,
					0.05034,
					0.02865
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "b2abf97c90b401a386f1a3437f2e4a952583af6bc7b166b8e93ea74bd9175aca",
				"bytes": 193095
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "c3434f9a38ed4fc079b93ed8ee7d7db3cf276c95efad508d8a73f526eebd72bd",
				"bytes": 27221
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "1b74dbc6b507b3bffd2b8a0b15f8e1fba52f0df178ee083f95c483f40b6aaafe",
				"bytes": 65998
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "7da896b1489d00555fba3a7b1cba9afd51df18a29a5fe222c66cbe6f88825fb5",
				"bytes": 5947
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "b2b62a5902907080515c79fd9e46b12f83732233331feb97e29cbfe16a238d5d",
				"bytes": 196040
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "47575824ba08fbe18f4b590d9b82ddeb1a054d0339200e52e13852f74e546340",
				"bytes": 238299
			},
			{
				"file": "young-color.ktx2",
				"sha256": "1898270a765bad40ff37ed17aa2341aa198cfe52bc8312ca84fb3d69537dc488",
				"bytes": 55071
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "6604377bac4597ee60dd2987151a636fed2535b23f615296750f5796acd7aea4",
				"bytes": 72648
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "1b3baea747b82be30c8830a66fbf0cd16cbdd30a08fb1ccc09a16fd62d3ec134",
				"bytes": 55150
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "73c8b1c1a79f776700bdd3f7f958969c1afc3f146a15c2794fe4d3d8867d45cd",
				"bytes": 71400
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "7201b8180f6980f1287c27bf747b2c54d0795bfbc2993d52f3161e43860e5da3",
				"bytes": 14410
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "94bd9dd9b5fbfd6781471daa13103c60f85a9d8e97b9e028f7f522305c97c032",
				"bytes": 21550
			}
		]
	},
	full: {
		leafColor: new URL('./leaf-color.ktx2', import.meta.url),
		leafNormal: new URL('./leaf-normal.ktx2', import.meta.url),
		barkColor: new URL('./bark-color.ktx2', import.meta.url),
		barkNormal: new URL('./bark-normal.ktx2', import.meta.url),
		youngColor: new URL('./young-color.ktx2', import.meta.url),
		youngNormal: new URL('./young-normal.ktx2', import.meta.url),
	},
	half: {
		leafColor: new URL('./leaf-color-half.ktx2', import.meta.url),
		leafNormal: new URL('./leaf-normal-half.ktx2', import.meta.url),
		barkColor: new URL('./bark-color-half.ktx2', import.meta.url),
		barkNormal: new URL('./bark-normal-half.ktx2', import.meta.url),
		youngColor: new URL('./young-color-half.ktx2', import.meta.url),
		youngNormal: new URL('./young-normal-half.ktx2', import.meta.url),
	},
};

// Written by tools/plant-textures from the reference set: the texture files of the species
// date-palm, as `bun run plants:textures date-palm` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "date-palm",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "c4cf368638acb151f39dd140441648f5ac5042fef5547a6e3be5348f57d6590f",
					"job": "04f67bb8-de8d-4dce-b584-4b4bf15477e4"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "ba4625bea127d46bf13e1086978b3dfb554290802b1a1030e2f377b9ee962278",
					"job": "9dffca7c-b72d-4382-8a41-3ddd8426bd60"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "41a7d27bdc2178d48862ee5aaa12324e328dd6c3bc9650b08b46b038a53be91e",
					"job": "adf6ad71-a3c4-4b94-83ae-b968979d8a5a"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "41a7d27bdc2178d48862ee5aaa12324e328dd6c3bc9650b08b46b038a53be91e",
					"job": "adf6ad71-a3c4-4b94-83ae-b968979d8a5a"
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
			"length": 0.6932,
			"frame": {
				"petiole": [
					0.5,
					0.02332
				],
				"base": [
					0.5,
					0.28027
				],
				"tip": [
					0.5,
					0.97347
				]
			},
			"outline": [
				0.481,
				0.9997,
				0.4755,
				0.9526,
				0.4671,
				0.9126,
				0.465,
				0.8999,
				0.4603,
				0.8677,
				0.4561,
				0.8306,
				0.4516,
				0.8091,
				0.4475,
				0.7856,
				0.4455,
				0.772,
				0.4415,
				0.7378,
				0.4385,
				0.6997,
				0.4366,
				0.6528,
				0.4358,
				0.6216,
				0.436,
				0.5581,
				0.4378,
				0.4946,
				0.4408,
				0.4399,
				0.4453,
				0.3765,
				0.4505,
				0.3228,
				0.4608,
				0.2446,
				0.465,
				0.2026,
				0.4728,
				0.1392,
				0.4796,
				0.0874,
				0.4914,
				0.0044,
				0.4921,
				0.0005,
				0.4927,
				0.0001,
				0.5005,
				0,
				0.5013,
				0.0005,
				0.5017,
				0.0024,
				0.5095,
				0.0474,
				0.5129,
				0.0698,
				0.5143,
				0.0767,
				0.5211,
				0.1255,
				0.53,
				0.1968,
				0.5344,
				0.2407,
				0.5395,
				0.2798,
				0.5461,
				0.3374,
				0.5476,
				0.3472,
				0.5508,
				0.3794,
				0.5535,
				0.4019,
				0.5538,
				0.4087,
				0.5553,
				0.4204,
				0.5584,
				0.4565,
				0.5624,
				0.5181,
				0.5641,
				0.5688,
				0.5642,
				0.6001,
				0.5637,
				0.6313,
				0.5623,
				0.6694,
				0.5582,
				0.7261,
				0.5544,
				0.7612,
				0.5488,
				0.7974,
				0.5466,
				0.8218,
				0.5416,
				0.8579,
				0.5361,
				0.8872,
				0.5329,
				0.9009,
				0.5291,
				0.9136,
				0.5242,
				0.9272,
				0.5212,
				0.9351,
				0.5177,
				0.9419,
				0.5147,
				0.9585,
				0.5147,
				0.9653,
				0.5178,
				0.9995,
				0.5161,
				1,
				0.4819,
				1
			],
			"mean": {
				"upper": [
					0.10053,
					0.14593,
					0.08743
				],
				"lower": [
					0.21315,
					0.27155,
					0.20786
				]
			},
			"veins": {
				"luminance": 0.13293,
				"contrast": 16.455
			},
			"profile": {
				"upper": [
					0.13218,
					0.1326,
					0.13144,
					0.13203,
					0.13163,
					0.132,
					0.12889,
					0.13894
				],
				"lower": [
					0.25471,
					0.25682,
					0.25447,
					0.25408,
					0.25454,
					0.25364,
					0.25305,
					0.25681
				]
			},
			"coverage": 0.0816
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.42,
						0.42
					],
					"mean": [
						0.22566,
						0.15146,
						0.11136
					],
					"height": {
						"offset": 0.16434,
						"depth": 0.057982
					}
				}
			],
			"young": {
				"tile": [
					0.12,
					0.12
				],
				"mean": [
					0.23992,
					0.17214,
					0.09275
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "5c747252cdb511e7cab01e68089d4b0a8f5cdca95ceb9234badd37b4129c3e11",
				"bytes": 101038
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "59391206d3701cebded84bd84d9e74ab28267879bc7816944f499f1e13006234",
				"bytes": 6333
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "00a71d77577e3f73301ab9f39f301b8b4dcc4eb6f81aa238f00baa4fa2a26790",
				"bytes": 39782
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "614f02b28b34dd320905a0227d74d17fa77461cce6f1a20ffc5f4ee10795f5a2",
				"bytes": 1723
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "5965f8089b8c751da48d1543407dbeb3bde96f41887f4d33a5bd2342818b899e",
				"bytes": 193929
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "b404d1b243f37705bae2c154566c9d71d808f5ee7b95b9acfb6bf0bbfd382a5f",
				"bytes": 253161
			},
			{
				"file": "young-color.ktx2",
				"sha256": "a5f7248a468deb27f23c438caa413f1369ccc09c38f3ac97e08595369229f1e2",
				"bytes": 56103
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "cf5796321037f6de39c1e8928e5b9314fe591074fe98a3c64a12034da8be8b94",
				"bytes": 19067
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "97d60b7cf106b1e0bb703f78f8b3afcde09de206791c137413c182e7e7b70daf",
				"bytes": 56076
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "30e58d01c326b1161fb640569da2703bab5bd04e1bed265eb513d7c94d7691c6",
				"bytes": 73315
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "2011babc743ecd700466e081b5be6d7c445ce9b380e67b321cd48807bda94ae3",
				"bytes": 15243
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "00e5f7106499bf4edcbc07b36e49aeb527c43a77f28c8af2b68a90517f1b22f7",
				"bytes": 8259
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

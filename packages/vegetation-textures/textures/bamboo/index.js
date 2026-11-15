// Written by tools/plant-textures from the reference set: the texture files of the species
// bamboo, as `bun run plants:textures bamboo` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "bamboo",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "08eea551b8239142359e0516036b794d2e3c6ab863189648bacb0a4d05c84a3f",
					"job": "7249299c-8090-415d-9a7e-40345d3262b6"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "002dc95578b95af094b49acf433daa4f78af08a769bec150365d732bed64835e",
					"job": "0d35eedf-b8cd-410c-a830-112605b11029"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "98b2c410e1e329d58a6abd9780e6afb520c2ffbd39d0c98527752c066b55e69f",
					"job": "0c851e7d-eed4-4f56-89d6-2396d95e709f"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "98b2c410e1e329d58a6abd9780e6afb520c2ffbd39d0c98527752c066b55e69f",
					"job": "0c851e7d-eed4-4f56-89d6-2396d95e709f"
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
			"length": 0.83398,
			"frame": {
				"petiole": [
					0.5,
					0.02542
				],
				"base": [
					0.5,
					0.14258
				],
				"tip": [
					0.5,
					0.97656
				]
			},
			"outline": [
				0.5005,
				0.9758,
				0.4969,
				0.8911,
				0.4881,
				0.8315,
				0.467,
				0.7329,
				0.4533,
				0.7124,
				0.4435,
				0.687,
				0.4344,
				0.6479,
				0.426,
				0.5903,
				0.4206,
				0.5005,
				0.4223,
				0.4263,
				0.421,
				0.3491,
				0.425,
				0.2837,
				0.4338,
				0.2202,
				0.4397,
				0.1968,
				0.4508,
				0.1665,
				0.4875,
				0.0005,
				0.5229,
				0,
				0.5579,
				0.1626,
				0.5691,
				0.1909,
				0.5748,
				0.2134,
				0.5841,
				0.2769,
				0.5877,
				0.2856,
				0.5874,
				0.2878,
				0.5851,
				0.2866,
				0.5851,
				0.2905,
				0.5886,
				0.3091,
				0.5866,
				0.311,
				0.5897,
				0.3354,
				0.5879,
				0.3364,
				0.5879,
				0.3491,
				0.5908,
				0.3599,
				0.588,
				0.3599,
				0.588,
				0.3784,
				0.5909,
				0.3892,
				0.5879,
				0.3892,
				0.5876,
				0.4019,
				0.5906,
				0.4146,
				0.5874,
				0.4136,
				0.5869,
				0.4282,
				0.5894,
				0.438,
				0.5874,
				0.4359,
				0.5862,
				0.439,
				0.5882,
				0.4604,
				0.5849,
				0.5649,
				0.577,
				0.6353,
				0.5633,
				0.689,
				0.5548,
				0.7104,
				0.5427,
				0.731,
				0.5425,
				0.7388,
				0.5403,
				0.7368,
				0.5386,
				0.7562,
				0.5366,
				0.7545,
				0.5356,
				0.7645,
				0.5347,
				0.7634,
				0.5326,
				0.77,
				0.5327,
				0.7782,
				0.5308,
				0.7786,
				0.5293,
				0.7837,
				0.5298,
				0.7925,
				0.5288,
				0.7939,
				0.5277,
				0.7925,
				0.5245,
				0.8062,
				0.5138,
				0.8667,
				0.5047,
				0.9536
			],
			"mean": {
				"upper": [
					0.08078,
					0.21876,
					0.00472
				],
				"lower": [
					0.16946,
					0.2568,
					0.1908
				]
			},
			"veins": {
				"luminance": 0.16399,
				"contrast": 6.225
			},
			"profile": {
				"upper": [
					0.1695,
					0.17302,
					0.17404,
					0.1739,
					0.17472,
					0.17563,
					0.1745,
					0.18066
				],
				"lower": [
					0.23367,
					0.23316,
					0.23363,
					0.23327,
					0.23291,
					0.2326,
					0.25465,
					0
				]
			},
			"coverage": 0.0927
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "culm",
					"tile": [
						0.4,
						0.45
					],
					"mean": [
						0.12968,
						0.34459,
						0.0153
					],
					"height": {
						"offset": 0.27512,
						"depth": 0.010375
					}
				}
			],
			"young": {
				"tile": [
					0.12,
					0.12
				],
				"mean": [
					0.12971,
					0.34453,
					0.01534
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "1d73f7e88136b19bcad67e04ac1323b89f1f039c0198d69f5e29c02de8b5e6c7",
				"bytes": 120304
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "62695e159855bbef07ec8694a2b45aea0fc74059147e0ea8ff2f3a932db34861",
				"bytes": 8969
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "f7aece57d717f1b72d2a411a8d5af46774354a4e0c84b960d60699ce507b9195",
				"bytes": 46297
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "c5122897243de0056121fd30d0b5aa8ccd3b413d7bb68a293a609a2fc5442a57",
				"bytes": 2028
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "9fb85dcccd7f50d0ec810f71fde06fd309a922e70966569fffeddd60d2f63a4b",
				"bytes": 160571
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "b6a670140910e960a4d992f74628289177ebe5e2198c4070baaf9ef5106f8532",
				"bytes": 173631
			},
			{
				"file": "young-color.ktx2",
				"sha256": "b73786f32f08e9b0b4e94771a05d3fd668c5f911f652850ea187ccf6f9d439ea",
				"bytes": 45993
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "c7d2e7010fed3038568fad4043df62fefc0a0ca68da8312d8b0acfcbd3d15d76",
				"bytes": 52584
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "61eb74b55404480ff2c5f929fa3b3082d042b117d8a65682135df442df163a48",
				"bytes": 45953
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "d130cb93f3d794e576b1fd38e3c15adafa1844a9dc74af794891b7372044c529",
				"bytes": 49824
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "de7dbf52baf936cbc33df44880693d66943c7cb6930cc5445a6dc42cef4f672c",
				"bytes": 11971
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "685ace246b6bf5944c847d2b29c70c6418be125c6d30d3715c98141824ae6ccd",
				"bytes": 13069
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

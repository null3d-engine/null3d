// Written by tools/plant-textures from the reference set: the texture files of the species
// common-alder, as `bun run plants:textures common-alder` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "common-alder",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "8355243695f3bae7eec19015855ea7459d019f0b",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "ffd5c7571af2ec37ba9946a47456c79cc1b20e5b8a41cc7ed7f34390085a79ac",
					"job": "4a34dcaf-c83e-44ec-81c9-feaac2fc435c"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "b0e74f910c67605e1c433acf15aad400e9d87c05987eb7f71a15648b1bb86ed9",
					"job": "ef841ad2-3a58-42d7-8a3a-a15d79018273"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "bde1143334ee230a797ef3ecae697332c57d128e491895d54c3505e9622b37ca",
					"job": "2a5d4ad7-0406-4fb9-81ef-6dee7283eb4d"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "e3a7b2f5a3f1b349fa19d31657be903a2c03d74c116693c18e9582a6e4841a58",
					"job": "824ad450-79ee-4493-b5c0-321e4be0e1ea"
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
			"length": 0.80147,
			"frame": {
				"petiole": [
					0.5,
					0.0229
				],
				"base": [
					0.5,
					0.17188
				],
				"tip": [
					0.5,
					0.97335
				]
			},
			"outline": [
				0.4614,
				0.9791,
				0.4263,
				0.9753,
				0.3804,
				0.951,
				0.3576,
				0.9214,
				0.3276,
				0.9169,
				0.2964,
				0.8759,
				0.2778,
				0.8775,
				0.2485,
				0.8538,
				0.2261,
				0.7977,
				0.1935,
				0.7964,
				0.1689,
				0.7524,
				0.1716,
				0.729,
				0.1466,
				0.7153,
				0.134,
				0.644,
				0.1167,
				0.6362,
				0.125,
				0.5767,
				0.1034,
				0.5522,
				0.1187,
				0.4995,
				0.1137,
				0.4634,
				0.1415,
				0.4097,
				0.1312,
				0.3833,
				0.1606,
				0.3452,
				0.1597,
				0.3247,
				0.1819,
				0.3101,
				0.185,
				0.2837,
				0.2476,
				0.2159,
				0.3296,
				0.1733,
				0.4292,
				0.1765,
				0.4761,
				0.1643,
				0.4863,
				0.0278,
				0.5005,
				0.0203,
				0.5178,
				0.0288,
				0.5132,
				0.0624,
				0.5252,
				0.0718,
				0.5081,
				0.1353,
				0.5132,
				0.1679,
				0.6665,
				0.1826,
				0.7446,
				0.223,
				0.7514,
				0.2397,
				0.8052,
				0.2798,
				0.8065,
				0.2993,
				0.8548,
				0.3677,
				0.8441,
				0.3911,
				0.8798,
				0.4536,
				0.8764,
				0.5239,
				0.886,
				0.5513,
				0.8703,
				0.5679,
				0.8729,
				0.6313,
				0.848,
				0.6538,
				0.8433,
				0.7104,
				0.8177,
				0.7407,
				0.7993,
				0.7918,
				0.7711,
				0.7954,
				0.7439,
				0.8491,
				0.7036,
				0.8595,
				0.6932,
				0.8882,
				0.6704,
				0.8968,
				0.6566,
				0.9233,
				0.6245,
				0.9287,
				0.5688,
				0.9742,
				0.522,
				0.9784,
				0.4985,
				0.9528
			],
			"mean": {
				"upper": [
					0.03031,
					0.06507,
					0.00926
				],
				"lower": [
					0.18184,
					0.2535,
					0.07808
				]
			},
			"veins": {
				"luminance": 0.04319,
				"contrast": 7.372
			},
			"profile": {
				"upper": [
					0.05429,
					0.05255,
					0.05352,
					0.05332,
					0.05398,
					0.05345,
					0.05375,
					0.05368
				],
				"lower": [
					0.22262,
					0.22726,
					0.22594,
					0.22479,
					0.22695,
					0.22622,
					0.22638,
					0.2197
				]
			},
			"coverage": 0.4825
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.45,
						0.45
					],
					"mean": [
						0.07191,
						0.04708,
						0.04017
					],
					"height": {
						"offset": 0.05189,
						"depth": 0.108266
					}
				}
			],
			"young": {
				"tile": [
					0.06,
					0.12
				],
				"mean": [
					0.14411,
					0.07538,
					0.04727
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "1ad1dbcaf4ced8c4229c5dd6a3d913af369635d15cf6821d2a6a78aa2c0c488d",
				"bytes": 274118
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "6e1077c57b947ef6de76f12e2387e49706a9818b1c95fefb8fe32a3045bcea24",
				"bytes": 100680
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "84e066d882a7039016412eabb1fea3b35a61b97026d4d66a457aa25348437d5d",
				"bytes": 83359
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "ddaadcd0445e57e757611fc44ad316ba7251300ba7c37651c4181c76b6d0304f",
				"bytes": 26576
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "3947d01eeb9578f5a5d86fcaf9d7416d6c41d6138e6f8952c24ddea3c1357dcf",
				"bytes": 188185
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "3d395388e36ba19c292d8b6ba51ec7446bb922d328ec7a2ea8a4c4f4cca21625",
				"bytes": 251290
			},
			{
				"file": "young-color.ktx2",
				"sha256": "7f6e4600a4e68df47e1b92b5181b7b6a1acf376a9a88fcd8c982f2e02fc04232",
				"bytes": 54429
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "d3cde56307a2ef9fe7a9e95ab924d42e8b12a0bca6228f3533c9e0bd2c2cf84a",
				"bytes": 57129
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "2c9e97525dd3258a12c50a9aac4be3ca148a2b59d9fbf75754bf52f5555b11e2",
				"bytes": 52504
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "788f5827c5ff5899824c858b052b705b168d650a41c542ebf437b8a05c1bba90",
				"bytes": 73133
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "2f13dae7bb14c82ee3c893da957b50ac04575294e1892ac3d0cc3271fad0172f",
				"bytes": 14078
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "7145be8832805b1496cda5b28c2dff898c3213cd285aa771ca8773f997f988b0",
				"bytes": 13288
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

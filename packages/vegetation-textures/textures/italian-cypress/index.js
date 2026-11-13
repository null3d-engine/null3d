// Written by tools/plant-textures from the reference set: the texture files of the species
// italian-cypress, as `bun run plants:textures italian-cypress` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: {
		"format": 1,
		"species": "italian-cypress",
		"source": {
			"repository": "null3d-engine/plant-references",
			"commit": "local",
			"files": [
				{
					"name": "24-leaf-texture-upper.png",
					"sha256": "c4b4571dde73d90a2deb317971f2c375fecdb0bdf1c3f4cd4b7f38d5a8ed3ba4",
					"job": "c0adf6fb-e001-4824-ae38-4f5bf80c7199"
				},
				{
					"name": "25-leaf-texture-underside.png",
					"sha256": "6bd9978ad0f708143953090f767c657b22f20ac21a034103b34d1499c3d5227e",
					"job": "91302f78-e1e4-499a-98a0-a8ae94816a63"
				},
				{
					"name": "26-bark-texture.png",
					"sha256": "c03eab750647a628a4bc28c7427cd3de421182327fb268ec79350fa42a401469",
					"job": "2996d55c-36e8-49c9-be56-d95f2fcefe74"
				},
				{
					"name": "28-young-bark.png",
					"sha256": "b0d79c0593476d17bce3e3d9c192b8ab7fd031687fcd90b1d6f001a255c24b36",
					"job": "e5d4ed30-c853-463c-bbb7-2d2145269049"
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
			"length": 0.87423,
			"frame": {
				"petiole": [
					0.5,
					0.053
				],
				"base": [
					0.5,
					0.08008
				],
				"tip": [
					0.5,
					0.95431
				]
			},
			"outline": [
				0.4585,
				0.9663,
				0.4448,
				0.8774,
				0.4126,
				0.8735,
				0.4097,
				0.769,
				0.4005,
				0.6763,
				0.4034,
				0.6343,
				0.3987,
				0.6079,
				0.3872,
				0.5747,
				0.3816,
				0.5454,
				0.3833,
				0.4935,
				0.3687,
				0.4454,
				0.3647,
				0.4434,
				0.3665,
				0.4146,
				0.3677,
				0.4084,
				0.3707,
				0.4067,
				0.3481,
				0.2575,
				0.353,
				0.2562,
				0.3591,
				0.2319,
				0.3736,
				0.2212,
				0.3776,
				0.2124,
				0.3835,
				0.1694,
				0.3882,
				0.1528,
				0.395,
				0.0757,
				0.4372,
				0.0786,
				0.4468,
				0.0696,
				0.4712,
				0.0661,
				0.4927,
				0.0491,
				0.5054,
				0.0486,
				0.5356,
				0.0822,
				0.5474,
				0.0813,
				0.5528,
				0.0884,
				0.5571,
				0.0894,
				0.6068,
				0.0942,
				0.6008,
				0.106,
				0.6013,
				0.1226,
				0.5948,
				0.1792,
				0.5988,
				0.186,
				0.5999,
				0.1978,
				0.6001,
				0.2358,
				0.5939,
				0.2798,
				0.5822,
				0.3306,
				0.578,
				0.4048,
				0.5822,
				0.4292,
				0.5913,
				0.4367,
				0.5971,
				0.4458,
				0.5999,
				0.4819,
				0.5965,
				0.5278,
				0.5914,
				0.5562,
				0.5971,
				0.5669,
				0.6058,
				0.6099,
				0.6078,
				0.6685,
				0.6122,
				0.6821,
				0.6194,
				0.6938,
				0.6234,
				0.7114,
				0.6251,
				0.7446,
				0.623,
				0.812,
				0.6323,
				0.8259,
				0.6372,
				0.8451,
				0.64,
				0.8892,
				0.6398,
				0.8921,
				0.6323,
				0.8925,
				0.5643,
				0.8872,
				0.5535,
				0.9214,
				0.5536,
				0.9517
			],
			"mean": {
				"upper": [
					0.07843,
					0.14293,
					0.01702
				],
				"lower": [
					0.12308,
					0.17239,
					0.03957
				]
			},
			"veins": {
				"luminance": 0.11652,
				"contrast": 8.214
			},
			"profile": {
				"upper": [
					0.12712,
					0.11805,
					0.11536,
					0.11702,
					0.12309,
					0.119,
					0.12396,
					0.12167
				],
				"lower": [
					0.15097,
					0.15685,
					0.14493,
					0.1561,
					0.15349,
					0.15235,
					0.15536,
					0.14513
				]
			},
			"coverage": 0.16
		},
		"bark": {
			"size": 1024,
			"layers": [
				{
					"name": "trunk",
					"tile": [
						0.55,
						0.55
					],
					"mean": [
						0.20159,
						0.13066,
						0.1019
					],
					"height": {
						"offset": 0.14366,
						"depth": 0.102121
					}
				}
			],
			"young": {
				"tile": [
					0.14,
					0.14
				],
				"mean": [
					0.22049,
					0.14474,
					0.12475
				]
			}
		},
		"outputs": [
			{
				"file": "leaf-color.ktx2",
				"sha256": "112793bf8d673d38316ac2ffb662ab4f49bba7d16b02ce5608a0a79097577354",
				"bytes": 178781
			},
			{
				"file": "leaf-normal.ktx2",
				"sha256": "0e1ed4d49ca4e231a6473ebe8d4bd27ba1eeb887d0e1a3885c8dd7323611f01a",
				"bytes": 1295
			},
			{
				"file": "leaf-color-half.ktx2",
				"sha256": "c9964a18c8b8798f6df450de111e663adb435e0e78f9750d8bf2584a84aefb92",
				"bytes": 66641
			},
			{
				"file": "leaf-normal-half.ktx2",
				"sha256": "363880c6db063f34c48c9afe27a65d43d8ede539eb742247d191d12b17ca47bf",
				"bytes": 978
			},
			{
				"file": "bark-color.ktx2",
				"sha256": "7eb1a21e32fedab4c7157895ab5fea622fc47517911bcffbf477d7f8a6b3161a",
				"bytes": 198973
			},
			{
				"file": "bark-normal.ktx2",
				"sha256": "7dc4c2f9c54cdd4884798d6a79446a7143263c3adfdb63525f875afe65a0ac10",
				"bytes": 236783
			},
			{
				"file": "young-color.ktx2",
				"sha256": "3b8ff9ea98c7cf73ec3c7a0dccc9ed92b8cb5e23d5c51dd11bf5e0dcc85a15dd",
				"bytes": 53061
			},
			{
				"file": "young-normal.ktx2",
				"sha256": "b598fbd265d18c107e3ea4f90daeed44af95be284bc2e04f603a724f40f27e8d",
				"bytes": 68054
			},
			{
				"file": "bark-color-half.ktx2",
				"sha256": "3297ae4f1b1f598e6511541bc625f74e6949fd1436968b6577d3957a52b309d1",
				"bytes": 55362
			},
			{
				"file": "bark-normal-half.ktx2",
				"sha256": "4bbee687592cfe2848684bb26082bb2c11a89399259f17a849071600f7ecdc6e",
				"bytes": 71166
			},
			{
				"file": "young-color-half.ktx2",
				"sha256": "59a3948c8047fc779529a5da1ff25e0169f20fb2af57c9d38f40344a3695959e",
				"bytes": 13863
			},
			{
				"file": "young-normal-half.ktx2",
				"sha256": "c95a023b53e29484d06522f9986cefd7a6140b21b944b95cf8c075904e6888c9",
				"bytes": 15892
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

### Literals of 600 characters or more (strings, templates, big arrays), biggest 40 by gzip bytes

| Chunk | Module | Kind | Raw kB | gzip kB | Starts with |
| --- | --- | --- | ---: | ---: | --- |
| zstd | `node_modules/zstddec/dist/zstddec-stream.modern.js` | template | 77.23 | 30.41 | `'AGFzbQEAAAABpgEVYAF/AGADf39/AX9gA39/fwBgAX8Bf2AFf39/f38Bf2ACf38AYAABf` |
| lerc | `node_modules/zstddec/dist/zstddec.modern.js` | template | 70.83 | 28.04 | `'AGFzbQEAAAABoAEUYAF/AGADf39/AGACf38AYAF/AX9gBX9/f39/AX9gA39/fwF/YAR/f` |
| render | `src/render/terrainLayer.ts` | template | 15.67 | 4.95 | `' ${xd} ${Sd} ${Cd} ${wd} uniform float uVex; // Linear albedo of the ` |
| render | `src/render/treeShaders.ts` | template | 11.07 | 4.23 | `' ${xd} uniform float uVex; uniform float uTime; uniform float uClock;` |
| render | `node_modules/three/build/three.module.js` | template | 17.69 | 3.13 | `'uniform sampler2D dfgLUT; struct PhysicalMaterial { vec3 diffuseColo` |
| render | `src/render/treeShaders.ts` | template | 5.91 | 1.91 | `' ${xd} ${Sd} ${Cd} uniform vec3 uSunDir; uniform vec3 uSunColour; uni` |
| render | `node_modules/three/build/three.module.js` | template | 10.12 | 1.61 | `'#if NUM_SPOT_LIGHT_COORDS > 0 varying vec4 vSpotLightCoord[ NUM_SPOT` |
| render | `node_modules/three/build/three.module.js` | array[512] | 2.83 | 1.57 | `[12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,136` |
| render | `node_modules/three/build/three.module.js` | template | 3.34 | 1.30 | `' precision highp float; precision highp int; varying vec3 ` |
| render | `node_modules/three/build/three.module.js` | template | 7.28 | 1.26 | `' vec3 geometryPosition = - vViewPosition; vec3 geometryNormal = norma` |
| render | `node_modules/three/build/three.module.js` | template | 5.73 | 1.21 | `'#ifdef USE_TRANSMISSION uniform float transmission; uniform float t` |
| render | `node_modules/three/build/three.module.js` | template | 3.39 | 1.19 | `'#ifndef saturate #define saturate( a ) clamp( a, 0.0, 1.0 ) #endif un` |
| render | `src/render/placesLayer.ts` | template | 3.54 | 1.03 | `' ${Sd} ${Cd} uniform vec3 uFill[17]; uniform vec3 uCase[17]; uniform ` |
| render | `src/render/glsl.ts` | template | 2.94 | 0.97 | `' vec2 fsGridUv(vec2 p, vec4 xf) { return (p - xf.xy) / xf.zw; } // Ma` |
| render | `node_modules/three/build/three.module.js` | template | 4.60 | 0.97 | `'uniform bool receiveShadow; uniform vec3 ambientLightColor; #if defin` |
| render | `node_modules/three/build/three.module.js` | template | 2.65 | 0.91 | `'#ifdef USE_IRIDESCENCE const mat3 XYZ_TO_REC709 = mat3( 3.2404542` |
| render | `src/render/fireLayer.ts` | template | 2.43 | 0.90 | `' uniform float uVex; uniform float uTime; uniform float uClock; unifo` |
| render | `node_modules/three/build/three.module.js` | template | 4.01 | 0.82 | `'PhysicalMaterial material; material.diffuseColor = diffuseColor.rgb; ` |
| render | `node_modules/three/build/three.module.js` | template | 3.24 | 0.75 | `'#ifdef ENVMAP_TYPE_CUBE_UV #define cubeUV_minMipLevel 4.0 #define c` |
| render | `node_modules/three/build/three.module.js` | template | 2.51 | 0.75 | `'#define PI 3.141592653589793 #define PI2 6.283185307179586 #define PI` |
| render | `node_modules/three/build/three.module.js` | template | 2.80 | 0.63 | `'vec3 packNormalToRGB( const in vec3 normal ) { return normalize( nor` |
| render | `node_modules/three/build/three.core.js` | template | 0.75 | 0.56 | `'00.01.02.03.04.05.06.07.08.09.0a.0b.0c.0d.0e.0f.10.11.12.13.14.15.16.` |
| render | `node_modules/three/build/three.module.js` | template | 1.99 | 0.50 | `'#ifdef USE_LIGHT_PROBES_GRID uniform highp sampler3D probesSH; unifor` |
| render | `src/render/placesLayer.ts` | template | 1.52 | 0.49 | `' uniform float uVex; uniform vec2 uViewport; uniform float uDpr; unif` |
| render | `node_modules/three/build/three.module.js` | template | 3.92 | 0.47 | `'#define STANDARD #ifdef PHYSICAL #define IOR #define USE_SPECULAR #` |
| render | `node_modules/three/build/three.module.js` | template | 1.72 | 0.46 | `' precision highp float; precision highp int; varying vec3 ` |
| render | `src/render/streaks.ts` | template | 1.31 | 0.44 | `' ${Sd} ${Cd} uniform float uWidthPx; uniform float uHeadPx; uniform f` |
| render | `src/render/placesLayer.ts` | template | 1.47 | 0.44 | `' uniform float uVex; uniform vec2 uViewport; uniform float uDpr; unif` |
| render | `src/render/streaks.ts` | template | 1.17 | 0.44 | `' uniform vec2 uViewport; uniform float uWidthPx; uniform float uHeadP` |
| render | `node_modules/three/build/three.module.js` | template | 1.18 | 0.40 | `'#ifdef USE_ALPHAHASH const float ALPHA_HASH_SCALE = 0.05; float has` |
| render | `node_modules/three/build/three.module.js` | template | 2.62 | 0.38 | `'#if defined( USE_UV ) \|\| defined( USE_ANISOTROPY ) vUv = vec3( uv, 1` |
| render | `src/render/glsl.ts` | template | 0.79 | 0.37 | `' uniform float uExposure; const float LIGHT_REF = 1.45; vec3 fsDispla` |
| render | `src/render/fireLayer.ts` | template | 1.21 | 0.35 | `' ${xd} ${Sd} uniform float uClock; uniform float uNight; varying vec2` |
| render | `src/render/skyDome.ts` | template | 1.01 | 0.35 | `' ${xd} ${Sd} uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec` |
| render | `node_modules/three/build/three.module.js` | template | 0.98 | 0.35 | `'uniform sampler2D shadow_pass; uniform vec2 resolution; uniform float` |
| render | `node_modules/three/build/three.module.js` | template | 2.44 | 0.32 | `'#ifdef USE_ENVMAP vec3 getIBLIrradiance( const in vec3 normal ) { ` |
| render | `node_modules/three/build/three.module.js` | template | 1.66 | 0.31 | `'#if NUM_CLIPPING_PLANES > 0 vec4 plane; #ifdef ALPHA_TO_COVERAGE ` |
| render | `src/render/placesLayer.ts` | template | 1.02 | 0.31 | `' ${Sd} ${Cd} uniform vec3 uSunDir; uniform vec3 uSunColour; uniform f` |
| render | `src/render/crossSectionLayer.ts` | template | 1.01 | 0.31 | `' ${Sd} ${Cd} uniform sampler2D uTex; uniform float uOpacity; varying ` |
| render | `node_modules/three/build/three.module.js` | template | 1.52 | 0.29 | `'#if defined( USE_UV ) \|\| defined( USE_ANISOTROPY ) varying vec2 vUv;` |

91 such literals: raw 343.0 kB, gzip 103.4 kB (of all JS gzip 956.7 kB).

### Modules by bytes inside string and template literals (any size), top 25 by gzip

| Module | Chunk | Module raw kB | Text raw kB | Text gzip kB | Text share of raw |
| --- | --- | ---: | ---: | ---: | ---: |
| `node_modules/three/build/three.module.js` | render | 343.4 | 168.0 | 32.46 | 48.9 % |
| `node_modules/zstddec/dist/zstddec-stream.modern.js` | zstd | 79.0 | 77.4 | 30.52 | 98.0 % |
| `node_modules/zstddec/dist/zstddec.modern.js` | lerc | 71.5 | 70.9 | 28.10 | 99.2 % |
| `src/ui/modelInfo.ts` | index | 40.2 | 29.1 | 10.53 | 72.4 % |
| `src/explain/text.ts` | sim | 31.1 | 25.6 | 8.67 | 82.3 % |
| `src/explain/text.ts` | worker | 31.1 | 25.6 | 8.66 | 82.3 % |
| `src/render/treeShaders.ts` | render | 17.0 | 17.0 | 6.13 | 99.9 % |
| `src/scenario/datasetRecords.ts` | estimate | 25.3 | 15.6 | 5.77 | 61.8 % |
| `src/render/terrainLayer.ts` | render | 25.3 | 17.3 | 5.27 | 68.4 % |
| `src/ui/screens/datasetsModel.ts` | index | 30.5 | 14.9 | 5.25 | 48.9 % |
| `src/render/layerCatalog.ts` | index | 22.6 | 15.9 | 5.22 | 70.3 % |
| `src/ui/content.ts` | index | 13.7 | 11.9 | 4.71 | 86.6 % |
| `src/scenario/datasetRecordsWeather.ts` | estimate | 22.1 | 14.2 | 4.21 | 64.3 % |
| `src/scenario/datasetRecordsPlaces.ts` | estimate | 18.7 | 10.7 | 3.77 | 57.2 % |
| `src/ui/screens/setup.ts` | index | 26.5 | 10.7 | 3.69 | 40.4 % |
| `src/ui/screens/datasets.ts` | index | 29.0 | 12.5 | 3.62 | 43.0 % |
| `src/ui/legends.ts` | index | 15.7 | 9.5 | 3.52 | 61.0 % |
| `src/ui/screens/sim/sheet.ts` | index | 18.4 | 9.4 | 3.48 | 50.8 % |
| `src/render/legends.ts` | index | 17.1 | 7.9 | 3.29 | 46.4 % |
| `src/ui/mockSim.ts` | mocks | 22.1 | 7.4 | 3.13 | 33.6 % |
| `src/ui/icons.ts` | index | 8.9 | 7.9 | 3.00 | 88.6 % |
| `node_modules/three/build/three.core.js` | render | 179.7 | 7.3 | 2.93 | 4.1 % |
| `src/scenario/estimate.ts` | estimate | 20.1 | 9.3 | 2.92 | 46.0 % |
| `src/render/placesLayer.ts` | render | 21.5 | 9.2 | 2.72 | 42.9 % |
| `src/scenario/datasetStats.ts` | datasetStats | 20.1 | 5.2 | 2.31 | 25.9 % |

All string and template literals together: raw 815.2 kB, gzip 270.6 kB (28.3 % of all JS gzip).

### console.* calls (the call and its arguments, as compiled)

| Origin and level | Calls | Raw kB | gzip kB |
| --- | ---: | ---: | ---: |
| app: warn | 30 | 1.93 | 0.74 |
| library: warn | 12 | 0.87 | 0.35 |
| library: log | 9 | 0.35 | 0.14 |
| app: error | 7 | 0.14 | 0.06 |
| app: info | 1 | 0.03 | 0.01 |
| library: error | 2 | 0.05 | 0.01 |

61 calls, raw 3.38 kB, gzip 1.31 kB.

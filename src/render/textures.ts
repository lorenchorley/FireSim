/**
 * DataTexture helpers. Float32 textures are always NEAREST (and filtered manually in the shader where needed) because
 * float32 linear filtering is not guaranteed on iPhones (doc 09 §3.1); fields that need hardware filtering use half
 * floats (RG16F is filterable in core WebGL2).
 */
import * as THREE from 'three';

function finish<T extends THREE.DataTexture>(t: T, linear: boolean, unpackAlignment = 4): T {
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = unpackAlignment;
  t.needsUpdate = true;
  return t;
}

/** R32F, NEAREST (sample with fsBilinearR / texelFetch). Row 0 = j 0 = south = v 0. */
export function floatTexture(data: Float32Array, nx: number, ny: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, THREE.FloatType);
  return finish(t, false);
}

/** RG16F from interleaved float pairs, LINEAR. */
export function halfRgTexture(data: Float32Array, nx: number, ny: number): THREE.DataTexture {
  const h = new Uint16Array(data.length);
  for (let k = 0; k < data.length; k++) h[k] = THREE.DataUtils.toHalfFloat(Math.max(-65000, Math.min(65000, data[k]!)));
  const t = new THREE.DataTexture(h, nx, ny, THREE.RGFormat, THREE.HalfFloatType);
  return finish(t, true);
}

/** RGBA8 texture; `srgb` marks colour data (decoded to linear by the GPU). */
export function rgbaTexture(data: Uint8Array, nx: number, ny: number, opts: { srgb?: boolean; linear?: boolean; mipmaps?: boolean } = {}): THREE.DataTexture {
  const t = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  finish(t, opts.linear ?? true);
  if (opts.mipmaps) {
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return t;
}

/** R8 (0–1 from a float field), LINEAR. */
export function r8Texture(data: Float32Array, nx: number, ny: number): THREE.DataTexture {
  const b = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) b[k] = Math.round(Math.max(0, Math.min(1, data[k]!)) * 255);
  const t = new THREE.DataTexture(b, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
  return finish(t, true, 1);
}

/** 256 × 1 sRGB LUT, NEAREST. */
export function lutTexture(lut: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(lut, lut.length / 4, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  return finish(t, false);
}

/** 1 × 1 placeholder textures (bound when a layer has no data so the shader always has valid samplers). */
export function dummyFloat(value = 0): THREE.DataTexture {
  return floatTexture(new Float32Array([value]), 1, 1);
}
export function dummyRgba(r = 0, g = 0, b = 0, a = 0, srgb = false): THREE.DataTexture {
  return rgbaTexture(new Uint8Array([r, g, b, a]), 1, 1, { srgb, linear: false });
}

/** Replace a DataTexture's contents in place when the size matches, otherwise return a new one (and dispose the old). */
export function refillFloat(t: THREE.DataTexture | null, data: Float32Array, nx: number, ny: number): THREE.DataTexture {
  if (t && t.image.width === nx && t.image.height === ny && t.type === THREE.FloatType) {
    (t.image.data as Float32Array).set(data);
    t.needsUpdate = true;
    return t;
  }
  t?.dispose();
  return floatTexture(data.slice(), nx, ny);
}

export function refillRgba(t: THREE.DataTexture | null, data: Uint8Array, nx: number, ny: number, srgb = false, linear = false): THREE.DataTexture {
  if (t && t.image.width === nx && t.image.height === ny && t.format === THREE.RGBAFormat && t.type === THREE.UnsignedByteType) {
    (t.image.data as Uint8Array).set(data);
    t.needsUpdate = true;
    return t;
  }
  t?.dispose();
  return rgbaTexture(data.slice(), nx, ny, { srgb, linear });
}

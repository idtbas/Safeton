/**
 * JSON codec that round-trips typed arrays (base64) — used for export/import files.
 */

const TYPED = {
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
} as const;
type TypedName = keyof typeof TYPED;

interface EncodedTyped {
  __typed: TypedName;
  b64: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function typedName(value: unknown): TypedName | null {
  for (const name of Object.keys(TYPED) as TypedName[]) if (value instanceof TYPED[name]) return name;
  return null;
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, function replacer(_key, v: unknown) {
    const name = typedName(v);
    if (name) {
      const arr = v as ArrayBufferView;
      return {
        __typed: name,
        b64: toBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)),
      } satisfies EncodedTyped;
    }
    return v;
  });
}

export function decodeJson(text: string): unknown {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && '__typed' in v && 'b64' in v) {
      const enc = v as EncodedTyped;
      const Ctor = TYPED[enc.__typed];
      if (!Ctor) throw new Error(`Unsupported typed array "${String(enc.__typed)}"`);
      const bytes = fromBase64(enc.b64);
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return new Ctor(copy.buffer);
    }
    return v;
  });
}

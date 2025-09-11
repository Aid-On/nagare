// Lightweight helpers extracted from Nagare core

export function isTypedArrayLike(obj: any): obj is { length: number; [k: number]: any } {
  return !!obj && typeof obj === 'object' && typeof (obj as any).length === 'number' &&
    typeof (obj as any).buffer === 'object' && typeof (obj as any).BYTES_PER_ELEMENT === 'number' &&
    typeof (obj as any).byteLength === 'number';
}


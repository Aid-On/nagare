// Lightweight helpers extracted from Nagare core

export function isTypedArrayLike(obj: unknown): obj is { length: number; buffer: unknown; BYTES_PER_ELEMENT: number; byteLength: number } {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return typeof o.length === 'number' && typeof o.buffer === 'object' && typeof o.BYTES_PER_ELEMENT === 'number' && typeof o.byteLength === 'number';
}

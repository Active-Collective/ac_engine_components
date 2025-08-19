export async function toUint8Array(input: string | File | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (typeof input === 'string') {
    const res = await fetch(input);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
  const buf = await input.arrayBuffer();
  return new Uint8Array(buf);
}

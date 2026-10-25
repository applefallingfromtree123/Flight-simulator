// Off-main-thread fetch + decode of Terrarium elevation PNGs into Float32 height arrays.
self.onmessage = async (e: MessageEvent<{ id: number; url: string }>) => {
  const { id, url } = e.data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const bmp = await createImageBitmap(await r.blob());
    const c = new OffscreenCanvas(256, 256);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const px = g.getImageData(0, 0, 256, 256).data;
    const out = new Float32Array(256 * 256);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      const h = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
      out[i] = h < -12 ? -9999 : h; // ocean marker (keeps below-sea-level polders)
    }
    (self as unknown as Worker).postMessage({ id, data: out }, [out.buffer]);
  } catch {
    (self as unknown as Worker).postMessage({ id, data: null });
  }
};

export type CachedDomImage = HTMLImageElement;

function approxBytesForImage(img: HTMLImageElement): number {
  const w = img.naturalWidth ?? 0;
  const h = img.naturalHeight ?? 0;
  if (w > 0 && h > 0) return w * h * 4;
  return 0;
}

type Entry = {
  img: CachedDomImage;
  bytes: number;
  lastUsed: number;
};

/**
 * Caches decoded HTMLImageElements across the Obsidian session.
 *
 * Use-case:
 * - DOM marker icons (many different images) should stay decoded even if the map instance is destroyed
 *   (tab switching / note re-render).
 *
 * Key can be:
 * - vault file path (preferred)
 * - data: URL
 * - arbitrary URL string (fallback)
 */
export class DomDecodeCache {
  private maxBytes: number;
  private readonly startEvictRatio = 0.9;
  private readonly targetEvictRatio = 0.8;

  private entries = new Map<string, Entry>();
  private refs = new Map<string, number>();
  private loading = new Map<string, Promise<CachedDomImage>>();

  constructor(maxBytes: number) {
    this.maxBytes = Math.max(1, Math.round(maxBytes));
  }

  setMaxBytes(maxBytes: number): void {
    this.maxBytes = Math.max(1, Math.round(maxBytes));
    this.evictIfNeeded();
  }

  getMaxBytes(): number {
    return this.maxBytes;
  }

  getRefCount(key: string): number {
    return this.refs.get(key) ?? 0;
  }

  getTotalBytes(): number {
    let total = 0;
    for (const e of this.entries.values()) total += e.bytes;
    return total;
  }
  
  getEntryCount(): number {
    return this.entries.size;
  }

  getRefKeyCount(): number {
    return this.refs.size;
  }

  debugSnapshot(limit = 10): {
    maxBytes: number;
    totalBytes: number;
    entryCount: number;
    refKeyCount: number;
    top: { key: string; bytes: number; refCount: number; ageMs: number }[];
  } {
    const now = Date.now();
    const top = [...this.entries.entries()]
      .map(([key, e]) => ({
        key,
        bytes: e.bytes,
        refCount: this.getRefCount(key),
        ageMs: Math.max(0, now - (e.lastUsed ?? now)),
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, Math.max(0, limit));

    return {
      maxBytes: this.maxBytes,
      totalBytes: this.getTotalBytes(),
      entryCount: this.getEntryCount(),
      refKeyCount: this.getRefKeyCount(),
      top,
    };
  }

  clear(): void {
    this.entries.clear();
    this.refs.clear();
    this.loading.clear();
  }

  async acquire(key: string, url: string): Promise<CachedDomImage> {
    // refcount first
    this.refs.set(key, (this.refs.get(key) ?? 0) + 1);

    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.img;
    }

    const inflight = this.loading.get(key);
    if (inflight) return inflight;

    const p = this.load(url)
      .then((img) => {
        const bytes = approxBytesForImage(img);
        this.entries.set(key, { img, bytes, lastUsed: Date.now() });
        this.loading.delete(key);
        this.evictIfNeeded();
        return img;
      })
      .catch((err) => {
        this.loading.delete(key);
        // rollback refcount if load failed
        this.release(key);
        throw err;
      });

    this.loading.set(key, p);
    return p;
  }

  release(key: string): void {
    const cur = this.refs.get(key) ?? 0;
    if (cur <= 1) this.refs.delete(key);
    else this.refs.set(key, cur - 1);

    this.evictIfNeeded();
  }

  private async load(url: string): Promise<CachedDomImage> {
    const img = new Image();
    img.decoding = "async";
    img.src = url;

    try {
      await img.decode();
    } catch {
      // decode can fail even if the image later renders;
    }

    return img;
  }

  private evictIfNeeded(): void {
    const total = this.getTotalBytes();
    const start = this.maxBytes * this.startEvictRatio;
    if (total <= start) return;

    const target = this.maxBytes * this.targetEvictRatio;
    let curTotal = total;

    const candidates = [...this.entries.entries()]
      .filter(([key]) => (this.refs.get(key) ?? 0) === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    for (const [key, e] of candidates) {
      if (curTotal <= target) break;
      curTotal -= e.bytes;
      // allow GC to reclaim decode memory
      try {
        e.img.src = "";
      } catch {
        // ignore
      }
      this.entries.delete(key);
    }
  }
}
/** Fixed-capacity numeric ring buffer backed by a Float64Array. */
export class RingBuffer {
  readonly data: Float64Array;
  private head = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  get length(): number {
    return this.size;
  }

  last(): number | undefined {
    if (this.size === 0) return undefined;
    return this.data[(this.head - 1 + this.capacity) % this.capacity];
  }

  /** Values in chronological order (oldest first). */
  toArray(): Float64Array {
    const out = new Float64Array(this.size);
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out[i] = this.data[(start + i) % this.capacity]!;
    return out;
  }

  /** Last `n` values in chronological order. */
  tail(n: number): Float64Array {
    const all = this.toArray();
    return all.subarray(Math.max(0, all.length - n));
  }

  serialize(): { capacity: number; values: Float64Array } {
    return { capacity: this.capacity, values: this.toArray() };
  }

  static restore(state: { capacity: number; values: Float64Array }): RingBuffer {
    const rb = new RingBuffer(state.capacity);
    for (const v of state.values) rb.push(v);
    return rb;
  }
}

/** Generic object ring buffer. */
export class ObjectRing<T> {
  private items: (T | undefined)[];
  private head = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  get length(): number {
    return this.size;
  }

  toArray(): T[] {
    const out: T[] = [];
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out.push(this.items[(start + i) % this.capacity]!);
    return out;
  }

  /** Items for which `pred` holds, scanning newest-first until `limit` matches, returned oldest-first. */
  findLast(pred: (item: T) => boolean, limit: number): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.size && out.length < limit; i++) {
      const item = this.items[(this.head - 1 - i + this.capacity * 2) % this.capacity]!;
      if (pred(item)) out.push(item);
    }
    return out.reverse();
  }
}

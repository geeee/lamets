/**
 * Java compatibility utilities for TypeScript LAME port.
 * Provides factory functions for typed arrays and Java standard library equivalents.
 */

export function new_byte(n: number): Uint8Array {
  return new Uint8Array(n);
}

export function new_short(n: number): Int16Array {
  return new Int16Array(n);
}

export function new_int(n: number): Int32Array {
  return new Int32Array(n);
}

export function new_float(n: number): Float32Array {
  return new Float32Array(n);
}

export function new_double(n: number): Float64Array {
  return new Float64Array(n);
}

export function new_float_n(...dims: number[]): unknown {
  if (dims.length === 1) {
    return new_float(dims[0]);
  }
  const arr: unknown[] = new Array(dims[0]);
  for (let i = 0; i < dims[0]; i++) {
    arr[i] = new_float_n(...dims.slice(1));
  }
  return arr;
}

export function new_int_n(...dims: number[]): unknown {
  if (dims.length === 1) {
    return new_int(dims[0]);
  }
  const arr: unknown[] = new Array(dims[0]);
  for (let i = 0; i < dims[0]; i++) {
    arr[i] = new_int_n(...dims.slice(1));
  }
  return arr;
}

export function new_short_n(...dims: number[]): unknown {
  if (dims.length === 1) {
    return new_short(dims[0]);
  }
  const arr: unknown[] = new Array(dims[0]);
  for (let i = 0; i < dims[0]; i++) {
    arr[i] = new_short_n(...dims.slice(1));
  }
  return arr;
}

export function new_byte_n(...dims: number[]): unknown {
  if (dims.length === 1) {
    return new_byte(dims[0]);
  }
  const arr: unknown[] = new Array(dims[0]);
  for (let i = 0; i < dims[0]; i++) {
    arr[i] = new_byte_n(...dims.slice(1));
  }
  return arr;
}

export function new_double_n(...dims: number[]): unknown {
  if (dims.length === 1) {
    return new_double(dims[0]);
  }
  const arr: unknown[] = new Array(dims[0]);
  for (let i = 0; i < dims[0]; i++) {
    arr[i] = new_double_n(...dims.slice(1));
  }
  return arr;
}

/**
 * Java's System.arraycopy equivalent.
 */
export function arraycopy(
  src: ArrayLike<number>,
  srcPos: number,
  dest: ArrayLike<number> & { set?: (arr: ArrayLike<number>, offset?: number) => void },
  destPos: number,
  length: number,
): void {
  if (length === 0) return;

  if (dest.set) {
    // TypedArray fast path
    if ('subarray' in src && typeof (src as Int32Array).subarray === 'function') {
      dest.set(
        (src as Int32Array).subarray(srcPos, srcPos + length),
        destPos,
      );
    } else {
      // Regular array source → typed array dest
      const slice = Array.prototype.slice.call(src, srcPos, srcPos + length);
      dest.set(slice, destPos);
    }
  } else {
    // Regular array dest
    const d = dest as unknown as number[];
    for (let i = 0; i < length; i++) {
      d[destPos + i] = src[srcPos + i];
    }
  }
}

/**
 * Java's Arrays.fill equivalent.
 */
export function fill(
  arr: { fill(value: number, start?: number, end?: number): unknown },
  val: number,
  fromIndex?: number,
  toIndex?: number,
): void {
  if (fromIndex !== undefined) {
    arr.fill(val, fromIndex, toIndex);
  } else {
    arr.fill(val);
  }
}

/**
 * Assert utility.
 */
export function assert(condition: boolean, msg?: string): void {
  if (!condition) {
    throw new Error(msg ?? 'assertion failed');
  }
}

/** Integer types helper - bitwise OR 0 for truncation to 32-bit int */
export function int(x: number): number {
  return x | 0;
}

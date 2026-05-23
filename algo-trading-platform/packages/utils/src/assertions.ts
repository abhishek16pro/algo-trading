export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

export function assertDefined<T>(v: T | undefined | null, name = 'value'): asserts v is T {
  if (v === undefined || v === null) {
    throw new Error(`Assertion failed: ${name} is ${v === null ? 'null' : 'undefined'}`);
  }
}

export function isDefined<T>(v: T | undefined | null): v is T {
  return v !== undefined && v !== null;
}

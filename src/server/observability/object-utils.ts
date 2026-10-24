/**
 * Drops keys whose value is `undefined` so uncaptured/absent trace fields
 * are missing keys on the wire (`{}`), never `{ "key": undefined }`.
 *
 * `Object.fromEntries` erases the input's field types by default
 * (`{[k: string]: unknown}`); the `Partial<T>` return annotation restores
 * them so callers keep concrete field types (e.g. `byteSize: number`)
 * instead of `unknown`. The cast is the one place that type is asserted —
 * it is true because every kept entry came straight from `value`.
 */
export function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

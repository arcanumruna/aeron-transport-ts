// The key that `util.inspect` calls for a custom form (`Symbol.for('nodejs.util.inspect.custom')`). Port-only (issue #47):
// the classes that hold big buffers (the client's publications, images, subscriptions and log buffers, `UnsafeBuffer`)
// give `util.inspect` and, through `toJSON`, vitest's pretty-format a short summary, so that a matcher on a real object
// does not walk 16 MiB log buffers and run out of memory. Not part of Agrona: there is no Java file behind this one.
export const INSPECT_CUSTOM: unique symbol = Symbol.for('nodejs.util.inspect.custom');

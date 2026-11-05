// Creates an own data property (IR39-01). Assignment, `push` and `Reflect.set` perform [[Set]], which walks the prototype chain: an
// inherited setter would run and a read-only inherited entry would refuse the write. The descriptor has no prototype, so an inherited
// `get` or `set` cannot make it an invalid descriptor.
export function defineOwn(target: object, key: PropertyKey, value: unknown): void {
  const descriptor = { __proto__: null, value, writable: true, enumerable: true, configurable: true };
  Object.defineProperty(target, key, descriptor);
}

export function appendOwn<T>(list: T[], value: NoInfer<T>): void {
  defineOwn(list, list.length, value);
}

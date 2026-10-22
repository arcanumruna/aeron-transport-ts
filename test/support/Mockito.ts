// The part of Mockito that the ported tests use.
import { expect, vi } from 'vitest';

/**
 * `Mockito.mock(Class)` for a class: an instance of it whose methods record their calls and do nothing.
 */
export function mock<T extends object>(type: { prototype: T }): { mock: T; verifyNoInteractions(): void } {
    const instance = Object.create(type.prototype) as Record<string, unknown>;
    const spies = new Map<string, ReturnType<typeof vi.fn>>();
    for (let proto: object | null = type.prototype; null !== proto && proto !== Object.prototype;) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if ('constructor' !== name && !spies.has(name) && typeof instance[name] === 'function') {
                const spy = vi.fn();
                instance[name] = spy;
                spies.set(name, spy);
            }
        }
        proto = Object.getPrototypeOf(proto) as object | null;
    }

    return {
        mock: instance as T,
        verifyNoInteractions: () => {
            for (const [name, spy] of spies) {
                expect(spy, name).not.toHaveBeenCalled();
            }
        },
    };
}

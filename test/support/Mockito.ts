// The part of Mockito that the ported tests use.
import { expect, vi } from 'vitest';
import type { Mock } from 'vitest';

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

/** A hand fake of an interface: each member is a `vi.fn` with the signature of the member. */
export type Fake<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : never;
};

type Spied = { mock: { calls: unknown[][]; invocationCallOrder: number[] } };

function spies(target: object): [string, Spied][] {
    return Object.entries(target).filter(
        (entry): entry is [string, Spied] => typeof entry[1] === 'function' && 'mock' in (entry[1] as object),
    );
}

/** The members of a mock object (`mock(X).mock`) or a fake that have been called. */
export function calledMembers(target: object): string[] {
    return spies(target)
        .filter(([, spy]) => spy.mock.calls.length > 0)
        .map(([name]) => name);
}

/** The largest `invocationCallOrder` of any call to any member of the mocks or fakes, 0 when none was called. */
export function lastCallOrder(...targets: object[]): number {
    let last = 0;
    for (const target of targets) {
        for (const [, spy] of spies(target)) {
            for (const order of spy.mock.invocationCallOrder) {
                last = Math.max(last, order);
            }
        }
    }
    return last;
}

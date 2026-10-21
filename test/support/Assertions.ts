// JUnit's assertThrows / assertThrowsExactly, which return the thrown exception (vitest's toThrow does not).
import { expect } from 'vitest';

type Constructor<T extends Error> = abstract new (...args: never[]) => T;

/** `Assertions.assertThrows(X.class, executable)`: the exception is an instance of the type. */
export function assertThrows<T extends Error>(type: Constructor<T>, executable: () => unknown): T {
    let thrown: unknown;
    try {
        executable();
    } catch (e) {
        thrown = e;
    }
    expect(thrown).toBeInstanceOf(type);
    return thrown as T;
}

/** `Assertions.assertThrowsExactly(X.class, executable)`: the exception is of exactly the type. */
export function assertThrowsExactly<T extends Error>(type: Constructor<T>, executable: () => unknown): T {
    const thrown = assertThrows(type, executable);
    expect(thrown.constructor).toBe(type);
    return thrown;
}

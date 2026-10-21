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

/** JUnit's `objectsAreEqual`: `expected.equals(actual)` for an expected that is not null. */
function objectsAreEqual(expected: unknown, actual: unknown): boolean {
    if (expected === null || expected === undefined) {
        return actual === null || actual === undefined;
    }

    return (expected as { equals(other: unknown): boolean }).equals(actual);
}

/** `Assertions.assertEquals(Object, Object)` for objects that have an `equals` method. */
export function assertEqualsObject(expected: unknown, actual: unknown): void {
    expect(objectsAreEqual(expected, actual)).toBe(true);
}

/** `Assertions.assertNotEquals(Object, Object)` for objects that have an `equals` method. */
export function assertNotEqualsObject(unexpected: unknown, actual: unknown): void {
    expect(objectsAreEqual(unexpected, actual)).toBe(false);
}

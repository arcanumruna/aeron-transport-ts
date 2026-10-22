// `Mockito.mock(Position.class)`: a `Position` whose calls are recorded and which does nothing else. The writers
// record their argument in a spy (`setReleaseSpy`, ...), the readers return `value`.
import { vi } from 'vitest';
import { Position } from '../../src/agrona/concurrent/status/Position.js';

export class MockPosition extends Position {
    public value = 0;
    public readonly setVolatileSpy = vi.fn<(value: number) => void>();
    public readonly setOrderedSpy = vi.fn<(value: number) => void>();
    public readonly setReleaseSpy = vi.fn<(value: number) => void>();
    public readonly setOpaqueSpy = vi.fn<(value: number) => void>();
    public readonly setSpy = vi.fn<(value: number) => void>();

    public id(): number {
        return 0;
    }

    public get(): number {
        return this.value;
    }

    public getVolatile(): number {
        return this.value;
    }

    public getAcquire(): number {
        return this.value;
    }

    public getOpaque(): number {
        return this.value;
    }

    public isClosed(): boolean {
        return false;
    }

    public close(): void {}

    public setVolatile(value: number): void {
        this.setVolatileSpy(value);
    }

    public setOrdered(value: number): void {
        this.setOrderedSpy(value);
    }

    public setRelease(value: number): void {
        this.setReleaseSpy(value);
    }

    public setOpaque(value: number): void {
        this.setOpaqueSpy(value);
    }

    public set(value: number): void {
        this.setSpy(value);
    }

    public proposeMax(): boolean {
        return false;
    }

    public proposeMaxOrdered(): boolean {
        return false;
    }

    public proposeMaxRelease(): boolean {
        return false;
    }

    public proposeMaxOpaque(): boolean {
        return false;
    }
}

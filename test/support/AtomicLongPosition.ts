// Port of org/agrona/concurrent/status/AtomicLongPosition.java @ Agrona 2.6.1, for the tests of the driver: a `Position`
// that holds its value in a field (one thread, spec D19, so there is no atomic). The transport itself uses
// `UnsafeBufferPosition` (docs/mapping.md, "Not ported").
import { Position } from '../../src/agrona/concurrent/status/Position.js';

export class AtomicLongPosition extends Position {
    private closed = false;
    private readonly positionId: number;
    private value: number;

    public constructor(id = 0, initialValue = 0) {
        super();
        this.positionId = id;
        this.value = initialValue;
    }

    public isClosed(): boolean {
        return this.closed;
    }

    public id(): number {
        return this.positionId;
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

    public set(value: number): void {
        this.value = value;
    }

    public setVolatile(value: number): void {
        this.value = value;
    }

    public setOrdered(value: number): void {
        this.value = value;
    }

    public setRelease(value: number): void {
        this.value = value;
    }

    public setOpaque(value: number): void {
        this.value = value;
    }

    public proposeMax(proposedValue: number): boolean {
        if (this.value < proposedValue) {
            this.value = proposedValue;
            return true;
        }

        return false;
    }

    public proposeMaxOrdered(proposedValue: number): boolean {
        return this.proposeMax(proposedValue);
    }

    public proposeMaxRelease(proposedValue: number): boolean {
        return this.proposeMax(proposedValue);
    }

    public proposeMaxOpaque(proposedValue: number): boolean {
        return this.proposeMax(proposedValue);
    }

    public close(): void {
        this.closed = true;
    }
}

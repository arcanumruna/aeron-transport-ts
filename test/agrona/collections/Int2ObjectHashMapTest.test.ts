// Port of org/agrona/collections/Int2ObjectHashMapTest.java @ Agrona 2.6.1
import { describe } from 'vitest';
import { Int2ObjectHashMap } from '../../../src/agrona/collections/Int2ObjectHashMap.js';
import { int2ObjectHashMapTest } from './Int2ObjectHashMapTestSuite.js';

describe('Int2ObjectHashMapTest', () => {
    int2ObjectHashMapTest((loadFactor, initialCapacity) => new Int2ObjectHashMap<string>(initialCapacity, loadFactor));
});

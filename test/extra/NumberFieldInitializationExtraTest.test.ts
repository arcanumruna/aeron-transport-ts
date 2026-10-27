// Extra test of issue #52 (port-only, spec D122): every class field of `src/` that is typed `number` has an initial number.
//
// A field declared as `x: number;` is a class field that starts as `undefined` (ES2022 class fields, which both `tsc` and
// node's type stripping emit), and V8 gives a field that has held `undefined` the tagged representation for good: every
// store of a number that is not a small integer (a time in nanoseconds, a position above 2^31) then allocates a heap number,
// where a field that starts as a number is a double field whose store writes into its box. `PublicationImage.timeOfLastPacketNs`,
// `NetworkPublication.timeOfLastDataOrHeartbeatNs` and `ClientConductor.timeOfLastServiceNs` allocated 16 bytes per datagram
// or per cycle for it, in loops that the other allocation tests do not see, as their numbers stay below 2^30.
//
// Fields of two kinds are not covered: a field that is optional (`x?: number`) or definitely assigned (`x!: number`), and
// the allowed list below.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');

/**
 * Fields that are typed `number` and have no initial number, with the reason. `agrona/jdk.ts` is not touched by the
 * allocation work of issue #52 (its `scale` is a constant of a table that is read, never stored in a loop).
 */
const ALLOWED = new Set<string>(['agrona/jdk.ts:scale']);

function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...sourceFiles(path));
        } else if (path.endsWith('.ts')) {
            files.push(path);
        }
    }
    return files;
}

/** `file:Class.field` of each instance field typed exactly `number` that has no initializer. */
function uninitializedNumberFields(): string[] {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
        const text = readFileSync(file, 'utf8');
        const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
        const visit = (node: ts.Node): void => {
            if (
                ts.isPropertyDeclaration(node) &&
                ts.isClassLike(node.parent) &&
                undefined === node.initializer &&
                undefined === node.questionToken &&
                undefined === node.exclamationToken &&
                undefined !== node.type &&
                'number' === node.type.getText(sourceFile) &&
                !node.modifiers?.some(
                    (m) =>
                        ts.SyntaxKind.StaticKeyword === m.kind ||
                        ts.SyntaxKind.AbstractKeyword === m.kind ||
                        ts.SyntaxKind.DeclareKeyword === m.kind,
                )
            ) {
                const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                found.push(relative(SRC, file) + ':' + node.name.getText(sourceFile) + ' (line ' + line + ')');
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return found;
}

describe('NumberFieldInitializationExtraTest', () => {
    it('every instance field typed number starts as a number', () => {
        const missing = uninitializedNumberFields().filter(
            (field) => !ALLOWED.has(field.replace(/ \(line \d+\)$/, '')),
        );
        expect(missing).toEqual([]);
    });

    it('the allowed list has no field that is initialized by now', () => {
        const present = new Set(uninitializedNumberFields().map((field) => field.replace(/ \(line \d+\)$/, '')));
        expect([...ALLOWED].filter((field) => !present.has(field))).toEqual([]);
    });
});

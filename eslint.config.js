import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/', '.claude/', '.refs/', 'node_modules/', 'test/scripts/fixtures/'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            // Ported Java code keeps its shape: empty interface-like classes and bitwise ops are expected.
            'no-bitwise': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        },
    },
    {
        files: ['scripts/**/*.mjs', 'test/interop/**/*.mjs'],
        languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    },
    {
        files: ['test/support/**/*.mjs'],
        languageOptions: { globals: { URL: 'readonly' } },
    },
);

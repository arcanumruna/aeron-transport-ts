// Node module resolve hook for the test workers (test/support/Workers.ts): the sources import each other as `./X.js`
// (NodeNext), and in a worker only the `.ts` file exists, which Node runs by stripping the types. On a failed resolve
// of a relative or file: specifier ending in `.js`, retry with `.ts`.
export async function resolve(specifier, context, next) {
    try {
        return await next(specifier, context);
    } catch (e) {
        if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('file:'))) {
            return next(specifier.slice(0, -3) + '.ts', context);
        }
        throw e;
    }
}

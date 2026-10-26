export function javaTestNames(path: string): { own: string[]; base: string | undefined };
export function tsTestTitles(src: string): { name: string; skip: boolean }[];
export function checkMapping(
    md: string,
    opts: {
        roots: Record<string, string>;
        readTs: (path: string) => string;
        fileExists?: (path: string) => boolean;
        findJavaTest?: (prefix: string, name: string) => boolean;
    },
): string[];

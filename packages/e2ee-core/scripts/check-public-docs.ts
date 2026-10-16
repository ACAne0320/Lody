/**
 * Fails when an export of a public entry (every `exports` key except
 * `./internal`) has no JSDoc comment. `--list` prints the surface instead.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  readonly exports: Record<string, string>;
};
const entries = Object.entries(manifest.exports).filter(([name]) => name !== './internal');
const program = ts.createProgram(
  entries.map(([, file]) => path.join(root, file)),
  {
    strict: true,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    resolveJsonModule: true,
  }
);
const checker = program.getTypeChecker();

const documented = (symbol: ts.Symbol) => {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (target.getDocumentationComment(checker).length > 0) return true;
  // Namespace re-exports (`export * as Bytes`) are documented by their module comment.
  return (target.declarations ?? []).some(
    (declaration) =>
      ts.isSourceFile(declaration) ||
      ts.getJSDocCommentsAndTags(declaration).length > 0 ||
      // `export const X = Schema.Struct(...)` paired with `export type X`: either may carry the doc.
      (ts.isVariableDeclaration(declaration) &&
        ts.getJSDocCommentsAndTags(declaration.parent.parent).length > 0)
  );
};
/** Every public entry's exports, and those without JSDoc. */
export function inspectPublicSurface() {
  const surface: { readonly entry: string; readonly names: readonly string[] }[] = [];
  const missing: string[] = [];
  for (const [name, file] of entries) {
    const source = program.getSourceFile(path.join(root, file));
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`cannot load ${file}`);
    const exports = checker
      .getExportsOfModule(moduleSymbol)
      .sort((a, b) => a.name.localeCompare(b.name));
    surface.push({
      entry: name === '.' ? '@lody/e2ee-core' : `@lody/e2ee-core/${name.slice(2)}`,
      names: exports.map((symbol) => symbol.name),
    });
    for (const symbol of exports) if (!documented(symbol)) missing.push(`${name}: ${symbol.name}`);
  }
  return { surface, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { surface, missing } = inspectPublicSurface();
  if (process.argv.includes('--list'))
    for (const { entry, names } of surface)
      console.log(`\n${entry} (${names.length})\n  ${names.join('\n  ')}`);
  else if (missing.length) {
    console.error(`Public exports without JSDoc (${missing.length}):\n  ${missing.join('\n  ')}`);
    process.exit(1);
  } else console.log(`All public exports of ${entries.length} entries are documented.`);
}

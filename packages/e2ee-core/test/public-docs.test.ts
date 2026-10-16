import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectPublicSurface } from '../scripts/check-public-docs';

const { surface, missing } = inspectPublicSurface();
/** Backticked names in each `## \`entry\`` section of a surface document. */
const listed = (file: string) => {
  const sections = new Map<string, Set<string>>();
  let current: Set<string> | undefined;
  for (const line of readFileSync(new URL(file, import.meta.url), 'utf8').split('\n')) {
    const heading = /^## `([^`]+)`/.exec(line);
    if (heading) sections.set(heading[1]!, (current = new Set()));
    else if (current)
      for (const [, name] of line.matchAll(/`([A-Za-z_][\w]*)`/g)) current.add(name!);
  }
  return sections;
};

describe('public surface documentation', () => {
  it('documents every export of every public entry with JSDoc', () => {
    expect(missing).toEqual([]);
  });
  it.each(['../docs/surface.md', '../docs/surface.zh.md'])(
    '%s lists exactly the exports of each entry',
    (file) => {
      const sections = listed(file);
      for (const { entry, names } of surface)
        expect([...(sections.get(entry) ?? [])].sort(), entry).toEqual([...names].sort());
    }
  );
});

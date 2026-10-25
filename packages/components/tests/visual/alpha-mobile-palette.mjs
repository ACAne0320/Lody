/** Palette controls on real production dirty-worktree results. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, i, all) => (arg.startsWith('--') ? [[arg.slice(2), all[i + 1]]] : []))
);
if (!args.before || !args.after) throw new Error('--before and --after immutable URLs required');
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(pkg, 'artifacts/visual/alpha-mobile-palette-stable-delivery');
await mkdir(out, { recursive: true });
const sha = (data) => createHash('sha256').update(data).digest('hex');
let browser;
try {
  browser = await chromium.launch();
} catch {
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const revisions = (await readdir(cache))
    .filter((n) => /^chromium_headless_shell-\d+$/.test(n))
    .sort((a, b) => +b.split('-').at(-1) - +a.split('-').at(-1));
  browser = await chromium.launch({
    executablePath: path.join(
      cache,
      revisions[0],
      'chrome-headless-shell-mac-arm64/chrome-headless-shell'
    ),
  });
}
const entries = [],
  failures = [];
for (const theme of ['light', 'dark'])
  for (const variant of theme === 'light'
    ? ['default', 'override', 'missing-fallback']
    : ['default', 'override']) {
    for (const side of ['before', 'after']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 1000 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      try {
        const url = new URL('/iframe.html', args[side]);
        url.search = new URLSearchParams({
          id: 'mobile-alphamobilemigration--removal-default',
          viewMode: 'story',
          globals: `theme:${theme};locale:en`,
        });
        await page.goto(url.href);
        await page.locator('[role=dialog]').waitFor();
        await page.locator('[role=checkbox]').click();
        const dirty = page.getByText(
          '1 worktree has changes and will stay on disk: Dirty synthetic worktree 中文',
          { exact: true }
        );
        await dirty.waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.mouse.move(-10, -10);
        const observation = await dirty.evaluate(
          (element, options) => {
            const token = options.theme === 'light' ? '--color-amber-700' : '--color-amber-300';
            if (options.side === 'before' && options.theme === 'light')
              element.style.color = 'var(--color-amber-700)';
            if (options.variant === 'override')
              document.documentElement.style.setProperty(
                token,
                options.theme === 'light' ? 'rgb(12, 123, 45)' : 'rgb(70, 80, 220)'
              );
            if (options.variant === 'missing-fallback' && options.side === 'after')
              document.documentElement.style.setProperty(token, 'initial');
            const computed = getComputedStyle(element),
              canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = computed.color;
            ctx.fillRect(0, 0, 1, 1);
            return {
              text: element.textContent,
              token,
              palette: computed.getPropertyValue(token),
              color: computed.color,
              rgba: [...ctx.getImageData(0, 0, 1, 1).data],
              className: element.className,
              referenceDeclaration:
                options.side === 'before' && options.theme === 'light'
                  ? 'color:var(--color-amber-700)'
                  : null,
            };
          },
          { theme, variant, side }
        );
        await page.waitForFunction(
          () =>
            document
              .getAnimations()
              .filter((a) => a.effect?.getTiming().iterations !== Infinity)
              .every((a) => a.playState !== 'running'),
          undefined,
          { timeout: 15000 }
        );
        await page.waitForFunction(
          () => {
            const dialog = document.querySelector('[role=dialog]'),
              r = dialog.getBoundingClientRect(),
              s = getComputedStyle(dialog),
              signature = JSON.stringify([r.x, r.y, r.width, r.height, s.transform, s.opacity]);
            const previous = window.__paletteLayout ?? { signature: '', stable: 0 };
            previous.stable = previous.signature === signature ? previous.stable + 1 : 0;
            previous.signature = signature;
            window.__paletteLayout = previous;
            return previous.stable >= 3;
          },
          undefined,
          { polling: 100, timeout: 15000 }
        );
        const settledObservation = await dirty.evaluate((element, token) => {
          const computed = getComputedStyle(element);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = computed.color;
          ctx.fillRect(0, 0, 1, 1);
          return {
            color: computed.color,
            palette: computed.getPropertyValue(token),
            rgba: [...ctx.getImageData(0, 0, 1, 1).data],
          };
        }, observation.token);
        const shot = `${theme}-${variant}-${side}.png`;
        await page.screenshot({
          path: path.join(out, shot),
          animations: 'disabled',
          caret: 'hide',
        });
        entries.push({
          theme,
          variant,
          side,
          url: url.href,
          shot,
          sha256: sha(await readFile(path.join(out, shot))),
          ...observation,
          preTransitionObservation: observation,
          ...settledObservation,
        });
      } catch (error) {
        failures.push({ theme, variant, side, message: String(error.stack ?? error) });
      } finally {
        await context.close();
      }
    }
  }
await browser.close();
for (const beforeEntry of entries.filter((entry) => entry.side === 'before')) {
  const afterEntry = entries.find(
    (entry) =>
      entry.theme === beforeEntry.theme &&
      entry.variant === beforeEntry.variant &&
      entry.side === 'after'
  );
  if (!afterEntry || JSON.stringify(beforeEntry.rgba) !== JSON.stringify(afterEntry.rgba))
    failures.push({
      theme: beforeEntry.theme,
      variant: beforeEntry.variant,
      message: 'Original reference/final rendered color differs',
      before: beforeEntry.rgba,
      after: afterEntry?.rgba,
    });
  if (beforeEntry.variant === 'override') {
    const expected = beforeEntry.theme === 'light' ? [12, 123, 45, 255] : [70, 80, 220, 255];
    if (JSON.stringify(afterEntry?.rgba) !== JSON.stringify(expected))
      failures.push({ theme: beforeEntry.theme, message: 'Palette override not observed' });
  }
}
await writeFile(
  path.join(out, 'proof.json'),
  JSON.stringify(
    {
      caption:
        'Real production UI. Before light uses the original Tailwind var declaration; missing-fallback compares original default with final missing-variable fallback, not an absent-variable historical equivalence claim.',
      before: args.before,
      after: args.after,
      runnerSha256: sha(await readFile(fileURLToPath(import.meta.url))),
      entries,
      failures,
    },
    null,
    2
  )
);
console.log(`Palette: ${entries.length} screenshots, ${failures.length} failures`);
if (failures.length) process.exitCode = 1;

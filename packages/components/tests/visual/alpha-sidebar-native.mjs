import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const readOption = (name) => argv[argv.indexOf(`--${name}`) + 1];
const prefix = readOption('phase');
const baseUrl = readOption('storybook');
const mode = readOption('mode');
if (!prefix || !baseUrl || !['before', 'final'].includes(mode)) {
  throw new Error('--phase <prefix> --storybook <url> --mode before|final required');
}
const artifacts = fileURLToPath(new URL('../../artifacts/visual/', import.meta.url));
const hash = (input) => createHash('sha256').update(input).digest('hex');
const buildFingerprint = hash(
  (await (await fetch(new URL('/iframe.html', baseUrl))).text()) +
    JSON.stringify(await (await fetch(new URL('/index.json', baseUrl))).json())
);
const harnessFingerprint = hash(await readFile(fileURLToPath(import.meta.url)));
const suffixes = mode === 'before' ? ['current', 'reference'] : ['final'];
const stores = new Map(
  suffixes.map((suffix) => [suffix, { entries: [], failures: [], controls: [] }])
);
for (const suffix of suffixes)
  await mkdir(path.join(artifacts, `${prefix}-${suffix}`, 'shots'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const snapshot = () => {
  const rows = [];
  const walk = (element, route) => {
    if (['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) return;
    const s = getComputedStyle(element);
    const r = element.getBoundingClientRect();
    rows.push({
      path: route,
      tag: element.tagName.toLowerCase(),
      rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100),
      text: (element.textContent || '').trim().slice(0, 60),
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      color: s.color,
      backgroundColor: s.backgroundColor,
      borderColor: s.borderColor,
      borderRadius: s.borderRadius,
      boxShadow: s.boxShadow,
      opacity: s.opacity,
    });
    [...element.children].forEach((child, i) => walk(child, `${route}>${i}`));
  };
  [...document.body.children]
    .filter((e) => !['SCRIPT', 'STYLE', 'LINK'].includes(e.tagName))
    .forEach((e, i) => walk(e, String(i)));
  return rows;
};
const restoreOriginal = () => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) throw new Error('Actual project removal dialog is missing');
  const paragraphs = [...dialog.querySelectorAll('p')];
  const archive = paragraphs.find((e) => e.textContent === '3 conversations will move to Archive.');
  const lead = paragraphs.find(
    (e) => e.textContent === 'Lody never deletes the original project folder or its files.'
  );
  const panel = dialog.querySelector('[role="checkbox"]')?.closest('label')?.parentElement;
  const targets = [
    [
      archive,
      'color',
      'color-mix(in oklab, hsl(var(--foreground) / 1) 85%, transparent)',
      'text-foreground/85',
    ],
    [
      lead?.parentElement,
      'background-color',
      'color-mix(in oklab, hsl(var(--muted) / 1) 60%, transparent)',
      'bg-muted/60',
    ],
    [
      lead,
      'color',
      'color-mix(in oklab, hsl(var(--foreground) / 1) 90%, transparent)',
      'text-foreground/90',
    ],
    [
      panel,
      'border-color',
      'color-mix(in oklab, hsl(var(--border) / 1) 70%, transparent)',
      'border-border/70',
    ],
  ];
  window.__alphaSidebarStyles = [];
  return targets.map(([element, property, declaration, originalUtility]) => {
    if (!element || element.getBoundingClientRect().width === 0)
      throw new Error(`Missing visible original declaration target: ${originalUtility}`);
    const record = {
      originalUtility,
      property,
      declaration,
      text: element.textContent.slice(0, 100),
      oldInline: element.getAttribute('style'),
      before: getComputedStyle(element).getPropertyValue(property),
    };
    window.__alphaSidebarStyles.push({ element, inline: record.oldInline });
    element.style.setProperty(property, declaration);
    record.after = getComputedStyle(element).getPropertyValue(property);
    return record;
  });
};
const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .every((a) => a.playState !== 'running')
  );
  await page.evaluate(async () => {
    let last = '',
      stable = 0;
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      const value = JSON.stringify(
        [...document.querySelectorAll('[role="dialog"], [role="dialog"] *')].map((e) => {
          const r = e.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        })
      );
      stable = value === last ? stable + 1 : 0;
      last = value;
      if (stable >= 4) return;
    }
    throw new Error('Actual dialog geometry did not settle');
  });
};
try {
  for (const width of [1280, 390])
    for (const theme of ['light', 'dark'])
      for (const scenario of ['local', 'offline', 'unavailable', 'preflight-error', 'processing']) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
        const storyId = `sidebar-alphamigration--${scenario}`;
        const viewport = width === 390 ? 'compact' : 'desktop';
        const capture = async (state) => {
          await settle(page);
          for (const suffix of suffixes) {
            const store = stores.get(suffix);
            const key = `${storyId}__${viewport}__${theme}__${state}`;
            if (suffix === 'reference')
              store.controls.push({
                key,
                kind: 'Actual production component with only four original compiled CSS declarations restored; not a historical whole-HEAD UI baseline.',
                declarations: await page.evaluate(restoreOriginal),
              });
            const shot = `shots/${key}.png`;
            await page.screenshot({
              path: path.join(artifacts, `${prefix}-${suffix}`, shot),
              animations: 'disabled',
              caret: 'hide',
            });
            store.entries.push({
              key,
              storyId,
              title: 'Sidebar/AlphaMigration — original declaration controls',
              viewport,
              theme,
              state,
              shot,
              layout: await page.evaluate(snapshot),
            });
            if (suffix === 'reference')
              await page.evaluate(() => {
                for (const { element, inline } of window.__alphaSidebarStyles) {
                  if (inline === null) element.removeAttribute('style');
                  else element.setAttribute('style', inline);
                }
                delete window.__alphaSidebarStyles;
              });
          }
        };
        try {
          const url = new URL('/iframe.html', baseUrl);
          url.search = new URLSearchParams({
            id: storyId,
            viewMode: 'story',
            globals: `theme:${theme};locale:en`,
          }).toString();
          await page.goto(url.href);
          await page.getByRole('button', { name: 'Open project removal', exact: true }).click();
          await page.getByRole('dialog').waitFor({ state: 'visible' });
          await page.mouse.move(2, 2);
          await capture('opened');
          if (scenario === 'local' || scenario === 'preflight-error') {
            await page.getByRole('checkbox').click();
            await page
              .getByText(
                scenario === 'local'
                  ? 'Dirty synthetic session 中文'
                  : 'Synthetic preflight failed; the original directory remains safe.',
                { exact: true }
              )
              .waitFor({ state: 'visible' });
            await page.mouse.move(2, 2);
            await capture('cleanup-result');
          }
        } catch (error) {
          for (const store of stores.values())
            store.failures.push({ storyId, viewport, theme, error: String(error) });
          await page
            .screenshot({
              path: path.join(
                artifacts,
                `${prefix}-${suffixes[0]}`,
                `failed-${scenario}-${viewport}-${theme}.png`
              ),
            })
            .catch(() => undefined);
        }
        await context.close();
      }
} finally {
  for (const [suffix, store] of stores) {
    const dir = path.join(artifacts, `${prefix}-${suffix}`);
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        {
          phase: `${prefix}-${suffix}`,
          baseUrl,
          buildFingerprint,
          harnessFingerprint,
          browserVersion: browser.version(),
          expected: 28,
          capturedAt: new Date().toISOString(),
          entries: store.entries,
        },
        null,
        2
      )
    );
    await writeFile(path.join(dir, 'failures.json'), JSON.stringify(store.failures, null, 2));
    await writeFile(path.join(dir, 'controls.json'), JSON.stringify(store.controls, null, 2));
  }
  await browser.close();
}
for (const [suffix, store] of stores) {
  console.log({
    phase: `${prefix}-${suffix}`,
    frames: store.entries.length,
    failures: store.failures.length,
  });
  if (store.entries.length !== 28 || store.failures.length) process.exitCode = 1;
}

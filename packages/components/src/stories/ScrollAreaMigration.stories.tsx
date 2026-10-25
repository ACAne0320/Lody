import type { Meta, StoryObj } from '@storybook/react';
import { useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Button } from '@lody/ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { themeColors } from '../style/theme-colors.stylex';
import { themeSpace } from '../style/theme-scale.stylex';

const styles = stylex.create({
  canvas: { padding: themeSpace[4], color: themeColors.foreground, minHeight: '100vh' },
  controls: { display: 'flex', gap: themeSpace[2], flexWrap: 'wrap', marginBottom: themeSpace[3] },
  area: {
    height: 240,
    width: '100%',
    maxWidth: 640,
    borderRadius: 12,
    backgroundColor: themeColors.muted,
  },
  row: { padding: themeSpace[3], borderBottom: `1px solid ${themeColors.border}` },
  wide: { width: 960 },
  horizontal: { display: 'flex', width: 'max-content' },
  tile: { width: 180, padding: themeSpace[4] },
});

function Fixture({
  mode = 'vertical',
  overrides = false,
  asChild = false,
  empty = false,
}: {
  mode?: 'vertical' | 'horizontal' | 'both';
  overrides?: boolean;
  asChild?: boolean;
  empty?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState('Start');
  const horizontalOnly = mode === 'horizontal';
  const content = horizontalOnly ? (
    <div {...stylex.props(styles.horizontal)}>
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} {...stylex.props(styles.tile)}>
          Tab {index + 1} · 本地文件
        </div>
      ))}
    </div>
  ) : (
    <div {...stylex.props(mode === 'both' && styles.wide)}>
      {Array.from({ length: empty ? 2 : 24 }, (_, index) => (
        <div key={index} {...stylex.props(styles.row)}>
          Row {index + 1} · 本地工作区 / source / component.tsx
        </div>
      ))}
    </div>
  );
  return (
    <div {...stylex.props(styles.canvas)}>
      <div {...stylex.props(styles.controls)}>
        <Button
          onClick={() => {
            viewport.current?.scrollTo({ top: 310, left: 270, behavior: 'instant' });
            setPosition('Scrolled');
          }}
        >
          Scroll middle
        </Button>
        <Button
          onClick={() => {
            viewport.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            setPosition('Start');
          }}
        >
          Scroll start
        </Button>
        <output>{position}</output>
      </div>
      <ScrollArea
        type="always"
        {...stylex.props(styles.area)}
        viewportRef={viewport}
        scrollableX={mode !== 'vertical'}
        horizontalOnly={horizontalOnly}
        viewportAsChild={asChild}
        viewportClassName={overrides ? 'rounded-none' : undefined}
        scrollbarClassName={overrides ? 'w-4 p-0' : undefined}
        scrollbarThumbClassName={
          overrides ? 'rounded-none bg-primary/40 hover:bg-primary/60' : undefined
        }
        horizontalScrollbarClassName={overrides ? 'h-3 p-0' : undefined}
        horizontalScrollbarThumbClassName={
          overrides ? 'rounded-none bg-primary/40 hover:bg-primary/60' : undefined
        }
      >
        {asChild ? (
          <div tabIndex={0} aria-label="Scrollable content">
            {content}
          </div>
        ) : (
          content
        )}
      </ScrollArea>
    </div>
  );
}

const meta = {
  title: 'Ui/ScrollAreaMigration',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Vertical: Story = { render: () => <Fixture /> };
export const Horizontal: Story = { render: () => <Fixture mode="horizontal" /> };
export const Both: Story = { render: () => <Fixture mode="both" /> };
export const CallerOverrides: Story = { render: () => <Fixture mode="both" overrides /> };
export const ViewportAsChild: Story = { render: () => <Fixture asChild /> };
export const NoOverflow: Story = { render: () => <Fixture empty /> };

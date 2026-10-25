import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as stylex from '@stylexjs/stylex';

import { cn } from '@/lib/utils';
import { withClassName } from '@/lib/stylex';
import { themeSpace } from '../style/theme-scale.stylex';

const styles = stylex.create({
  root: { position: 'relative', overflow: 'hidden' },
  viewport: { height: '100%', width: '100%', borderRadius: 'inherit' },
  track: {
    display: 'flex',
    touchAction: 'none',
    userSelect: 'none',
    position: 'absolute',
    transitionProperty:
      'color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to',
    transitionDuration: 'var(--tw-duration, var(--default-transition-duration, 150ms))',
    transitionTimingFunction:
      'var(--tw-ease, var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1)))',
    padding: '1px',
  },
  vertical: {
    top: 0,
    right: 0,
    height: '100%',
    width: themeSpace[2.5],
    borderLeftWidth: '1px',
    borderLeftStyle: 'var(--tw-border-style, solid)',
    borderLeftColor: 'transparent',
  },
  horizontal: {
    bottom: 0,
    left: 0,
    height: themeSpace[1.5],
    width: '100%',
    flexDirection: 'column',
    borderTopWidth: '1px',
    borderTopStyle: 'var(--tw-border-style, solid)',
    borderTopColor: 'transparent',
  },
  thumb: {
    position: 'relative',
    flex: '1 1 0%',
    borderRadius: 'calc(infinity * 1px)',
    backgroundColor: {
      default: 'hsl(var(--scrollbar-thumb) / 0.5)',
      '@media (hover: hover)': {
        ':hover:not(:active)': 'hsl(var(--scrollbar-thumb-hover) / 0.65)',
      },
      ':active': 'hsl(var(--scrollbar-thumb-active) / 0.75)',
    },
    transitionProperty:
      'color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to',
    transitionDuration: 'var(--tw-duration, var(--default-transition-duration, 150ms))',
    transitionTimingFunction:
      'var(--tw-ease, var(--default-transition-timing-function, cubic-bezier(0.4, 0, 0.2, 1)))',
  },
});

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    /**
     * Enable horizontal scrollbar. When true, the Radix content wrapper keeps
     * its default `display: table` so it can expand beyond the viewport width,
     * enabling horizontal scroll.
     */
    scrollableX?: boolean;
    /**
     * When true with `scrollableX`, skip the vertical scrollbar track. Useful
     * for single-row tab strips that only scroll horizontally.
     */
    horizontalOnly?: boolean;
    viewportAsChild?: boolean;
    viewportClassName?: string;
    viewportRef?: React.Ref<HTMLDivElement>;
    viewportStyle?: React.CSSProperties;
    scrollbarClassName?: string;
    scrollbarThumbClassName?: string;
    /** Applied only to the horizontal scrollbar (defaults to `scrollbarClassName`). */
    horizontalScrollbarClassName?: string;
    horizontalScrollbarThumbClassName?: string;
  }
>(
  (
    {
      className,
      children,
      scrollableX,
      horizontalOnly,
      viewportAsChild,
      viewportClassName,
      viewportRef,
      viewportStyle,
      scrollbarClassName,
      scrollbarThumbClassName,
      horizontalScrollbarClassName,
      horizontalScrollbarThumbClassName,
      ...props
    },
    ref
  ) => (
    <ScrollAreaPrimitive.Root
      ref={ref}
      {...withClassName(stylex.props(styles.root), className)}
      {...props}
    >
      {/* https://github.com/radix-ui/primitives/issues/926 */}
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        asChild={viewportAsChild}
        className={cn(
          stylex.props(styles.viewport).className,
          !scrollableX && '[&>div]:block!',
          viewportClassName
        )}
        style={viewportStyle}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!horizontalOnly && (
        <ScrollBar className={scrollbarClassName} thumbClassName={scrollbarThumbClassName} />
      )}
      {scrollableX && (
        <ScrollBar
          orientation="horizontal"
          className={horizontalScrollbarClassName ?? scrollbarClassName}
          thumbClassName={horizontalScrollbarThumbClassName ?? scrollbarThumbClassName}
        />
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
);
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
    thumbClassName?: string;
  }
>(({ className, orientation = 'vertical', thumbClassName, ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      // Absolute so the track overlays the edge instead of growing the layout
      // (important for compact tab strips where a 10px in-flow bar is too tall).
      stylex.props(styles.track, orientation === 'vertical' ? styles.vertical : styles.horizontal)
        .className,
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      className={cn(stylex.props(styles.thumb).className, thumbClassName)}
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };

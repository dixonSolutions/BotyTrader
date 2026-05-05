/**
 * Consistent single-cell icons for the Ink TUI (no special fonts required).
 * Pairs with clickable buttons and labels for scannable hierarchy.
 */

export const icons = {
  back: "←",
  home: "⌂",
  search: "⌕",
  close: "✕",
  play: "▶",
  pause: "⏸",
  refresh: "↻",
  reset: "↺",
  edit: "✎",
  plus: "+",
  minus: "−",
  chevronUp: "▲",
  chevronDown: "▼",
  check: "✓",
  download: "↓",
  bullet: "●",
  debug: "⚙",
  stop: "■",
} as const;

export type IconName = keyof typeof icons;

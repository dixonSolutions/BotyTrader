/**
 * Theme tokens — single source of truth for colours and spacing across the
 * TUI. Keeping every screen on the same palette enforces Consistency and
 * Similarity (Gestalt) and lowers cognitive load (Hick's Law).
 *
 * Ink uses chalk-style colour names; we centralise them here so swapping the
 * palette or adding a "high-contrast" theme is a one-file change.
 */

export const theme = {
  color: {
    primary: "cyan",
    accent: "magenta",
    success: "green",
    warn: "yellow",
    danger: "red",
    muted: "gray",
    text: "white",
    subtle: "gray",
  },
  /** Filled controls (chalk background names). */
  ui: {
    buttonPrimaryBg: "blue",
    buttonSecondaryBg: "cyan",
    buttonDangerBg: "red",
    buttonGhostBg: "gray",
    /** Prominent positive / go action (e.g. Alpaca Search). */
    buttonSuccessBg: "green",
    tabActiveBg: "blue",
    tabInactiveBg: "gray",
    switchTrackOn: "blue",
    switchTrackOff: "gray",
  },
  level: {
    info: "white",
    warn: "yellow",
    error: "red",
    agent: "cyan",
  } as const,
  // Single horizontal padding value applied to every screen body so column
  // alignment stays predictable.
  padding: 1,
  /**
   * Terminal hints for a PrimeNG-like dark surface (see primeng.org).
   * Angular/PrimeNG components cannot run inside Ink; these tokens only
   * approximate the showcase “dark + cyan progress” look in the CLI.
   */
  primengDark: {
    surfaceBorder: "cyan",
    title: "cyan",
    subtitle: "gray",
    progressFill: "cyan",
    progressTrack: "gray",
    progressLabel: "white",
    dangerAction: "red",
  },
} as const;

export type LogLevelColor = keyof typeof theme.level;

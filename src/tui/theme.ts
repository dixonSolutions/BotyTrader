/**
 * Theme tokens — single source of truth for colours and spacing across the
 * TUI. Keeping every screen on the same palette enforces Consistency and
 * Similarity (Gestalt) and lowers cognitive load (Hick's Law).
 *
 * Ink uses chalk-style colour names or hex; we centralise them here so
 * swapping the palette or adding a "high-contrast" theme is a one-file change.
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
    border: "gray",
  },
  /** Filled controls and surface tokens. */
  ui: {
    /**
     * Primary button: white pill, black text (design: white rounded rect, black text).
     * Use buttonPrimaryFg for the text colour.
     */
    buttonPrimaryBg: "#FFFFFF",
    buttonPrimaryFg: "#000000",
    buttonSecondaryBg: "#3A3A3C",
    buttonSecondaryFg: "#FFFFFF",
    buttonDangerBg: "#DC2626",
    buttonGhostBg: "transparent",
    buttonSuccessBg: "#16A34A",

    /**
     * Tab bar (dark surface, underline-based active indicator).
     *   Inactive: muted gray text, no background.
     *   Active:   white bold text, underline.
     *   Divider:  thin ─── line below the tab strip.
     */
    tabActiveFg: "#FFFFFF",
    tabInactiveFg: "#707074",
    tabDividerColor: "#333336",

    /**
     * Select / dropdown (PrimeNG dark surface approximation).
     *   Trigger: dark bordered box with chevron.
     *   Popover:  same dark surface, list of options.
     */
    select: {
      bg: "#1A1A1C",
      border: "#333336",
      borderFocus: "#8E8E93",
      fg: "#FFFFFF",
      muted: "#8E8E93",
      optionHoverBg: "#2C2C2E",
      optionActiveFg: "#FFFFFF",
    },

    /** Opaque modal / popover panel (no transparency). */
    popover: {
      surface: "#1A1A1C",
      border: "#333336",
      titleFg: "#FFFFFF",
      bodyFg: "#E4E4E7",
      mutedFg: "#8E8E93",
      caret: "#555555",
    },

    /**
     * Dark-surface checkbox (unchecked: subtle border; checked: white field + black tick).
     * Matches the app's dark chrome; terminals without truecolor still degrade reasonably.
     */
    checkbox: {
      surface: "#121214",
      border: "#707074",
      borderHover: "#8c8c90",
      checkedBg: "#ffffff",
      checkmark: "#000000",
      /** Outer size in terminal cells (same on / off). */
      frameWidth: 5,
      frameHeight: 3,
    },

    // Legacy tokens kept for backward compatibility with TabBarClickable before redesign.
    tabActiveBg: "#FFFFFF",
    tabInactiveBg: "#3A3A3C",
    buttonSecondaryBgLegacy: "cyan",
    switchTrackOn: "#0A84FF",
    switchTrackOff: "#3A3A3C",
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
   * approximate the showcase "dark + cyan progress" look in the CLI.
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

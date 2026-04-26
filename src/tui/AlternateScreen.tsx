/**
 * Use the alternate screen buffer so Ink’s (0,0) matches the terminal’s top-left
 * for SGR mouse reporting. Without this, the first Ink row can sit below the shell
 * prompt while mouse Py counts from the viewport top — every hit-test looks “off”.
 */

import { useLayoutEffect } from "react";

const ALT_ON = "\u001b[?1049h";
const ALT_OFF = "\u001b[?1049l";
const CURSOR_HOME = "\u001b[H";

export function AlternateScreen(): null {
  useLayoutEffect(() => {
    if (!process.stdout.isTTY) return undefined;
    if (process.env.BOTYTRADER_NO_ALT_SCREEN === "1" || process.env.BOTYTRADER_NO_ALT_SCREEN === "true") {
      return undefined;
    }
    process.stdout.write(ALT_ON + CURSOR_HOME);
    const restore = (): void => {
      try {
        process.stdout.write(ALT_OFF);
      } catch {
        /* stream may be closed on shutdown */
      }
    };
    process.once("exit", restore);
    return () => {
      process.removeListener("exit", restore);
      restore();
    };
  }, []);
  return null;
}

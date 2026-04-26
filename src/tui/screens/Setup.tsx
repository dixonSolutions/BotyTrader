/**
 * Setup wizard — opens automatically on startup when any required secret is
 * missing. Walks through the missing keys one at a time and persists each
 * value to .env. Calls `onComplete` once every required key has been entered.
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../components/SafeTextInput.js";

import { Button } from "../components/Button.js";
import { Footer, Header, Panel, ScreenFrame } from "../components/Layout.js";
import { ScrollRegion } from "../components/ScrollRegion.js";
import { icons } from "../components/icons.js";
import { theme } from "../theme.js";
import { SECRET_DESCRIPTIONS, writeEnv, type Secrets } from "../../config.js";

interface Props {
  missing: (keyof Secrets)[];
  /** Shown in the header broker slot (e.g. platform id) — no live connection during setup. */
  brokerName: string;
  onComplete: () => void;
  /** First step ← Back, or ← Back on the “all set” screen — exit without finishing setup. */
  onAbort: () => void;
}

export function Setup({ missing, brokerName, onComplete, onAbort }: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");

  function handleHeaderBack(): void {
    if (missing.length === 0) {
      onComplete();
      return;
    }
    if (index > 0) {
      setIndex(index - 1);
      setDraft("");
    } else {
      onAbort();
    }
  }

  if (missing.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Box flexShrink={0}>
          <Header breadcrumb={["Setup"]} brokerName={brokerName} connected={false} onBack={handleHeaderBack} />
        </Box>
        <ScrollRegion>
          <ScreenFrame title="Setup" subtitle="Nothing to do — all required secrets are set.">
            <Box marginTop={1}>
              <Button label="Continue" icon={icons.check} onClick={onComplete} variant="primary" />
            </Box>
          </ScreenFrame>
        </ScrollRegion>
        <Box flexShrink={0}>
          <Footer
            hints={[
              "← Back continues to the app (same as Continue)",
              "Wheel scrolls the main pane when content is tall",
              "Pointer or Tab to controls where shown",
            ]}
          />
        </Box>
      </Box>
    );
  }

  const current = missing[index];

  function commit(): void {
    const value = draft.trim();
    if (!value) return;
    writeEnv({ [current]: value });
    setDraft("");
    if (index + 1 >= missing.length) {
      onComplete();
    } else {
      setIndex(index + 1);
    }
  }

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box flexShrink={0}>
        <Header breadcrumb={["Setup"]} brokerName={brokerName} connected={false} onBack={handleHeaderBack} />
      </Box>
      <ScrollRegion>
        <ScreenFrame
          title="Setup wizard"
          subtitle={`Missing ${missing.length - index} required credential${missing.length - index === 1 ? "" : "s"}.`}
        >
          <Panel title={`${current} (${index + 1} of ${missing.length})`}>
            <Text color={theme.color.muted}>{SECRET_DESCRIPTIONS[current]}</Text>
            <Box marginTop={1} flexDirection="row" flexWrap="wrap">
              <Text color={theme.color.primary}>Value: </Text>
              <TextInput value={draft} onChange={setDraft} onSubmit={commit} mask="*" />
              <Box marginLeft={1}>
                <Button label="Save" icon={icons.check} onClick={commit} variant="primary" />
              </Box>
            </Box>
          </Panel>
          <Text color={theme.color.muted}>
            Values are written to .env (mode 0600). Press Ctrl+C to abort.
          </Text>
        </ScreenFrame>
      </ScrollRegion>
      <Box flexShrink={0}>
        <Footer
          hints={[
            index > 0 ? "← Back goes to the previous secret" : "← Back exits setup without saving remaining keys",
            "Wheel scrolls the main pane when content is tall",
            "Save commits this key; last key finishes and starts the app",
          ]}
        />
      </Box>
    </Box>
  );
}

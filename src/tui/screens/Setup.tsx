/**
 * Setup wizard — opens automatically on startup when any required secret is
 * missing. Walks through the missing keys one at a time and persists each
 * value to .env. Calls `onComplete` once every required key has been entered.
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

import { Panel, ScreenFrame } from "../components/Layout.js";
import { theme } from "../theme.js";
import { SECRET_DESCRIPTIONS, writeEnv, type Secrets } from "../../config.js";

interface Props {
  missing: (keyof Secrets)[];
  onComplete: () => void;
}

export function Setup({ missing, onComplete }: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");

  if (missing.length === 0) {
    return (
      <ScreenFrame title="Setup" subtitle="Nothing to do — all required secrets are set.">
        <Text color={theme.color.success}>Press any key to continue.</Text>
      </ScreenFrame>
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
    <ScreenFrame
      title="Setup wizard"
      subtitle={`Missing ${missing.length - index} required credential${missing.length - index === 1 ? "" : "s"}.`}
    >
      <Panel title={`${current} (${index + 1} of ${missing.length})`}>
        <Text color={theme.color.muted}>{SECRET_DESCRIPTIONS[current]}</Text>
        <Box marginTop={1}>
          <Text color={theme.color.primary}>Value: </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} mask="*" />
        </Box>
      </Panel>
      <Text color={theme.color.muted}>
        Values are written to .env (mode 0600). Press Ctrl+C to abort.
      </Text>
    </ScreenFrame>
  );
}

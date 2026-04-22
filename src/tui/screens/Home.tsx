/**
 * Home launcher — three-option entry point.
 *
 * The cards use Common Region (borders) and a single accent on the focused
 * option (Von Restorff) so the next action is obvious without reading.
 * Three top-level routes is still well within Hick's Law sweet spot, and
 * grouping is consistent: Insights (read), Models (manage AI), Config (tune).
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

import { Footer, Header, ScreenFrame } from "../components/Layout.js";
import { theme } from "../theme.js";

export type HomeChoice = "config" | "insights" | "models";

interface Props {
  brokerName: string;
  connected: boolean;
  onChoose: (choice: HomeChoice) => void;
  onQuit: () => void;
}

const ORDER: HomeChoice[] = ["insights", "models", "config"];

export function Home({ brokerName, connected, onChoose, onQuit }: Props): React.ReactElement {
  const [focus, setFocus] = useState<HomeChoice>("insights");

  useInput((input, key) => {
    if (input === "q") {
      onQuit();
      return;
    }
    if (input === "c") return onChoose("config");
    if (input === "i") return onChoose("insights");
    if (input === "m") return onChoose("models");
    if (key.leftArrow || key.upArrow) {
      const i = ORDER.indexOf(focus);
      setFocus(ORDER[(i - 1 + ORDER.length) % ORDER.length]);
      return;
    }
    if (key.rightArrow || key.downArrow) {
      const i = ORDER.indexOf(focus);
      setFocus(ORDER[(i + 1) % ORDER.length]);
      return;
    }
    if (key.return) onChoose(focus);
  });

  return (
    <Box flexDirection="column">
      <Header breadcrumb={[]} brokerName={brokerName} connected={connected} />
      <ScreenFrame title="Welcome" subtitle="Choose where you want to go.">
        <Box>
          <Card
            label="Insights"
            shortcut="i"
            description="Dashboard — vitals, agent schedule & reasoning, performance, market, logs. Press `n` there to run the agent manually."
            focused={focus === "insights"}
          />
          <Box width={2} />
          <Card
            label="Models"
            shortcut="m"
            description="Install, select, and delete local Hugging Face models. The active model powers the trading agent."
            focused={focus === "models"}
          />
          <Box width={2} />
          <Card
            label="Config"
            shortcut="c"
            description="Edit secrets, settings, and the cycle interval."
            focused={focus === "config"}
          />
        </Box>
      </ScreenFrame>
      <Footer hints={["←/→ select", "Enter open", "i insights", "m models", "c config", "q quit"]} />
    </Box>
  );
}

interface CardProps {
  label: string;
  shortcut: string;
  description: string;
  focused: boolean;
}

function Card({ label, shortcut, description, focused }: CardProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? theme.color.accent : theme.color.muted}
      paddingX={2}
      paddingY={1}
      width={32}
    >
      <Box>
        <Text color={theme.color.muted}>[{shortcut}] </Text>
        <Text bold color={focused ? theme.color.accent : theme.color.text}>
          {label}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.color.muted}>{description}</Text>
      </Box>
    </Box>
  );
}

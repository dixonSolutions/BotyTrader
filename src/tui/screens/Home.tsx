/**
 * Home launcher — Insights, Alpaca Search, and Config entry points.
 *
 * Common Region (borders) and accent on pointer hover (Von Restorff).
 * All navigation is pointer-driven (see @zenobius/ink-mouse on the root app).
 */

import React, { useRef } from "react";
import { Box, type DOMElement, Text } from "ink";

import { Button } from "../components/Button.js";
import { ScrollRegion } from "../components/ScrollRegion.js";
import { usePointerTarget } from "../pointer/usePointerTarget.js";
import { Footer, Header, ScreenFrame } from "../components/Layout.js";
import { icons } from "../components/icons.js";
import { theme } from "../theme.js";

export type HomeChoice = "config" | "insights" | "alpaca_search" | "models";

interface Props {
  brokerName: string;
  connected: boolean;
  onChoose: (choice: HomeChoice) => void;
  onQuit: () => void;
}

const ORDER: { id: HomeChoice; label: string; description: string; icon: string }[] = [
  {
    id: "insights",
    label: "Insights",
    icon: icons.bullet,
    description: "Dashboard — vitals, agent schedule & reasoning, performance, market, logs.",
  },
  {
    id: "alpaca_search",
    label: "Alpaca Search",
    icon: icons.search,
    description: "News from Alpaca Market Data — ticker, comma list, or keyword filter on recent headlines.",
  },
  {
    id: "models",
    label: "Models",
    icon: icons.download,
    description: "Download LLMs for intelligent trading — allocation, risk review, news analysis.",
  },
  {
    id: "config",
    label: "Config",
    icon: icons.bullet,
    description: "Settings, trading, discovery, secrets, schedules — full configuration.",
  },
];

export function Home({ brokerName, connected, onChoose, onQuit }: Props): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box flexShrink={0}>
        <Header breadcrumb={[]} brokerName={brokerName} connected={connected} />
      </Box>
      <ScrollRegion>
        <ScreenFrame title="Welcome" subtitle="Choose where you want to go.">
          <Box flexDirection="column">
            <Box flexDirection="row" flexWrap="wrap">
              {ORDER.map((o) => (
                <Box key={o.id} marginRight={2} marginBottom={1}>
                  <LaunchCard
                    label={o.label}
                    description={o.description}
                    icon={o.icon}
                    onClick={() => onChoose(o.id)}
                  />
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Button
                label="Quit"
                icon={icons.close}
                onClick={onQuit}
                variant="danger"
                minWidth={10}
              />
            </Box>
          </Box>
        </ScreenFrame>
      </ScrollRegion>
      <Box flexShrink={0}>
        <Footer
          hints={[
            "Click a card — Insights, Alpaca Search (news), or Config",
            "Wheel scrolls the main pane when content is tall",
            "Click Quit to exit — typing stays for search fields in other screens",
          ]}
        />
      </Box>
    </Box>
  );
}

function LaunchCard({
  label,
  description,
  icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: string;
  onClick: () => void;
}): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, { onPress: () => onClick() });

  return (
    <Box
      ref={ref}
      flexDirection="column"
      borderStyle="round"
      borderColor={ripple ? theme.color.text : hover ? theme.color.accent : theme.color.muted}
      paddingX={2}
      paddingY={1}
      width={36}
    >
      <Text
        bold
        color={ripple ? "black" : hover ? theme.color.accent : theme.color.text}
        backgroundColor={ripple ? "white" : undefined}
      >
        {icon} {label}
      </Text>
      <Box marginTop={1}>
        <Text color={theme.color.muted}>{description}</Text>
      </Box>
    </Box>
  );
}

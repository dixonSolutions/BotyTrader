/**
 * Clickable tab strip — dark surface, underline-based active indicator.
 *
 * Inactive tab: muted gray. Active tab: white bold + underline. Divider below strip.
 * (Stepped animation was removed: extra timers + re-renders amplified pointer load and
 * contributed to sluggish / “stuck” UI with many `usePointerTarget` subscribers.)
 */

import React, { useRef } from "react";
import { Box, type DOMElement, Text } from "ink";

import { usePointerTarget } from "../pointer/usePointerTarget.js";
import { theme } from "../theme.js";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: string;
}

export interface TabBarClickableProps<T extends string> {
  tabs: readonly TabItem<T>[];
  current: T;
  onSelect: (id: T) => void;
}

function TabPill<T extends string>({
  tab,
  active,
  onSelect,
}: {
  tab: TabItem<T>;
  active: boolean;
  onSelect: (id: T) => void;
}): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, { onPress: () => onSelect(tab.id) });

  const label = tab.icon ? `${tab.icon} ${tab.label}` : tab.label;
  const paddedLabel = ` ${label} `;

  if (active) {
    return (
      <Box ref={ref}>
        <Text bold color={theme.ui.tabActiveFg} underline>
          {paddedLabel}
        </Text>
      </Box>
    );
  }

  const color = ripple ? "#FFFFFF" : hover ? "#ADADAD" : theme.ui.tabInactiveFg;

  return (
    <Box ref={ref}>
      <Text color={color}>{paddedLabel}</Text>
    </Box>
  );
}

export function TabBarClickable<T extends string>({
  tabs,
  current,
  onSelect,
}: TabBarClickableProps<T>): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {tabs.map((t) => (
          <TabPill key={t.id} tab={t} active={t.id === current} onSelect={onSelect} />
        ))}
      </Box>
      <Box>
        <Text color={theme.ui.tabDividerColor}>{"─".repeat(60)}</Text>
      </Box>
    </Box>
  );
}

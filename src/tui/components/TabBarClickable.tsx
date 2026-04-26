/**
 * Clickable tab strip (e.g. Config sub-tabs). No keyboard shortcuts.
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
  isLast,
}: {
  tab: TabItem<T>;
  active: boolean;
  onSelect: (id: T) => void;
  isLast: boolean;
}): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, { onPress: () => onSelect(tab.id) });

  const bg = active
    ? theme.ui.tabActiveBg
    : ripple
      ? "white"
      : hover
        ? theme.ui.buttonSecondaryBg
        : theme.ui.tabInactiveBg;

  return (
    <Box ref={ref} marginRight={isLast ? 0 : 1}>
      <Text
        bold
        backgroundColor={bg}
        color={ripple && !active ? "black" : "white"}
        underline={!active && hover && !ripple}
      >
        {` ${tab.icon ? `${tab.icon} ` : ""}${tab.label} `}
      </Text>
    </Box>
  );
}

export function TabBarClickable<T extends string>({
  tabs,
  current,
  onSelect,
}: TabBarClickableProps<T>): React.ReactElement {
  return (
    <Box marginBottom={1} flexWrap="wrap">
      {tabs.map((t, i) => (
        <TabPill key={t.id} tab={t} active={t.id === current} onSelect={onSelect} isLast={i === tabs.length - 1} />
      ))}
    </Box>
  );
}

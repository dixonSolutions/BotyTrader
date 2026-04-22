/**
 * Layout primitives — Header (breadcrumb), Footer (help bar), ScreenFrame, Panel.
 *
 * Every screen renders inside ScreenFrame so spacing, chrome, and the broker
 * status indicator stay uniform (Consistency, Common Region). The screen title
 * is the only h1 per screen (Typography Hierarchy).
 */

import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

export interface HeaderProps {
  breadcrumb: string[];
  brokerName: string;
  connected: boolean;
}

export function Header({ breadcrumb, brokerName, connected }: HeaderProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box paddingX={theme.padding} justifyContent="space-between">
        <Box>
          <Text bold color={theme.color.primary}>
            BotyTrader
          </Text>
          {breadcrumb.length > 0 ? (
            <>
              <Text color={theme.color.muted}> › </Text>
              <Text color={theme.color.text}>{breadcrumb.join(" › ")}</Text>
            </>
          ) : null}
        </Box>
        <Box>
          <Text color={theme.color.muted}>broker </Text>
          <Text color={connected ? theme.color.success : theme.color.danger}>{brokerName}</Text>
          <Text color={theme.color.muted}>{connected ? " ●" : " ✗"}</Text>
        </Box>
      </Box>
      <Divider />
    </Box>
  );
}

export function Footer({ hints }: { hints: string[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Divider />
      <Box paddingX={theme.padding}>
        {hints.map((hint, i) => (
          <Box key={i} marginRight={3}>
            <Text color={theme.color.muted}>{hint}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function Divider(): React.ReactElement {
  return <Text color={theme.color.muted}>{"─".repeat(80)}</Text>;
}

export interface ScreenFrameProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function ScreenFrame({ title, subtitle, children }: ScreenFrameProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={theme.padding} paddingY={1} flexGrow={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.color.primary}>
          {title}
        </Text>
        {subtitle ? <Text color={theme.color.muted}>{subtitle}</Text> : null}
      </Box>
      {children}
    </Box>
  );
}

export interface PanelProps {
  title?: string;
  accent?: string;
  children: React.ReactNode;
}

export function Panel({ title, accent, children }: PanelProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={accent ?? theme.color.muted}
      paddingX={1}
      marginBottom={1}
    >
      {title ? (
        <Text bold color={theme.color.text}>
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

export function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}): React.ReactElement {
  return (
    <Box justifyContent="space-between">
      <Text color={theme.color.muted}>{label}</Text>
      <Text color={valueColor ?? theme.color.text}>{value}</Text>
    </Box>
  );
}

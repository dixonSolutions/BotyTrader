/**
 * Root Ink app — owns top-level routing between Home, Insights, Alpaca Search, and Config.
 *
 * State subscription happens once here; child screens receive immutable
 * snapshots (Single Responsibility, predictable rendering).
 */

import React, { useEffect, useState } from "react";
import { Box, useApp } from "ink";

import { AlpacaSearchScreen } from "./screens/AlpacaSearchScreen.js";
import { Home, type HomeChoice } from "./screens/Home.js";
import { Insights } from "./screens/insights/Insights.js";
import { Config } from "./screens/config/Config.js";
import { ModelsScreen } from "./screens/ModelsScreen.js";
import type { Orchestrator, OrchestratorState } from "../orchestrator.js";

type Route = "home" | HomeChoice;

interface Props {
  orchestrator: Orchestrator;
  initialRoute?: Route;
}

export function App({ orchestrator, initialRoute = "home" }: Props): React.ReactElement {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [state, setState] = useState<OrchestratorState>(orchestrator.getState());
  const { exit } = useApp();

  useEffect(() => orchestrator.subscribe(setState), [orchestrator]);

  function quit(): void {
    orchestrator.stop();
    exit();
  }

  function goHome(): void {
    setRoute("home");
  }

  function choose(choice: HomeChoice): void {
    setRoute(choice);
  }

  if (route === "home") {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Home
          brokerName={state.brokerName}
          connected={state.connected}
          onChoose={choose}
          onQuit={quit}
        />
      </Box>
    );
  }

  if (route === "config") {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <Config orchestrator={orchestrator} state={state} onBack={goHome} />
      </Box>
    );
  }

  if (route === "alpaca_search") {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <AlpacaSearchScreen orchestrator={orchestrator} state={state} onBack={goHome} />
      </Box>
    );
  }

  if (route === "models") {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        <ModelsScreen orchestrator={orchestrator} onBack={goHome} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Insights orchestrator={orchestrator} state={state} onBack={goHome} />
    </Box>
  );
}

/**
 * Root Ink app — owns top-level routing between Home, Insights, Models, Config.
 *
 * State subscription happens once here; child screens receive immutable
 * snapshots (Single Responsibility, predictable rendering).
 */

import React, { useEffect, useState } from "react";
import { useApp } from "ink";

import { Home, type HomeChoice } from "./screens/Home.js";
import { Insights } from "./screens/insights/Insights.js";
import { Config } from "./screens/config/Config.js";
import { Models } from "./screens/models/Models.js";
import type { Orchestrator, OrchestratorState } from "../orchestrator.js";

type Route = "home" | "config" | "insights" | "models";

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
      <Home
        brokerName={state.brokerName}
        connected={state.connected}
        onChoose={choose}
        onQuit={quit}
      />
    );
  }

  if (route === "config") {
    return <Config orchestrator={orchestrator} state={state} onBack={goHome} />;
  }

  if (route === "models") {
    return <Models orchestrator={orchestrator} state={state} onBack={goHome} />;
  }

  return <Insights orchestrator={orchestrator} state={state} onBack={goHome} />;
}

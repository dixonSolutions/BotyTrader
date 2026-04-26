/**
 * Full-screen Alpaca news search — opened from Home.
 */

import React from "react";
import { Box } from "ink";

import { Footer, Header, ScreenFrame } from "../components/Layout.js";
import { ScrollRegion } from "../components/ScrollRegion.js";
import { AlpacaSearchPanel } from "./insights/AlpacaSearch.js";
import type { Orchestrator, OrchestratorState } from "../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  onBack: () => void;
}

export function AlpacaSearchScreen({ orchestrator, state, onBack }: Props): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box flexShrink={0}>
        <Header
          breadcrumb={["Alpaca Search"]}
          brokerName={state.brokerName}
          connected={state.connected}
          onBack={onBack}
        />
      </Box>
      <ScrollRegion>
        <ScreenFrame
          title="Alpaca Search"
          subtitle="Market Data news — tickers or keywords. Requires Alpaca paper or live."
        >
          <AlpacaSearchPanel
            orchestrator={orchestrator}
            connected={state.connected}
            showPanelHeading={false}
          />
        </ScreenFrame>
      </ScrollRegion>
      <Box flexShrink={0}>
        <Footer
          hints={[
            "Enter runs search; the wide green bar is the same action",
            "Wheel scrolls when results are long",
            "Back returns Home",
          ]}
        />
      </Box>
    </Box>
  );
}

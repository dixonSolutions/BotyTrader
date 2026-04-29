/**
 * Full-screen Alpaca news search — opened from Home.
 */

import React, { useEffect, useRef } from "react";
import { Box } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import { useMouse } from "@zenobius/ink-mouse";

import { Footer, Header, ScreenFrame } from "../components/Layout.js";
import { AlpacaSearchPanel } from "./insights/AlpacaSearch.js";
import type { Orchestrator, OrchestratorState } from "../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  onBack: () => void;
}

const WHEEL_STEP = 3;

export function AlpacaSearchScreen({ orchestrator, state, onBack }: Props): React.ReactElement {
  const mouse = useMouse();
  const scrollViewRef = useRef<ScrollViewRef>(null);

  // Wheel scroll handler
  useEffect(() => {
    const onScroll = (_pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null) return;
      const scrollView = scrollViewRef.current;
      if (!scrollView) return;

      if (dir === "scrollup") {
        scrollView.scrollBy(-WHEEL_STEP);
      } else if (dir === "scrolldown") {
        scrollView.scrollBy(WHEEL_STEP);
      }
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events]);

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
      <Box flexGrow={1} minHeight={0} minWidth={0}>
        <ScrollView ref={scrollViewRef} flexGrow={1}>
          <ScreenFrame
            title="Alpaca Search"
            subtitle="Market Data news with Technical + Sentiment scoring. Discover and rank new opportunities."
          >
            <AlpacaSearchPanel
              orchestrator={orchestrator}
              connected={state.connected}
              showPanelHeading={false}
            />
          </ScreenFrame>
        </ScrollView>
      </Box>
      <Box flexShrink={0}>
        <Footer
          hints={[
            "Enter runs search; Symbols are scored with Tech + Sentiment weights from config",
            "Wheel to scroll · Back returns Home",
          ]}
        />
      </Box>
    </Box>
  );
}

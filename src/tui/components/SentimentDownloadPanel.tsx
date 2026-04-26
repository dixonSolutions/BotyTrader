/**
 * FinBERT local download job — PrimeNG-inspired dark “card”, spinner, progress bar, cancel.
 * PrimeNG ([primefaces/primeng](https://github.com/primefaces/primeng)) is Angular-only; Ink cannot
 * host those components — this panel approximates dark progress / status density in the terminal.
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";

import { Button } from "./Button.js";
import { TerminalProgressBar } from "./TerminalProgressBar.js";
import { icons } from "./icons.js";
import { theme } from "../theme.js";
import type { Orchestrator } from "../../orchestrator.js";
import type { SentimentInstallProgress } from "../../trading/sentiment/finbert.js";
import { formatBytes } from "../../llm/model_manager.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface Props {
  orchestrator: Orchestrator;
  needsLocalInstall: boolean;
  cacheDir: string;
  parentBusy: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function SentimentDownloadPanel({
  orchestrator,
  needsLocalInstall,
  cacheDir,
  parentBusy,
  onBusyChange,
}: Props): React.ReactElement | null {
  const { stdout } = useStdout();
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [progress, setProgress] = useState<SentimentInstallProgress | null>(null);
  const [outcome, setOutcome] = useState<"idle" | "ok" | "cancelled" | "error">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const p = theme.primengDark;
  const barW = Math.min(52, Math.max(16, (stdout.columns ?? 80) - 14));

  const prevNeeds = useRef(needsLocalInstall);
  const needsMount = useRef(true);
  useEffect(() => {
    if (needsMount.current) {
      needsMount.current = false;
      prevNeeds.current = needsLocalInstall;
      return;
    }
    if (needsLocalInstall && !prevNeeds.current) {
      setOutcome("idle");
      setErrorText(null);
      setProgress(null);
    }
    prevNeeds.current = needsLocalInstall;
  }, [needsLocalInstall]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => (t + 1) % SPINNER.length), 100);
    return () => clearInterval(id);
  }, [running]);

  const spin = SPINNER[tick % SPINNER.length] ?? SPINNER[0];
  const suffixBytes =
    progress?.loaded != null && progress.total != null && progress.total > 0
      ? `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
      : undefined;

  const showCard = needsLocalInstall || running || outcome !== "idle";
  if (!showCard) {
    return null;
  }

  function startInstall(): void {
    setOutcome("idle");
    setErrorText(null);
    setProgress({
      phase: "preparing",
      message: "Preparing install…",
      fraction: null,
    });
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    onBusyChange(true);
    void orchestrator
      .installSentimentFinbert({
        signal: ac.signal,
        onProgress: setProgress,
      })
      .then(() => {
        setOutcome("ok");
        setProgress({ phase: "complete", message: "Installed and engine refreshed.", fraction: 1 });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          setOutcome("cancelled");
          setProgress({ phase: "preparing", message: "Cancelled.", fraction: null });
        } else {
          setOutcome("error");
          setErrorText(err instanceof Error ? err.message : String(err));
          setProgress({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
            fraction: null,
          });
        }
      })
      .finally(() => {
        setRunning(false);
        onBusyChange(false);
        abortRef.current = null;
      });
  }

  function cancelInstall(): void {
    abortRef.current?.abort();
  }

  const phaseLabel =
    progress?.phase === "preparing"
      ? "Preparing"
      : progress?.phase === "downloading"
        ? "Downloading"
        : progress?.phase === "verifying"
          ? "Verifying"
          : progress?.phase === "complete"
            ? "Complete"
            : progress?.phase === "error"
              ? "Error"
              : "…";

  const canShowInstallCta =
    needsLocalInstall && !running && (outcome === "idle" || outcome === "error" || outcome === "cancelled");

  return (
    <Box marginTop={1} flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={p.surfaceBorder}
        paddingX={1}
        paddingY={1}
      >
        <Text bold color={p.title}>
          {spin} FinBERT — local weights
        </Text>
        <Text dimColor color={p.subtitle}>
          Dark / high-contrast progress (PrimeNG-inspired); not the Angular library.
        </Text>

        {canShowInstallCta ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={p.subtitle}>
              Sentiment engine not ready. Cache: {cacheDir}. Install syncs <Text bold>HF_TOKEN</Text> from secrets into
              the process for Transformers.js, and queries the Hub via <Text bold>@huggingface/hub</Text> before
              downloading.
            </Text>
            <Box marginTop={1} flexDirection="row" flexWrap="wrap">
              <Button
                label="Install / update FinBERT"
                icon={icons.download}
                onClick={startInstall}
                disabled={parentBusy || running}
                variant="primary"
                minWidth={26}
              />
            </Box>
          </Box>
        ) : null}

        {running || progress != null ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={p.progressLabel}>
              <Text bold color={p.title}>
                {phaseLabel}
              </Text>
              {": "}
              {progress?.message ?? "…"}
            </Text>
            {progress?.file ? (
              <Text dimColor color={p.subtitle}>
                {progress.file}
              </Text>
            ) : null}
            <Box marginTop={1}>
              <TerminalProgressBar fraction={progress?.fraction ?? null} width={barW} suffix={suffixBytes} />
            </Box>
            {running ? (
              <Box marginTop={1} flexDirection="row" flexWrap="wrap">
                <Button
                  label="Cancel"
                  icon={icons.close}
                  onClick={cancelInstall}
                  disabled={parentBusy}
                  variant="danger"
                  minWidth={12}
                />
                <Text> </Text>
                <Text dimColor color={p.subtitle}>
                  Stops the pipeline; one in-flight file may still complete.
                </Text>
              </Box>
            ) : null}
            {outcome === "ok" ? (
              <Box marginTop={1}>
                <Text color={theme.color.success}>{icons.check} Ready — use Warm / reload if needed.</Text>
              </Box>
            ) : null}
            {outcome === "cancelled" ? (
              <Box marginTop={1}>
                <Text color={theme.color.warn}>Stopped — config not changed.</Text>
              </Box>
            ) : null}
            {outcome === "error" && errorText ? (
              <Box marginTop={1}>
                <Text color={theme.color.danger}>{errorText}</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

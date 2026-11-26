import { useState } from "react";
import { useServerState } from "@/components/server/useServerState";
import { ServerHeader } from "@/components/server/ServerHeader";
import { WebSocketPanel } from "@/components/server/WebSocketPanel";
import { LoadedModelsPanel } from "@/components/server/LoadedModelsPanel";
import { EndpointsPanel } from "@/components/server/EndpointsPanel";
import { DevLogs } from "@/components/server/DevLogs";
import { ServerStats } from "@/components/server/ServerStats";
import { type LogLevel } from "@/components/server/types";

export default function ServerPage() {
  const [serverPort, setServerPort] = useState("1234");
  const [logFilter, setLogFilter]   = useState<LogLevel>("ALL");
  const [logSearch, setLogSearch]   = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const {
    serverUrl,
    isRunning, toggleServer,
    logs, setLogs, isPaused, setIsPaused,
    wsStatus, uptime, wsMsgCountRef,
    loadedModels, isFetchingModels, fetchModels,
    endpointTestResult, setEndpointTestResult,
    requestCount, latency,
    testEndpoint,
  } = useServerState(serverPort);

  const errorCount = logs.filter(l => l.level === "ERROR").length;
  const warnCount  = logs.filter(l => l.level === "WARN").length;

  return (
    <div className="flex-1 flex h-full min-w-0">
      <div className="flex-1 flex flex-col h-full overflow-y-auto scrollbar-thin">
        <ServerHeader
          isRunning={isRunning}
          onToggle={toggleServer}
          serverUrl={serverUrl}
          serverPort={serverPort}
          onPortChange={setServerPort}
        />

        <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto scrollbar-styled">
          <div className="grid grid-cols-2 gap-3">
            <WebSocketPanel
              wsStatus={wsStatus}
              serverPort={serverPort}
              uptime={uptime}
              wsMsgCount={wsMsgCountRef.current}
              latency={latency}
            />
            <LoadedModelsPanel
              models={loadedModels}
              isFetching={isFetchingModels}
              onRefresh={fetchModels}
            />
          </div>

          <EndpointsPanel
            onTest={testEndpoint}
            testResult={endpointTestResult}
          />

          <DevLogs
            logs={logs}
            isPaused={isPaused}
            onPauseToggle={() => setIsPaused(p => !p)}
            onClear={() => setLogs([])}
            logFilter={logFilter}
            onFilterChange={setLogFilter}
            logSearch={logSearch}
            onSearchChange={setLogSearch}
            showSearch={showSearch}
            onToggleSearch={() => setShowSearch(s => !s)}
            isRunning={isRunning}
          />
        </div>
      </div>

      <ServerStats
        requestCount={requestCount}
        modelCount={loadedModels.length}
        wsStatus={wsStatus}
        wsMsgCount={wsMsgCountRef.current}
        latency={latency}
        logCount={logs.length}
        uptime={uptime}
        errorCount={errorCount}
        warnCount={warnCount}
        serverUrl={serverUrl}
      />
    </div>
  );
}

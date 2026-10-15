/// <reference types="vite/client" />

interface Window {
  electron?: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    onEnginePort(cb: (port: number) => void): void;
    onAistclawPort(cb: (port: number) => void): void;
  };
}

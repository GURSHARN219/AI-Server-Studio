/// <reference types="vite/client" />

interface Window {
  electron?: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    onEnginePort(cb: (port: number) => void): void;
    onGoClawPort(cb: (port: number) => void): void;
  };
}

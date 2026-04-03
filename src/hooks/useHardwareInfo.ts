/**
 * useHardwareInfo
 * Fetches real hardware info from the local engine's /v1/hardware endpoint.
 * Falls back to null values when the engine is offline.
 */

import { useState, useEffect, useCallback } from "react";
import { getEnginePort } from "@/lib/localEngine";

const engineBase = () => `http://localhost:${getEnginePort()}/v1`;

export interface CpuInfo {
  name: string;
  manufacturer: string;
  cores: number;
  physicalCores: number;
  speed: number;
  architecture: string;
  extensions: string[];
}

export interface MemoryInfo {
  totalRam: number;
  freeRam: number;
  usedRam: number;
}

export interface GpuInfo {
  name: string;
  vram: number;
  vramFree: number;
  vendor: string;
  deviceId: string;
  hasCuda: boolean;
  hasVulkan: boolean;
  driverVersion: string;
}

export interface HardwareInfo {
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpus: GpuInfo[];
  platform: string;
  arch: string;
}

export interface ResourceUsage {
  cpuPercent: number;
  ramUsed: number;
  ramTotal: number;
}

function formatBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes === 0) return "0 B";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(decimals)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(1)} MB`;
}

export function useHardwareInfo(usageInterval = 3000) {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [usage, setUsage] = useState<ResourceUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHardware = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${engineBase()}/system/hardware`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: HardwareInfo = await res.json();
      // Normalize nullable arrays that can come back as null from the API
      if (data.cpu) data.cpu.extensions = data.cpu.extensions ?? [];
      data.gpus = data.gpus ?? [];
      setHardware(data);
      setError(null);
    } catch (e) {
      setError("Engine offline — start the engine to see hardware info");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch(`${engineBase()}/system/usage`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return;
      const data: ResourceUsage = await res.json();
      setUsage(data);
    } catch {
      // silently ignore — engine may be offline
    }
  }, []);

  useEffect(() => {
    fetchHardware();
  }, [fetchHardware]);

  useEffect(() => {
    fetchUsage();
    const id = setInterval(fetchUsage, usageInterval);
    return () => clearInterval(id);
  }, [fetchUsage, usageInterval]);

  return {
    hardware,
    usage,
    loading,
    error,
    refresh: fetchHardware,
    formatBytes,
  };
}

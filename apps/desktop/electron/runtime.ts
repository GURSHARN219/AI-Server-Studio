import path from "node:path";

/** Shared by development and packaged launches; legacy configuration is opt-in only. */
export function engineEnvironment(environment: NodeJS.ProcessEnv, userData: string): NodeJS.ProcessEnv {
  const dataDir = environment.AI_SERVER_DATA_DIR?.trim() || path.join(userData, "data");
  return {
    ...environment,
    AI_SERVER_DATA_DIR: dataDir,
    AIST_ENGINE_DATA_DIR: dataDir,
    AIST_IMPORT_ENGINE_CONFIG: "0",
  };
}

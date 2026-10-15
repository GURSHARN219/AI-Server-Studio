import path from "node:path";
import { describe, expect, it } from "vitest";
import { engineEnvironment } from "../../electron/runtime";

describe("Electron local engine storage", () => {
  it("uses userData/data explicitly with no cloud or database environment", () => {
    const env = engineEnvironment({}, path.join("user", "Studio"));
    expect(env.AI_SERVER_DATA_DIR).toBe(path.join("user", "Studio", "data"));
    expect(env.AIST_ENGINE_DATA_DIR).toBe(env.AI_SERVER_DATA_DIR);
    expect(env.AIST_IMPORT_ENGINE_CONFIG).toBe("0");
  });
  it("honors an explicit data directory and does not mutate launch environment", () => {
    const supplied = { AI_SERVER_DATA_DIR: "custom-data", AIST_IMPORT_ENGINE_CONFIG: "1" };
    expect(engineEnvironment(supplied, "user").AI_SERVER_DATA_DIR).toBe("custom-data");
    expect(supplied.AIST_IMPORT_ENGINE_CONFIG).toBe("1");
    expect(engineEnvironment(supplied, "user").AIST_IMPORT_ENGINE_CONFIG).toBe("0");
  });
  it("treats an empty override consistently in development and production", () => {
    expect(engineEnvironment({ AI_SERVER_DATA_DIR: "  " }, "user").AI_SERVER_DATA_DIR).toBe(path.join("user", "data"));
  });
});

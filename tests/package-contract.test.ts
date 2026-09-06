import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("publish contract", () => {
  it("ships as an independent DSH bundle and keeps the official MCP bridge", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
    const agent = readFileSync(new URL("../agent.cordis.yml", import.meta.url), "utf8");
    expect(manifest.name).toBe("@taiheqi718-art/dsh-browser-workbench");
    expect(manifest.dsh.bundle.patch).toBe("./cordis.patch.yml");
    expect(manifest.dsh.client.platform).toBe("web");
    expect(manifest.dsh.client.inject).toContain("@deepseek-ai/dsh-client-ui-renderer");
    expect(patch).toContain("DSH_BROWSER_WORKBENCH_RUNTIME");
    expect(patch).toContain("enabled: true");
    expect(agent).toContain("@deepseek-ai/dsh-mcp-client");
    expect(agent).toContain("ctx.dshBrowserWorkbench.mcp");
    expect(agent).not.toContain("npx");
    expect(`${patch}\n${agent}`).not.toMatch(/ai-company|smart-auto|exp-harness/i);
  });
});

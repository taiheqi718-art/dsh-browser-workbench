import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBrowserMcpDescriptor } from "../src/runtime.js";

const scratch = path.resolve(".scratch");
mkdirSync(scratch, { recursive: true });
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("browser runtime descriptor", () => {
  it("resolves one host-owned descriptor used by the official MCP row", () => {
    const runtimeRoot = mkdtempSync(path.join(scratch, "runtime-"));
    roots.push(runtimeRoot);
    const descriptor = createBrowserMcpDescriptor({
      runtimeRoot,
      browserExecutable: process.execPath,
      mcpEntry: process.execPath,
    });

    expect(descriptor.command).toBe(process.execPath);
    expect(descriptor.args).toContain("--isolated");
    expect(descriptor.args).toContain("--headless");
    expect(descriptor.args).toContain("--block-service-workers");
    expect(descriptor.args).not.toContain("--allow-unrestricted-file-access");
    expect(descriptor.outputDir.startsWith(runtimeRoot)).toBe(true);
    expect(existsSync(descriptor.outputDir)).toBe(true);
    expect(descriptor.env.HOME?.startsWith(runtimeRoot)).toBe(true);
    expect(descriptor.serviceWorkersBlocked).toBe(true);
  });

  it("refuses relative runtime roots and missing executables", () => {
    expect(() => createBrowserMcpDescriptor({
      runtimeRoot: "relative",
      browserExecutable: process.execPath,
      mcpEntry: process.execPath,
    })).toThrow(/runtimeRoot must be absolute/);
    expect(() => createBrowserMcpDescriptor({
      runtimeRoot: path.resolve(scratch, "missing-browser-root"),
      browserExecutable: path.resolve(scratch, "no-browser"),
      mcpEntry: process.execPath,
    })).toThrow(/browser executable must be an existing absolute path/);
    rmSync(path.resolve(scratch, "missing-browser-root"), { recursive: true, force: true });
  });
});

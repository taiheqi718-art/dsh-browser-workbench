import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("DSH browser client", () => {
  it("registers only a transient official-details overlay", () => {
    const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
    let registration: { id: string; factory: (load: (name: string) => unknown) => { inject: string[]; apply(ctx: unknown): void } } | undefined;
    vm.runInNewContext(source, {
      window: { __ModuleLoader__: { load(value: typeof registration) { registration = value; } } },
    });
    expect(registration?.id).toBe("@taiheqi718-art/dsh-browser-workbench");

    const react = {
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
      useState: (initial: unknown) => [initial, () => undefined],
      useEffect: () => undefined,
      useRef: (initial: unknown) => ({ current: initial }),
    };
    const plugin = registration?.factory((name) => {
      if (name === "react") return react;
      if (name === "@deepseek-ai/dsh-client-ui-primitives") return { StateDot: () => null };
      throw new Error(`unexpected client dependency: ${name}`);
    });
    expect(plugin?.inject).toEqual(["layout", "sessions", "slots"]);

    const registered = new Map<string, { id: string; component: (props: unknown) => unknown }>();
    plugin?.apply({
      slots: {
        inject(_name: string, callback: () => void) { callback(); },
        register(definition: { name: string; id: string }, component: (props: unknown) => unknown) {
          registered.set(definition.name, { id: definition.id, component });
          return () => undefined;
        },
      },
    });
    const overlay = registered.get("shell.overlay");
    expect(overlay?.id).toBe("dsh-browser-workbench-panel");
    expect(overlay?.component({ useSessions: (pick: (state: unknown) => unknown) => pick({ current: undefined, byId: {} }) })).toBeNull();
    expect(registered.has("conversation.view")).toBe(false);
    expect(source).toContain("waitMs: 25000");
    expect(source).not.toContain("setInterval(");
    expect(source).toContain("ctx.layout.openDetails()");
    expect(source).toContain("工具详情");
  });
});

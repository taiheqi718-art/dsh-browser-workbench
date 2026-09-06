/* Browser-only half loaded by DSH's client module roster. */
window.__ModuleLoader__.load({
  id: "@taiheqi718-art/dsh-browser-workbench",
  factory: (require) => {
    const react = require("react");
    const { StateDot } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = react.createElement;
    const ROUTE = "/dsh-browser-workbench/live";
    const PANEL_SLOT = "shell.overlay";
    const PANEL_ID = "dsh-browser-workbench-panel";
    const TOGGLE_SLOT = "conversation.session.header.utilities";
    const TOGGLE_ID = "dsh-browser-workbench-toggle";
    const MAX_REMEMBERED_SESSIONS = 32;
    const FRAME_LAYOUT_ATTR = "data-dsh-browser-workbench-layout";
    const FRAME_SIDEBAR_VAR = "--dsh-browser-workbench-sidebar";
    const FRAME_DETAILS_VAR = "--dsh-browser-workbench-details";
    const PANEL_MIN = 520;
    const PANEL_MAX = 880;
    const PANEL_SHARE = 0.48;
    const CENTER_FLOOR = 360;
    const PUSHED_LAYOUT_CSS = `
      [${FRAME_LAYOUT_ATTR}] {
        grid-template-columns:
          var(${FRAME_SIDEBAR_VAR}) minmax(0, 1fr) var(${FRAME_DETAILS_VAR}) !important;
      }
    `;
    const EMPTY_PANEL_UI = Object.freeze({
      activity: 0,
      dismissedActivity: 0,
      manualOpen: false,
      available: false,
    });
    let layout = null;
    const panelUiBySession = new Map();
    const panelUiListeners = new Set();

    function readPanelUi(sessionId) {
      return typeof sessionId === "string"
        ? panelUiBySession.get(sessionId) ?? EMPTY_PANEL_UI
        : EMPTY_PANEL_UI;
    }

    function updatePanelUi(sessionId, patch) {
      if (typeof sessionId !== "string") return;
      const previous = readPanelUi(sessionId);
      const next = { ...previous, ...patch };
      if (Object.keys(next).every((key) => next[key] === previous[key])) return;
      panelUiBySession.delete(sessionId);
      panelUiBySession.set(sessionId, next);
      while (panelUiBySession.size > MAX_REMEMBERED_SESSIONS) {
        panelUiBySession.delete(panelUiBySession.keys().next().value);
      }
      for (const listener of panelUiListeners) listener(sessionId);
    }

    function usePanelUi(sessionId) {
      const [, refresh] = react.useState(0);
      react.useEffect(() => {
        const listener = (changedSessionId) => {
          if (changedSessionId === sessionId) refresh((value) => value + 1);
        };
        panelUiListeners.add(listener);
        return () => panelUiListeners.delete(listener);
      }, [sessionId]);
      return readPanelUi(sessionId);
    }

    async function readFrame(sessionId, afterRevision, signal) {
      const response = await fetch(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, afterRevision, waitMs: 25000 }),
        signal,
      });
      if (!response.ok) throw new Error(`${ROUTE} → HTTP ${response.status}`);
      const answer = await response.json();
      if (!answer?.ok) throw new Error(answer?.error ?? "Unable to read browser state");
      return answer.result;
    }

    function BrowserSidePanel({ useSessions }) {
      const sessionId = useSessions((sessions) => {
        const current = sessions.current;
        return current !== undefined && sessions.byId?.[current]?.blank === false ? current : null;
      });
      const [state, setState] = react.useState({
        sessionId: null,
        status: "idle",
        revision: 0,
        activity: 0,
        updatedAt: null,
        url: null,
        error: null,
      });
      const [frame, setFrame] = react.useState(null);
      const [routeError, setRouteError] = react.useState(null);
      const [fullscreen, setFullscreen] = react.useState(false);
      const panel = react.useRef(null);
      const panelUi = usePanelUi(sessionId);

      react.useEffect(() => {
        const abort = new AbortController();
        if (sessionId === null) {
          setState({ sessionId: null, status: "idle", revision: 0, activity: 0, updatedAt: null, url: null, error: null });
          setFrame(null);
          setRouteError(null);
          return () => abort.abort();
        }
        let afterRevision = 0;
        setState({ sessionId, status: "idle", revision: 0, activity: 0, updatedAt: null, url: null, error: null });
        setFrame(null);
        setRouteError(null);
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const follow = async () => {
          while (!abort.signal.aborted) {
            try {
              const next = await readFrame(sessionId, afterRevision, abort.signal);
              if (abort.signal.aborted) return;
              afterRevision = Number.isSafeInteger(next.revision) ? next.revision : afterRevision;
              if (typeof next.imageBase64 === "string" && typeof next.mimeType === "string") {
                setFrame(`data:${next.mimeType};base64,${next.imageBase64}`);
              } else if (next.status === "idle") {
                setFrame(null);
              }
              const activity = Number.isSafeInteger(next.activity) ? next.activity : 0;
              updatePanelUi(sessionId, next.status === "idle"
                ? { activity, available: false, manualOpen: false, dismissedActivity: activity }
                : { activity, available: activity > 0 });
              setState({ ...next, sessionId });
              setRouteError(null);
            } catch (error) {
              if (abort.signal.aborted || error?.name === "AbortError") return;
              setRouteError(String(error?.message ?? error));
              await pause(1500);
            }
          }
        };
        void follow();
        return () => abort.abort();
      }, [sessionId]);

      const visible = sessionId !== null
        && state.sessionId === sessionId
        && state.status !== "idle"
        && panelUi.available
        && (panelUi.manualOpen || state.activity > panelUi.dismissedActivity);

      react.useEffect(() => {
        if (visible) layout?.openDetails();
        else if (sessionId !== null && state.sessionId === sessionId && state.status === "idle" && state.activity > 0) {
          layout?.closeDetails();
        }
      }, [sessionId, state.activity, state.sessionId, state.status, visible]);

      react.useEffect(() => {
        if (!fullscreen) return undefined;
        const exitOnEscape = (event) => {
          if (event.key === "Escape") setFullscreen(false);
        };
        window.addEventListener("keydown", exitOnEscape);
        return () => window.removeEventListener("keydown", exitOnEscape);
      }, [fullscreen]);

      react.useEffect(() => {
        if (!visible && fullscreen) setFullscreen(false);
      }, [fullscreen, visible]);

      react.useEffect(() => {
        if (!visible || panel.current === null) return undefined;
        const overlay = panel.current.closest("[data-shell-overlay]");
        const appFrame = overlay?.parentElement;
        if (!(appFrame instanceof HTMLElement) || overlay === null) {
          return undefined;
        }
        const syncLayout = () => {
          const frameWidth = appFrame.getBoundingClientRect().width;
          const inlineTracks = appFrame.style.gridTemplateColumns;
          const sidebarMatch = /^\s*([\d.]+)px/.exec(inlineTracks);
          const sidebarWidth = Math.max(0, Number(sidebarMatch?.[1] ?? 280));
          const roomForPanel = Math.max(300, frameWidth - sidebarWidth - CENTER_FLOOR);
          const preferred = Math.max(PANEL_MIN, frameWidth * PANEL_SHARE);
          const detailsWidth = Math.round(Math.min(PANEL_MAX, preferred, roomForPanel));
          const sidebarValue = `${Math.round(sidebarWidth)}px`;
          const detailsValue = `${detailsWidth}px`;
          if (appFrame.style.getPropertyValue(FRAME_SIDEBAR_VAR) !== sidebarValue) {
            appFrame.style.setProperty(FRAME_SIDEBAR_VAR, sidebarValue);
          }
          if (appFrame.style.getPropertyValue(FRAME_DETAILS_VAR) !== detailsValue) {
            appFrame.style.setProperty(FRAME_DETAILS_VAR, detailsValue);
          }
          if (!appFrame.hasAttribute(FRAME_LAYOUT_ATTR)) appFrame.setAttribute(FRAME_LAYOUT_ATTR, "");
        };
        syncLayout();
        const resize = typeof ResizeObserver === "function" ? new ResizeObserver(syncLayout) : null;
        resize?.observe(appFrame);
        const mutation = typeof MutationObserver === "function" ? new MutationObserver(syncLayout) : null;
        mutation?.observe(appFrame, {
          attributes: true,
          attributeFilter: ["style", "data-sidebar-collapsed"],
        });
        return () => {
          resize?.disconnect();
          mutation?.disconnect();
          appFrame.removeAttribute(FRAME_LAYOUT_ATTR);
          appFrame.style.removeProperty(FRAME_SIDEBAR_VAR);
          appFrame.style.removeProperty(FRAME_DETAILS_VAR);
        };
      }, [visible]);

      const dismiss = (keepDetails) => {
        if (sessionId === null) return;
        setFullscreen(false);
        updatePanelUi(sessionId, { dismissedActivity: state.activity, manualOpen: false });
        if (!keepDetails) layout?.closeDetails();
      };

      if (!visible) return null;
      const statusText = routeError !== null
        ? "浏览器视图未连接"
        : state.status === "working"
          ? "浏览器正在执行操作"
          : state.status === "ready"
            ? "画面已同步"
            : state.status === "error"
              ? "画面同步失败"
              : "等待首次浏览器操作";

      return h("div", {
        ref: panel,
        "data-dsh-browser-workbench-panel": true,
        style: {
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: fullscreen ? `var(${FRAME_SIDEBAR_VAR}, 280px)` : "auto",
          width: fullscreen
            ? "auto"
            : `var(${FRAME_DETAILS_VAR}, ${PANEL_MIN}px)`,
          minWidth: 0,
          zIndex: fullscreen ? 1000 : "auto",
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
          borderLeft: fullscreen ? 0 : "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
          background: "var(--dsw-alias-bg-base, #111)",
          boxShadow: fullscreen ? "none" : "-10px 0 28px rgba(0,0,0,0.12)",
        },
      }, [
        h("style", { key: "pushed-layout" }, PUSHED_LAYOUT_CSS),
        h("div", {
          key: "bar",
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            borderBottom: "1px solid var(--border, rgba(128,128,128,0.25))",
            minWidth: 0,
          },
        }, [
          h(StateDot, { key: "dot", state: routeError !== null || state.status === "error" ? "error" : state.status === "ready" ? "done" : "warning" }),
          h("span", { key: "title", style: { fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap" } }, "浏览器"),
          h("span", { key: "status", style: { fontSize: "12px", whiteSpace: "nowrap" } }, statusText),
          h("span", {
            key: "url",
            title: state.url ?? "",
            style: {
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              opacity: 0.65,
              fontSize: "12px",
              fontFamily: "var(--font-mono, monospace)",
            },
          }, state.url ?? ""),
          h("button", {
            key: "fullscreen",
            type: "button",
            title: fullscreen ? "退出全屏" : "全屏浏览器",
            "aria-label": fullscreen ? "退出全屏" : "全屏浏览器",
            "aria-pressed": fullscreen,
            onClick: () => setFullscreen((value) => !value),
            style: {
              display: "grid",
              placeItems: "center",
              width: "28px",
              height: "28px",
              padding: 0,
              border: 0,
              borderRadius: "6px",
              background: "transparent",
              color: "inherit",
              opacity: 0.72,
              cursor: "pointer",
            },
          }, h("svg", {
            "aria-hidden": true,
            viewBox: "0 0 24 24",
            width: 18,
            height: 18,
            fill: "none",
          }, h("path", {
            d: fullscreen
              ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
              : "M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5",
            stroke: "currentColor",
            strokeWidth: 1.8,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }))),
          h("button", {
            key: "details",
            type: "button",
            onClick: () => dismiss(true),
            style: { border: 0, background: "transparent", color: "inherit", opacity: 0.72, cursor: "pointer", whiteSpace: "nowrap" },
          }, "工具详情"),
          h("button", {
            key: "close",
            type: "button",
            "aria-label": "关闭浏览器",
            onClick: () => dismiss(false),
            style: { display: "grid", placeItems: "center", width: "28px", height: "28px", border: 0, borderRadius: "999px", background: "transparent", color: "inherit", cursor: "pointer", fontSize: "18px" },
          }, "×"),
        ]),
        h("div", {
          key: "stage",
          style: {
            minHeight: 0,
            overflow: "auto",
            display: "grid",
            placeItems: "center",
            padding: "12px",
            background: "#0b0d10",
          },
        }, frame === null
          ? h("div", {
            style: { maxWidth: "460px", textAlign: "center", display: "grid", gap: "8px", color: "#d6d9de" },
          }, [
            h("div", { key: "title", style: { fontWeight: 600 } }, statusText),
            h("div", { key: "help", style: { opacity: 0.65, fontSize: "13px", lineHeight: 1.6 } },
              routeError ?? state.error ?? "模型正在打开页面。自动画面不发送给模型，不增加 token。"),
          ])
          : h("div", { style: { display: "grid", gap: "8px", width: "100%", height: "100%" } }, [
            h("img", {
              key: `frame-${state.revision}`,
              src: frame,
              alt: "浏览器最新画面",
              draggable: false,
              style: {
                display: "block",
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                margin: "auto",
                objectFit: "contain",
                borderRadius: "6px",
                boxShadow: "0 16px 44px rgba(0,0,0,0.35)",
              },
            }),
            state.error === null ? null : h("div", {
              key: "error",
              style: { color: "var(--danger, #ff7373)", fontSize: "12px", textAlign: "center" },
            }, state.error),
          ])),
      ]);
    }

    function BrowserPanelToggle({ sessionId }) {
      const panelUi = usePanelUi(sessionId);
      if (!panelUi.available) return null;
      const open = panelUi.manualOpen || panelUi.activity > panelUi.dismissedActivity;
      const toggle = () => {
        if (open) {
          updatePanelUi(sessionId, {
            dismissedActivity: panelUi.activity,
            manualOpen: false,
          });
          layout?.closeDetails();
        } else {
          updatePanelUi(sessionId, { manualOpen: true });
          layout?.openDetails();
        }
      };
      return h("button", {
        type: "button",
        title: open ? "关闭浏览器侧栏" : "打开浏览器侧栏",
        "aria-label": open ? "关闭浏览器侧栏" : "打开浏览器侧栏",
        "aria-pressed": open,
        onClick: toggle,
        style: {
          display: "grid",
          placeItems: "center",
          alignItems: "center",
          width: "34px",
          height: "34px",
          padding: 0,
          border: 0,
          borderRadius: "8px",
          background: open ? "var(--dsw-alias-bg-base, rgba(128,128,128,0.12))" : "transparent",
          color: "inherit",
          cursor: "pointer",
        },
      }, h("svg", {
        "aria-hidden": true,
        viewBox: "0 0 24 24",
        width: 22,
        height: 22,
        fill: "none",
        style: { display: "block", opacity: 0.72 },
      }, [
        h("rect", {
          key: "frame",
          x: 3.25,
          y: 3.25,
          width: 17.5,
          height: 17.5,
          rx: 4,
          stroke: "currentColor",
          strokeWidth: 1.7,
        }),
        h("path", {
          key: "divider",
          d: "M9 4.25v15.5",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
        }),
      ]));
    }

    function apply(ctx) {
      layout = ctx.layout;
      ctx.slots.inject(PANEL_SLOT, () => ctx.slots.register({
        name: PANEL_SLOT,
        id: PANEL_ID,
        order: 20,
      }, BrowserSidePanel));
      ctx.slots.inject(TOGGLE_SLOT, () => ctx.slots.register({
        name: TOGGLE_SLOT,
        id: TOGGLE_ID,
        order: 30,
      }, BrowserPanelToggle));
    }

    return { inject: ["layout", "sessions", "slots"], apply };
  },
});

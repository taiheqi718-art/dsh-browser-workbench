/**
 * Ephemeral, capability-addressed HTTP preview for files in one DSH Session
 * workspace. Playwright deliberately blocks file:// navigation; this bridge
 * keeps the safer default and exposes only a random-token route on loopback.
 *
 * @module browser/workspace-preview
 */
export interface WorkspacePreviewBridge {
    urlForFile(workspace: string, absoluteFile: string): Promise<string>;
    /** Convert one private preview URL into a user-facing workspace path. */
    displayAddress(url: string): string | undefined;
    dispose(): void;
}
/** Create the bridge lazily: no socket exists until a local file is opened. */
export declare function createWorkspacePreviewBridge(maxFileBytes?: number): WorkspacePreviewBridge;

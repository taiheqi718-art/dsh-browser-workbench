/**
 * Symlink-aware path resolution shared by browser inputs, outputs and local
 * previews. The public plugin keeps this tiny boundary local so it does not
 * depend on a private Harness policy module.
 */
export interface ResolvedTarget {
    readonly input: string;
    readonly resolved: string;
    readonly insideWorkspace: boolean;
    readonly unresolved?: true;
}
/** Whether target is root itself or a descendant on the same filesystem. */
export declare function isInside(root: string, target: string): boolean;
/** Resolve an untrusted input against one Session workspace. */
export declare function resolveTarget(root: string, input: string): ResolvedTarget;

/**
 * Symlink-aware path resolution shared by browser inputs, outputs and local
 * previews. The public plugin keeps this tiny boundary local so it does not
 * depend on a private Harness policy module.
 */

import { realpathSync } from "node:fs";
import path from "node:path";

export interface ResolvedTarget {
  readonly input: string;
  readonly resolved: string;
  readonly insideWorkspace: boolean;
  readonly unresolved?: true;
}

/** Whether target is root itself or a descendant on the same filesystem. */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** Refuse shell-style variables instead of pretending they are literal names. */
function hasUnexpandedVariable(input: string): boolean {
  return /\$env:|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%|~[\\/]/.test(input);
}

/** Follow the deepest existing ancestor, retaining a not-yet-created tail. */
function realOf(target: string): string {
  let head = target;
  const tail: string[] = [];
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      return path.join(realpathSync(head), ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return target;
      tail.push(path.basename(head));
      head = parent;
    }
  }
  return target;
}

/** Resolve an untrusted input against one Session workspace. */
export function resolveTarget(root: string, input: string): ResolvedTarget {
  if (hasUnexpandedVariable(input)) {
    return { input, resolved: input, insideWorkspace: false, unresolved: true };
  }
  const realRoot = realOf(path.resolve(root));
  const resolved = realOf(path.resolve(realRoot, input));
  return { input, resolved, insideWorkspace: isInside(realRoot, resolved) };
}

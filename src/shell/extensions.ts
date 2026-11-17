import type { ComponentType } from "react";

export interface DashboardSlotProps {
  viewerId: string;
}

export interface CustomerSlotProps {
  viewerId: string;
  customerId: string;
}

export interface SlotProps {
  dashboard: DashboardSlotProps;
  customer: CustomerSlotProps;
}

export type SlotName = keyof SlotProps;

export interface ToolManifest {
  /** Matches the tool's folder in src/tools/ and its action id prefix. */
  id: string;
  name: string;
  description: string;
  nav?: { href: string; label: string };
  /** Components the shell renders in its extension slots. */
  slots?: { [S in SlotName]?: ComponentType<SlotProps[S]> };
}

const globalForTools = globalThis as unknown as { __fitTools?: Map<string, ToolManifest> };
const tools = (globalForTools.__fitTools ??= new Map());

/** Registers a tool with the shell. Re-registering the same id replaces it (hot reload). */
export function registerTool(manifest: ToolManifest): ToolManifest {
  tools.set(manifest.id, manifest);
  return manifest;
}

export function listTools(): ToolManifest[] {
  return [...tools.values()];
}

export function getSlotComponents<S extends SlotName>(
  slot: S,
): { tool: ToolManifest; Component: ComponentType<SlotProps[S]> }[] {
  return listTools().flatMap((tool) => {
    const Component = tool.slots?.[slot] as ComponentType<SlotProps[S]> | undefined;
    return Component ? [{ tool, Component }] : [];
  });
}

export function unregisterToolForTests(id: string): void {
  tools.delete(id);
}

import { getAssistantNavigationActions } from "../assistantActionCatalog";
import { resolveAssistantKnownPageNavigation } from "../runtime/assistantNavigation";
import type { NavigationRole } from "../../../config/navigation";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  auditAssistantTool,
  authenticatedPermission,
  type AssistantToolDefinition,
} from "../tools/assistantToolRegistry";

type NavigationInput = { path: string; query: string };

function readNavigationInput(value: unknown): NavigationInput {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return { path: String(input.path || "").trim(), query: String(input.query || "").trim() };
}

function navigationRole(value: string): NavigationRole {
  return value === "admin" || value === "manager" ? value : "angajat";
}

function cleanPathname(path: string) {
  return path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
}

export function isAssistantNavigationPathAllowed(path: string, role: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  const pathname = cleanPathname(path);
  return getAssistantNavigationActions(navigationRole(role)).some((action) => {
    const allowedPath = cleanPathname(action.path);
    if (pathname === allowedPath) return true;
    return allowedPath !== "/" && pathname.startsWith(`${allowedPath}/`);
  });
}

export function createNavigationTool(): AssistantToolDefinition<unknown, NavigationInput> {
  const definition: AssistantToolDefinition<unknown, NavigationInput> = {
    id: "navigation.open",
    description: "Deschide o ruta WorkControl fara sa modifice date sau formulare.",
    aliases: ["open_page", "navigate"],
    module: "navigation",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, query: { type: "string" } },
      required: ["path", "query"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "low",
    permission: authenticatedPermission,
    resolve: (input, context) => {
      const parsed = readNavigationInput(input);
      if (parsed.path) return parsed;
      const known = resolveAssistantKnownPageNavigation(
        parsed.query || context.contract.response,
        navigationRole(context.pageContext.role)
      );
      return { ...parsed, path: known?.path || "" };
    },
    validate: (input, context) =>
      isAssistantNavigationPathAllowed(input.path, context.pageContext.role)
        ? { ok: true }
        : {
            ok: false,
            reason: "Ruta de navigare lipseste sau nu este permisa pentru rolul curent.",
            missingInformation: ["targetPage"],
          },
    preview: (input) => `Deschid ${input.path}.`,
    execute: async (input, context) => {
      await context.runtime.navigate(input.path);
      return { message: `Am deschis ${input.path}.` };
    },
    audit: (input, outcome, context) => auditAssistantTool(definition, input, outcome, context),
  };
  return definition;
}

import type { AssistantRuntimeUser, AssistantResolvedEntity } from "./assistantTypes";

type PermissionCheckParams = {
  intent: string;
  user: AssistantRuntimeUser | null;
  entity?: AssistantResolvedEntity;
};

function valueFromEntity(entity: AssistantResolvedEntity | undefined, key: string) {
  const data = entity?.data as Record<string, unknown> | undefined;
  return data?.[key] ? String(data[key]) : "";
}

export function checkAssistantPermission(params: PermissionCheckParams) {
  const { user, intent, entity } = params;
  if (!user?.uid) return { ok: false, message: "Trebuie sa fii autentificat." };
  if (user.role === "admin") return { ok: true, message: "" };

  if (intent === "delete_entity") {
    return { ok: false, message: "Nu ai permisiune sa modifici aceasta resursa." };
  }

  if (intent === "update_user") {
    return entity?.entityType === "user" && entity.entityId === user.uid
      ? { ok: true, message: "" }
      : { ok: false, message: "Nu ai permisiune sa modifici acest utilizator." };
  }

  if (user.role === "manager") {
    return { ok: true, message: "" };
  }

  if (intent === "start_timesheet" || intent === "stop_timesheet" || intent === "update_profile") {
    return { ok: true, message: "" };
  }

  if (entity?.entityType === "vehicle") {
    const driverId = valueFromEntity(entity, "currentDriverUserId");
    const ownerId = valueFromEntity(entity, "ownerUserId");
    if (driverId === user.uid || ownerId === user.uid) return { ok: true, message: "" };
  }

  if (entity?.entityType === "tool") {
    const holderId = valueFromEntity(entity, "currentHolderUserId");
    const ownerId = valueFromEntity(entity, "ownerUserId");
    if (holderId === user.uid || ownerId === user.uid) return { ok: true, message: "" };
  }

  return { ok: false, message: "Nu ai permisiune sa modifici aceasta resursa." };
}

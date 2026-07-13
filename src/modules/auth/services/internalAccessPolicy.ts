export type InternalAccessStatus =
  | "active"
  | "pending"
  | "disabled"
  | "unknown";

export type InternalAccessDecision = {
  allowed: boolean;
  status: InternalAccessStatus;
  message: string;
};

type InternalProfile = Record<string, unknown> | null | undefined;

export function evaluateInternalAccessProfile(
  profile: InternalProfile
): InternalAccessDecision {
  if (!profile) {
    return {
      allowed: false,
      status: "unknown",
      message:
        "Contul nu este inregistrat in WorkControl. Contacteaza administratorul.",
    };
  }

  const accessStatus = String(profile.accessStatus ?? "").trim().toLowerCase();
  if (accessStatus === "pending") {
    return {
      allowed: false,
      status: "pending",
      message: "Contul asteapta aprobarea administratorului.",
    };
  }

  if (profile.active !== true || accessStatus === "disabled") {
    return {
      allowed: false,
      status: "disabled",
      message: "Contul este dezactivat. Contacteaza administratorul.",
    };
  }

  if (accessStatus !== "active") {
    return {
      allowed: false,
      status: "unknown",
      message: "Contul intern nu are accesul activat explicit. Contacteaza administratorul.",
    };
  }

  const role = String(profile.role ?? "").trim();
  if (!(["admin", "manager", "angajat"] as string[]).includes(role)) {
    return {
      allowed: false,
      status: "unknown",
      message: "Contul nu are un rol intern valid.",
    };
  }

  return { allowed: true, status: "active", message: "" };
}

export class InternalAccessError extends Error {
  readonly accessStatus: InternalAccessStatus;

  constructor(decision: InternalAccessDecision) {
    super(decision.message);
    this.name = "InternalAccessError";
    this.accessStatus = decision.status;
  }
}

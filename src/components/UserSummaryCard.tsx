import type { ReactNode } from "react";
import type { AppUserItem } from "../types/user";
import { getUserInitials, getUserThemeClass } from "../lib/ui/userTheme";
import UserProfileLink from "./UserProfileLink";

type UserSummaryCardProps = {
  user: AppUserItem;
  stats?: Array<{ label: string; value: ReactNode; tone?: "green" | "orange" | "red" | "blue" | "muted" }>;
  actions?: ReactNode;
};

export default function UserSummaryCard({ user, stats = [], actions }: UserSummaryCardProps) {
  const themeClass = getUserThemeClass(user.themeKey ?? null);

  return (
    <div className={`wc-user-summary-card user-history-row ${themeClass}`}>
      <div className="wc-user-summary-card__identity">
        <span className="user-accent-avatar">{getUserInitials(user.fullName || user.email || "U")}</span>
        <div>
          <UserProfileLink
            userId={user.uid || user.id}
            name={user.fullName || user.email || "Utilizator"}
            themeKey={user.themeKey}
            className="user-accent-name"
          />
          <p>{[user.roleTitle, user.department].filter(Boolean).join(" - ") || user.email || "-"}</p>
        </div>
      </div>
      {stats.length ? (
        <div className="wc-user-summary-card__stats">
          {stats.map((item) => (
            <div key={item.label} className={`wc-user-summary-card__stat wc-user-summary-card__stat--${item.tone ?? "muted"}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {actions ? <div className="wc-user-summary-card__actions">{actions}</div> : null}
    </div>
  );
}

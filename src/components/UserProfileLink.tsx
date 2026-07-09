import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { KeyboardEvent, MouseEvent } from "react";
import { getUserInitials, getUserThemeClass } from "../lib/ui/userTheme";
import { getUserAvatar } from "../modules/users/services/usersService";

type Props = {
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  themeKey?: string | null;
  avatarUrl?: string | null;
  avatarThumbUrl?: string | null;
  showAvatar?: boolean;
  className?: string;
  avatarClassName?: string;
  fallback?: string;
};

const avatarCache = new Map<string, { avatarUrl: string; avatarThumbUrl: string }>();

export default function UserProfileLink({
  userId,
  name,
  email,
  themeKey,
  avatarUrl,
  avatarThumbUrl,
  showAvatar = true,
  className = "",
  avatarClassName = "",
  fallback = "-",
}: Props) {
  const navigate = useNavigate();
  const [loadedAvatar, setLoadedAvatar] = useState<{ avatarUrl: string; avatarThumbUrl: string } | null>(null);
  const label = name || email || fallback;
  const cleanUserId = String(userId || "").trim();
  const canOpenProfile = Boolean(cleanUserId);
  const themeClass = getUserThemeClass(themeKey || null);
  const imageUrl = avatarThumbUrl || avatarUrl || loadedAvatar?.avatarThumbUrl || loadedAvatar?.avatarUrl || "";

  useEffect(() => {
    if (!showAvatar || avatarUrl || avatarThumbUrl || !cleanUserId) {
      setLoadedAvatar(null);
      return;
    }

    const cached = avatarCache.get(cleanUserId);
    if (cached) {
      setLoadedAvatar(cached);
      return;
    }

    let active = true;
    getUserAvatar(cleanUserId)
      .then((avatar) => {
        if (!active || !avatar) return;
        if (avatar.avatarThumbUrl || avatar.avatarUrl) {
          avatarCache.set(cleanUserId, avatar);
        }
        setLoadedAvatar(avatar);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [avatarThumbUrl, avatarUrl, cleanUserId, showAvatar]);

  function openProfile(event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) {
    if (!canOpenProfile) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(`/users/${cleanUserId}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    openProfile(event);
  }

  return (
    <span
      className={`user-profile-link ${themeClass} ${canOpenProfile ? "is-clickable" : "is-static"} ${className}`}
      role={canOpenProfile ? "link" : undefined}
      tabIndex={canOpenProfile ? 0 : undefined}
      title={canOpenProfile ? `Deschide profilul: ${label}` : label}
      onClick={openProfile}
      onKeyDown={handleKeyDown}
    >
      {showAvatar ? (
        <span className={`user-accent-avatar ${avatarClassName}`}>
          {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : getUserInitials(label || "U")}
        </span>
      ) : null}
      <span className="user-profile-link__label">{label}</span>
    </span>
  );
}

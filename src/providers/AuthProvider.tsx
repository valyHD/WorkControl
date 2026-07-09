import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase/firebase";
import { observeAuth, startUserPresence, type AppAuthUser } from "../modules/auth/services/authService";

type AuthContextValue = {
  user: AppAuthUser | null;
  role: string;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  role: "",
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppAuthUser | null>(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = observeAuth(async (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setRole("");
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", nextUser.uid));

        if (snap.exists()) {
          const data = snap.data();

          setUser({
            uid: nextUser.uid,
            email: nextUser.email,
            displayName:
              data.fullName ||
              nextUser.displayName ||
              nextUser.email ||
              "Utilizator",
            avatarUrl: data.avatarUrl || nextUser.avatarUrl || "",
            avatarThumbUrl: data.avatarThumbUrl || data.avatarUrl || nextUser.avatarThumbUrl || nextUser.avatarUrl || "",
            themeKey: data.themeKey ?? null,
            roleTitle: data.roleTitle || "",
            department: data.department || "",
            companyIds: Array.isArray(data.companyIds) ? data.companyIds.filter(Boolean) : [],
            companyNames: Array.isArray(data.companyNames) ? data.companyNames.filter(Boolean) : [],
            primaryCompanyId: data.primaryCompanyId || "",
            primaryCompanyName: data.primaryCompanyName || "",
          });

          setRole(data.role ?? "");
        } else {
          setUser(nextUser);
          setRole("");
        }
      } catch (error) {
        console.error("Eroare la citirea profilului user:", error);
        setUser(nextUser);
        setRole("");
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return startUserPresence(user);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return undefined;

    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      setUser((prev) => {
        if (!prev || prev.uid !== user.uid) return prev;
        const nextUser: AppAuthUser = {
          ...prev,
          displayName: data.fullName || prev.displayName,
          avatarUrl: data.avatarUrl || "",
          avatarThumbUrl: data.avatarThumbUrl || data.avatarUrl || "",
          themeKey: data.themeKey ?? null,
          roleTitle: data.roleTitle || "",
          department: data.department || "",
          companyIds: Array.isArray(data.companyIds) ? data.companyIds.filter(Boolean) : [],
          companyNames: Array.isArray(data.companyNames) ? data.companyNames.filter(Boolean) : [],
          primaryCompanyId: data.primaryCompanyId || "",
          primaryCompanyName: data.primaryCompanyName || "",
        };

        if (
          nextUser.displayName === prev.displayName &&
          nextUser.avatarUrl === prev.avatarUrl &&
          nextUser.avatarThumbUrl === prev.avatarThumbUrl &&
          nextUser.themeKey === prev.themeKey &&
          nextUser.roleTitle === prev.roleTitle &&
          nextUser.department === prev.department &&
          nextUser.primaryCompanyId === prev.primaryCompanyId &&
          nextUser.primaryCompanyName === prev.primaryCompanyName &&
          JSON.stringify(nextUser.companyIds || []) === JSON.stringify(prev.companyIds || []) &&
          JSON.stringify(nextUser.companyNames || []) === JSON.stringify(prev.companyNames || [])
        ) {
          return prev;
        }

        return nextUser;
      });
      setRole(data.role ?? "");
    });
  }, [user?.uid]);

  const value = useMemo(
    () => ({
      user,
      role,
      loading,
    }),
    [user, role, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

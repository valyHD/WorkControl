import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase/firebase";
import { observeAuth, type AppAuthUser } from "../modules/auth/services/authService";

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
            themeKey: data.themeKey ?? null,
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
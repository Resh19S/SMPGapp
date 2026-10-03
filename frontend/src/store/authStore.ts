import { create } from "zustand";
import type { StaffUser } from "../types/contract";

interface AuthState {
  token: string | null;
  user: StaffUser | null;
  setAuth: (token: string, user: StaffUser) => void;
  logout: () => void;
}

/** Restore the session, treating anything unreadable as "logged out" — a bad
 * value here would otherwise crash the app before anything renders. */
function readStoredSession(): { token: string | null; user: StaffUser | null } {
  try {
    const token = sessionStorage.getItem("token");
    const user = JSON.parse(sessionStorage.getItem("user") ?? "null") as StaffUser | null;
    if (token && user && typeof user.role === "string") return { token, user };
  } catch {
    /* corrupted or blocked storage — fall through */
  }
  try {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
  } catch {
    /* storage unavailable */
  }
  return { token: null, user: null };
}

const stored = readStoredSession();

export const useAuthStore = create<AuthState>((set) => ({
  token: stored.token,
  user: stored.user,

  setAuth: (token, user) => {
    sessionStorage.setItem("token", token);
    sessionStorage.setItem("user", JSON.stringify(user));
    set({ token, user });
  },

  logout: () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    set({ token: null, user: null });
  },
}));

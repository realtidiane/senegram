import { createContext, useContext, useEffect, useState } from "react";
import api from "../services/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("senegram_token"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!token) { setLoading(false); return; }
      try {
        const { data } = await api.get("/auth/me");
        setUser(data.user);
        localStorage.setItem("senegram_user", JSON.stringify(data.user));
      } catch {
        localStorage.removeItem("senegram_token");
        localStorage.removeItem("senegram_user");
        setUser(null); setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function login(identifier, password) {
    try {
      const { data } = await api.post("/auth/login", { identifier, password });
      localStorage.setItem("senegram_token", data.token);
      localStorage.setItem("senegram_user", JSON.stringify(data.user));
      setToken(data.token); setUser(data.user);
      return data;
    } catch (err) {
      localStorage.removeItem("senegram_token");
      localStorage.removeItem("senegram_user");
      setToken(null);
      setUser(null);
      throw err;
    }
  }

  async function register(payload) {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("senegram_token", data.token);
    localStorage.setItem("senegram_user", JSON.stringify(data.user));
    setToken(data.token); setUser(data.user);
    return data;
  }

  async function updateProfile(patch) {
    const { data } = await api.patch("/users/me", patch);
    setUser(data.user);
    localStorage.setItem("senegram_user", JSON.stringify(data.user));
    return data.user;
  }

  async function logout() {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("senegram_token");
    localStorage.removeItem("senegram_user");
    setUser(null); setToken(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateProfile, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

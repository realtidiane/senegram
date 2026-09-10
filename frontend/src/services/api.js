import axios from "axios";

/**
 * Determine le baseURL pour les appels API.
 *
 * Par defaut, on utilise une URL relative "" qui passe par Caddy (reverse proxy).
 * Caddy redirige /api/* vers le backend Node.js sur le port interne 5000.
 *
 * Avantages:
 * - Pas de probleme CSP (meme origine)
 * - Pas de probleme CORS (cookies same-origin)
 * - Fonctionne en dev (Vite proxy) et prod (Caddy)
 *
 * Override possible via VITE_API_URL pour pointer vers un backend distant.
 */
function resolveApiUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/+$/, "").replace(/\/api(?:\/api)*$/, "");
  }
  // Toujours URL relative -> passe par Caddy ou Vite proxy
  return "";
}

export const API_URL = resolveApiUrl();

const api = axios.create({
  baseURL: `${API_URL}/api`,
  // Le JWT est envoye via Authorization: Bearer header (plus compatible que cookies)
  // Le backend set le cookie en plus pour le SSR/SEO si besoin
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  if (config.baseURL) {
    config.baseURL = config.baseURL
      .replace(/\/+$/, "")
      .replace(/\/api\/api$/, "/api");
  }
  if (typeof config.url === "string") {
    config.url = config.url.replace(/^\/api\/api\//, "/").replace(/^\/api\//, "/");
  }
  // JWT envoye via cookie httpOnly automatiquement (withCredentials=true)
  // Plus besoin du localStorage, le cookie est envoye avec chaque requete
  // On garde un fallback pour le mode dev ou les clients non-browser
  const token = localStorage.getItem("senegram_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && location.pathname !== "/login") {
      localStorage.removeItem("senegram_token");
      localStorage.removeItem("senegram_user");
      location.href = "/login";
    }
    return Promise.reject(err);
  },
);

/** Transforme un `/uploads/...` relatif en URL absolue. */
export function fileUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  // URL relative -> passe par Caddy
  if (url.startsWith("/")) return url;
  return `/${url}`;
}

export default api;

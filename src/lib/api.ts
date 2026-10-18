/**
 * CampusSync API client configuration.
 * Resolves the base URL from import.meta.env.VITE_API_BASE_URL,
 * with fallback to relative paths for local development or proxies.
 */
export function getApiBaseUrl(): string {
  const base = (import.meta as any).env?.VITE_API_BASE_URL || "";
  return typeof base === "string" ? base.trim().replace(/\/+$/, "") : "";
}

/**
 * Builds a full API endpoint URL using VITE_API_BASE_URL.
 * Example: apiUrl("/api/summarize") -> "https://campussync-backend.onrender.com/api/summarize"
 */
export function apiUrl(endpoint: string): string {
  const base = getApiBaseUrl();
  const cleanPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}

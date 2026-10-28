// Use the page's origin so LAN and Tailscale clients reach the same server.
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

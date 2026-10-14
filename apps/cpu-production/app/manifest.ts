import type { MetadataRoute } from "next";
import { CPU_PWA_BACKGROUND_COLOR, CPU_PWA_THEME_COLOR } from "../lib/cpu-pwa";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "FIKA CPU Production",
    short_name: "FIKA CPU",
    description: "FIKA kitchen production workspace. An internet connection is required.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: CPU_PWA_THEME_COLOR,
    background_color: CPU_PWA_BACKGROUND_COLOR,
    prefer_related_applications: false,
    icons: [
      { src: "/icons/cpu-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/cpu-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/cpu-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

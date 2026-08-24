import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Via Encanto — Gerador de Imagens",
    short_name: "Via Encanto",
    description: "Gerador de URLs SEO-friendly para imagens de produto.",
    start_url: "/upload",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#0d809d",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}

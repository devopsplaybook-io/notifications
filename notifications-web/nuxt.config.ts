// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  vite: {
    build: {
      cssMinify: "esbuild",
    },
  },
  app: {
    head: {
      charset: "utf-16",
      viewport:
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      title: "Notifications",
      meta: [
        {
          name: "description",
          content: "Notifications - Centralized notification service",
        },
        { name: "theme-color", content: "#1976d2" },
      ],
      link: [
        { rel: "icon", href: "/icon.svg" },
        { rel: "apple-touch-icon", href: "/icon.png" },
        { rel: "stylesheet", href: "/styles.css" },
        { rel: "manifest", href: "/manifest.json" },
      ],
    },
  },
  css: ["~/assets/css/main.css"],
  modules: ["@pinia/nuxt"],
  imports: {
    dirs: ["./stores"],
  },
  pinia: {
    autoImports: ["defineStore", "acceptHMRUpdate"],
  },
});

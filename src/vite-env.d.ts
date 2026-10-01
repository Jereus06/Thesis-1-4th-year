/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DATA_MODE?: "browser-demo" | "api";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

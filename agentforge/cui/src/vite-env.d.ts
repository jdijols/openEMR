/// <reference types="vite/client" />

declare global {
  interface Window {
    __AGENTFORGE_CUI__?: {
      readonly apiBase: string;
    };
  }
}

export {};

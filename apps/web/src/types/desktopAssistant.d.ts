export interface DesktopAssistantApi {
  platform: 'desktop';
}

declare global {
  interface Window {
    desktopAssistant?: DesktopAssistantApi;
  }
}

export {};

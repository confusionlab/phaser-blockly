import { contextBridge } from 'electron';

const assistantDesktopApi = {
  platform: 'desktop' as const,
};

contextBridge.exposeInMainWorld('desktopAssistant', assistantDesktopApi);

export type DesktopAssistantApi = typeof assistantDesktopApi;

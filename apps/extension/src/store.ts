import { create } from 'zustand';

export type ExtensionStatus = 'idle' | 'checking' | 'ready' | 'error';

interface ExtensionStore {
  status: ExtensionStatus;
  lastMessage: string;
  setStatus: (status: ExtensionStatus, lastMessage: string) => void;
}

export const useExtensionStore = create<ExtensionStore>((set) => ({
  status: 'idle',
  lastMessage: 'Extension scaffold ready.',
  setStatus: (status, lastMessage) => set({ status, lastMessage })
}));

import { create } from 'zustand';

export type ExtensionStatus = 'idle' | 'checking' | 'ready' | 'error';
export type RecordingState = 'idle' | 'recording' | 'stopping';

interface ExtensionStore {
  status: ExtensionStatus;
  lastMessage: string;
  setStatus: (status: ExtensionStatus, lastMessage: string) => void;

  recordingState: RecordingState;
  recordingId: string | undefined;
  eventCount: number;
  setRecordingState: (state: RecordingState) => void;
  setRecordingId: (id: string | undefined) => void;
  setEventCount: (count: number) => void;
}

export const useExtensionStore = create<ExtensionStore>((set) => ({
  status: 'idle',
  lastMessage: 'Extension scaffold ready.',
  setStatus: (status, lastMessage) => set({ status, lastMessage }),

  recordingState: 'idle',
  recordingId: undefined,
  eventCount: 0,
  setRecordingState: (recordingState) => set({ recordingState }),
  setRecordingId: (recordingId) => set({ recordingId }),
  setEventCount: (eventCount) => set({ eventCount })
}));

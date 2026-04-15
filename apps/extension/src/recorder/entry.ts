/**
 * Self-executing entry point for the content recorder.
 * Bundled by vite into dist/scripts/content-recorder.js and injected
 * by the service worker via chrome.scripting.executeScript.
 *
 * Receives the tabId + startedAtMs from the SW via a one-time message,
 * installs DOM listeners, and sends captured events back to the SW.
 */

import { ContentRecorder } from './content-recorder.js';

const win = window as Window & { __routineFlowRecorder__?: ContentRecorder };

if (!win.__routineFlowRecorder__) {
  // Listen for the init message from the service worker.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'routineflow.recorder.init') {
      const tabId: string = message.tabId ?? 'unknown';
      const startedAtMs: number = message.startedAtMs ?? Date.now();

      const recorder = new ContentRecorder({
        tabId,
        startedAtMs,
        onEvents(events) {
          // Send events back to the service worker.
          chrome.runtime.sendMessage(
            { type: 'routineflow.recording.events', events },
            () => { void chrome.runtime.lastError; }
          );
        }
      });

      recorder.start();
      win.__routineFlowRecorder__ = recorder;

      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'routineflow.recorder.stop') {
      if (win.__routineFlowRecorder__) {
        win.__routineFlowRecorder__.dispose();
        win.__routineFlowRecorder__ = undefined;
      }
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
}

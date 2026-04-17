import { handleAlarm, rehydrateAlarms } from './scheduler.js';

chrome.runtime.onInstalled.addListener(() => {
  console.info('[RoutineFlow] extension scaffold installed.');
  void rehydrateAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  void rehydrateAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleAlarm(alarm);
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error('[RoutineFlow] failed to set side panel behavior', error);
  });

// ---- Recording session state ----

interface RecordingSession {
  recordingId: string;
  name: string;
  startedAt: string;
  tabIds: Set<string>;
  active: boolean;
  events: Array<Record<string, unknown>>;
  eventCounter: number;
}

let session: RecordingSession | null = null;
let pendingInitTabId: number | null = null;
let pendingInitStartedAtMs = 0;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Chrome forbids extensions from injecting scripts into these origins.
 * Returns a human-readable reason string, or null if the URL is recordable.
 */
function restrictedPageReason(url: string | undefined): string | null {
  if (!url) return 'No URL for the active tab — open a page and try again.';
  if (url.startsWith('chrome://')) return 'Cannot record chrome:// pages — Chrome blocks extensions here.';
  if (url.startsWith('chrome-extension://')) return 'Cannot record other extension pages.';
  if (url.startsWith('edge://') || url.startsWith('about:')) return 'Cannot record browser-internal pages.';
  if (url.startsWith('https://chrome.google.com/webstore') || url.startsWith('https://chromewebstore.google.com')) {
    return 'Cannot record the Chrome Web Store — Chrome blocks extensions here.';
  }
  if (url.startsWith('view-source:')) return 'Cannot record view-source: pages.';
  return null;
}

// ---- Message handler ----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'routineflow.ping') {
    sendResponse({ ok: true, source: 'service-worker' });
    return false;
  }

  if (message?.type === 'routineflow.inject-active-tab') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const [activeTab] = tabs;
      if (!activeTab?.id) {
        sendResponse({ ok: false, message: 'No active tab is available for injection.' });
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['scripts/content-script.js']
        });
        sendResponse({ ok: true, source: 'service-worker', payload: { url: activeTab.url } });
      } catch (error) {
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : 'Content script injection failed.'
        });
      }
    });
    return true;
  }

  if (message?.type === 'routineflow.content-script-ready') {
    sendResponse({ ok: true, source: 'service-worker', payload: message.payload });
    return false;
  }

  // ---- Recording commands ----

  if (message?.type === 'routineflow.content-recorder-ready') {
    console.info('[RoutineFlow] Content recorder ready signal received.');
    if (session?.active && pendingInitTabId !== null) {
      const tabIdNum = pendingInitTabId;
      pendingInitTabId = null;
      console.info('[RoutineFlow] Sending recorder init to tab', tabIdNum);
      chrome.tabs.sendMessage(tabIdNum, {
        type: 'routineflow.recorder.init',
        tabId: String(tabIdNum),
        startedAtMs: pendingInitStartedAtMs
      }, () => { void chrome.runtime.lastError; });
    }
    sendResponse({ ok: true, source: 'service-worker' });
    return false;
  }

  if (message?.type === 'routineflow.recording.start') {
    if (session?.active) {
      sendResponse({ ok: false, message: 'Recording already in progress.' });
      return false;
    }
    const recordingId = generateId('rec');
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    session = {
      recordingId,
      name: message.name ?? 'Untitled recording',
      startedAt,
      tabIds: new Set<string>(),
      active: true,
      events: [],
      eventCounter: 0
    };
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const [activeTab] = tabs;
      const restricted = restrictedPageReason(activeTab?.url);
      if (restricted) {
        session = null;
        sendResponse({ ok: false, message: restricted });
        return;
      }
      if (activeTab?.id) {
        const tabId = String(activeTab.id);
        session!.tabIds.add(tabId);
        try {
          pendingInitTabId = activeTab.id;
          pendingInitStartedAtMs = startedAtMs;
          console.info('[RoutineFlow] Injecting content-recorder into tab', activeTab.id, activeTab.url);
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['scripts/content-recorder.js']
          });
          console.info('[RoutineFlow] Content-recorder injected. Waiting for ready signal (fallback 150ms).');
          setTimeout(() => {
            if (pendingInitTabId === activeTab.id) {
              pendingInitTabId = null;
              console.info('[RoutineFlow] Fallback: sending recorder init directly to tab', activeTab.id);
              chrome.tabs.sendMessage(activeTab.id!, {
                type: 'routineflow.recorder.init',
                tabId,
                startedAtMs
              }, () => { void chrome.runtime.lastError; });
            }
          }, 150);
        } catch (err) {
          console.error('[RoutineFlow] Could not inject recorder:', err);
        }
      }
      sendResponse({
        ok: true,
        source: 'service-worker',
        payload: { recordingId }
      });
    });
    return true;
  }

  if (message?.type === 'routineflow.recording.stop') {
    if (!session?.active) {
      sendResponse({ ok: false, message: 'No active recording.' });
      return false;
    }

    let responded = false;
    function finishStop() {
      if (responded) return;
      responded = true;
      if (!session) {
        sendResponse({ ok: false, message: 'Session already cleared.' });
        return;
      }
      session.active = false;
      const result = {
        recordingId: session.recordingId,
        name: session.name,
        startedAt: session.startedAt,
        events: session.events,
        eventCount: session.events.length
      };
      session = null;
      sendResponse({ ok: true, source: 'service-worker', payload: result });
    }

    // Tell content scripts to stop and flush remaining events.
    const tabIds = [...session.tabIds];
    const stopPromises = tabIds.map(
      (tid) =>
        new Promise<void>((resolve) => {
          try {
            chrome.tabs.sendMessage(Number(tid), { type: 'routineflow.recorder.stop' }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          } catch {
            resolve();
          }
          // Per-tab timeout in case callback never fires.
          setTimeout(resolve, 500);
        })
    );
    void Promise.all(stopPromises).then(() => {
      // Short delay for any final event batches, then respond.
      setTimeout(finishStop, 150);
    });

    // Hard timeout — never hang longer than 2 seconds.
    setTimeout(finishStop, 2000);
    return true;
  }

  if (message?.type === 'routineflow.recording.status') {
    sendResponse({
      ok: true,
      source: 'service-worker',
      payload: session
        ? {
            recordingId: session.recordingId,
            active: session.active,
            eventCount: session.events.length
          }
        : { active: false, eventCount: 0 }
    });
    return false;
  }

  if (message?.type === 'routineflow.recording.events') {
    if (session?.active && Array.isArray(message.events)) {
      console.info('[RoutineFlow] Received', message.events.length, 'event(s). Total:', session.events.length + message.events.length);
      for (const evt of message.events) {
        session.eventCounter++;
        session.events.push({
          ...evt,
          eventId: evt.eventId ?? `evt_${session.eventCounter}`
        });
      }
    } else {
      console.warn('[RoutineFlow] Events received but no active session or events not array.', {
        hasSession: !!session,
        sessionActive: session?.active,
        eventsIsArray: Array.isArray(message.events)
      });
    }
    sendResponse({ ok: true, source: 'service-worker' });
    return false;
  }

  if (message?.type === 'routineflow.schedules.rehydrate') {
    void rehydrateAlarms().then(() => {
      sendResponse({ ok: true, source: 'service-worker' });
    });
    return true;
  }

  sendResponse({ ok: false, message: 'Unsupported message type.' });
  return false;
});

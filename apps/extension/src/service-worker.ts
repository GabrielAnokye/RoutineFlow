chrome.runtime.onInstalled.addListener(() => {
  console.info('[RoutineFlow] extension scaffold installed.');
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

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    // Inject the bundled content-recorder into the active tab, then init it.
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const [activeTab] = tabs;
      if (activeTab?.id) {
        const tabId = String(activeTab.id);
        session!.tabIds.add(tabId);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['scripts/content-recorder.js']
          });
          // Tell the injected recorder to start capturing.
          chrome.tabs.sendMessage(activeTab.id, {
            type: 'routineflow.recorder.init',
            tabId,
            startedAtMs
          }, () => { void chrome.runtime.lastError; });
        } catch (err) {
          console.warn('[RoutineFlow] Could not inject recorder:', err);
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
    // Tell content scripts to stop and flush remaining events.
    const tabIds = [...session.tabIds];
    const stopPromises = tabIds.map(
      (tid) =>
        new Promise<void>((resolve) => {
          chrome.tabs.sendMessage(Number(tid), { type: 'routineflow.recorder.stop' }, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        })
    );
    void Promise.all(stopPromises).then(() => {
      // Give a short delay for any final event batches to arrive.
      setTimeout(() => {
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
      }, 200);
    });
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
      for (const evt of message.events) {
        session.eventCounter++;
        session.events.push({
          ...evt,
          eventId: evt.eventId ?? `evt_${session.eventCounter}`
        });
      }
    }
    sendResponse({ ok: true, source: 'service-worker' });
    return false;
  }

  sendResponse({ ok: false, message: 'Unsupported message type.' });
  return false;
});

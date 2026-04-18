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
  startUrl?: string;
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
        if (activeTab.url) session!.startUrl = activeTab.url;
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
        startUrl: session.startUrl,
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

  // ---- Replay orchestration ----

  if (message?.type === 'routineflow.replay.start') {
    const { workflowId, steps } = message as {
      workflowId: string;
      steps: Array<Record<string, unknown>>;
    };
    void runReplay(workflowId, steps).then((result) => {
      sendResponse({ ok: true, source: 'service-worker', payload: result });
    }).catch((err) => {
      sendResponse({ ok: false, message: err instanceof Error ? err.message : 'Replay failed.' });
    });
    return true;
  }

  if (message?.type === 'routineflow.content-replay-ready') {
    sendResponse({ ok: true, source: 'service-worker' });
    return false;
  }

  sendResponse({ ok: false, message: 'Unsupported message type.' });
  return false;
});

// ---- Replay engine ----

interface ReplayStepResult {
  stepIndex: number;
  stepType: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

async function runReplay(
  workflowId: string,
  steps: Array<Record<string, unknown>>
): Promise<{ workflowId: string; status: string; stepResults: ReplayStepResult[] }> {
  const stepResults: ReplayStepResult[] = [];

  // Find the active tab
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id) {
    throw new Error('No active tab available for replay.');
  }
  let tabId = activeTab.id;
  let replayScriptInjected = false;

  async function ensureReplayScript(tid: number): Promise<void> {
    if (replayScriptInjected) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        files: ['scripts/content-replay.js']
      });
      replayScriptInjected = true;
      // Brief delay for script to initialize
      await new Promise((r) => setTimeout(r, 50));
    } catch (err) {
      console.error('[RoutineFlow] Failed to inject replay script:', err);
      throw new Error('Cannot inject replay script into this tab.');
    }
  }

  async function sendStepToTab(tid: number, step: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tid, { type: 'routineflow.replay.step', step }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve((response as Record<string, unknown>) ?? { ok: false, error: 'No response' });
      });
    });
  }

  async function waitForTabLoad(tid: number, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Tab navigation timed out.'));
      }, timeoutMs);

      function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
        if (updatedTabId === tid && changeInfo.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);

      // Check if already loaded
      chrome.tabs.get(tid, (tab) => {
        if (tab.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

  let prevStepType = '';

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const stepType = step.type as string;
    const startMs = Date.now();

    try {
      // Skip disabled steps
      if (step.enabled === false) continue;

      // Skip waitFor steps that follow a goto or another waitFor — these are
      // compiler-inferred postconditions. The action steps already retry on
      // their own, so these just add unnecessary delay.
      if (stepType === 'waitFor' && (prevStepType === 'goto' || prevStepType === 'waitFor')) {
        stepResults.push({ stepIndex: i, stepType, ok: true, durationMs: 0 });
        prevStepType = stepType;
        continue;
      }

      // --- goto: navigate the tab ---
      if (stepType === 'goto') {
        const url = step.url as string;
        // Always navigate — even same base URL may have different hash/state
        await chrome.tabs.update(tabId, { url });
        await waitForTabLoad(tabId);
        replayScriptInjected = false;
        stepResults.push({ stepIndex: i, stepType, ok: true, durationMs: Date.now() - startMs });
        // Wait for page to render after navigation
        await new Promise((r) => setTimeout(r, 300));
        prevStepType = stepType;
        continue;
      }

      // --- newTab ---
      if (stepType === 'newTab') {
        const newTab = await chrome.tabs.create({
          url: (step.initialUrl as string) ?? 'about:blank',
          active: true
        });
        if (newTab.id) {
          tabId = newTab.id;
          replayScriptInjected = false;
          await waitForTabLoad(tabId);
        }
        stepResults.push({ stepIndex: i, stepType, ok: true, durationMs: Date.now() - startMs });
        prevStepType = stepType;
        continue;
      }

      // --- closeTab ---
      if (stepType === 'closeTab') {
        await chrome.tabs.remove(tabId);
        const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (fallback?.id) {
          tabId = fallback.id;
          replayScriptInjected = false;
        }
        stepResults.push({ stepIndex: i, stepType, ok: true, durationMs: Date.now() - startMs });
        prevStepType = stepType;
        continue;
      }

      // --- Action steps: inject script and execute in page ---
      await ensureReplayScript(tabId);

      // Retry with polling for elements that haven't appeared yet
      let result: Record<string, unknown> = { ok: false, error: 'No attempts made' };
      // waitFor steps get a shorter timeout since they're just checking state
      const defaultTimeout = stepType === 'waitFor' ? 3000 : 5000;
      const maxWaitMs = Math.min((step.timeoutMs as number | undefined) ?? defaultTimeout, defaultTimeout);
      const pollInterval = 150;
      const deadline = Date.now() + maxWaitMs;

      while (Date.now() < deadline) {
        try {
          result = await sendStepToTab(tabId, step);
          if (result.ok) break;
          // If element not found, wait and retry
          if (typeof result.error === 'string' && result.error.includes('locator')) {
            await new Promise((r) => setTimeout(r, pollInterval));
            continue;
          }
          break; // Other errors: don't retry
        } catch {
          // Tab message failed — script may need re-injection after SPA nav
          replayScriptInjected = false;
          await ensureReplayScript(tabId);
          await new Promise((r) => setTimeout(r, pollInterval));
        }
      }

      stepResults.push({
        stepIndex: i,
        stepType,
        ok: !!result.ok,
        ...(result.error ? { error: result.error as string } : {}),
        durationMs: Date.now() - startMs
      });

      if (!result.ok) {
        return { workflowId, status: 'failed', stepResults };
      }

      // Brief pause between steps for visual feedback
      await new Promise((r) => setTimeout(r, 80));

      prevStepType = stepType;
    } catch (err) {
      stepResults.push({
        stepIndex: i,
        stepType,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs
      });
      return { workflowId, status: 'failed', stepResults };
    }
  }

  return { workflowId, status: 'succeeded', stepResults };
}

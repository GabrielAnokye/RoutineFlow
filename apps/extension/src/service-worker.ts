chrome.runtime.onInstalled.addListener(() => {
  console.info('[RoutineFlow] extension scaffold installed.');
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error('[RoutineFlow] failed to set side panel behavior', error);
  });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'routineflow.ping') {
    sendResponse({
      ok: true,
      source: 'service-worker'
    });
    return false;
  }

  if (message?.type === 'routineflow.inject-active-tab') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const [activeTab] = tabs;

      if (!activeTab?.id) {
        sendResponse({
          ok: false,
          message: 'No active tab is available for injection.'
        });
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['scripts/content-script.js']
        });

        sendResponse({
          ok: true,
          source: 'service-worker',
          payload: {
            url: activeTab.url
          }
        });
      } catch (error) {
        sendResponse({
          ok: false,
          message:
            error instanceof Error ? error.message : 'Content script injection failed.'
        });
      }
    });

    return true;
  }

  if (message?.type === 'routineflow.content-script-ready') {
    sendResponse({
      ok: true,
      source: 'service-worker',
      payload: message.payload
    });
    return false;
  }

  sendResponse({
    ok: false,
    message: 'Unsupported message type.'
  });
  return false;
});

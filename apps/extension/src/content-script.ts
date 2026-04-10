const routineFlowWindow = window as Window & {
  __routineFlowInjected__?: boolean;
};

if (!routineFlowWindow.__routineFlowInjected__) {
  routineFlowWindow.__routineFlowInjected__ = true;

  chrome.runtime.sendMessage(
    {
      type: 'routineflow.content-script-ready',
      payload: {
        title: document.title,
        url: window.location.href
      }
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

import { useEffect, useState } from 'react';

import { WORKFLOW_SCHEMA_VERSION } from '@routineflow/shared-types';
import { AppShell } from '@routineflow/ui';

import { resolveExtensionEnv } from './env';
import { useExtensionStore } from './store';

interface RuntimeResponse {
  ok: boolean;
  source?: string;
  message?: string;
  payload?: {
    url?: string;
  };
}

function sendRuntimeMessage(message: unknown): Promise<RuntimeResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response?: RuntimeResponse) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(
        response ?? {
          ok: false,
          message: 'No response was returned by the extension runtime.'
        }
      );
    });
  });
}

export function App() {
  const env = resolveExtensionEnv();
  const { lastMessage, setStatus, status } = useExtensionStore();
  const [extensionVersion, setExtensionVersion] = useState('0.1.0');

  useEffect(() => {
    setExtensionVersion(chrome.runtime.getManifest().version);

    void (async () => {
      try {
        setStatus('checking', 'Pinging the extension service worker.');
        const response = await sendRuntimeMessage({ type: 'routineflow.ping' });

        setStatus(
          response.ok ? 'ready' : 'error',
          response.ok
            ? 'Service worker is reachable.'
            : response.message ?? 'Service worker did not reply.'
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Service worker ping failed.';

        setStatus('error', message);
      }
    })();
  }, [setStatus]);

  async function injectActiveTab() {
    try {
      setStatus('checking', 'Injecting the content script into the active tab.');
      const response = await sendRuntimeMessage({
        type: 'routineflow.inject-active-tab'
      });

      setStatus(
        response.ok ? 'ready' : 'error',
        response.ok
          ? `Content script injected for ${response.payload?.url ?? 'the active tab'}.`
          : response.message ?? 'Unable to inject the active tab.'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Active tab injection failed.';

      setStatus('error', message);
    }
  }

  return (
    <AppShell
      title="Morning setup scaffold"
      subtitle="React + Vite side panel for local-first browser automation."
      actions={
        <button className="rf-button" onClick={() => void injectActiveTab()}>
          Inject active tab
        </button>
      }
    >
      <section className="rf-card">
        <div className="rf-grid">
          <div>
            <p className="rf-label">Extension name</p>
            <p className="rf-value">{env.VITE_ROUTINEFLOW_NAME}</p>
          </div>
          <div>
            <p className="rf-label">Extension version</p>
            <p className="rf-value">{extensionVersion}</p>
          </div>
          <div>
            <p className="rf-label">Runner base URL</p>
            <p className="rf-value">{env.VITE_RUNNER_BASE_URL}</p>
          </div>
          <div>
            <p className="rf-label">Workflow schema</p>
            <p className="rf-value">v{WORKFLOW_SCHEMA_VERSION}</p>
          </div>
        </div>
      </section>

      <section className="rf-card">
        <p className="rf-label">Bridge status</p>
        <p className={`rf-status rf-status--${status}`}>{status}</p>
        <p className="rf-message">{lastMessage}</p>
      </section>
    </AppShell>
  );
}

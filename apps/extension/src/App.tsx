import { useEffect, useState } from 'react';

import { WORKFLOW_SCHEMA_VERSION } from '@routineflow/shared-types';
import { AppShell } from '@routineflow/ui';

import { resolveExtensionEnv } from './env';
import { useExtensionStore } from './store';

interface RuntimeResponse {
  ok: boolean;
  source?: string;
  message?: string;
  payload?: Record<string, unknown>;
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
  const {
    lastMessage, setStatus, status,
    recordingState, recordingId, eventCount,
    setRecordingState, setRecordingId, setEventCount
  } = useExtensionStore();
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

  async function startRecording() {
    try {
      setRecordingState('recording');
      setEventCount(0);
      const response = await sendRuntimeMessage({
        type: 'routineflow.recording.start',
        name: `Recording ${new Date().toLocaleTimeString()}`
      });
      if (response.ok && response.payload) {
        setRecordingId(response.payload.recordingId as string);
        setStatus('ready', 'Recording started.');
      } else {
        setRecordingState('idle');
        setStatus('error', response.message ?? 'Failed to start recording.');
      }
    } catch (error) {
      setRecordingState('idle');
      setStatus('error', error instanceof Error ? error.message : 'Failed to start recording.');
    }
  }

  async function stopRecording() {
    try {
      setRecordingState('stopping');
      const response = await sendRuntimeMessage({ type: 'routineflow.recording.stop' });
      setRecordingState('idle');
      if (response.ok && response.payload) {
        const count = (response.payload.eventCount as number) ?? 0;
        setEventCount(count);
        setStatus('ready', `Recording stopped. ${count} event(s) captured.`);
      } else {
        setStatus('error', response.message ?? 'Failed to stop recording.');
      }
    } catch (error) {
      setRecordingState('idle');
      setStatus('error', error instanceof Error ? error.message : 'Failed to stop recording.');
    }
  }

  return (
    <AppShell
      title="RoutineFlow"
      subtitle="Local-first browser automation recorder."
      actions={
        recordingState === 'recording' ? (
          <button className="rf-button rf-button--danger" onClick={() => void stopRecording()}>
            Stop recording
          </button>
        ) : (
          <button
            className="rf-button"
            onClick={() => void startRecording()}
            disabled={recordingState === 'stopping'}
          >
            {recordingState === 'stopping' ? 'Stopping...' : 'Start recording'}
          </button>
        )
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

      {recordingState === 'recording' && (
        <section className="rf-card">
          <p className="rf-label">Recording</p>
          <p className="rf-value">{recordingId ?? '...'}</p>
          <p className="rf-message">Events captured: {eventCount}</p>
        </section>
      )}

      <section className="rf-card">
        <p className="rf-label">Bridge status</p>
        <p className={`rf-status rf-status--${status}`}>{status}</p>
        <p className="rf-message">{lastMessage}</p>
      </section>
    </AppShell>
  );
}

import { useCallback, useEffect, useRef } from 'react';

import { api } from '../api';
import { useExtensionStore } from '../store';

export function WorkflowListView() {
  const {
    workflows, workflowOrder, setWorkflows, updateWorkflowInStore, removeWorkflow,
    setView, setSelectedRunId, setSelectedWorkflowId,
    runs, setRuns,
    loading, setLoading,
    recordingState, recordingId, eventCount,
    rerecordContext, setRerecordContext,
    setRecordingState, setRecordingId, setEventCount, setStatus
  } = useExtensionStore();

  // Poll event count while recording.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (recordingState === 'recording') {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await api.getRecordingStatus();
          if (res.ok && res.payload) {
            setEventCount(res.payload.eventCount);
          }
        } catch { /* ignore */ }
      }, 1000);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [recordingState, setEventCount]);

  const fetchWorkflows = useCallback(async () => {
    setLoading('workflows', true);
    try {
      const { workflows: list } = await api.listWorkflows();
      setWorkflows(list);
    } catch {
      /* silent — runner may be offline */
    } finally {
      setLoading('workflows', false);
    }
  }, [setWorkflows, setLoading]);

  const fetchRuns = useCallback(async () => {
    try {
      const { runs: list } = await api.listRuns();
      setRuns(list);
    } catch {
      /* silent */
    }
  }, [setRuns]);

  useEffect(() => {
    void fetchWorkflows();
    void fetchRuns();
  }, [fetchWorkflows, fetchRuns]);

  async function startRecording() {
    try {
      setRecordingState('recording');
      setEventCount(0);
      const response = await api.startRecording(
        `Recording ${new Date().toLocaleTimeString()}`
      );
      if (response.ok && response.payload) {
        setRecordingId(response.payload.recordingId);
        setStatus('ready', 'Recording started.');
      } else {
        setRecordingState('idle');
        setStatus('error', response.message ?? 'Failed to start recording.');
      }
    } catch (err) {
      setRecordingState('idle');
      setStatus('error', err instanceof Error ? err.message : 'Recording failed.');
    }
  }

  async function stopRecording() {
    try {
      setRecordingState('stopping');
      const response = await api.stopRecording();
      if (response.ok && response.payload) {
        const { recordingId: recId, name, startedAt, startUrl, events, eventCount: count } = response.payload;
        setEventCount(count ?? 0);

        const spliceCtx = rerecordContext;
        setRerecordContext(undefined);

        try {
          if (spliceCtx) {
            // Splice: compile new events and replace steps from the given index
            const result = await api.spliceWorkflow(spliceCtx.workflowId, {
              fromStepIndex: spliceCtx.fromStepIndex,
              recording: { recordingId: recId, name, startedAt, ...(startUrl ? { startUrl } : {}), events }
            });
            setRecordingState('idle');
            setStatus(
              'ready',
              `Workflow updated (v${result.workflowVersion}). ${result.stepsReplaced} step(s) replaced from step ${spliceCtx.fromStepIndex + 1}.`
            );
            void fetchWorkflows();
            // Navigate back to the editor for the updated workflow
            setSelectedWorkflowId(spliceCtx.workflowId);
            setView('workflow-editor');
          } else {
            // Normal: create a new workflow from the recording
            const result = await api.saveRecording({
              recordingId: recId,
              name,
              startedAt,
              ...(startUrl ? { startUrl } : {}),
              events
            });
            setRecordingState('idle');
            setStatus('ready', `Workflow created (${result.workflowId}). ${count} event(s) compiled.`);
            void fetchWorkflows();
          }
        } catch (saveErr) {
          setRecordingState('idle');
          setStatus(
            'error',
            `Recording stopped (${count} events) but failed to save: ${saveErr instanceof Error ? saveErr.message : 'Unknown error'}. Is the runner running?`
          );
        }
      } else {
        setRecordingState('idle');
        setRerecordContext(undefined);
        setStatus('error', response.message ?? 'Failed to stop recording.');
      }
    } catch (err) {
      setRecordingState('idle');
      setRerecordContext(undefined);
      setStatus('error', err instanceof Error ? err.message : 'Stop failed.');
    }
  }

  async function handleRun(workflowId: string) {
    try {
      setStatus('ready', 'Replaying workflow in current tab...');
      // Fetch workflow definition to get steps
      const { workflow } = await api.getWorkflowDefinition(workflowId);
      const response = await api.replayWorkflow(workflowId, workflow.steps);
      if (response.ok && response.payload) {
        const { status, stepResults } = response.payload;
        const passed = stepResults.filter((s) => s.ok).length;
        const total = stepResults.length;
        if (status === 'succeeded') {
          setStatus('ready', `Replay succeeded: ${passed}/${total} steps passed.`);
        } else {
          const failed = stepResults.find((s) => !s.ok);
          setStatus('error', `Replay failed at step ${(failed?.stepIndex ?? 0) + 1} (${failed?.stepType}): ${failed?.error ?? 'unknown'}`);
        }
      } else {
        setStatus('error', response.message ?? 'Replay failed.');
      }
      void fetchRuns();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Run failed.');
    }
  }

  async function handleDelete(workflowId: string) {
    try {
      await api.deleteWorkflow(workflowId);
      removeWorkflow(workflowId);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  async function handleDuplicate(workflowId: string) {
    try {
      await api.duplicateWorkflow(workflowId);
      void fetchWorkflows();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Duplicate failed.');
    }
  }

  async function handleRename(workflowId: string, name: string) {
    try {
      const updated = await api.updateWorkflow(workflowId, { name });
      updateWorkflowInStore(updated);
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Rename failed.');
    }
  }

  const recentRuns = (workflowId: string) =>
    Object.values(runs).filter((r) => r.workflowId === workflowId).slice(0, 3);

  return (
    <>
      {/* Recording controls */}
      <section className="rf-card">
        {recordingState === 'recording' ? (
          <>
            <p className="rf-label">Recording in progress</p>
            <p className="rf-value">{recordingId ?? '...'}</p>
            <p className="rf-message">Events: {eventCount}</p>
            <button
              className="rf-button rf-button--danger"
              onClick={() => void stopRecording()}
              style={{ marginTop: 8 }}
            >
              Stop recording
            </button>
          </>
        ) : (
          <button
            className="rf-button"
            onClick={() => void startRecording()}
            disabled={recordingState === 'stopping'}
            style={{ width: '100%' }}
          >
            {recordingState === 'stopping' ? 'Stopping...' : 'New recording'}
          </button>
        )}
      </section>

      {/* Workflow list */}
      {loading.workflows ? (
        <p className="rf-message">Loading workflows...</p>
      ) : workflowOrder.length === 0 ? (
        <section className="rf-card">
          <p className="rf-message">
            No workflows yet. Start a recording to create one.
          </p>
        </section>
      ) : (
        workflowOrder.map((id) => {
          const wf = workflows[id];
          if (!wf) return null;
          const wfRuns = recentRuns(id);
          return (
            <section key={id} className="rf-card">
              <p className="rf-label">{wf.name}</p>
              {wf.description && (
                <p className="rf-message" style={{ marginBottom: 8 }}>
                  {wf.description}
                </p>
              )}
              <div className="rf-grid" style={{ marginBottom: 8 }}>
                <div>
                  <p className="rf-label">Version</p>
                  <p className="rf-value">v{wf.latestVersion}</p>
                </div>
                <div>
                  <p className="rf-label">Updated</p>
                  <p className="rf-value">
                    {new Date(wf.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {wfRuns.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <p className="rf-label">Recent runs</p>
                  {wfRuns.map((r) => (
                    <p
                      key={r.id}
                      className="rf-message"
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => {
                        setSelectedRunId(r.id);
                        setView('run-detail');
                      }}
                    >
                      {r.status} - {new Date(r.startedAt).toLocaleString()}
                    </p>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="rf-button"
                  onClick={() => void handleRun(id)}
                >
                  Run
                </button>
                <button
                  className="rf-button"
                  onClick={() => {
                    setSelectedWorkflowId(id);
                    setView('workflow-editor');
                  }}
                >
                  Edit
                </button>
                <button
                  className="rf-button"
                  onClick={() => {
                    const name = prompt('New name:', wf.name);
                    if (name && name !== wf.name) void handleRename(id, name);
                  }}
                >
                  Rename
                </button>
                <button
                  className="rf-button"
                  onClick={() => void handleDuplicate(id)}
                >
                  Duplicate
                </button>
                <button
                  className="rf-button rf-button--danger"
                  onClick={() => {
                    if (confirm(`Delete "${wf.name}"?`)) void handleDelete(id);
                  }}
                >
                  Delete
                </button>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}

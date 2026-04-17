import { describe, expect, it } from 'vitest';

import { SampleWorkflow, createWorkflowVersion } from '@routineflow/shared-types';

import {
  INITIAL_SCHEMA_SQL,
  createDevelopmentSeedBundle,
  openRoutineFlowDatabase,
  seedDevelopmentData
} from './index.js';

describe('SQLite migrations', () => {
  it('creates the expected core tables', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const tables = database.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC"
      )
      .all()
      .map((row) => String((row as { name: string }).name));

    expect(INITIAL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS workflows');
    expect(tables).toEqual(
      expect.arrayContaining([
        'artifacts',
        'auth_profiles',
        'migrations',
        'run_steps',
        'runs',
        'schedules',
        'settings',
        'workflow_versions',
        'workflows'
      ])
    );

    database.close();
  });
});

describe('RoutineFlowRepository', () => {
  it('persists workflows and immutable workflow versions', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const workflowVersion = createWorkflowVersion(SampleWorkflow, {
      id: 'wfv_morning_setup_v1',
      createdAt: '2026-03-09T12:00:00.000Z',
      createdBy: 'system'
    });

    database.repository.saveWorkflowVersion(workflowVersion);

    const workflow = database.repository.getWorkflow(SampleWorkflow.workflowId);
    const loadedVersion = database.repository.getWorkflowVersion(
      SampleWorkflow.workflowId,
      SampleWorkflow.workflowVersion
    );

    expect(workflow?.latestVersion).toBe(1);
    expect(loadedVersion?.definition.steps[2]?.type).toBe('click');

    database.close();
  });

  it('writes runs, step results, and artifacts atomically', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const seedBundle = createDevelopmentSeedBundle();

    database.repository.upsertAuthProfile(seedBundle.authProfile);
    database.repository.saveWorkflowVersion(seedBundle.workflowVersion);
    database.repository.upsertSchedule(seedBundle.schedule);
    database.repository.saveRunGraph(seedBundle.runGraph);

    const runGraph = database.repository.getRunGraph(seedBundle.runGraph.run.id);

    expect(runGraph?.steps).toHaveLength(seedBundle.runGraph.steps.length);
    expect(runGraph?.artifacts).toHaveLength(seedBundle.runGraph.artifacts.length);
    expect(runGraph?.run.status).toBe('succeeded');

    database.close();
  });

  it('rolls back transaction-scoped writes when an error occurs', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const seedBundle = createDevelopmentSeedBundle();

    database.repository.saveWorkflowVersion(seedBundle.workflowVersion);

    expect(() =>
      database.repository.transaction(() => {
        database.repository.upsertSchedule(seedBundle.schedule);
        throw new Error('force rollback');
      })
    ).toThrow('force rollback');

    expect(database.repository.listSchedules()).toHaveLength(0);

    database.close();
  });
});

describe('RoutineFlowRepository — edge cases', () => {
  it('saveWorkflowDefinition creates workflow record and version atomically', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const wf = { ...SampleWorkflow, workflowId: 'wf_edge_1' };
    const version = database.repository.saveWorkflowDefinition(wf, {
      changeSummary: 'Initial version'
    });

    expect(version.workflowId).toBe('wf_edge_1');
    expect(version.version).toBe(1);

    const record = database.repository.getWorkflow('wf_edge_1');
    expect(record).not.toBeNull();
    expect(record!.name).toBe(wf.name);
    expect(record!.latestVersion).toBe(1);

    database.close();
  });

  it('saveWorkflowDefinition increments version on second save', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const wf = { ...SampleWorkflow, workflowId: 'wf_edge_2' };

    database.repository.saveWorkflowDefinition(wf, {});
    const v2 = database.repository.saveWorkflowDefinition(
      { ...wf, workflowVersion: 2 },
      { changeSummary: 'v2' }
    );

    expect(v2.version).toBe(2);
    const record = database.repository.getWorkflow('wf_edge_2');
    expect(record!.latestVersion).toBe(2);

    database.close();
  });

  it('getLatestWorkflowDefinition returns most recent version', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const wf1 = { ...SampleWorkflow, workflowId: 'wf_latest', name: 'Version 1' };
    const wf2 = { ...wf1, workflowVersion: 2, name: 'Version 2' };

    database.repository.saveWorkflowDefinition(wf1, {});
    database.repository.saveWorkflowDefinition(wf2, {});

    const latest = database.repository.getLatestWorkflowDefinition('wf_latest');
    expect(latest).not.toBeNull();
    expect(latest!.name).toBe('Version 2');

    database.close();
  });

  it('listWorkflowVersions returns versions in descending order', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const wf = { ...SampleWorkflow, workflowId: 'wf_versions' };

    database.repository.saveWorkflowDefinition(wf, { changeSummary: 'v1' });
    database.repository.saveWorkflowDefinition(
      { ...wf, workflowVersion: 2 },
      { changeSummary: 'v2' }
    );
    database.repository.saveWorkflowDefinition(
      { ...wf, workflowVersion: 3 },
      { changeSummary: 'v3' }
    );

    const versions = database.repository.listWorkflowVersions('wf_versions');
    expect(versions).toHaveLength(3);
    expect(versions[0]!.version).toBe(3);
    expect(versions[2]!.version).toBe(1);

    database.close();
  });

  it('updateWorkflow updates name and tags', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const wf = { ...SampleWorkflow, workflowId: 'wf_update' };
    database.repository.saveWorkflowDefinition(wf, {});

    database.repository.updateWorkflow('wf_update', {
      name: 'New name',
      tags: ['production', 'critical']
    });

    const record = database.repository.getWorkflow('wf_update');
    expect(record!.name).toBe('New name');
    expect(record!.tags).toEqual(['production', 'critical']);

    database.close();
  });

  it('deleteWorkflow removes workflow and related versions', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const wf = { ...SampleWorkflow, workflowId: 'wf_delete' };
    database.repository.saveWorkflowDefinition(wf, {});

    database.repository.deleteWorkflow('wf_delete');

    expect(database.repository.getWorkflow('wf_delete')).toBeNull();
    expect(database.repository.listWorkflowVersions('wf_delete')).toHaveLength(0);

    database.close();
  });

  it('setSetting stores and retrieves key-value pairs', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const now = '2026-04-15T00:00:00.000Z';

    database.repository.setSetting({ key: 'theme', value: 'dark', updatedAt: now });
    database.repository.setSetting({ key: 'lang', value: 'en', updatedAt: now });

    const settings = database.repository.listSettings();
    expect(settings).toHaveLength(2);

    database.repository.setSetting({ key: 'theme', value: 'light', updatedAt: now });
    const updated = database.repository.listSettings();
    const theme = updated.find(s => s.key === 'theme');
    expect(theme!.value).toBe('light');

    database.close();
  });

  it('saveRunGraph + getRunGraph round-trips all fields', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const seedBundle = createDevelopmentSeedBundle();
    database.repository.upsertAuthProfile(seedBundle.authProfile);
    database.repository.saveWorkflowVersion(seedBundle.workflowVersion);
    database.repository.upsertSchedule(seedBundle.schedule);
    database.repository.saveRunGraph(seedBundle.runGraph);

    const graph = database.repository.getRunGraph(seedBundle.runGraph.run.id);
    expect(graph).not.toBeNull();
    expect(graph!.run.id).toBe(seedBundle.runGraph.run.id);
    expect(graph!.run.status).toBe(seedBundle.runGraph.run.status);
    expect(graph!.steps).toHaveLength(seedBundle.runGraph.steps.length);
    expect(graph!.artifacts).toHaveLength(seedBundle.runGraph.artifacts.length);

    // Verify step fields round-trip
    const step = graph!.steps[0]!;
    const origStep = seedBundle.runGraph.steps[0]!;
    expect(step.stepType).toBe(origStep.stepType);
    expect(step.status).toBe(origStep.status);

    database.close();
  });

  it('returns null for non-existent entities', () => {
    const database = openRoutineFlowDatabase(':memory:');

    expect(database.repository.getWorkflow('nonexistent')).toBeNull();
    expect(database.repository.getLatestWorkflowDefinition('nonexistent')).toBeNull();
    expect(database.repository.getRunGraph('nonexistent')).toBeNull();

    database.close();
  });
});

describe('seedDevelopmentData', () => {
  it('seeds workflows, auth profiles, schedules, runs, and settings', () => {
    const database = openRoutineFlowDatabase(':memory:');
    const seedBundle = seedDevelopmentData(database.repository);

    expect(database.repository.listWorkflows()).toHaveLength(1);
    expect(database.repository.listAuthProfiles()).toHaveLength(1);
    expect(database.repository.listSchedules()).toHaveLength(1);
    expect(
      database.repository.listRunsForWorkflow(seedBundle.workflow.workflowId)
    ).toHaveLength(1);
    expect(database.repository.listSettings()).toHaveLength(2);

    database.close();
  });
});

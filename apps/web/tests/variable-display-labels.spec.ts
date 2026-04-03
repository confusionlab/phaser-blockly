import { expect, test } from '@playwright/test';
import { buildVariableDisplayLabelMap } from '../src/lib/variableUtils';
import type { Variable } from '../src/types';

test.describe('variable display labels', () => {
  test('uses plain names when there is no naming conflict', () => {
    const variables: Variable[] = [
      {
        id: 'global-score',
        name: 'score',
        type: 'number',
        cardinality: 'single',
        defaultValue: 0,
        scope: 'global',
      },
      {
        id: 'local-ready',
        name: 'ready',
        type: 'boolean',
        cardinality: 'single',
        defaultValue: false,
        scope: 'local',
      },
    ];

    const labels = buildVariableDisplayLabelMap(variables, {
      globalContextLabel: 'project',
      localContextLabel: 'here',
    });

    expect(labels.get('global-score')).toBe('score');
    expect(labels.get('local-ready')).toBe('ready');
  });

  test('only disambiguates conflicting names with friendly context labels', () => {
    const variables: Variable[] = [
      {
        id: 'global-score',
        name: 'score',
        type: 'number',
        cardinality: 'single',
        defaultValue: 0,
        scope: 'global',
      },
      {
        id: 'local-score',
        name: 'score',
        type: 'string',
        cardinality: 'array',
        defaultValue: [],
        scope: 'local',
      },
    ];

    const labels = buildVariableDisplayLabelMap(variables, {
      globalContextLabel: 'project',
      localContextLabel: 'here',
    });

    expect(labels.get('global-score')).toBe('score (project)');
    expect(labels.get('local-score')).toBe('score (here)');
  });
});

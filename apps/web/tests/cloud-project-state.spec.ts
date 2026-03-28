import { expect, test } from '@playwright/test';

import { doesLocalProjectMatchCloudHead } from '../src/lib/cloudProjectState';

test.describe('cloud project state', () => {
  test('treats matching schema and content as already current', () => {
    expect(
      doesLocalProjectMatchCloudHead({
        localSchemaVersion: 10,
        localContentHash: 'aaaaaaaaaaaaaaaa',
        cloudSchemaVersion: 10,
        cloudContentHash: 'aaaaaaaaaaaaaaaa',
        migrated: false,
      }),
    ).toBe(true);
  });

  test('keeps divergent local content marked as needing a push', () => {
    expect(
      doesLocalProjectMatchCloudHead({
        localSchemaVersion: 10,
        localContentHash: 'bbbbbbbbbbbbbbbb',
        cloudSchemaVersion: 10,
        cloudContentHash: 'aaaaaaaaaaaaaaaa',
        migrated: false,
      }),
    ).toBe(false);
  });

  test('treats migrated cloud data as needing a save back to cloud', () => {
    expect(
      doesLocalProjectMatchCloudHead({
        localSchemaVersion: 10,
        localContentHash: 'aaaaaaaaaaaaaaaa',
        cloudSchemaVersion: 9,
        cloudContentHash: 'aaaaaaaaaaaaaaaa',
        migrated: true,
      }),
    ).toBe(false);
  });
});

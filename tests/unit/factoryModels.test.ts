import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getFactoryDefaultModelId,
  getFactoryModels,
  resetDroidModelCatalog,
  setDroidModelCatalog,
  subscribeFactoryModelCatalog,
  type FactoryModel,
} from '../../src/common/config/factoryModels';

const RUNTIME_CATALOG: FactoryModel[] = [
  {
    id: 'model-a',
    name: 'Model A',
    reasoningLevels: ['low', 'medium'],
    defaultReasoning: 'medium',
  },
  {
    id: 'model-b',
    name: 'Model B',
    reasoningLevels: ['none'],
    defaultReasoning: 'none',
  },
];

afterEach(() => {
  resetDroidModelCatalog();
});

describe('factoryModels runtime catalog', () => {
  it('replaces the active catalog so omitted models disappear immediately', () => {
    setDroidModelCatalog(RUNTIME_CATALOG);
    expect(getFactoryModels().map((model) => model.id)).toEqual(['model-a', 'model-b']);

    setDroidModelCatalog([RUNTIME_CATALOG[1]]);

    expect(getFactoryModels().map((model) => model.id)).toEqual(['model-b']);
    expect(getFactoryDefaultModelId()).toBe('model-b');
  });

  it('notifies subscribers only when the catalog actually changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFactoryModelCatalog(listener);

    setDroidModelCatalog(RUNTIME_CATALOG);
    setDroidModelCatalog(RUNTIME_CATALOG);
    setDroidModelCatalog([RUNTIME_CATALOG[1]]);

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

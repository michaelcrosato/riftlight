/** Every cluster template, in one registry (generators query it by tags). */
import { Registry } from '../../core/registry';
import type { ClusterTemplate, NotableDef } from '../types';
import { GRACE_CLUSTERS } from './clusters-grace';
import { MIGHT_CLUSTERS } from './clusters-might';
import { WIT_CLUSTERS } from './clusters-wit';

export const CLUSTERS = new Registry<ClusterTemplate>('cluster', [...MIGHT_CLUSTERS, ...GRACE_CLUSTERS, ...WIT_CLUSTERS]);

/** Every notable, by id (duplicate ids across templates throw). */
export const NOTABLES = new Registry<NotableDef>(
  'notable',
  CLUSTERS.all().flatMap((c) => c.notables),
);

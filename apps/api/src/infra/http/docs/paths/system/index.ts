import { healthCheckPath } from './health-check.path';
import { readinessPath } from './readiness.path';

export const systemPaths = {
  ...healthCheckPath,
  ...readinessPath
};

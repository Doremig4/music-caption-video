import {availableParallelism} from 'node:os';
import {Config} from '@remotion/cli/config';

// Measured on this project's 10-core Mac. CLI --concurrency can override this.
Config.setConcurrency(Math.min(5, availableParallelism()));

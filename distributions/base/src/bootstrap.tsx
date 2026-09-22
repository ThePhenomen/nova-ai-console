import { createDistribution } from './createDistribution';

// The bare shell renders without any contributed features — distribution layers
// such as `distributions/nova-ai` call `createDistribution` with their own extensions.
createDistribution({ extensions: {} });

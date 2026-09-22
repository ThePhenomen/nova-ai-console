import type { AnyObject, CodeRef } from './sdk-types';

export type ComponentCodeRef<Props = AnyObject> = CodeRef<{ default: React.ComponentType<Props> }>;

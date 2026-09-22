/**
 * Plugin extension types and store contract.
 */

export type AnyObject = Record<string, unknown>;

export type CodeRef<TValue = unknown> = () => Promise<TValue>;

export type FeatureFlags = Record<string, boolean>;

export type ExtensionFlags = {
  required?: string[];
  disallowed?: string[];
};

export type Extension<TType extends string = string, TProperties extends AnyObject = AnyObject> = {
  type: TType;
  properties: TProperties;
  flags?: ExtensionFlags;
};

export type LoadedExtension<TExtension extends Extension = Extension> = TExtension & {
  pluginName: string;
  uid: string;
};

type ResolvedCodeRef<T> = T extends CodeRef<infer TValue> ? TValue : T;

export type ResolvedExtension<TExtension extends Extension = Extension> =
  TExtension extends Extension<infer TType, infer TProperties>
    ? Extension<TType, { [K in keyof TProperties]: ResolvedCodeRef<TProperties[K]> }>
    : never;

export type ExtensionPredicate<TExtension extends Extension = Extension> = (
  extension: Extension,
) => extension is TExtension;

export enum PluginEventType {
  ExtensionsChanged = 'ExtensionsChanged',
  PluginInfoChanged = 'PluginInfoChanged',
  FeatureFlagsChanged = 'FeatureFlagsChanged',
}

export type PluginInfoEntry = {
  pluginName: string;
  status: string;
};

export type PluginStoreInterface = {
  readonly sdkVersion: string;
  subscribe: (eventTypes: PluginEventType[], listener: VoidFunction) => VoidFunction;
  getExtensions: () => LoadedExtension[];
  getFeatureFlags: () => FeatureFlags;
  setFeatureFlags: (newFlags: FeatureFlags) => void;
};

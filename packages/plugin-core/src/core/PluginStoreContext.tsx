import * as React from 'react';
import type {
  Extension,
  ExtensionPredicate,
  LoadedExtension,
  PluginStoreInterface,
} from './sdk-types';
import { PluginEventType } from './sdk-types';

const PluginStoreContext = React.createContext<PluginStoreInterface | null>(null);

type PluginStoreProviderProps = {
  store: PluginStoreInterface;
  children?: React.ReactNode;
};

export const PluginStoreProvider: React.FC<PluginStoreProviderProps> = ({ store, children }) => (
  <PluginStoreContext.Provider value={store}>{children}</PluginStoreContext.Provider>
);

export const usePluginStore = (): PluginStoreInterface => {
  const store = React.useContext(PluginStoreContext);
  if (!store) {
    throw new Error('usePluginStore must be used within a PluginStoreProvider');
  }
  return store;
};

export const useExtensions = <TExtension extends Extension>(
  predicate?: ExtensionPredicate<TExtension>,
): LoadedExtension<TExtension>[] => {
  const store = usePluginStore();
  const [extensions, setExtensions] = React.useState(() => store.getExtensions());

  React.useEffect(() => {
    setExtensions(store.getExtensions());
    return store.subscribe([PluginEventType.ExtensionsChanged], () => {
      setExtensions(store.getExtensions());
    });
  }, [store]);

  return React.useMemo(() => {
    const matching = predicate ? extensions.filter(predicate) : extensions;
    return matching as LoadedExtension<TExtension>[];
  }, [extensions, predicate]);
};

export const useFeatureFlag = (name: string): [boolean, (value: boolean) => void] => {
  const store = usePluginStore();
  const [flags, setFlags] = React.useState(() => store.getFeatureFlags());

  React.useEffect(() => {
    setFlags(store.getFeatureFlags());
    return store.subscribe([PluginEventType.FeatureFlagsChanged], () => {
      setFlags(store.getFeatureFlags());
    });
  }, [store]);

  const setFlag = React.useCallback(
    (value: boolean) => {
      store.setFeatureFlags({ [name]: value });
    },
    [store, name],
  );

  return [flags[name] === true, setFlag];
};

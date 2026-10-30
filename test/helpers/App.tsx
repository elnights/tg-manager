import React, {type ComponentProps} from 'react';
import {App as Application} from '../../src/App.js';

// Terminal regressions never read or write the developer's real settings.
const memorySettings = {read: () => 32, write: (_value: number) => {}};
export function App(props: ComponentProps<typeof Application>) {
  return <Application settings={memorySettings} {...props} />;
}

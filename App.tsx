import React, {useEffect} from 'react';
import {installPluginRouter} from './src/pluginRouter';
import CalcPanel from './src/CalcPanel';
import {PluginManager} from 'sn-plugin-lib';

installPluginRouter();

export default function App() {
  useEffect(() => {
    const sub = PluginManager.addPluginLifeListener({
      onStart() {},
      onStop() {},
    });
    return () => sub.remove();
  }, []);

  return <CalcPanel />;
}

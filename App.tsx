import React, {useEffect, useState} from 'react';
import {installPluginRouter, subscribeToButtonEvents} from './src/pluginRouter';
import CalcPanel from './src/CalcPanelPro';
import {PluginManager} from 'sn-plugin-lib';

installPluginRouter();

const MANTA_SCALE = 1920 / 1404;

export default function App() {
  const [scale, setScale] = useState<number | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    const sub = PluginManager.addPluginLifeListener({onStart() {}, onStop() {}});
    PluginManager.getDeviceType()
      .then(t => setScale(t === 5 ? MANTA_SCALE : 1))
      .catch(() => setScale(1));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return subscribeToButtonEvents(() => setSessionKey(k => k + 1));
  }, []);

  if (scale === null) return null;
  return <CalcPanel key={sessionKey} scale={scale} />;
}

import React, {useEffect, useState} from 'react';
import {
  BUTTON_ID_LASSO,
  BUTTON_ID_TOOLBAR,
  consumeLastButtonEvent,
  installPluginRouter,
  subscribeToButtonEvents,
} from './src/pluginRouter';
import CalcPanel from './src/CalcPanelPro';
import LassoCalcAction from './src/LassoCalcAction';
import {PluginManager} from 'sn-plugin-lib';

installPluginRouter();

const MANTA_SCALE = 1920 / 1404;

export default function App() {
  const [scale, setScale] = useState<number | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [view, setView] = useState<'calculator' | 'lasso-calc'>('calculator');
  const [initialExpression, setInitialExpression] = useState('');

  useEffect(() => {
    const sub = PluginManager.addPluginLifeListener({onStart() {}, onStop() {}});
    PluginManager.getDeviceType()
      .then(t => {
        const deviceType = typeof t === 'number' ? t : (t as any)?.result;
        setScale(deviceType === 5 ? MANTA_SCALE : 1);
      })
      .catch(() => setScale(1));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const pending = consumeLastButtonEvent();
    if (pending?.id === BUTTON_ID_LASSO) {
      setView('lasso-calc');
      setSessionKey(k => k + 1);
    }

    return subscribeToButtonEvents(event => {
      if (event.id === BUTTON_ID_LASSO) {
        setView('lasso-calc');
      } else if (event.id === BUTTON_ID_TOOLBAR) {
        setInitialExpression('');
        setView('calculator');
      }
      setSessionKey(k => k + 1);
    });
  }, []);

  const handleOpenCalculator = (expression: string) => {
    setInitialExpression(expression);
    setView('calculator');
    setSessionKey(k => k + 1);
  };

  if (scale === null) return null;
  if (view === 'lasso-calc') return <LassoCalcAction key={sessionKey} onOpenCalculator={handleOpenCalculator} />;
  return <CalcPanel key={sessionKey} scale={scale} initialExpression={initialExpression} />;
}

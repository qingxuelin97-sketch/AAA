import React, { useEffect, useState } from 'react';
import { restoreAuthSession } from './api.jsx';
import { runBootstrapTasks } from './appBootstrapCore.js';

let nativeBootstrapPromise = null;

async function bootstrapNative() {
  let native;
  return runBootstrapTasks({
    initialize: async () => {
      native = await import('./native.js');
      await native.initNative();
    },
    restoreSession: restoreAuthSession,
    // launchAutoHide is false, so every success/error/timeout path must close it.
    finalize: async () => {
      if (!native) native = await import('./native.js');
      await native.hideNativeSplash();
    },
  });
}

export default function AppBootstrap({ native, children }) {
  const [result, setResult] = useState(() => native ? null : { session: undefined, error: null });

  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    if (!nativeBootstrapPromise) nativeBootstrapPromise = bootstrapNative();
    nativeBootstrapPromise
      .then((next) => { if (alive) setResult(next); })
      .catch((error) => { if (alive) setResult({ session: { state: 'retry', user: null, error }, error }); });
    return () => { alive = false; };
  }, [native]);

  if (!result) {
    return (
      <div className="app-bootstrap" role="status" aria-live="polite">
        <span className="app-bootstrap-mark" aria-hidden="true">幻</span>
        <b>正在准备幻域</b>
        <small>检查设备与恢复会话…</small>
      </div>
    );
  }
  return children(result.session);
}

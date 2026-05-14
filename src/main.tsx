import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

// CRITICAL: Prevent libraries from trying to overwrite read-only fetch
// This MUST be the first thing to run
if (typeof window !== 'undefined') {
  (window as any).global = window;
  try {
    const originalFetch = window.fetch;
    Object.defineProperty(window, 'fetch', {
      get: () => originalFetch,
      set: () => { console.warn('Attempt to overwrite read-only fetch was safely blocked.'); },
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    // Already protected or non-redefinable
  }
}

import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

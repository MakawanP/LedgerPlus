import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import {FirestoreErrorBoundary} from './components/FirestoreErrorBoundary.tsx';
import './index.css';

if (import.meta.env.PROD) {
  // Register Service Worker for offline app-shell, logo & font caching in production
  registerSW({immediate: true});
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  // Ensure dev preview never retains a stale dev-sw registration
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    })
    .catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <FirestoreErrorBoundary>
    <App />
  </FirestoreErrorBoundary>
);

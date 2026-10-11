import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

async function start() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) {
        await Promise.race([
          new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })),
          new Promise<void>(resolve => window.setTimeout(resolve, 1500)),
        ])
      }
    } catch { /* Browsers without offline support can still use the online site. */ }
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
}

void start()

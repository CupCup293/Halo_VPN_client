import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'framer-motion';
import { App } from './App';
import { HaloProvider } from './store';
import './styles.css';
import { installMock } from './mock';

if (!window.halo) installMock();
// ?static — без анимаций (для скриншотов и слабых машин).
if (new URLSearchParams(location.search).has('static')) MotionGlobalConfig.skipAnimations = true;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HaloProvider>
      <App />
    </HaloProvider>
  </StrictMode>,
);

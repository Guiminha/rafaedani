import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const path = window.location.pathname;
const root = createRoot(document.getElementById('root')!);

if (path === '/danierafaAdmin') {
  // Lazy-load the Admin panel so it stays out of the initial bundle (faster 4G load)
  import('./Admin.tsx').then(({default: Admin}) => {
    root.render(
      <StrictMode>
        <Admin />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

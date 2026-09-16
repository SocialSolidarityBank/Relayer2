import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/wire.css';
import './styles/shell.css';
import './styles/app.css';
import { Routes } from './routes.tsx';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Routes />
  </StrictMode>,
);

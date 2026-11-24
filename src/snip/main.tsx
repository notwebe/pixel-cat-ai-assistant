import React from 'react';
import ReactDOM from 'react-dom/client';
import { SnipOverlay } from './SnipOverlay';
import '../styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SnipOverlay />
  </React.StrictMode>,
);

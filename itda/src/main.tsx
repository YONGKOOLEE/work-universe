import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { applyTheme, readTheme } from './lib/theme';

applyTheme(readTheme()); // 첫 그리기 전에 밝기를 정한다

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './main.css';
import SnapWeb from './components/SnapWeb';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

console.log(`Welcome to ${import.meta.env.VITE_APP_NAME} ${import.meta.env.VITE_APP_VERSION}`);

root.render(
  <React.StrictMode>
    <SnapWeb />
  </React.StrictMode>,
);

import React from 'react';

export default function PwaReloadPopup({onReload}) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        padding: '0.75rem 1.25rem',
        background: '#e85d04',
        color: '#fff',
        borderRadius: '8px',
        cursor: 'pointer',
        zIndex: 1000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        fontSize: '0.9rem',
      }}
      onClick={onReload}>
      New version available. Click to reload.
    </div>
  );
}

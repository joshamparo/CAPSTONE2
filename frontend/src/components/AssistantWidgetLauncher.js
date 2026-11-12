import React, { lazy, Suspense, useState } from 'react';
import { Bot, MessageCircleMore } from 'lucide-react';
import './AssistantWidgetLauncher.css';

const AssistantWidget = lazy(() => import('./AssistantWidget'));

function getPageClass(pathname) {
  const currentPath = String(pathname || '').trim();
  if (!/^\/(admin|patient|staff|nurse|doctor|pharmacist|cashier|doctor-secretary|medtech|radiographer|ecg|pt)(\/|$)/.test(currentPath)) {
    return '';
  }
  const usesSidebar = /^\/(admin|nurse|doctor|pharmacist|cashier|doctor-secretary|medtech|radiographer|ecg|pt)(\/|$)/.test(currentPath);
  return `assistant-widget-page-dashboard${usesSidebar ? ' assistant-widget-page-sidebar' : ''}`;
}

function AssistantLauncher({ pageClass, onOpen, loading = false }) {
  return (
    <div className={`assistant-launcher-root ${pageClass}`.trim()}>
      <button
        type="button"
        className="assistant-launcher-button"
        onClick={onOpen}
        disabled={loading}
        aria-label={loading ? 'Loading Pascualinga Assistant' : 'Open Pascualinga Assistant'}
        aria-busy={loading}
      >
        <Bot size={20} />
        <span className="assistant-launcher-label">
          Pascualinga Assistant
          <small>{loading ? 'Loading…' : 'Need help?'}</small>
        </span>
        <MessageCircleMore size={18} />
      </button>
    </div>
  );
}

export default function AssistantWidgetLauncher({ pathname = '/' }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const pageClass = getPageClass(pathname);

  if (!isLoaded) {
    return <AssistantLauncher pageClass={pageClass} onOpen={() => setIsLoaded(true)} />;
  }

  return (
    <Suspense fallback={<AssistantLauncher pageClass={pageClass} onOpen={() => {}} loading />}>
      <AssistantWidget pathname={pathname} initialOpen />
    </Suspense>
  );
}

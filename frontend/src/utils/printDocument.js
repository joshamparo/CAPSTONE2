const removeLater = (node, delay = 500) => {
  window.setTimeout(() => {
    if (node?.isConnected) node.remove();
  }, delay);
};

// Print from an isolated same-origin frame. This avoids popup blockers and the
// blank-tab race caused by closing a temporary window before it has rendered.
export const printHtmlDocument = async ({ html, title = 'Pascualinga Report', onError } = {}) => {
  if (typeof document === 'undefined' || !String(html || '').trim()) {
    onError?.('No printable content is available.');
    return false;
  }

  const frame = document.createElement('iframe');
  frame.title = `${title} printable document`;
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px',
    border: '0', opacity: '0', pointerEvents: 'none'
  });
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument || frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    frame.remove();
    onError?.('Unable to prepare the printable document.');
    return false;
  }

  try {
    frameDocument.open();
    frameDocument.write(String(html));
    frameDocument.close();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    await frameDocument.fonts?.ready;
    frameWindow.onafterprint = () => removeLater(frame);
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(() => removeLater(frame, 0), 60000);
    return true;
  } catch (error) {
    frame.remove();
    onError?.(String(error?.message || 'Unable to open the print dialog.'));
    return false;
  }
};

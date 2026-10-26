// A real window is opened synchronously from the button click. Chromium-based
// browsers can silently ignore window.print() from a hidden iframe, especially
// after deployment behind a strict iframe policy.
export const printHtmlDocument = ({ html, title = 'Pascualinga Report', onError } = {}) => {
  if (typeof document === 'undefined' || !String(html || '').trim()) {
    onError?.('No printable content is available.');
    return false;
  }

  const printWindow = window.open('', '_blank', 'popup=yes,width=960,height=720');
  if (!printWindow) {
    onError?.('The print window was blocked. Allow pop-ups for this site, then try again.');
    return false;
  }

  try {
    let printed = false;
    const openDialog = () => {
      if (printed || printWindow.closed) return;
      printed = true;
      printWindow.focus();
      printWindow.print();
    };
    printWindow.onafterprint = () => printWindow.close();
    printWindow.onload = openDialog;
    printWindow.document.open();
    printWindow.document.write(String(html));
    printWindow.document.close();
    // Fallback for browsers that do not fire onload for document.write().
    window.setTimeout(openDialog, 250);
    return true;
  } catch (error) {
    printWindow.close();
    onError?.(String(error?.message || 'Unable to open the print dialog.'));
    return false;
  }
};

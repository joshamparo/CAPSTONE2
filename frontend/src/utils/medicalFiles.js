import { API_BASE, buildAuthHeaders } from './api';

export async function loadMedicalFile(reference) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${API_BASE}/api/lab-results/file?url=${encodeURIComponent(reference)}`, {
      headers: buildAuthHeaders(), signal: controller.signal, cache: 'no-store'
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || 'Unable to open the medical file. Please try again.');
    }
    const blob = await response.blob();
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('Unsupported medical file format.');
    const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `result.${blob.type === 'application/pdf' ? 'pdf' : blob.type.split('/')[1]}`;
    return { url: URL.createObjectURL(blob), mimeType: blob.type, filename };
  } finally { clearTimeout(timer); }
}

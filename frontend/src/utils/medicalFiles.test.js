import 'whatwg-fetch';
import { loadMedicalFile } from './medicalFiles';
import { API_BASE } from './api';
beforeEach(() => {
  localStorage.setItem('currentUser', JSON.stringify({ sessionToken: 'signed-session', role: 'patient' }));
  URL.createObjectURL = jest.fn().mockReturnValue('blob:private');
});
afterEach(() => { localStorage.clear(); jest.restoreAllMocks(); });
test('file downloads use only the backend with a bearer header and no-store cache', async () => {
  const fetchMock = jest.spyOn(window, 'fetch').mockResolvedValue({ ok: true, headers: new Headers(), blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) });
  const reference = 'https://old-storage.example/lab.pdf';
  const file = await loadMedicalFile(reference);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`${API_BASE}/api/lab-results/file?url=${encodeURIComponent(reference)}`);
  expect(options.headers.Authorization).toBe('Bearer signed-session');
  expect(options.cache).toBe('no-store');
  expect(file.url).toBe('blob:private');
});
test('a rejected download never creates a viewable blob URL', async () => {
  jest.spyOn(window, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ message: 'Forbidden' }) });
  await expect(loadMedicalFile('lab-local:file.pdf')).rejects.toThrow('Forbidden');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

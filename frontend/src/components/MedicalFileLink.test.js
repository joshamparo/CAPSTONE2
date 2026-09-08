import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MedicalFileLink from './MedicalFileLink';
import { loadMedicalFile } from '../utils/medicalFiles';
jest.mock('../utils/medicalFiles', () => ({ loadMedicalFile: jest.fn() }));
beforeEach(() => { URL.revokeObjectURL = jest.fn(); jest.clearAllMocks(); });
test('authorized file opens a PDF preview and download, then releases its blob', async () => {
  loadMedicalFile.mockResolvedValue({ url: 'blob:private-result', mimeType: 'application/pdf', filename: 'lab.pdf' });
  render(<MedicalFileLink href="lab-storage:lab-results/p/file.pdf">Open result</MedicalFileLink>);
  fireEvent.click(screen.getByText('Open result'));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getByTitle('Medical result PDF').getAttribute('src')).toBe('blob:private-result');
  expect(screen.getByText('Download').getAttribute('download')).toBe('lab.pdf');
  fireEvent.click(screen.getByText('Close'));
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-result'));
});
test('denied requests show an error and never open a raw storage URL', async () => {
  loadMedicalFile.mockRejectedValue(new Error('This record is not linked to your account.'));
  render(<MedicalFileLink href="https://storage.example/old.pdf" />);
  fireEvent.click(screen.getByText('Open file'));
  expect(await screen.findByRole('alert')).toHaveTextContent('not linked');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

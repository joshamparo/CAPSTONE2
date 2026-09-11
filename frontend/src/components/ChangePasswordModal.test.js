import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChangePasswordModal from './ChangePasswordModal';

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body
});

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('resolves an incomplete dashboard user and preserves the refreshed signed session', async () => {
  localStorage.setItem('currentUser', JSON.stringify({
    email: 'nurse@example.com', role: 'nurse', sessionToken: 'old-token'
  }));
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response({ id: 'nurse-id', email: 'nurse@example.com', account_type: 'nurse' }))
    .mockResolvedValueOnce(response({ id: 'nurse-id', email: 'nurse@example.com', account_type: 'nurse', sessionToken: 'new-token' }));

  render(<ChangePasswordModal open user={{ email: 'nurse@example.com', role: 'nurse' }} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'CurrentPass1!' } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'Replacement1!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'Replacement1!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(screen.getByText('Password updated successfully.')).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(global.fetch.mock.calls[0][0]).toContain('/api/staff/by-email?email=nurse%40example.com');
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer old-token');
  expect(global.fetch.mock.calls[1][0]).toContain('/api/staff/nurse-id');
  expect(JSON.parse(localStorage.getItem('currentUser')).sessionToken).toBe('new-token');
});

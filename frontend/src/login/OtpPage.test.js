import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OtpPage from './OtpPage';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

beforeEach(() => {
  mockNavigate.mockClear();
  localStorage.clear();
  localStorage.setItem('otpChallengeId', '11111111-1111-4111-8111-111111111111');
  localStorage.setItem('tempLoginEmail', 'staff@example.com');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, expiresInSeconds: 60, resendAfterSeconds: 0 })
  });
});

afterEach(() => jest.restoreAllMocks());

test('resend OTP is immediately available without a countdown', async () => {
  render(<OtpPage />);
  expect(screen.queryByText(/resend code in/i)).not.toBeInTheDocument();
  const resend = screen.getByRole('button', { name: /resend code/i });
  expect(resend).toBeEnabled();
  fireEvent.click(resend);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/staff/login/otp/resend'),
    expect.objectContaining({ method: 'POST' })
  ));
  expect(await screen.findByText('New code sent to staff@example.com')).toBeInTheDocument();
});

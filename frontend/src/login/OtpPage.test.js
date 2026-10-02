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
  expect(screen.getByText('1:00')).toBeInTheDocument();
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

test('entering the complete OTP shows verification progress without changing resend text', async () => {
  global.fetch = jest.fn(() => new Promise(() => {}));
  render(<OtpPage />);

  const inputs = screen.getAllByRole('textbox');
  ['1', '2', '3', '4', '5', '6'].forEach((digit, index) => {
    fireEvent.change(inputs[index], { target: { value: digit } });
  });

  expect(await screen.findByText('Verifying code...')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /resend code/i })).toHaveTextContent('Resend Code');
  expect(screen.queryByText(/sending new code/i)).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/staff/login/otp/verify'),
    expect.objectContaining({ method: 'POST' })
  );
});

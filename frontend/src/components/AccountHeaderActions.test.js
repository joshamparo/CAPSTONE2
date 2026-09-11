import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AccountHeaderActions from './AccountHeaderActions';

beforeEach(() => {
  global.fetch = jest.fn(() => new Promise(() => {}));
});

afterEach(() => jest.restoreAllMocks());

test('staff dropdown shows identity and password action without a profile page link', () => {
  render(<AccountHeaderActions user={{ id: 'staff-1', name: 'Ana Cruz', email: 'ana@example.com', role: 'pharmacist' }} onSignOut={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Profile menu' }));
  expect(screen.getAllByText('Pharmacist').length).toBeGreaterThan(0);
  expect(screen.getByText('ana@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  expect(screen.queryByText('My Profile')).not.toBeInTheDocument();
});

test('admin keeps its full profile action', () => {
  const onMyProfile = jest.fn();
  render(<AccountHeaderActions user={{ id: 'admin-1', name: 'Admin', email: 'admin@example.com', role: 'admin' }} onMyProfile={onMyProfile} showChangePasswordMenu={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Profile menu' }));
  fireEvent.click(screen.getByRole('button', { name: /my profile/i }));
  expect(onMyProfile).toHaveBeenCalledTimes(1);
});

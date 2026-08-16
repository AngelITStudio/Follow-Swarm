import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../services/api', () => ({
  __esModule: true,
  twoFactorAPI: {
    verify: vi.fn(),
    verifyBackup: vi.fn(),
    status: vi.fn(),
  },
}));

import TwoFactor from './TwoFactor';
import { twoFactorAPI } from '../services/api';

const mockedAPI = vi.mocked(twoFactorAPI, true);

describe('TwoFactor page', () => {
  let originalRedirectDelay: string | undefined;

  beforeEach(() => {
    const env = import.meta.env as Record<string, string | undefined>;
    originalRedirectDelay = env.VITE_2FA_REDIRECT_DELAY_MS;
    env.VITE_2FA_REDIRECT_DELAY_MS = '0';

    mockedAPI.verify.mockReset();
    mockedAPI.verifyBackup.mockReset();
    mockedAPI.status.mockReset();
    mockedAPI.verify.mockResolvedValue({});
    mockedAPI.verifyBackup.mockResolvedValue({ data: {} });
    localStorage.clear();
  });

  afterEach(() => {
    const env = import.meta.env as Record<string, string | undefined>;
    if (originalRedirectDelay === undefined) {
      delete env.VITE_2FA_REDIRECT_DELAY_MS;
    } else {
      env.VITE_2FA_REDIRECT_DELAY_MS = originalRedirectDelay;
    }
    localStorage.clear();
  });

  const renderWithParams = (search = '') => {
    render(
      <MemoryRouter initialEntries={[`/auth/2fa${search}`]}>
        <Routes>
          <Route path="/auth/2fa" element={<TwoFactor />} />
          <Route path="/login" element={<div>login</div>} />
          <Route path="/dashboard" element={<div>dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('redirects to login when params are missing', () => {
    renderWithParams();
    expect(screen.getByText(/login/i)).toBeInTheDocument();
  });

  it('submits TOTP code', async () => {
    renderWithParams('?tempToken=temp-token&userId=user-123');

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '123456' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify code/i })).not.toBeDisabled();
    });

    fireEvent.submit(screen.getByRole('button', { name: /verify code/i }).closest('form')!);

    await waitFor(() => {
      expect(mockedAPI.verify).toHaveBeenCalledWith({ userId: 'user-123', token: '123456' }, 'temp-token');
    });

    await waitFor(() => {
      expect(localStorage.getItem('token')).toBe('temp-token');
      expect(localStorage.getItem('userId')).toBe('user-123');
    });
  });

  it('submits backup code when toggled', async () => {
    renderWithParams('?tempToken=temp-token&userId=user-123');

    fireEvent.click(screen.getByText(/backup code instead/i));
    fireEvent.change(screen.getByPlaceholderText(/backup codes/i), { target: { value: 'backup-code' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify backup code/i })).not.toBeDisabled();
    });

    fireEvent.submit(screen.getByRole('button', { name: /verify backup code/i }).closest('form')!);

    await waitFor(() => {
      expect(mockedAPI.verifyBackup).toHaveBeenCalledWith({ userId: 'user-123', code: 'backup-code' }, 'temp-token');
    });

    await waitFor(() => {
      expect(localStorage.getItem('token')).toBe('temp-token');
      expect(localStorage.getItem('userId')).toBe('user-123');
    });
  });
});

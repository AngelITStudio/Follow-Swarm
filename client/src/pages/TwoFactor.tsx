import { FormEvent, useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Loader2, KeyRound, ArrowLeft } from 'lucide-react';
import { twoFactorAPI } from '../services/api';

const DEFAULT_REDIRECT_DELAY_MS = 600;

type VerificationMode = 'totp' | 'backup';

type AxiosLikeError = {
  response?: {
    data?: {
      message?: string;
      error?: string;
    };
  };
};

const extractErrorMessage = (error: unknown, fallback: string): string => {
  const typedError = error as AxiosLikeError | undefined;
  return (
    typedError?.response?.data?.message ||
    typedError?.response?.data?.error ||
    fallback
  );
};

const TwoFactor = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<VerificationMode>('totp');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const tempToken = searchParams.get('tempToken');
  const userId = searchParams.get('userId');

  useEffect(() => {
    if (!tempToken || !userId) {
      navigate('/login', { replace: true });
      return;
    }
  }, [navigate, tempToken, userId]);

  const redirectAfterSuccess = useCallback(() => {
    const rawDelay = import.meta.env.VITE_2FA_REDIRECT_DELAY_MS;
    const parsedDelay = rawDelay !== undefined ? Number(rawDelay) : DEFAULT_REDIRECT_DELAY_MS;
    const delay = Number.isFinite(parsedDelay) ? Math.max(0, parsedDelay) : DEFAULT_REDIRECT_DELAY_MS;

    setTimeout(() => {
      navigate('/dashboard', { replace: true });
    }, delay);
  }, [navigate]);

  useEffect(() => {
    if (mode === 'totp') {
      setBackupCode('');
    } else {
      setCode('');
    }
    setError('');
  }, [mode]);

  const isDisabled = useMemo(() => (
    submitting ||
    !userId ||
    !tempToken ||
    (mode === 'totp' ? code.trim().length < 6 : backupCode.trim().length === 0)
  ), [backupCode, code, mode, submitting, tempToken, userId]);

  const handleTotpSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || !tempToken) {
      return;
    }

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      await twoFactorAPI.verify({ userId, token: code.trim() }, tempToken);
      localStorage.setItem('token', tempToken);
      localStorage.setItem('userId', userId);
      setInfo('Verification successful. Redirecting to your dashboard...');
      redirectAfterSuccess();
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to verify the code. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || !tempToken) {
      return;
    }

    setSubmitting(true);
    setError('');
    setInfo('');

    try {
      const response = await twoFactorAPI.verifyBackup({ userId, code: backupCode.trim() }, tempToken);
      if (response.data?.warning) {
        setInfo(response.data.warning);
      } else {
        setInfo('Backup code accepted. Redirecting to your dashboard...');
      }
      localStorage.setItem('token', tempToken);
      localStorage.setItem('userId', userId);
      redirectAfterSuccess();
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to verify the backup code. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = () => {
    setMode((prev) => (prev === 'totp' ? 'backup' : 'totp'));
  };

  const goBackToLogin = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-spotify-black via-gray-900 to-gray-800 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={goBackToLogin}
          className="flex items-center text-sm text-gray-400 hover:text-white transition mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to login
        </button>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-3xl shadow-lg shadow-black/40 p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-spotify-green/10 text-spotify-green p-3 rounded-full">
              <ShieldCheck className="h-8 w-8" />
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-white text-center">Two-Factor Verification</h1>
          <p className="mt-2 text-sm text-gray-400 text-center">
            Enter the verification code from your authenticator app to finish signing in.
          </p>

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={toggleMode}
              className="text-xs text-spotify-green hover:text-white transition"
            >
              {mode === 'totp' ? 'Use a backup code instead' : 'Use authenticator app instead'}
            </button>
          </div>

          {error && (
            <div className="mt-6 bg-red-500/10 border border-red-500/40 text-red-200 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {info && (
            <div className="mt-6 bg-spotify-green/10 border border-spotify-green/40 text-spotify-green text-sm rounded-xl px-4 py-3">
              {info}
            </div>
          )}

          {mode === 'totp' ? (
            <form onSubmit={handleTotpSubmit} className="mt-6 space-y-6">
              <div>
                <label className="block text-sm text-gray-300 mb-2" htmlFor="totp-code">
                  6-digit code
                </label>
                <input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-3 rounded-xl bg-gray-800/60 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-spotify-green"
                  placeholder="123456"
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              <button
                type="submit"
                disabled={isDisabled}
                className="w-full flex items-center justify-center gap-2 bg-spotify-green text-black font-semibold py-3 rounded-xl hover:bg-spotify-green/90 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                Verify code
              </button>
            </form>
          ) : (
            <form onSubmit={handleBackupSubmit} className="mt-6 space-y-6">
              <div>
                <label className="block text-sm text-gray-300 mb-2" htmlFor="backup-code">
                  Backup code
                </label>
                <div className="flex items-center rounded-xl bg-gray-800/60 border border-gray-700">
                  <div className="px-3 text-gray-500">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <input
                    id="backup-code"
                    type="text"
                    value={backupCode}
                    onChange={(event) => setBackupCode(event.target.value.trim())}
                    className="w-full px-3 py-3 bg-transparent text-white placeholder-gray-500 focus:outline-none"
                    placeholder="Enter one of your backup codes"
                    autoComplete="off"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isDisabled}
                className="w-full flex items-center justify-center gap-2 bg-spotify-green text-black font-semibold py-3 rounded-xl hover:bg-spotify-green/90 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
                Verify backup code
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default TwoFactor;

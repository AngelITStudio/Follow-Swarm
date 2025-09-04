-- Migration: Add 2FA support for admin accounts
-- Date: 2025-09-04
-- Purpose: Implement two-factor authentication for enhanced admin security

-- Add 2FA columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS two_fa_secret TEXT, -- encrypted
ADD COLUMN IF NOT EXISTS two_fa_backup_codes TEXT[], -- encrypted backup codes
ADD COLUMN IF NOT EXISTS two_fa_enabled_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS two_fa_last_used_at TIMESTAMP;

-- Create table for 2FA setup tokens (temporary during setup)
CREATE TABLE IF NOT EXISTS two_fa_setup_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL, -- encrypted temporary secret
    qr_code TEXT, -- QR code data URL
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Create table for 2FA verification attempts (for audit/security)
CREATE TABLE IF NOT EXISTS two_fa_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    success BOOLEAN NOT NULL,
    ip_address INET,
    user_agent TEXT,
    error_message TEXT,
    attempted_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_two_fa_setup_tokens_user_id ON two_fa_setup_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_two_fa_setup_tokens_expires_at ON two_fa_setup_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_two_fa_attempts_user_id ON two_fa_attempts(user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_two_fa_enabled ON users(two_fa_enabled) WHERE two_fa_enabled = TRUE;

-- Add system settings for 2FA configuration
INSERT INTO system_settings (key, value, description)
VALUES 
    ('2fa_required_for_admins', 'true', 'Require 2FA for admin accounts'),
    ('2fa_grace_period_days', '7', 'Days before 2FA becomes mandatory for admins'),
    ('2fa_max_attempts', '3', 'Maximum failed 2FA attempts before lockout'),
    ('2fa_lockout_duration_minutes', '15', 'Duration of 2FA lockout after max attempts')
ON CONFLICT (key) DO NOTHING;
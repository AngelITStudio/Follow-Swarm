-- Migration: Create migrations tracking table
-- Date: 2025-09-03
-- Purpose: Track which migrations have been applied to the database

-- UP Migration
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP DEFAULT NOW(),
    checksum VARCHAR(64), -- SHA256 hash of migration file
    execution_time_ms INTEGER, -- Track how long migration took
    rolled_back BOOLEAN DEFAULT FALSE,
    rolled_back_at TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_migrations_name ON migrations(name);
CREATE INDEX IF NOT EXISTS idx_migrations_executed ON migrations(executed_at DESC);

-- Insert this migration as the first entry
INSERT INTO migrations (name, checksum) 
VALUES ('001_create_migrations_table.sql', 'initial')
ON CONFLICT (name) DO NOTHING;
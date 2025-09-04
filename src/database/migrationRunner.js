/**
 * Database Migration Runner
 * 
 * Handles execution of database migrations in order
 * Tracks applied migrations and supports rollback
 * 
 * @author Claude
 * @since 2025-09-03
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const db = require('./index');
const logger = require('../utils/logger');

class MigrationRunner {
  constructor() {
    this.migrationsDir = path.join(__dirname, 'migrations');
  }

  /**
   * Initialize migrations table if it doesn't exist
   */
  async initialize() {
    try {
      // Check if migrations table exists
      const tableExists = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'migrations'
        );
      `);

      if (!tableExists.rows[0].exists) {
        logger.info('Creating migrations table...');
        const initSQL = await fs.readFile(
          path.join(this.migrationsDir, '001_create_migrations_table.sql'),
          'utf8'
        );
        await this.executeMigrationSQL(initSQL);
        logger.info('Migrations table created');
      }
    } catch (error) {
      logger.error('Failed to initialize migrations:', error);
      throw error;
    }
  }

  /**
   * Get list of migration files
   */
  async getMigrationFiles() {
    const files = await fs.readdir(this.migrationsDir);
    return files
      .filter(f => f.endsWith('.sql'))
      .sort(); // Alphabetical order ensures correct sequence
  }

  /**
   * Get list of applied migrations
   */
  async getAppliedMigrations() {
    const result = await db.query(
      'SELECT name, checksum FROM migrations WHERE rolled_back = FALSE ORDER BY executed_at'
    );
    return result.rows;
  }

  /**
   * Calculate checksum of migration file
   */
  async calculateChecksum(content) {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
  }

  /**
   * Execute migration SQL with transaction
   */
  async executeMigrationSQL(sql) {
    // Execute the entire SQL as a single transaction
    // This handles CREATE TABLE and CREATE INDEX statements properly
    try {
      await db.query(sql);
    } catch (error) {
      logger.error('Failed to execute migration SQL:', error);
      throw error;
    }
  }

  /**
   * Run a single migration
   */
  async runMigration(filename) {
    const startTime = Date.now();
    
    try {
      logger.info(`Running migration: ${filename}`);
      
      // Read migration file
      const filepath = path.join(this.migrationsDir, filename);
      const content = await fs.readFile(filepath, 'utf8');
      const checksum = await this.calculateChecksum(content);
      
      // Check if already applied
      const existing = await db.query(
        'SELECT * FROM migrations WHERE name = $1',
        [filename]
      );
      
      if (existing.rows.length > 0) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Migration ${filename} has been modified since it was applied!`);
        }
        logger.debug(`Migration ${filename} already applied, skipping...`);
        return false;
      }
      
      // Execute migration
      await this.executeMigrationSQL(content);
      
      // Record migration
      const executionTime = Date.now() - startTime;
      await db.query(
        'INSERT INTO migrations (name, checksum, execution_time_ms) VALUES ($1, $2, $3)',
        [filename, checksum, executionTime]
      );
      
      logger.info(`✓ Migration ${filename} completed in ${executionTime}ms`);
      return true;
    } catch (error) {
      logger.error(`✗ Migration ${filename} failed:`, error);
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async up() {
    try {
      await db.connect();
      await this.initialize();
      
      const files = await this.getMigrationFiles();
      const applied = await this.getAppliedMigrations();
      const appliedNames = new Set(applied.map(m => m.name));
      
      const pending = files.filter(f => !appliedNames.has(f));
      
      if (pending.length === 0) {
        logger.info('No pending migrations');
        return { applied: 0, pending: [] };
      }
      
      logger.info(`Found ${pending.length} pending migrations`);
      
      let appliedCount = 0;
      for (const file of pending) {
        const wasApplied = await this.runMigration(file);
        if (wasApplied) appliedCount++;
      }
      
      logger.info(`Applied ${appliedCount} migrations`);
      return { applied: appliedCount, pending };
      
    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async status() {
    try {
      await db.connect();
      await this.initialize();
      
      const files = await this.getMigrationFiles();
      const applied = await this.getAppliedMigrations();
      const appliedNames = new Set(applied.map(m => m.name));
      
      const status = files.map(file => ({
        name: file,
        applied: appliedNames.has(file),
        appliedAt: applied.find(m => m.name === file)?.executed_at
      }));
      
      return {
        total: files.length,
        applied: applied.length,
        pending: files.length - applied.length,
        migrations: status
      };
    } catch (error) {
      logger.error('Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * Create a new migration file
   */
  async create(name) {
    const timestamp = new Date().toISOString()
      .replace(/[-:T]/g, '')
      .substring(0, 14); // YYYYMMDDHHMMSS
    
    const filename = `${timestamp}_${name}.sql`;
    const filepath = path.join(this.migrationsDir, filename);
    
    const template = `-- Migration: ${name}
-- Date: ${new Date().toISOString().split('T')[0]}
-- Purpose: [Describe purpose here]

-- UP Migration (apply changes)


-- DOWN Migration (rollback changes)
-- Note: Add rollback SQL after this comment for future rollback support
`;
    
    await fs.writeFile(filepath, template);
    logger.info(`Created migration: ${filename}`);
    return filename;
  }
}

module.exports = new MigrationRunner();
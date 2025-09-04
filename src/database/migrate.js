#!/usr/bin/env node
/**
 * Migration CLI Tool
 * 
 * Provides command line interface for database migrations
 * Commands: up, down, status, create
 * 
 * @author Claude
 * @since 2025-09-04
 */

const path = require('path');
const migrationRunner = require('./migrationRunner');
const logger = require('../utils/logger');

// Parse command line arguments
const command = process.argv[2];
const arg = process.argv[3];

/**
 * Display usage information
 */
function showHelp() {
  console.log(`
Database Migration Tool

Usage:
  node migrate.js <command> [options]

Commands:
  up              Run all pending migrations
  status          Show migration status
  create <name>   Create a new migration file

Examples:
  node migrate.js up
  node migrate.js status
  node migrate.js create add_user_preferences

Environment:
  NODE_ENV        Set to 'production' for production database
  `)
}

/**
 * Execute migration command
 */
async function execute() {
  try {
    switch (command) {
      case 'up':
        console.log('Running pending migrations...');
        const result = await migrationRunner.up();
        if (result.applied === 0) {
          console.log('✓ Database is up to date');
        } else {
          console.log(`✓ Applied ${result.applied} migrations`);
        }
        process.exit(0);
        break;

      case 'status':
        console.log('Checking migration status...');
        const status = await migrationRunner.status();
        console.log('\n=== Migration Status ===');
        console.log(`Total: ${status.total}`);
        console.log(`Applied: ${status.applied}`);
        console.log(`Pending: ${status.pending}`);
        
        if (status.migrations.length > 0) {
          console.log('\n=== Migrations ===');
          status.migrations.forEach(m => {
            const marker = m.applied ? '✓' : '○';
            const date = m.appliedAt ? 
              new Date(m.appliedAt).toLocaleString() : 
              'pending';
            console.log(`${marker} ${m.name} (${date})`);
          });
        }
        process.exit(0);
        break;

      case 'create':
        if (!arg) {
          console.error('Error: Migration name required');
          console.log('Usage: node migrate.js create <name>');
          process.exit(1);
        }
        
        // Sanitize migration name
        const sanitizedName = arg
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/_+/g, '_');
        
        console.log(`Creating migration: ${sanitizedName}`);
        const filename = await migrationRunner.create(sanitizedName);
        console.log(`✓ Created: ${filename}`);
        console.log(`Edit: src/database/migrations/${filename}`);
        process.exit(0);
        break;

      case 'help':
      case '-h':
      case '--help':
        showHelp();
        process.exit(0);
        break;

      default:
        if (!command) {
          console.error('Error: No command specified');
        } else {
          console.error(`Error: Unknown command "${command}"`);
        }
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.error('Migration failed:', error);
    console.error(`\n✗ Migration failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  execute();
}

module.exports = { execute };
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checksum, isSafeAutomaticMigration, migrationFiles } = require('../scripts/bootstrap-schema');

test('schema bootstrap discovers only deterministic manual migrations', () => {
  const files = migrationFiles();
  assert.ok(files.length >= 1);
  assert.deepEqual(files, [...files].sort((left, right) => left.localeCompare(right)));
  assert.ok(files.every((name) => /^manual_migration_[a-z0-9_]+\.sql$/i.test(name)));
});

test('schema migration checksums are stable and sensitive to changes', () => {
  assert.equal(checksum('SELECT 1;'), checksum('SELECT 1;'));
  assert.notEqual(checksum('SELECT 1;'), checksum('SELECT 2;'));
});

test('automatic bootstrap permits additive DDL and rejects destructive/data-changing SQL', () => {
  assert.equal(isSafeAutomaticMigration('CREATE TABLE IF NOT EXISTS demo (id bigint); ALTER TABLE demo ADD COLUMN IF NOT EXISTS name text;'), true);
  assert.equal(isSafeAutomaticMigration('ALTER TABLE demo DROP COLUMN name;'), false);
  assert.equal(isSafeAutomaticMigration('UPDATE demo SET name = null;'), false);
  assert.equal(isSafeAutomaticMigration('DELETE FROM demo;'), false);
});

test('role authorization no longer mutates schema during requests', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'requireRole.js'), 'utf8');
  assert.doesNotMatch(source, /ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+INDEX/i);
  assert.doesNotMatch(source, /\$executeRawUnsafe/);
});

test('staff and restock traffic does not invoke schema setup', () => {
  const staff = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');
  const restock = fs.readFileSync(path.join(__dirname, '..', 'routes', 'restockRequests.js'), 'utf8');

  for (const invocation of [
    'ensurePresenceSchemaOnce()',
    'ensureAccountsDoctorLinkSchema()',
    'ensureStaffActivationSchemaOnce()',
    'ensureUserSettingsSchema()',
    'ensureLoginOtpSchema()',
    'ensureInventoryTimestampSchemaOnce()'
  ]) {
    assert.equal(staff.split(invocation).length - 1, 1, `${invocation} should only remain as its function declaration`);
  }
  assert.equal(restock.split('ensureTable()').length - 1, 1, 'ensureTable should only remain as its function declaration');
  assert.equal(restock.split('ensureStockMovementsTableExist()').length - 1, 1, 'stock movement schema setup should only remain as its function declaration');
});

test('command-line schema bootstrap fails closed before application start', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'bootstrap-schema.js'), 'utf8');
  assert.match(source, /SET lock_timeout = '10s'/);
  assert.match(source, /bootstrapSchema\(\{ strict: true \}\)/);
});

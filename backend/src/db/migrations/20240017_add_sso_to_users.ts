import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.string('sso_provider').nullable();
    t.string('sso_id').nullable();
  });

  // Make password_hash nullable for SSO-only users
  await knex.raw('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');

  // Unique constraint: one SSO identity per provider
  await knex.schema.alterTable('users', (t) => {
    t.unique(['sso_provider', 'sso_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropUnique(['sso_provider', 'sso_id']);
    t.dropColumn('sso_provider');
    t.dropColumn('sso_id');
  });

  await knex.raw('ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL');
}

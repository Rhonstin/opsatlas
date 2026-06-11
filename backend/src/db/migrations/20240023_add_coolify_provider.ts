import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE cloud_connections
      DROP CONSTRAINT IF EXISTS cloud_connections_provider_check,
      ADD CONSTRAINT cloud_connections_provider_check
        CHECK (provider IN ('gcp', 'aws', 'hetzner', 'coolify'));
  `);

  await knex.raw(`
    ALTER TABLE instances
      DROP CONSTRAINT IF EXISTS instances_provider_check,
      ADD CONSTRAINT instances_provider_check
        CHECK (provider IN ('gcp', 'aws', 'hetzner', 'coolify'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE cloud_connections
      DROP CONSTRAINT IF EXISTS cloud_connections_provider_check,
      ADD CONSTRAINT cloud_connections_provider_check
        CHECK (provider IN ('gcp', 'aws', 'hetzner'));
  `);

  await knex.raw(`
    ALTER TABLE instances
      DROP CONSTRAINT IF EXISTS instances_provider_check,
      ADD CONSTRAINT instances_provider_check
        CHECK (provider IN ('gcp', 'aws', 'hetzner'));
  `);
}

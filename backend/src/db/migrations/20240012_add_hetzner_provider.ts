import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE cloud_connections
    DROP CONSTRAINT IF EXISTS cloud_connections_provider_check;

    ALTER TABLE cloud_connections
    ADD CONSTRAINT cloud_connections_provider_check
    CHECK (provider IN ('gcp', 'aws', 'hetzner'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE cloud_connections
    DROP CONSTRAINT IF EXISTS cloud_connections_provider_check;

    ALTER TABLE cloud_connections
    ADD CONSTRAINT cloud_connections_provider_check
    CHECK (provider IN ('gcp', 'aws'));
  `);
}

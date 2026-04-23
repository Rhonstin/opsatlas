import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE instances
    DROP CONSTRAINT IF EXISTS instances_provider_check;

    ALTER TABLE instances
    ADD CONSTRAINT instances_provider_check
    CHECK (provider IN ('gcp', 'aws', 'hetzner'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE instances
    DROP CONSTRAINT IF EXISTS instances_provider_check;

    ALTER TABLE instances
    ADD CONSTRAINT instances_provider_check
    CHECK (provider IN ('gcp', 'aws'));
  `);
}

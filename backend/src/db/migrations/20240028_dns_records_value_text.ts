import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE dns_records ALTER COLUMN value TYPE TEXT');
  await knex.raw('ALTER TABLE dns_records ALTER COLUMN name TYPE TEXT');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE dns_records ALTER COLUMN value TYPE VARCHAR(255)');
  await knex.raw('ALTER TABLE dns_records ALTER COLUMN name TYPE VARCHAR(255)');
}

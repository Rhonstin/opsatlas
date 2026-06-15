import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dns_records', (t) => {
    t.text('value').notNullable().alter();
    t.text('name').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dns_records', (t) => {
    t.string('value', 255).notNullable().alter();
    t.string('name', 255).notNullable().alter();
  });
}

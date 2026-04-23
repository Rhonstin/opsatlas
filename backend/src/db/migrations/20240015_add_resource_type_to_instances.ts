import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (table) => {
    table.string('resource_type', 50).notNullable().defaultTo('compute');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (table) => {
    table.dropColumn('resource_type');
  });
}

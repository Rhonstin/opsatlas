import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('auto_update_runs', (t) => {
    t.integer('instances_synced').notNullable().defaultTo(0);
    t.integer('dns_records_synced').notNullable().defaultTo(0);
    t.integer('cost_rows_upserted').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('auto_update_runs', (t) => {
    t.dropColumn('instances_synced');
    t.dropColumn('dns_records_synced');
    t.dropColumn('cost_rows_upserted');
  });
}

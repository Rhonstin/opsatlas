import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('aws_price_cache', (t) => {
    t.string('instance_type').notNullable();
    t.string('region').notNullable();
    t.decimal('price_hourly', 14, 10).notNullable();
    t.timestamp('fetched_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['instance_type', 'region']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('aws_price_cache');
}

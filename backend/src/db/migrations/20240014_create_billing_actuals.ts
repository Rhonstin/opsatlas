import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('billing_actuals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('connection_id').notNullable().references('id').inTable('cloud_connections').onDelete('CASCADE');
    t.string('provider', 20).notNullable();
    t.string('period', 7).notNullable(); // YYYY-MM
    t.string('project_id', 200).nullable();
    t.string('project_name', 200).nullable();
    t.string('service', 200).nullable();
    t.decimal('amount_usd', 14, 6).notNullable().defaultTo(0);
    t.string('currency', 10).notNullable().defaultTo('USD');
    t.timestamp('fetched_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['connection_id', 'period', 'project_id', 'service']);
  });

  await knex.schema.alterTable('billing_actuals', (t) => {
    t.index(['connection_id', 'period']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('billing_actuals');
}

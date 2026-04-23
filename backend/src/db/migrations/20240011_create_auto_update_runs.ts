import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auto_update_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('policy_id').notNullable().references('id').inTable('auto_update_policies').onDelete('CASCADE');
    t.string('status', 20).notNullable(); // success | error
    t.text('error').nullable();
    t.integer('connections_synced').notNullable().defaultTo(0);
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at').nullable();
  });

  await knex.schema.alterTable('auto_update_runs', (t) => {
    t.index(['policy_id', 'started_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auto_update_runs');
}

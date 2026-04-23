import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auto_update_policies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');

    // Scope: global | connection | provider
    t.string('scope', 20).notNullable().defaultTo('global');
    // target_id: connection_id or null (global/provider scopes)
    t.uuid('target_id').nullable();
    // provider filter for scope=provider (gcp | aws | etc)
    t.string('provider', 20).nullable();

    t.string('name', 100).notNullable();
    t.boolean('enabled').notNullable().defaultTo(true);

    // Interval in minutes (5, 15, 60, 360, 1440)
    t.integer('interval_minutes').notNullable().defaultTo(60);

    // What to refresh
    t.boolean('sync_instances').notNullable().defaultTo(true);
    t.boolean('sync_dns').notNullable().defaultTo(false);
    t.boolean('sync_cost').notNullable().defaultTo(true);

    // Scheduling state
    t.timestamp('last_run_at').nullable();
    t.timestamp('next_run_at').nullable();
    t.string('last_status', 20).nullable(); // success | error | running
    t.text('last_error').nullable();

    // Backoff: consecutive failure count
    t.integer('failure_count').notNullable().defaultTo(0);

    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auto_update_policies');
}

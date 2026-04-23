import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('instances', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.enu('provider', ['gcp', 'aws']).notNullable();
    t.uuid('connection_id').notNullable().references('id').inTable('cloud_connections').onDelete('CASCADE');
    t.uuid('project_or_account_id').nullable().references('id').inTable('projects_or_accounts').onDelete('SET NULL');
    t.string('instance_id').notNullable();
    t.string('name').notNullable();
    t.string('status').notNullable();
    t.string('region').notNullable();
    t.string('zone').nullable();
    t.string('private_ip').nullable();
    t.string('public_ip').nullable();
    t.string('instance_type').nullable();
    t.timestamp('launched_at').nullable();
    t.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
    t.decimal('estimated_hourly_cost', 10, 6).nullable();
    t.decimal('estimated_monthly_cost', 10, 2).nullable();
    t.jsonb('raw_payload').nullable();
    t.timestamps(true, true);
    t.unique(['connection_id', 'instance_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('instances');
}

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('favorite_instances', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['user_id', 'instance_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('favorite_instances');
}

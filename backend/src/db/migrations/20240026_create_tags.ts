import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tags', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('color').notNullable().defaultTo('#6c72f0');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['user_id', 'name']);
  });

  await knex.schema.createTable('instance_tags', (t) => {
    t.uuid('instance_id').notNullable().references('id').inTable('instances').onDelete('CASCADE');
    t.uuid('tag_id').notNullable().references('id').inTable('tags').onDelete('CASCADE');
    t.primary(['instance_id', 'tag_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('instance_tags');
  await knex.schema.dropTableIfExists('tags');
}

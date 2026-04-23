import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dns_connections', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('provider').notNullable(); // 'cloudflare'
    t.string('name').notNullable();
    t.text('credentials_enc').notNullable();
    t.string('status').notNullable().defaultTo('pending'); // 'active' | 'error' | 'pending'
    t.timestamp('last_sync_at').nullable();
    t.text('last_error').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('dns_connections');
}

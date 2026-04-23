import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('projects_or_accounts', (t) => {
    t.timestamp('last_sync_at').nullable();
    t.text('last_error').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('projects_or_accounts', (t) => {
    t.dropColumn('last_sync_at');
    t.dropColumn('last_error');
  });
}

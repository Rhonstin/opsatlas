import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('instances', 'project_or_account_id');
  if (!hasColumn) {
    await knex.schema.alterTable('instances', (t) => {
      t.uuid('project_or_account_id')
        .nullable()
        .references('id')
        .inTable('projects_or_accounts')
        .onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('instances', (t) => {
    t.dropColumn('project_or_account_id');
  });
}

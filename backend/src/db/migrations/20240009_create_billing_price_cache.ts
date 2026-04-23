import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('billing_price_cache');
  if (exists) return;

  await knex.schema.createTable('billing_price_cache', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('family', 16).notNullable();    // e2, n1, n2, ...
    t.string('resource', 8).notNullable();   // cpu | ram
    t.string('region_group', 16).notNullable(); // americas | europe | apac | emea
    t.float('price').notNullable();           // USD per vCPU-hour or GiB-hour
    t.timestamp('fetched_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['family', 'resource', 'region_group']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('billing_price_cache');
}

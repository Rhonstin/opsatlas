import type { Knex } from 'knex';

/**
 * Fix billing_actuals currency semantics.
 *
 * Before: `amount_usd` actually stored the amount already converted to the
 * user's preferred currency (the column name lied), and changing the preferred
 * currency corrupted historical rows. We now keep the RAW provider amount in
 * `source_amount` / `source_currency` and convert on read, so history stays
 * correct regardless of the current display currency.
 *
 * `amount_usd` is retained as a denormalised cache of the last converted value
 * (kept for backward compatibility); the read path recomputes from source.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('billing_actuals', (t) => {
    t.decimal('source_amount', 14, 6).nullable();
    t.string('source_currency', 10).nullable();
  });

  // Best-effort backfill for existing rows: treat the stored value as the source.
  await knex('billing_actuals')
    .whereNull('source_amount')
    .update({
      source_amount: knex.ref('amount_usd'),
      source_currency: knex.ref('currency'),
    });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('billing_actuals', (t) => {
    t.dropColumn('source_amount');
    t.dropColumn('source_currency');
  });
}

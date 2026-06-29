-- ════════════════════════════════════════════════════════════════════════════
-- SCHEMA DRIFT DIAGNOSTIC  (read-only; run in the Supabase SQL editor)
-- Reports every object the legacy db/sql migrations add that is MISSING from the
-- live database, and which migration file supplies it. Run the listed files for
-- any 'MISSING' row. Nothing here writes — it only inspects the catalog.
-- ════════════════════════════════════════════════════════════════════════════
with expected_columns(table_name, column_name, migration) as (values
    ('payments','check_number','add_check_number_to_payments.sql'),
    ('orders','collect_payment_on_delivery','add_collect_payment_on_delivery.sql'),
    ('customers','requires_prepayment','add_customer_requires_prepayment.sql'),
    ('users','dashboard_prefs','add_dashboard_prefs.sql'),
    ('documents','business_domain','add_documents_business_domain.sql'),
    ('salary_agreements','due_day_of_next_month','add_due_day_of_next_month_to_salary_agreements.sql'),
    ('projects','items_to_move','add_items_to_move_to_projects.sql'),
    ('products','low_stock_threshold','add_low_stock_threshold_to_products.sql'),
    ('orders','needs_invoice','add_order_invoice_delivery_fields.sql'),
    ('orders','invoice_sent_at','add_order_invoice_delivery_fields.sql'),
    ('orders','delivery_confirmed_at','add_order_invoice_delivery_fields.sql'),
    ('expenses','paid_date','add_paid_date_to_expenses.sql'),
    ('expenses','payment_method','add_payment_method_to_expenses.sql'),
    ('orders','payment_terms','add_payment_terms.sql'),
    ('orders','due_date','add_payment_terms.sql'),
    ('projects','payment_terms','add_payment_terms.sql'),
    ('projects','due_date','add_payment_terms.sql'),
    ('users','payroll_worker_type','add_payroll_worker_type.sql'),
    ('card_statement_rows','row_index','add_row_index_to_card_statement_rows.sql'),
    ('tasks','is_private','add_task_privacy.sql'),
    ('tasks','private_owner_id','add_task_privacy.sql'),
    ('expenses','transaction_date','add_transaction_date_to_expenses.sql'),
    ('users','avatar_color','add_user_avatar_color.sql'),
    ('users','font_scale','add_user_font_scale.sql'),
    ('payments','vat_rate','add_vat_tracking.sql'),
    ('payments','vat_amount','add_vat_tracking.sql'),
    ('projects','price_includes_vat','add_vat_tracking.sql'),
    ('projects','vat_rate','add_vat_tracking.sql'),
    ('business_settings','audit_logging_enabled','audit_logging_toggle.sql'),
    ('card_statement_rows','assignment_raw','card_statement_drafts.sql'),
    ('card_statement_rows','include','card_statement_drafts.sql'),
    ('card_statements','marked_done','card_statement_drafts.sql'),
    ('card_statement_rows','income_payment_id','card_statement_drafts.sql'),
    ('payments','account_id','create_accounts.sql'),
    ('expenses','account_id','create_accounts.sql'),
    ('worker_payments','account_id','create_accounts.sql'),
    ('loan_repayments','account_id','create_accounts.sql'),
    ('loans','account_id','create_accounts.sql'),
    ('communication_logs','customer_id','create_communication_center.sql'),
    ('communication_logs','user_id','create_communication_center.sql'),
    ('communication_logs','channel','create_communication_center.sql'),
    ('communication_logs','direction','create_communication_center.sql'),
    ('communication_logs','content','create_communication_center.sql'),
    ('communication_logs','category','create_communication_center.sql'),
    ('communication_logs','order_id','create_communication_center.sql'),
    ('communication_logs','project_id','create_communication_center.sql'),
    ('communication_logs','property_id','create_communication_center.sql'),
    ('communication_logs','payment_id','create_communication_center.sql'),
    ('communication_logs','created_by','create_communication_center.sql'),
    ('communication_logs','created_at','create_communication_center.sql'),
    ('reminders','customer_id','create_communication_center.sql'),
    ('reminders','project_id','create_communication_center.sql'),
    ('reminders','assigned_to','create_communication_center.sql'),
    ('reminders','remind_at','create_communication_center.sql'),
    ('reminders','content','create_communication_center.sql'),
    ('reminders','action_type','create_communication_center.sql'),
    ('reminders','status','create_communication_center.sql'),
    ('reminders','category','create_communication_center.sql'),
    ('reminders','order_id','create_communication_center.sql'),
    ('reminders','property_id','create_communication_center.sql'),
    ('reminders','payment_id','create_communication_center.sql'),
    ('reminders','communication_log_id','create_communication_center.sql'),
    ('reminders','created_by','create_communication_center.sql'),
    ('reminders','created_at','create_communication_center.sql'),
    ('reminders','updated_by','create_communication_center.sql'),
    ('reminders','updated_at','create_communication_center.sql'),
    ('customers','morning_client_id','create_morning_integration.sql'),
    ('customers','morning_synced_at','create_morning_integration.sql'),
    ('customers','morning_match_status','create_morning_integration.sql'),
    ('customers','morning_last_sync_error','create_morning_integration.sql'),
    ('expenses','recurring_expense_template_id','create_recurring_expense_templates.sql'),
    ('expenses','recurrence_key','create_recurring_expense_templates.sql'),
    ('tasks','recurring_task_template_id','create_recurring_task_templates.sql'),
    ('tasks','recurrence_key','create_recurring_task_templates.sql'),
    ('vehicles','owner_name','create_tags_and_vehicles.sql'),
    ('customers','city','customers_required_delivery_fields.sql'),
    ('customers','address','customers_required_delivery_fields.sql'),
    ('customers','email','customers_required_delivery_fields.sql'),
    ('users','auth_user_id','decouple_users_from_auth_for_no_access_workers.sql'),
    ('tasks','due_time','tasks_trello_upgrade.sql'),
    ('tasks','city','tasks_trello_upgrade.sql'),
    ('tasks','address','tasks_trello_upgrade.sql'),
    ('reminders','task_id','tasks_trello_upgrade.sql'),
    ('reminders','notified_at','tasks_trello_upgrade.sql'),
    ('attendance_sessions','labor_cost','update_project_financial_views_for_billed_expenses.sql'),
    ('attendance_sessions','is_billable_to_customer','update_project_financial_views_for_billed_expenses.sql'),
    ('attendance_sessions','bill_to_customer_amount','update_project_financial_views_for_billed_expenses.sql'),
    ('attendance_sessions','billing_status','update_project_financial_views_for_billed_expenses.sql')
),
expected_tables(table_name, migration) as (values
    ('idempotency_keys','add_idempotency_keys.sql'),
    ('business_settings','add_vat_tracking.sql'),
    ('accounts','create_accounts.sql'),
    ('card_statements','create_card_statements.sql'),
    ('card_statement_rows','create_card_statements.sql'),
    ('communication_logs','create_communication_center.sql'),
    ('reminders','create_communication_center.sql'),
    ('expense_merchant_mappings','create_expense_merchant_mappings.sql'),
    ('loans','create_loans.sql'),
    ('loan_repayments','create_loans.sql'),
    ('morning_documents','create_morning_integration.sql'),
    ('push_alert_config','create_push_alert_config.sql'),
    ('push_subscriptions','create_push_subscriptions.sql'),
    ('recurring_expense_templates','create_recurring_expense_templates.sql'),
    ('recurring_task_templates','create_recurring_task_templates.sql'),
    ('recurring_task_template_assignees','create_recurring_task_templates.sql'),
    ('tags','create_tags_and_vehicles.sql'),
    ('vehicles','create_tags_and_vehicles.sql'),
    ('entity_tags','create_tags_and_vehicles.sql'),
    ('task_members','tasks_trello_upgrade.sql'),
    ('task_comments','tasks_trello_upgrade.sql')
),
expected_views(view_name, migration) as (values
    ('cash_flow_entries_view','create_cash_flow_entries_view.sql'),
    ('collections_view','create_collections_view.sql'),
    ('delivery_overview_view','create_delivery_overview_view.sql'),
    ('operations_dashboard_view','create_operations_dashboard_view.sql'),
    ('products_with_last_used','create_products_with_last_used_view.sql'),
    ('worker_attendance_monthly_view','create_salary_center_views.sql'),
    ('worker_project_hours_view','create_salary_center_views.sql'),
    ('current_salary_agreements_view','create_salary_center_views.sql'),
    ('payroll_period_summary_view','create_salary_center_views.sql'),
    ('salary_center_worker_overview_view','create_salary_center_views.sql'),
    ('session_effective_payment_view','create_session_effective_payment_view.sql'),
    ('worker_debt_items_view','create_worker_payment_views.sql'),
    ('worker_balance_summary_view','create_worker_payment_views.sql'),
    ('project_worker_balance_view','create_worker_payment_views.sql'),
    ('monthly_worker_balance_view','create_worker_payment_views.sql'),
    ('order_overview_view','fix_zero_total_orders.sql'),
    ('project_financials_view','project_actual_price_use_received.sql'),
    ('cash_flow_view','rename_cash_flow_view_to_monthly.sql'),
    ('customer_overview_view','update_customer_overview_view.sql'),
    ('order_financials_view','update_order_financials_view.sql'),
    ('project_expenses_summary_view','update_project_financial_views_for_billed_expenses.sql'),
    ('financial_project_view','update_project_financial_views_for_billed_expenses.sql')
),
expected_functions(fn_name, migration) as (values
    ('set_my_dashboard_prefs','add_dashboard_prefs.sql'),
    ('task_can_access','add_task_privacy.sql'),
    ('task_can_manage','add_task_privacy.sql'),
    ('set_my_avatar_color','add_user_avatar_color.sql'),
    ('set_my_font_scale','add_user_font_scale.sql'),
    ('set_audit_logging','audit_logging_toggle.sql'),
    ('get_audit_logging','audit_logging_toggle.sql'),
    ('admin_upsert_user_profile','create_admin_upsert_user_profile_rpc.sql'),
    ('set_reminders_updated_at','create_communication_center.sql'),
    ('recurring_expense_apply_tokens','create_recurring_expense_templates.sql'),
    ('recurring_expense_clamped_date','create_recurring_expense_templates.sql'),
    ('generate_recurring_expenses_for_date','create_recurring_expense_templates.sql'),
    ('create_sales_order','create_sales_order_rpc.sql'),
    ('tag_rollup','create_tags_and_vehicles.sql'),
    ('users_fill_auth_user_id_from_existing_auth','decouple_users_from_auth_for_no_access_workers.sql'),
    ('delete_sales_order','delete_sales_order_rpc.sql'),
    ('calculate_line_total','fix_order_line_total_pricing.sql'),
    ('recalculate_order_totals','fix_order_line_total_pricing.sql'),
    ('product_order_stats','fix_products_popularity_global.sql'),
    ('release_order_inventory','release_order_inventory_rpc.sql'),
    ('apply_inventory_movement_effect','sync_inventory_from_movements_trigger.sql'),
    ('sync_inventory_from_movements','sync_inventory_from_movements_trigger.sql'),
    ('task_current_user_id','tasks_trello_upgrade.sql'),
    ('task_is_office_admin','tasks_trello_upgrade.sql'),
    ('set_task_comments_updated_at','tasks_trello_upgrade.sql'),
    ('update_sales_order','update_sales_order_rpc.sql')
)
select 'column' as kind, ec.table_name as object, ec.column_name as detail, ec.migration
  from expected_columns ec
  left join information_schema.columns c
    on c.table_schema='public' and c.table_name=ec.table_name and c.column_name=ec.column_name
 where c.column_name is null
union all
select 'table', et.table_name, null, et.migration
  from expected_tables et
  left join information_schema.tables t
    on t.table_schema='public' and t.table_name=et.table_name
 where t.table_name is null
union all
select 'view', ev.view_name, null, ev.migration
  from expected_views ev
  left join information_schema.views v
    on v.table_schema='public' and v.table_name=ev.view_name
 where v.table_name is null
union all
select 'function', ef.fn_name, null, ef.migration
  from expected_functions ef
  left join pg_proc p
    join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    on p.proname=ef.fn_name
 where p.proname is null
order by kind, object, detail;


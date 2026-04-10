export interface TranslationMeta {
  locale: string;
  name: string;
  nativeName: string;
  variant?: string;
  version: string;
  authors: string[];
  cc_version: string;
}

export interface TranslationStrings {
  permissions: {
    allow: string;
    deny: string;
    ask: string;
    yes_allow_external: string;
    no_disable_external: string;
    yes_trust_settings: string;
    yes_for_session: string;
    yes_remember_dir: string;
    yes_delete: string;
    yes_during_session: string;
    yes_allow_all_edits_session: string;
    yes_use_auto_mode: string;
    yes_bypass_permissions: string;
    yes_auto_accept: string;
    yes_manually_approve: string;
    yes_enter_plan_mode: string;
    yes_use_recommended: string;
    yes_trust_folder: string;
    yes_accept: string;
    yes_enable_auto: string;
    yes_make_default: string;
    no_exit: string;
    no_cancel: string;
    no_keep_tag: string;
    no_not_now: string;
    no_go_back: string;
    no_keep_planning: string;
    no_start_implementing: string;
    no_exit_claude: string;
    no_tell_differently: string;
    waiting_permission: string;
    do_you_proceed: string;
    no_code_changes_until_approve: string;
    allowed_by_auto: string;
    settings_requiring_approval: string;
  };

  modes: {
    default_mode: string;
    plan_mode: string;
    plan_short: string;
    accept_edits: string;
    accept_short: string;
    bypass_permissions: string;
    bypass_short: string;
    dont_ask: string;
    dont_ask_short: string;
    auto_mode: string;
    auto_short: string;
    default_recommended: string;
  };

  status: {
    thinking: string;
    compacting: string;
    running: string;
    running_alt: string;
    connecting: string;
    loading: string;
    loading_conversations: string;
    loading_session: string;
    loading_stats: string;
    loading_your_stats: string;
    loading_diff: string;
    loading_explanation: string;
    loading_output: string;
    loading_plugins: string;
    loading_usage: string;
    loading_environments: string;
    searching: string;
    searching_claude: string;
    search: string;
    resuming: string;
    resuming_session: string;
    initializing: string;
    installing: string;
    processing: string;
    processing_auth: string;
    processing_changes: string;
    updating: string;
    auto_updating: string;
    fetching: string;
    saving_session: string;
    summarizing: string;
    voice_processing: string;
    please_wait: string;
    pasting_text: string;
    teleporting: string;
    interrupted: string;
    task_running: string;
    summarized_conversation: string;
    no_changes_detected: string;
    debug_mode_enabled: string;
    this_may_take_moment: string;
    this_may_take_moments: string;
    ultraplanning: string;
  };

  prompts: {
    press_enter_continue: string;
    press_enter_verify: string;
    press_any_key_continue: string;
    press_any_key_exit: string;
    type_something: string;
    esc_go_back: string;
    save_close_continue: string;
    save_file_continue: string;
    search_settings: string;
  };

  tools: {
    view_tools: string;
  };

  errors: {
    file_not_found: string;
    error_reading_file: string;
    error_searching_files: string;
    installation_failed: string;
    verification_failed: string;
    no_network: string;
    remote_control_failed: string;
    no_clipboard_image: string;
  };

  actions: {
    try_again: string;
    not_now: string;
    never_mind: string;
    exit_fix_manually: string;
    restore_conversation: string;
    help_improve: string;
    clear_auth: string;
    open_homepage: string;
    back_to_list: string;
    manage_marketplaces: string;
    select_marketplace: string;
    discover_plugins: string;
    add_marketplace: string;
    install_github_app: string;
  };

  info: {
    version: string;
    status_prefix: string;
    command_prefix: string;
    location: string;
    config_location: string;
    tools_prefix: string;
    auth_prefix: string;
    url_prefix: string;
    no_hooks_configured: string;
    add_hooks_hint: string;
    no_matching_sessions: string;
    no_conversations_found: string;
    no_scheduled_jobs: string;
    no_tasks_found: string;
    no_tasks_running: string;
    no_agents_found: string;
    no_skills_found: string;
    no_stats_yet: string;
    built_in_agents: string;
    system_prompt: string;
    suggestions: string;
    plan_to_implement: string;
    no_preview: string;
  };

  billing: {
    pro_max_team: string;
    api_billing: string;
    third_party: string;
    using_third_party: string;
    configure_extra: string;
    high_demand_opus: string;
  };

  models: {
    opus_1m: string;
    sonnet_1m: string;
  };
}

export interface CommandStrings {
  [key: string]: string;
}

export interface SubcommandStrings {
  [key: string]: string;
}

export interface ConfigStrings {
  [key: string]: string;
}

export interface TranslationSchema {
  _meta: TranslationMeta;
  [category: string]: Record<string, string> | TranslationMeta;
}

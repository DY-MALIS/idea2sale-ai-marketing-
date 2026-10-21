// Demo data has no authenticated owner. Each entry into demo mode starts with
// an empty workspace so a later visitor on the same browser cannot inherit it.
const DEMO_KEYS = [
  'demo_business_profile',
  'demo_scheduled_posts',
  'demo_agent_conversation',
  'demo_generation_history_video',
  'demo_generation_history_image',
  'demo_generation_history_facebook_scan',
  'copy_prompt_demo',
  'copy_content_type_demo',
  'copy_result_demo',
  'research_query_demo',
  'research_analysis_demo',
  'ads_strategy_demo',
  'ads_creative_demo',
  'ads_scaling_advice_demo',
  'tiktok_handle_demo',
  'tiktok_stats_demo',
];

export const clearDemoWorkspace = () => {
  try {
    DEMO_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Browser storage may be unavailable. Demo screens still reset in memory.
  }
};

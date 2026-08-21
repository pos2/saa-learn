ALTER TABLE `ai_analysis_runs` ADD `prompt_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_analysis_runs` ADD `completion_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_analysis_runs` ADD `reasoning_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_analysis_runs` ADD `total_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_analysis_runs` ADD `attempt_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_analysis_runs` ADD `latency_ms` integer DEFAULT 0 NOT NULL;
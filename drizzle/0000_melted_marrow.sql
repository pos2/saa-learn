CREATE TABLE `ai_analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`system_prompt_snapshot` text NOT NULL,
	`raw_response` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ai_analysis_runs_question_created` ON `ai_analysis_runs` (`question_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_points` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text NOT NULL,
	`exam_cue` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_points_normalized_name` ON `knowledge_points` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_points_status_name` ON `knowledge_points` (`status`,`name`);--> statement-breakpoint
CREATE TABLE `question_knowledge_points` (
	`question_id` text NOT NULL,
	`knowledge_point_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`question_id`, `knowledge_point_id`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_question_knowledge_points_knowledge_id` ON `question_knowledge_points` (`knowledge_point_id`);--> statement-breakpoint
CREATE TABLE `question_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` text NOT NULL,
	`label` text NOT NULL,
	`content` text,
	`explanation` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_question_options_question_label` ON `question_options` (`question_id`,`label`);--> statement-breakpoint
CREATE INDEX `idx_question_options_question_id` ON `question_options` (`question_id`);--> statement-breakpoint
CREATE TABLE `question_tags` (
	`question_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`question_id`, `tag_id`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_question_tags_tag_id` ON `question_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`original_text` text NOT NULL,
	`title` text NOT NULL,
	`answer` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_questions_created_at` ON `questions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_questions_status_updated_at` ON `questions` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tags_kind_normalized_name` ON `tags` (`kind`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_tags_kind_name` ON `tags` (`kind`,`name`);
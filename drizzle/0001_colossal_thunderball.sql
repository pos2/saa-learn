ALTER TABLE `questions` ADD `mastery` text DEFAULT 'unreviewed' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_questions_mastery_updated_at` ON `questions` (`mastery`,`updated_at`);
-- AlterTable
ALTER TABLE "video_jobs" ADD COLUMN "content_type" TEXT NOT NULL DEFAULT '';

ALTER TABLE "video_jobs" ALTER COLUMN "content_type" DROP DEFAULT;

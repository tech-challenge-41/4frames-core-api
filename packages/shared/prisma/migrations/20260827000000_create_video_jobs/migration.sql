-- CreateEnum
CREATE TYPE "VideoJobStatus" AS ENUM ('UPLOAD_PENDING', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "video_jobs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "VideoJobStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

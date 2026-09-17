-- video_jobs v2
-- - id passa de SERIAL para UUID (o id aparece em URL compartilhável e não pode ser enumerável)
-- - colunas do processamento: file_size, failure_reason, zip_key, frame_count, duration_seconds,
--   notified_at e correlation_id
-- - FK para users e índice (user_id, created_at DESC) para a listagem por usuário
--
-- A tabela é recriada em vez de alterada: trocar o tipo da chave primária e adicionar file_size NOT NULL
-- não tem conversão possível para as linhas existentes, que eram apenas jobs de desenvolvimento.
-- ATENÇÃO: esta migration apaga todos os jobs existentes.

-- DropTable
DROP TABLE "video_jobs";

-- CreateTable
CREATE TABLE "video_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "status" "VideoJobStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
    "failure_reason" TEXT,
    "zip_key" TEXT,
    "frame_count" INTEGER,
    "duration_seconds" DOUBLE PRECISION,
    "notified_at" TIMESTAMP(3),
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_jobs_user_id_created_at_idx" ON "video_jobs"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

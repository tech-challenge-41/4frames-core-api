import { VideoValidationError } from '@/application/error/video-validation-error';
import { type IVideoJobService } from '@/domain/ports/service/video-job.service.interface';
import { type IVideoStorageService } from '@/domain/ports/service/video-storage.service.interface';
import { type IUseCase } from '@/domain/ports/use-case';

import { type CreateVideoJobInputDTO, type CreateVideoJobOutputDTO } from './create-video-job.dto';
import { buildVideoSourceKey, contentTypeToExtension } from '../video-storage-key';

const UPLOAD_URL_EXPIRES_IN_SECONDS = 5 * 60;

interface CreateVideoJobUseCaseDependencies {
  videoJobService: IVideoJobService;
  videoStorageService: IVideoStorageService;
}

export class CreateVideoJobUseCase implements IUseCase {
  private readonly videoJobService: IVideoJobService;
  private readonly videoStorageService: IVideoStorageService;

  constructor({ videoJobService, videoStorageService }: CreateVideoJobUseCaseDependencies) {
    this.videoJobService = videoJobService;
    this.videoStorageService = videoStorageService;
  }

  public async execute({ userId, fileName, contentType }: CreateVideoJobInputDTO): Promise<CreateVideoJobOutputDTO> {
    const extension = contentTypeToExtension(contentType);

    if (!extension) {
      throw new VideoValidationError('Unsupported content type', { contentType });
    }

    const job = await this.videoJobService.createUploadPendingJob(userId, fileName, contentType);

    const key = buildVideoSourceKey(userId, job.id, extension);

    const { uploadUrl, expiresIn } = await this.videoStorageService.generatePresignedUploadUrl(
      key,
      contentType,
      UPLOAD_URL_EXPIRES_IN_SECONDS
    );

    return {
      jobId: job.id,
      uploadUrl,
      expiresIn
    };
  }
}

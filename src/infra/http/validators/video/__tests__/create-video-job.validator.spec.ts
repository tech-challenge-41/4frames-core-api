import createVideoJobSchema, { MAX_VIDEO_FILE_SIZE_BYTES } from '../create-video-job.validator';

describe('CreateVideoJobValidator', () => {
  it('should validate a valid video job payload', () => {
    const validData = {
      fileName: 'my-video.mp4',
      fileSize: 1024 * 1024,
      contentType: 'video/mp4'
    };

    const result = createVideoJobSchema.safeParse(validData);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(validData);
  });

  it('should accept video/quicktime as a valid content type', () => {
    const result = createVideoJobSchema.safeParse({
      fileName: 'my-video.mov',
      fileSize: 1024,
      contentType: 'video/quicktime'
    });

    expect(result.success).toBe(true);
  });

  it('should reject empty file name', () => {
    const result = createVideoJobSchema.safeParse({
      fileName: '',
      fileSize: 1024,
      contentType: 'video/mp4'
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Nome do arquivo é obrigatório');
  });

  it('should reject non-string file name', () => {
    const result = createVideoJobSchema.safeParse({
      fileName: 123,
      fileSize: 1024,
      contentType: 'video/mp4'
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Nome do arquivo deve ser uma string');
  });

  it('should reject zero or negative file size', () => {
    const result = createVideoJobSchema.safeParse({
      fileName: 'video.mp4',
      fileSize: 0,
      contentType: 'video/mp4'
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Tamanho do arquivo deve ser maior que zero');
  });

  it('should reject file size above the 500MB limit', () => {
    const result = createVideoJobSchema.safeParse({
      fileName: 'video.mp4',
      fileSize: MAX_VIDEO_FILE_SIZE_BYTES + 1,
      contentType: 'video/mp4'
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Tamanho do arquivo excede o limite de 500MB');
  });

  it('should reject invalid content type', () => {
    const result = createVideoJobSchema.safeParse({
      fileName: 'video.avi',
      fileSize: 1024,
      contentType: 'video/avi'
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Tipo de conteúdo inválido. Permitidos: video/mp4, video/quicktime');
  });
});

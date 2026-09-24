import { buildVideoJobTerminalHtml, type BuildVideoJobEmailHtmlParams } from './video-job-template';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function buildParams(overrides: Partial<BuildVideoJobEmailHtmlParams> = {}): BuildVideoJobEmailHtmlParams {
  return {
    recipientName: 'maria',
    jobId: JOB_ID,
    fileName: 'clip.mp4',
    subject: 'Seu vídeo foi convertido',
    heading: 'Conversão finalizada',
    message: 'A extração de frames terminou com sucesso.',
    color: '#166534',
    jobUrl: `http://localhost:5173/jobs/${JOB_ID}`,
    detailText: '30 frame(s) gerado(s).',
    ...overrides
  };
}

describe('buildVideoJobTerminalHtml', () => {
  it('should render the full e-mail from the Pug template', () => {
    const html = buildVideoJobTerminalHtml(buildParams());

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Seu vídeo foi convertido</title>');
    expect(html).toContain('Conversão finalizada');
    expect(html).toContain('<strong> maria</strong>');
    expect(html).toContain('A extração de frames terminou com sucesso.');
    expect(html).toContain('clip.mp4');
    expect(html).toContain(JOB_ID);
    expect(html).toContain('30 frame(s) gerado(s).');
    expect(html).toContain(`href="http://localhost:5173/jobs/${JOB_ID}"`);
    expect(html).toContain('background-color: #166534');
  });

  it('should leave the detail block out when there is no detail text', () => {
    const withDetail = buildVideoJobTerminalHtml(buildParams());
    const withoutDetail = buildVideoJobTerminalHtml(buildParams({ detailText: undefined }));

    expect(withoutDetail).not.toContain('30 frame(s)');
    expect(withoutDetail.length).toBeLessThan(withDetail.length);
  });

  it('should escape user-controlled text such as the file name and the failure reason', () => {
    const html = buildVideoJobTerminalHtml(
      buildParams({ fileName: '<script>alert(1)</script>.mp4', detailText: 'Motivo: <b>falhou</b>' })
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;.mp4');
    expect(html).toContain('Motivo: &lt;b&gt;falhou&lt;/b&gt;');
  });
});

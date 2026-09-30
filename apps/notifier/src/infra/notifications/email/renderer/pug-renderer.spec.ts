import fs from 'node:fs';
import path from 'node:path';

import pug from 'pug';

import { renderPugTemplate } from './pug-renderer';

// O cache de templates compilados vive no módulo: cada teste usa um caminho próprio para não
// herdar o que outro já compilou.
describe('renderPugTemplate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should render a template from src with the given locals', () => {
    const html = renderPugTemplate('infra/notifications/email/templates/layouts/base-email.pug', {
      subject: 'Assunto',
      heading: 'Conversão finalizada',
      color: '#166534',
      recipientName: 'maria'
    });

    expect(html).toContain('<title>Assunto</title>');
    expect(html).toContain('Conversão finalizada');
    expect(html).toContain('maria');
    expect(html).toContain('background-color: #166534');
  });

  it('should compile each template only once', () => {
    const compileFile = jest.spyOn(pug, 'compileFile');
    const templatePath = 'infra/notifications/email/templates/video-job/video-job-terminal.pug';
    const locals = { subject: 's', heading: 'h', message: 'm', color: '#000', recipientName: 'r', jobUrl: '/' };

    const first = renderPugTemplate(templatePath, { ...locals, fileName: 'a.mp4' });
    const second = renderPugTemplate(templatePath, { ...locals, fileName: 'b.mp4' });

    expect(compileFile).toHaveBeenCalledTimes(1);
    expect(first).toContain('a.mp4');
    expect(second).toContain('b.mp4');
  });

  it('should fall back to dist when the template is not under src (compiled image)', () => {
    const distPath = path.resolve(process.cwd(), 'dist', 'fake/only-in-dist.pug');
    jest.spyOn(fs, 'existsSync').mockImplementation(candidate => candidate === distPath);
    const compileFile = jest.spyOn(pug, 'compileFile').mockReturnValue(() => '<p>dist</p>');

    expect(renderPugTemplate('fake/only-in-dist.pug', {})).toBe('<p>dist</p>');
    expect(compileFile).toHaveBeenCalledWith(distPath);
  });

  it('should fail with the relative path when the template does not exist', () => {
    expect(() => renderPugTemplate('missing/template.pug', {})).toThrow(
      'Template file not found: missing/template.pug'
    );
  });
});

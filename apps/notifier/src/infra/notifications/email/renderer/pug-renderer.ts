import fs from 'node:fs';
import path from 'node:path';

import pug from 'pug';

type CompiledTemplate = (locals?: object) => string;

const compiledTemplateCache = new Map<string, CompiledTemplate>();

function resolveTemplatePath(templateRelativePath: string): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'src', templateRelativePath),
    path.resolve(process.cwd(), 'dist', templateRelativePath)
  ];

  const templatePath = candidatePaths.find(candidatePath => fs.existsSync(candidatePath));

  if (!templatePath) {
    throw new Error(`Template file not found: ${templateRelativePath}`);
  }

  return templatePath;
}

export function renderPugTemplate<T extends object>(templateRelativePath: string, locals: T): string {
  const compiledTemplate = compiledTemplateCache.get(templateRelativePath);

  if (compiledTemplate) {
    return compiledTemplate(locals);
  }

  const templatePath = resolveTemplatePath(templateRelativePath);
  const template = pug.compileFile(templatePath);
  compiledTemplateCache.set(templateRelativePath, template);

  return template(locals);
}

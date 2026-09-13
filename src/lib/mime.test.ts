import { describe, expect, it } from 'vitest';
import { contentTypePorExtension } from './mime';

describe('contentTypePorExtension', () => {
  it('reconoce las extensiones más comunes en el estudio', () => {
    expect(contentTypePorExtension('pdf')).toBe('application/pdf');
    expect(contentTypePorExtension('docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(contentTypePorExtension('jpg')).toBe('image/jpeg');
  });

  it('no distingue mayúsculas de minúsculas', () => {
    expect(contentTypePorExtension('PDF')).toBe('application/pdf');
    expect(contentTypePorExtension('Png')).toBe('image/png');
  });

  it('devuelve application/octet-stream para una extensión desconocida', () => {
    expect(contentTypePorExtension('xyz')).toBe('application/octet-stream');
  });
});

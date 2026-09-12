// Mapeo mínimo extensión -> Content-Type. Alcanza para que el navegador
// sepa cómo renderizar el archivo al abrirlo inline (ver documentos.ts
// GET /:id/descargar); no pretende ser exhaustivo.
const MAPA_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
};

export function contentTypePorExtension(extension: string): string {
  return MAPA_MIME[extension.toLowerCase()] ?? 'application/octet-stream';
}
